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
const { injectPdfJsBundle, isPdfjsAvailable } = require('./pdfjs-inline');
const signing = require('./signing');
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
  // 6b. ED25519 DUAL-SIGNATURE (Phase 2B — invisible-with-fallback)
  //
  // signing.signEd25519() returns null if no primary key is configured
  // (Phase 2A invisible mode — production state today). When that happens,
  // the pipeline proceeds with HMAC only and the document is byte-equivalent
  // to a Phase 2A doc.
  //
  // The Ed25519 payload INTENTIONALLY does NOT include codeIntegrity, because
  // codeIntegrity is computed after obfuscation and the signature is embedded
  // in the inline script (chicken-and-egg). The HMAC chain_token below still
  // covers codeIntegrity — Ed25519 is a parallel asymmetric proof of document
  // identity, not a replacement for the chain.
  // -----------------------------------------------------------------
  // Phase 2B Fix #2: wrap signEd25519 in try/catch. If crypto.sign() throws
  // at runtime (corrupted KeyObject, OpenSSL failure, hardware issue), the
  // pipeline must degrade to HMAC-only rather than aborting doc creation
  // entirely. Phase 2B's "invisible-with-fallback" contract requires graceful
  // degradation.
  // Phase 3B: signEd25519 is now async — it consults
  // keyManager.getActivePrimary() which reads ed25519_keys WHERE state='active'
  // behind a 30s cache. The surrounding try/catch still works because await
  // inside try/catch catches rejections the same way it catches sync throws.
  let ed25519Result = null;
  try {
    ed25519Result = await signing.signEd25519(signing.buildSigningPayload({
      hash: fileHash,
      orgId,
      createdAt: timestamp,
      recipientHash: recipientHash || '',
      codeIntegrity: ''   // Intentionally empty — see comment above
    }));
  } catch (e) {
    logger.warn({ err: e.message, event: 'ed25519_sign_failed' }, '[pvf-pipeline] Ed25519 signing failed — falling back to HMAC-only');
    ed25519Result = null;
  }
  const ed25519Signature = ed25519Result ? ed25519Result.signature : null;
  const ed25519KeyId = ed25519Result ? ed25519Result.keyId : null;

  // -----------------------------------------------------------------
  // 6c. PHASE 2E — Hard requirement (fail-closed)
  //
  // When ED25519_REQUIRED=1 is set, Ed25519 signing is MANDATORY. If the
  // signing step produced no signature — whether because no primary key
  // was loaded at boot, or because crypto.sign() threw — we ABORT PVF
  // creation rather than silently producing an HMAC-only document.
  //
  // This is the point where Vertifile transitions from "dual-signed with
  // graceful HMAC fallback" to "dual-signed or nothing". No customer will
  // ever receive an HMAC-only document issued after Phase 2E deployment.
  //
  // Phase 2A invariant still holds: when ED25519_REQUIRED is unset (or any
  // value other than '1'), the pipeline degrades to HMAC-only exactly as
  // in Phase 2B. This is the safe default for local dev and CI runs that
  // don't have a test Ed25519 keypair configured.
  // -----------------------------------------------------------------
  // STRICT '1' equality — see tests/pipeline-phase2e.test.js Scenario E.
  // Truthy coercion (=== 'true', !!, parseInt, etc.) is FORBIDDEN here: a future
  // refactor that "helpfully" accepts more values would silently activate Phase 2E
  // in dev environments that ship ED25519_REQUIRED=0 in .env.example. The strict
  // check is the contract.
  if (process.env.ED25519_REQUIRED === '1' && (!ed25519Signature || !ed25519KeyId)) {
    // Discriminator: which failure mode fired? The inner try/catch (line 250) sets
    // ed25519Result=null on EITHER "no primary key loaded" OR "crypto.sign threw".
    // For on-call triage we want to know which — config issue (rotate env vars) vs.
    // runtime/hardware issue (escalate to security). The inner try/catch already
    // logs 'ed25519_sign_failed' for the throw path; this discriminator is for the
    // enforcement log specifically.
    const failMode = ed25519Result === null
      ? 'no_primary_key_or_sign_returned_null'
      : 'half_state_signature_or_keyid_missing';
    logger.error({
      event: 'ed25519_required_fail_closed',
      failMode,
      hash: fileHash.substring(0, 16),
      orgId
    }, '[pvf-pipeline] ED25519_REQUIRED=1 but no Ed25519 signature produced — aborting PVF creation');
    throw new Error('ED25519_REQUIRED_NO_SIGNATURE');
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
  // Phase 2B: Ed25519 signature + keyId passed through. When no key is
  // configured both are null and the template omits var SIG_ED / var KEY_ID
  // entirely — documents are byte-equivalent to Phase 2A.
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
    shareId,
    timestamp,         // Phase 2B Fix #1 — single source of truth for created_at
    ed25519Signature,  // Phase 2B — null if no key configured
    ed25519KeyId       // Phase 2B — null if no key configured
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
    createdAt: timestamp,  // Phase 2B Fix #1 — same ISO string used in Ed25519 payload & HTML template
    orgId,
    orgName,
    token,
    tokenCreatedAt,
    recipient: recipient || null,
    recipientHash,
    ed25519_signature: ed25519Signature,
    ed25519_key_id: ed25519KeyId
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
  // 14. INJECT PDF.JS BUNDLE (PDFs only, non-op for other MIME types)
  // Must run BEFORE obfuscatePvf so the obfuscator's regex only matches
  // the main <script> (plain, no attributes). Our injected tags carry
  // id attributes and will be skipped by the obfuscator.
  //
  // Fail fast on PDF uploads when vendor files are missing — the boot sanity
  // check in server.js logs a loud warning but intentionally does not crash
  // so text/image uploads still work. Without this guard the user would get
  // a cryptic ENOENT from fs.readFileSync inside injectPdfJsBundle.
  // -----------------------------------------------------------------
  if (mimeType === 'application/pdf' && !isPdfjsAvailable()) {
    throw new Error('PDF support unavailable: vendor files missing');
  }
  pvfHtml = injectPdfJsBundle(pvfHtml, mimeType);

  // -----------------------------------------------------------------
  // 15. OBFUSCATE — same seed (first 8 hex chars of hash → 32-bit int)
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
  // Phase 2B: ed25519Signature/ed25519KeyId are added to the internal
  // result for future consumers (Phase 2C verify, Phase 2D migration).
  // They are NOT yet surfaced in HTTP responses — call sites (wrappers in
  // pvf-generator.js handleCreatePvf and routes/user.js upload) don't
  // expose them in JSON responses. That's Phase 2C/D territory.
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
    token,
    ed25519Signature: ed25519Signature || null,
    ed25519KeyId: ed25519KeyId || null
  };
}

// ============================================================================
// ZERO-KNOWLEDGE (PVF 2.0) — ENCRYPTED UPLOAD PIPELINE
// ============================================================================
//
// createPvfEncrypted() is the parallel of createPvf() for encrypted uploads.
// The server NEVER sees the original document content — only the encrypted
// blob + client-provided SHA-256 hash. The hash is signed by HMAC + Ed25519
// exactly as in v1.0, binding it to the org and timestamp.
//
// This function is intentionally separate from createPvf() to avoid polluting
// the battle-tested v1.0 pipeline with branching logic. Both functions share
// the same signing, obfuscation, and persistence helpers.
// ============================================================================

// escapeHtml/sanitizeSvg import removed — generateEncryptedPvfHtml deleted; template handles its own escaping

/**
 * Generate a URL-friendly slug from a filename.
 *
 * Algorithm (matches ZERO-KNOWLEDGE-SPEC.md Section 5):
 *   1. Strip file extension
 *   2. Normalize unicode (NFKD), strip combining marks
 *   3. Lowercase
 *   4. Replace non-alphanumeric with hyphens
 *   5. Collapse consecutive hyphens, trim leading/trailing
 *   6. Truncate to 64 chars
 *   7. Fallback to 'document' if empty
 *
 * @param {string} filename - Original filename
 * @returns {string} slug (without uniqueness suffix)
 */
function generateSlug(filename) {
  let slug = (filename || 'document').replace(/\.[^.]+$/, '');
  slug = slug.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  slug = slug.toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-|-$/g, '');
  slug = slug.substring(0, 64);
  if (!slug) slug = 'document';
  return slug;
}

/**
 * Generate a unique slug, retrying with random suffixes on collision.
 * Falls back to shareId if all retries fail.
 *
 * @param {string} originalName - Original filename
 * @param {string} shareId - Fallback identifier
 * @returns {Promise<string>} unique slug
 */
async function generateUniqueSlug(originalName, shareId) {
  const base = generateSlug(originalName);

  // Try the bare slug first
  const existing = await db.getDocumentBySlug(base);
  if (!existing) return base;

  // Collision — retry with random 4-hex-char suffix, up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const candidate = base + '-' + suffix;
    const collision = await db.getDocumentBySlug(candidate);
    if (!collision) return candidate;
  }

  // All retries exhausted — fall back to shareId
  return shareId;
}

// generateEncryptedPvfHtml() has been REMOVED.
// PVF 2.0 HTML is now generated by the SAME generatePvfHtml() template (templates/pvf.js)
// with encryptedOpts = { encrypted: true, encryptedBase64, iv } as the 16th parameter.
// This eliminates the hollow-shell duplicate template and ensures all viewer features
// (toolbar, stamp, PDF.js, print, zoom, crypto functions) are present in v2.0 PVFs.
/* --- REMOVED: generateEncryptedPvfHtml() body ---
 * The entire function (~350 lines) was a hollow HTML template without viewer code.
 * PVF 2.0 HTML is now generated by generatePvfHtml() in templates/pvf.js
 * with the encryptedOpts parameter. See createPvfEncrypted() step 10.
 *
 * Original function signature was:
 * function generateEncryptedPvfHtml({ encryptedBase64, iv, hash, signature, ... })
 *
 * DELETED CONTENT: ~350 lines of duplicate HTML/CSS/JS template
 --- END REMOVED ---
*/

// Placeholder to keep line references stable: the old function body occupied ~350 lines
// starting at the opening brace through the return of the HTML template string.

/* --- The old function content was here. Now cleaned up. --- */

/**
 * Create a PVF from an ENCRYPTED document upload (Zero-Knowledge mode).
 * The server NEVER sees the original content -- only the encrypted blob +
 * client-provided hash.
 *
 * Pipeline mirrors createPvf() steps exactly, with these differences:
 *   - Hash comes from client (not computed by server)
 *   - File content is the encrypted blob (not original document)
 *   - PVF HTML uses the SAME template (generatePvfHtml) with encryptedOpts flag
 *   - Slug is generated for human-readable URLs
 *   - DB row includes encrypted=true, iv, slug, pvf_version='2.0'
 *
 * @param {Object} opts
 * @param {Buffer} opts.encryptedBlob - AES-256-GCM encrypted document content
 * @param {string} opts.hash - SHA-256 of the ORIGINAL content (client-computed, 64 hex chars)
 * @param {string} opts.iv - Base64 IV used for encryption (decodes to 12 bytes)
 * @param {string} opts.mimeType - Original file MIME type
 * @param {string} opts.originalName - Original filename
 * @param {Object} opts.owner - { type, id, displayName, email, plan }
 * @param {string} [opts.recipient] - optional recipient string for binding
 * @param {Object} [opts.branding] - optional pre-fetched branding row
 * @param {string} [opts.apiKey] - optional, for incrementDocCount
 * @param {Object} [opts.req] - optional Express req, for IP audit logging
 * @returns {Promise<Object>} { success, hash, shareId, slug, timestamp, ... }
 */
async function createPvfEncrypted(opts) {
  // -----------------------------------------------------------------
  // 1. INPUT VALIDATION
  // -----------------------------------------------------------------
  if (!opts || typeof opts !== 'object') {
    throw new Error('INVALID_OPTS');
  }
  const { encryptedBlob, hash, iv, mimeType, owner, recipient, apiKey, req } = opts;
  let { branding } = opts;
  const originalName = sanitizeOriginalName(opts.originalName);

  if (!encryptedBlob || !Buffer.isBuffer(encryptedBlob)) {
    throw new Error('INVALID_BUFFER');
  }
  if (encryptedBlob.length === 0) {
    throw new Error('EMPTY_FILE');
  }

  // Validate client-provided hash is exactly 64 lowercase hex chars
  if (!hash || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('INVALID_HASH');
  }

  // Validate IV: must be valid base64 that decodes to exactly 12 bytes
  if (!iv || typeof iv !== 'string') {
    throw new Error('INVALID_IV');
  }
  try {
    const ivBytes = Buffer.from(iv, 'base64');
    if (ivBytes.length !== 12) {
      throw new Error('INVALID_IV');
    }
  } catch (e) {
    if (e.message === 'INVALID_IV') throw e;
    throw new Error('INVALID_IV');
  }

  if (!mimeType || typeof mimeType !== 'string') {
    throw new Error('INVALID_MIME_TYPE');
  }
  const mimeOk = ALLOWED_MIME_TYPES.some(
    t => mimeType === t || mimeType.startsWith(t.split('/')[0] + '/')
  );
  if (!mimeOk) {
    await db.log('create_rejected', {
      reason: 'invalid_file_type',
      mimeType,
      encrypted: true,
      ip: req ? getClientIP(req) : null
    }).catch(() => {});
    throw new Error('INVALID_MIME_TYPE');
  }
  if (!owner || !owner.type) {
    throw new Error('INVALID_OWNER');
  }

  // -----------------------------------------------------------------
  // 2. DERIVE orgId
  // -----------------------------------------------------------------
  const orgId = deriveOrgId(owner);
  const orgName = owner.displayName || 'VERTIFILE';

  // -----------------------------------------------------------------
  // 3. HASH -- use client-provided hash (zero-knowledge: server cannot verify)
  // -----------------------------------------------------------------
  const fileHash = hash;

  // -----------------------------------------------------------------
  // 4. HMAC SIGNATURE (signs the client-provided hash)
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
  // 6b. ED25519 DUAL-SIGNATURE
  // -----------------------------------------------------------------
  let ed25519Result = null;
  try {
    ed25519Result = await signing.signEd25519(signing.buildSigningPayload({
      hash: fileHash,
      orgId,
      createdAt: timestamp,
      recipientHash: recipientHash || '',
      codeIntegrity: ''
    }));
  } catch (e) {
    logger.warn({ err: e.message, event: 'ed25519_sign_failed' }, '[pvf-pipeline] Ed25519 signing failed for encrypted upload -- falling back to HMAC-only');
    ed25519Result = null;
  }
  const ed25519Signature = ed25519Result ? ed25519Result.signature : null;
  const ed25519KeyId = ed25519Result ? ed25519Result.keyId : null;

  // -----------------------------------------------------------------
  // 6c. PHASE 2E ENFORCEMENT
  // -----------------------------------------------------------------
  if (process.env.ED25519_REQUIRED === '1' && (!ed25519Signature || !ed25519KeyId)) {
    const failMode = ed25519Result === null
      ? 'no_primary_key_or_sign_returned_null'
      : 'half_state_signature_or_keyid_missing';
    logger.error({
      event: 'ed25519_required_fail_closed',
      failMode,
      hash: fileHash.substring(0, 16),
      orgId,
      encrypted: true
    }, '[pvf-pipeline] ED25519_REQUIRED=1 but no Ed25519 signature -- aborting encrypted PVF creation');
    throw new Error('ED25519_REQUIRED_NO_SIGNATURE');
  }

  // -----------------------------------------------------------------
  // 7. ENCODE -- encrypted blob is always base64
  // -----------------------------------------------------------------
  const encryptedBase64 = encryptedBlob.toString('base64');

  // -----------------------------------------------------------------
  // 8. FETCH BRANDING
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
  // 9. GENERATE shareId + slug
  // -----------------------------------------------------------------
  const shareId = crypto.randomBytes(8).toString('base64url');
  const slug = await generateUniqueSlug(originalName, shareId);

  // -----------------------------------------------------------------
  // 10. GENERATE PVF 2.0 HTML (uses the SAME template as v1.0 with encrypted flag)
  // -----------------------------------------------------------------
  let pvfHtml = generatePvfHtml(
    '',                        // fileBase64 — not used in encrypted mode
    originalName,
    fileHash,
    mimeType,
    signature,
    recipientHash || '',
    branding.custom_icon,
    branding.brand_color,
    orgName,
    orgId,
    branding.wave_color,
    shareId,
    timestamp,
    ed25519Signature,
    ed25519KeyId,
    { encrypted: true, encryptedBase64, iv }  // encryptedOpts — triggers v2.0 mode
  );

  // -----------------------------------------------------------------
  // 11. CREATE DOCUMENT ROW
  // -----------------------------------------------------------------
  await db.createDocument({
    hash: fileHash,
    signature,
    originalName,
    mimeType,
    fileSize: encryptedBlob.length,
    createdAt: timestamp,
    orgId,
    orgName,
    token,
    tokenCreatedAt,
    recipient: recipient || null,
    recipientHash,
    shareId,
    ed25519_signature: ed25519Signature,
    ed25519_key_id: ed25519KeyId
  });

  // -----------------------------------------------------------------
  // 12. USER DOC COUNT
  // -----------------------------------------------------------------
  if (owner.type === 'user') {
    await db.setDocumentUserId(fileHash, owner.id);
    await db.updateUserDocCount(owner.id);
  }

  // -----------------------------------------------------------------
  // 13. INCREMENT API KEY DOC COUNT
  // -----------------------------------------------------------------
  if (apiKey && apiKey !== 'demo') {
    try {
      await db.incrementDocCount(apiKey);
    } catch (e) {
      logger.warn({ err: e }, 'incrementDocCount failed');
    }
  }

  // -----------------------------------------------------------------
  // 14. INJECT PDF.JS BUNDLE (PDFs only)
  // -----------------------------------------------------------------
  if (mimeType === 'application/pdf' && !isPdfjsAvailable()) {
    throw new Error('PDF support unavailable: vendor files missing');
  }
  pvfHtml = injectPdfJsBundle(pvfHtml, mimeType);

  // -----------------------------------------------------------------
  // 15. OBFUSCATE
  // -----------------------------------------------------------------
  const seed = parseInt(fileHash.substring(0, 8), 16);
  pvfHtml = await obfuscatePvf(pvfHtml, seed);

  // -----------------------------------------------------------------
  // 16. CODE INTEGRITY
  // -----------------------------------------------------------------
  const scriptMatch = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
  const codeIntegrity = scriptMatch
    ? crypto.createHash('sha256').update(scriptMatch[1]).digest('hex')
    : null;
  if (!codeIntegrity) {
    logger.warn(
      { event: 'code_integrity_missing', hash: fileHash.substring(0, 16), encrypted: true },
      'No <script> block found in encrypted PVF -- codeIntegrity will be null'
    );
  }

  // -----------------------------------------------------------------
  // 17. CHAIN TOKEN
  // -----------------------------------------------------------------
  const chainToken = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(fileHash + signature + orgId + (codeIntegrity || ''))
    .digest('hex');

  // -----------------------------------------------------------------
  // 18. PERSIST INTEGRITY + SHAREID + SLUG + AUDIT LOG
  // -----------------------------------------------------------------
  await Promise.all([
    db.saveCodeIntegrity(fileHash, codeIntegrity, chainToken),
    db.setShareId(fileHash, shareId),
    db.setSlug(fileHash, slug),
    db.log('pvf_created', {
      orgId,
      hash: fileHash,
      originalName,
      mimeType,
      fileSize: encryptedBlob.length,
      encrypted: true,
      slug,
      ip: req ? getClientIP(req) : null
    })
  ]);

  // Set encrypted flag + IV + version on the document row
  await db.query(
    'UPDATE documents SET encrypted = $1, iv = $2, pvf_version = $3 WHERE hash = $4',
    [true, iv, '2.0', fileHash]
  );

  // -----------------------------------------------------------------
  // 19. SAVE OBFUSCATED PVF CONTENT
  // -----------------------------------------------------------------
  await db.savePvfContent(fileHash, pvfHtml);

  // -----------------------------------------------------------------
  // 20. PREVIEW-ONLY GATING (free-plan dashboard users only)
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
  // 21. FIRE-AND-FORGET BLOCKCHAIN REGISTRATION
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
          encrypted: true,
          error: err && err.message
        }).catch(() => {});
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
    logger.warn({ err: e, event: 'blockchain_dispatch_error' }, 'Blockchain dispatch threw');
  }

  logger.info(
    {
      event: 'create_pvf_encrypted',
      file: originalName,
      mimeType,
      hash: fileHash.substring(0, 24),
      org: orgName,
      slug,
      sizeKB: (encryptedBlob.length / 1024).toFixed(1)
    },
    `Encrypted PVF created: ${originalName}`
  );

  // -----------------------------------------------------------------
  // 22. RETURN STRUCTURED RESULT
  // -----------------------------------------------------------------
  return {
    success: true,
    shareId,
    slug,
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
    token,
    encrypted: true,
    ed25519Signature: ed25519Signature || null,
    ed25519KeyId: ed25519KeyId || null
  };
}

module.exports = {
  createPvf,
  createPvfEncrypted,
  ALLOWED_MIME_TYPES,
  // Exposed for unit tests / future callers; safe pure helpers
  deriveOrgId,
  encodeFileForTemplate,
  sanitizeOriginalName,
  generateSlug,
  generateUniqueSlug
  // generateEncryptedPvfHtml removed — single-template approach via generatePvfHtml()
};
