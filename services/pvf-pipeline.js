/**
 * Vertifile Unified PVF Creation Pipeline
 * ============================================================================
 *
 * SECURITY CRITICAL — read this carefully before modifying.
 *
 * This module is the SINGLE place where PVF documents are created. Both the
 * public API (services/pvf-generator.js handleCreatePvf) and the dashboard
 * upload route (routes/user.js POST /upload) call into createPvf() here.
 *
 * The output of createPvf() — every byte of the obfuscated HTML, every
 * database side effect, every audit log entry — must be byte-identical
 * to the previous per-endpoint implementations. Phase 1B introduced this
 * unification to eliminate the chronic drift between the two near-identical
 * code paths and to fix the SHAREID post-obfuscation patch bug.
 *
 * Sequence (do NOT reorder without security review):
 *   1. Validate input (mime allowlist, non-empty buffer)
 *   2. Hash raw bytes (BLIND — never reads document content)
 *   3. HMAC sign the hash
 *   4. Generate session token + recipient binding
 *   5. Encode file (text → HTML escape, binary → base64)
 *   6. Fetch branding (sequential with try/catch)
 *   7. Generate shareId BEFORE generatePvfHtml (THIS IS THE SHAREID FIX)
 *   8. generatePvfHtml(... shareId)  ← shareId baked in pre-obfuscation
 *   9. createDocument (db row insert)
 *  10. setDocumentUserId + updateUserDocCount (user uploads only)
 *  11. incrementDocCount (apiKey-bearing requests only)
 *  12. obfuscatePvf
 *  13. extract codeIntegrity
 *  14. compute chainToken (sha256(hash + signature + orgId + codeIntegrity))
 *  15. saveCodeIntegrity (with chainedToken)
 *  16. setShareId on documents row
 *  17. savePvfContent (full obfuscated HTML)
 *  18. markDocumentPreviewOnly (free-plan gating, user uploads only)
 *  19. fire-and-forget blockchain registration
 *  20. audit log
 *  21. return structured result
 *
 * NOTE: HMAC_SECRET key management lives in pvf-generator.js. We import the
 * helpers from there to avoid duplicating the secret-loading logic.
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const { obfuscatePvf } = require('../obfuscate');
const { generatePvfHtml } = require('../templates/pvf');
const { HMAC_SECRET, hashBytes, signHash, generateToken } = require('./pvf-generator');
const chain = require('../blockchain');
const db = require('../db');
const { getClientIP } = require('../middleware/auth');

// ----------------------------------------------------------------------------
// Allowed MIME types — superset of the API allowlist (8 types) and the
// dashboard upload allowlist (5 types). Both endpoints now share this list.
// ----------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'text/plain',
  'text/html',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

/**
 * Derive the orgId from owner.{type,id}.
 *
 * Convention is preserved EXACTLY from the existing codebase:
 *   - 'user' → 'user_' + numeric user.id  (matches routes/user.js:83)
 *   - 'org'  → owner.id as-is             (already 'org_<key>' from auth middleware)
 *   - 'demo' → owner.id as-is             (caller supplies 'org_demo' from routes/api.js:179)
 *
 * Centralizing this in one place is the whole point of Phase 1B.
 */
function deriveOrgId(owner) {
  if (!owner || !owner.type) {
    throw new Error('INVALID_OWNER_TYPE');
  }
  switch (owner.type) {
    case 'user':
      return 'user_' + owner.id;
    case 'org':
    case 'demo':
      return String(owner.id);
    default:
      throw new Error('INVALID_OWNER_TYPE');
  }
}

/**
 * HTML-escape a text payload — same logic the per-endpoint code used for
 * text/plain and text/html previews. Binary types skip this and go to base64.
 */
function encodeFileForTemplate(buffer, mimeType) {
  if (mimeType.startsWith('text/')) {
    return buffer.toString('utf-8')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  return buffer.toString('base64');
}

/**
 * Sanitize a filename — preserves the API path's behavior of stripping
 * filesystem-unsafe characters. Dashboard uploads bypassed this in the old
 * code but it's safe to apply universally.
 */
function sanitizeOriginalName(originalName) {
  return (originalName || 'document').replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Unified PVF creation pipeline. See module header for the exact sequence.
 *
 * @param {Object} opts
 * @param {Buffer} opts.buffer - Raw file bytes (caller owns the multer file)
 * @param {string} opts.originalName - Filename, UTF-8 normalized by caller
 * @param {string} opts.mimeType - MIME type, validated against ALLOWED_MIME_TYPES
 * @param {Object} opts.owner
 * @param {'user'|'org'|'demo'} opts.owner.type
 * @param {string|number} opts.owner.id - numeric user.id OR string orgId
 * @param {string} [opts.owner.plan] - 'free'|'starter'|'pro'|'enterprise'
 * @param {string} [opts.owner.email] - optional, for admin bypass
 * @param {string} opts.owner.displayName - human-readable orgName
 * @param {string} [opts.recipient] - optional recipient string for binding
 * @param {Object} [opts.branding] - optional pre-fetched branding row
 * @param {string} [opts.apiKey] - optional, for incrementDocCount
 * @param {Object} [opts.req] - optional Express req, for IP audit logging
 * @param {boolean} [opts.sanitizeFilename=true] - strip filesystem-unsafe chars.
 *        The legacy public API path always sanitized; the legacy dashboard
 *        upload path did NOT. Wrappers pass the value matching their legacy.
 * @returns {Promise<Object>} structured result — see README in module header
 */
async function createPvf(opts) {
  // -----------------------------------------------------------------
  // 1. INPUT VALIDATION
  // -----------------------------------------------------------------
  if (!opts || typeof opts !== 'object') {
    throw new Error('INVALID_OPTS');
  }
  const { buffer, mimeType, owner, recipient, apiKey, req } = opts;
  let { branding } = opts;
  // Sanitize unless caller opts out (dashboard upload preserves raw names
  // for byte-identity with the legacy /api/user/upload contract).
  const sanitizeFilename = opts.sanitizeFilename !== false;
  const originalName = sanitizeFilename
    ? sanitizeOriginalName(opts.originalName)
    : (opts.originalName || 'document');

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('INVALID_BUFFER');
  }
  if (buffer.length === 0) {
    throw new Error('EMPTY_FILE');
  }
  if (!mimeType || typeof mimeType !== 'string') {
    throw new Error('INVALID_MIME_TYPE');
  }
  // Allow exact match OR same top-level type (e.g. image/png matches image/jpeg
  // family — preserves the existing pvf-generator.js loose match)
  const mimeOk = ALLOWED_MIME_TYPES.some(
    t => mimeType === t || mimeType.startsWith(t.split('/')[0] + '/')
  );
  if (!mimeOk) {
    // Audit log mirrors pvf-generator.js:102
    await db.log('create_rejected', {
      reason: 'invalid_file_type',
      mimeType,
      ip: req ? getClientIP(req) : null
    }).catch(() => { /* never block on audit */ });
    throw new Error('INVALID_MIME_TYPE');
  }
  if (!owner || !owner.type) {
    throw new Error('INVALID_OWNER');
  }

  // -----------------------------------------------------------------
  // 2. DERIVE orgId — single source of truth
  // -----------------------------------------------------------------
  const orgId = deriveOrgId(owner);
  const orgName = owner.displayName || 'VERTIFILE';

  // -----------------------------------------------------------------
  // 3. HASH (BLIND — never reads document content)
  // -----------------------------------------------------------------
  const fileHash = hashBytes(buffer);

  // -----------------------------------------------------------------
  // 4. HMAC SIGNATURE
  // -----------------------------------------------------------------
  const signature = signHash(fileHash);

  // -----------------------------------------------------------------
  // 5. SESSION TOKEN + TIMESTAMP
  // -----------------------------------------------------------------
  const token = generateToken();
  const timestamp = new Date().toISOString();
  const tokenCreatedAt = Date.now();

  // -----------------------------------------------------------------
  // 6. RECIPIENT BINDING (optional)
  // -----------------------------------------------------------------
  let recipientHash = null;
  if (recipient) {
    recipientHash = crypto
      .createHash('sha256')
      .update(String(recipient).toLowerCase().trim())
      .digest('hex');
  }

  // -----------------------------------------------------------------
  // 7. ENCODE FILE (text → HTML escape, binary → base64)
  // -----------------------------------------------------------------
  const fileBase64 = encodeFileForTemplate(buffer, mimeType);

  // -----------------------------------------------------------------
  // 8. FETCH BRANDING (sequential with try/catch — mirrors user.js:109-112)
  // The user.js pattern handles missing org rows more gracefully than the
  // parallel pattern in pvf-generator.js, so we use it as the unified path.
  // -----------------------------------------------------------------
  if (!branding) {
    try {
      branding = await db.getBranding(orgId);
    } catch (e) {
      branding = null;
    }
  }
  if (!branding) {
    branding = { custom_icon: null, brand_color: null, wave_color: null };
  }

  // -----------------------------------------------------------------
  // 9. GENERATE shareId BEFORE generatePvfHtml (THE SHAREID FIX)
  // -----------------------------------------------------------------
  const shareId = crypto.randomBytes(8).toString('base64url');

  // -----------------------------------------------------------------
  // 10. GENERATE PVF HTML — shareId is now baked in pre-obfuscation
  // -----------------------------------------------------------------
  let pvfHtml = generatePvfHtml(
    fileBase64,
    originalName,
    fileHash,
    mimeType,
    signature,
    recipientHash,
    branding.custom_icon,
    branding.brand_color,
    orgName,
    orgId,
    branding.wave_color,
    shareId   // ← NEW final parameter (Step A.1)
  );

  // -----------------------------------------------------------------
  // 11. CREATE DOCUMENT ROW
  // The richer API-flow shape includes token/recipient/recipientHash; for
  // dashboard uploads these are simply null. createDocument handles nulls.
  // -----------------------------------------------------------------
  await db.createDocument({
    hash: fileHash,
    signature,
    originalName,
    mimeType,
    fileSize: buffer.length,
    orgId,
    orgName,
    token,
    tokenCreatedAt,
    recipient: recipient || null,
    recipientHash
  });

  // -----------------------------------------------------------------
  // 12. USER DOC COUNT (only when owner is a logged-in user)
  // -----------------------------------------------------------------
  if (owner.type === 'user') {
    await db.setDocumentUserId(fileHash, owner.id);
    await db.updateUserDocCount(owner.id);
  }

  // -----------------------------------------------------------------
  // 13. INCREMENT API KEY DOC COUNT (skip for demo)
  // -----------------------------------------------------------------
  if (apiKey && apiKey !== 'demo') {
    try {
      await db.incrementDocCount(apiKey);
    } catch (e) {
      logger.warn({ err: e }, 'incrementDocCount failed');
    }
  }

  // -----------------------------------------------------------------
  // 14. OBFUSCATE — same seed (first 8 hex chars of hash → 32-bit int)
  // -----------------------------------------------------------------
  const seed = parseInt(fileHash.substring(0, 8), 16);
  pvfHtml = await obfuscatePvf(pvfHtml, seed);

  // -----------------------------------------------------------------
  // 15. CODE INTEGRITY (sha256 of obfuscated <script> body)
  // -----------------------------------------------------------------
  const scriptMatch = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
  const codeIntegrity = scriptMatch
    ? crypto.createHash('sha256').update(scriptMatch[1]).digest('hex')
    : null;
  if (!codeIntegrity) {
    logger.warn(
      { event: 'code_integrity_missing', hash: fileHash.substring(0, 16) },
      'No <script> block found in PVF — codeIntegrity will be null'
    );
  }

  // -----------------------------------------------------------------
  // 16. CHAIN TOKEN
  // Formula MUST stay byte-identical to the existing per-endpoint code:
  //   sha256(hash + signature + orgId + codeIntegrity)
  // No separators. Ed25519 separators come in Phase 3, NOT here.
  // -----------------------------------------------------------------
  const chainToken = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(fileHash + signature + orgId + (codeIntegrity || ''))
    .digest('hex');

  // -----------------------------------------------------------------
  // 17. PERSIST INTEGRITY + SHAREID + AUDIT LOG (parallelized)
  // saveCodeIntegrity already accepts (hash, codeIntegrity, chainedToken)
  // — there is no separate db.saveChainToken function.
  // -----------------------------------------------------------------
  await Promise.all([
    db.saveCodeIntegrity(fileHash, codeIntegrity, chainToken),
    db.setShareId(fileHash, shareId),
    db.log('pvf_created', {
      orgId,
      hash: fileHash,
      originalName,
      mimeType,
      fileSize: buffer.length,
      ip: req ? getClientIP(req) : null
    })
  ]);

  // -----------------------------------------------------------------
  // 18. SAVE OBFUSCATED PVF CONTENT (full HTML blob)
  // The shareId is ALREADY embedded inside pvfHtml (Step 10). The old
  // post-obfuscation .replace('var SHAREID=""', ...) call is dead code now.
  // -----------------------------------------------------------------
  await db.savePvfContent(fileHash, pvfHtml);

  // -----------------------------------------------------------------
  // 19. PREVIEW-ONLY GATING (free-plan dashboard users only)
  // Admin bypass: zur2525@gmail.com always full access.
  // info@vertifile.com is also bypassed (mirrors routes/user.js:156).
  // -----------------------------------------------------------------
  let preview = false;
  if (owner.type === 'user') {
    const isAdmin =
      owner.email === 'zur2525@gmail.com' || owner.email === 'info@vertifile.com';
    const isPaidPlan = isAdmin || (owner.plan && owner.plan !== 'free');
    if (!isPaidPlan) {
      await db.markDocumentPreviewOnly(fileHash, true);
      preview = true;
    }
  }

  // -----------------------------------------------------------------
  // 20. FIRE-AND-FORGET BLOCKCHAIN REGISTRATION
  // Same global._blockchainRetryQueue pattern from pvf-generator.js:199-211.
  // Moving the queue out of the global is Phase 1C cleanup, not 1B's job.
  // -----------------------------------------------------------------
  try {
    if (chain.isConnected()) {
      chain.register(fileHash, signature, orgName).then(async (result) => {
        if (result && result.success && result.txHash) {
          await db.log('blockchain_registered', {
            hash: fileHash,
            txHash: result.txHash,
            blockNumber: result.blockNumber
          });
        }
      }).catch(async (err) => {
        logger.warn({ err, event: 'blockchain_retry' }, 'Registration failed, queued for retry');
        await db.log('blockchain_failed', {
          hash: fileHash,
          orgId,
          error: err && err.message
        }).catch(() => { /* never block */ });
        if (!global._blockchainRetryQueue) global._blockchainRetryQueue = [];
        global._blockchainRetryQueue.push({
          hash: fileHash,
          signature,
          orgName,
          failedAt: Date.now()
        });
      });
    }
  } catch (e) {
    // Blockchain failures NEVER break PVF creation
    logger.warn({ err: e, event: 'blockchain_dispatch_error' }, 'Blockchain dispatch threw');
  }

  logger.info(
    {
      event: 'create_pvf',
      file: originalName,
      mimeType,
      hash: fileHash.substring(0, 24),
      org: orgName,
      sizeKB: (buffer.length / 1024).toFixed(1)
    },
    `PVF created: ${originalName}`
  );

  // -----------------------------------------------------------------
  // 21. RETURN STRUCTURED RESULT
  // -----------------------------------------------------------------
  return {
    success: true,
    shareId,
    hash: fileHash,
    signature,
    recipientHash,
    timestamp,
    orgId,
    orgName,
    pvfHtml,
    fileName: originalName.replace(/\.[^.]+$/, '') + '.pvf',
    preview,
    codeIntegrity,
    chainToken,
    token
  };
}

module.exports = {
  createPvf,
  ALLOWED_MIME_TYPES,
  // Exposed for unit tests / future callers; safe pure helpers
  deriveOrgId,
  encodeFileForTemplate,
  sanitizeOriginalName
};
