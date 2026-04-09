const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const chain = require('../blockchain');
const logger = require('./logger');
const { obfuscatePvf } = require('../obfuscate');
const { generatePvfHtml } = require('../templates/pvf');
const { injectPdfJsBundle } = require('./pdfjs-inline');
const { getClientIP } = require('../middleware/auth');

// ===== HMAC Secret — persistent (survives restarts) =====
const HMAC_FILE = path.join(__dirname, '..', 'data', '.hmac-secret');
function loadOrCreateHmacSecret() {
  // 1. Environment variable takes priority
  if (process.env.HMAC_SECRET) return process.env.HMAC_SECRET;
  // 2. Try to load from persistent file
  try {
    if (fs.existsSync(HMAC_FILE)) {
      const secret = fs.readFileSync(HMAC_FILE, 'utf8').trim();
      if (secret.length >= 32) return secret;
    }
  } catch (e) { /* fall through */ }
  // 3. Generate new secret and persist it
  const secret = 'vf_secret_' + crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(HMAC_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HMAC_FILE, secret, { mode: 0o600 }); // owner-only permissions
    logger.info({ event: 'hmac_secret_created' }, 'New HMAC secret generated and saved');
  } catch (e) {
    logger.error({ err: e, event: 'hmac_secret_error' }, 'Could not persist HMAC secret');
  }
  return secret;
}
const HMAC_SECRET = loadOrCreateHmacSecret();

// Hash raw bytes — BLIND (never reads document content)
function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// HMAC signature — proves hash was registered by our server
function signHash(hash) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(hash).digest('hex');
}

// Verify HMAC signature
function verifySignature(hash, signature) {
  const expected = signHash(hash);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Generate random token for session verification
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Content Security Policy for PVF files
function setPvfSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'self'",                // PVF inline scripts need 'unsafe-inline'; 'self' enables PDF.js worker loading from /vendor/pdfjs/
    "worker-src 'self'",                                // Allow same-origin Web Workers (PDF.js)
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src data: blob:",
    "connect-src 'self'",                               // Allow API calls back to origin
    "frame-src data:",                                  // Allow PDF iframe with data: URI
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'"                            // Prevent embedding in foreign iframes
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// Fix multer Latin1 filename encoding — decode to UTF-8
function fixFilename(file) {
  if (file && file.originalname) {
    try {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch(e) { /* keep original */ }
  }
  return file;
}

// ============================================================================
// PVF CREATION HANDLER
// ============================================================================
//
// Phase 1B: this is now a thin wrapper around services/pvf-pipeline.createPvf().
// The unified pipeline is the SINGLE source of truth for PVF creation, used by
// both this handler and routes/user.js POST /upload.
//
// Feature flag PVF_PIPELINE_V2 (default ON):
//   - PVF_PIPELINE_V2 !== '0'  → new unified pipeline path (createPvf)
//   - PVF_PIPELINE_V2 === '0'  → legacy 159-line per-endpoint path (rollback)
//
// The legacy implementation is preserved verbatim as handleCreatePvfLegacy
// below. Do NOT delete it until at least one production release validates
// the new pipeline. Deletion is a separate PR.
// ============================================================================
async function handleCreatePvf(req, res) {
  // Emergency rollback path
  if (process.env.PVF_PIPELINE_V2 === '0') {
    return handleCreatePvfLegacy(req, res);
  }

  try {
    if (req.file) fixFilename(req.file);
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Lazy require to avoid module-load circular dependency.
    // pvf-pipeline.js imports HMAC_SECRET/hashBytes/signHash/generateToken
    // from THIS file at top level, so it can only safely be required after
    // pvf-generator.js has finished evaluating its module.exports.
    const { createPvf } = require('./pvf-pipeline');

    // Determine owner shape — demo and authenticated API both look like 'org'
    // from the pipeline's POV; we use 'demo' explicitly so the pipeline can
    // log appropriately (and to keep behavior crisp for future telemetry).
    const ownerType = req.apiKey === 'demo' ? 'demo' : 'org';
    const owner = {
      type: ownerType,
      id: req.org.orgId,           // already 'org_<key>' or 'org_demo'
      displayName: req.org.orgName
    };

    const recipient = (req.body && req.body.recipient) || (req.query && req.query.recipient) || null;

    let result;
    try {
      result = await createPvf({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype || 'application/octet-stream',
        owner,
        recipient,
        apiKey: req.apiKey,
        req
      });
    } catch (err) {
      // Map pipeline-domain errors to HTTP responses
      if (err && err.message === 'INVALID_MIME_TYPE') {
        return res.status(400).json({
          success: false,
          error: 'Unsupported file type: ' + (req.file.mimetype || 'unknown')
        });
      }
      if (err && err.message === 'EMPTY_FILE') {
        return res.status(400).json({ success: false, error: 'Empty file uploaded' });
      }
      throw err;
    }

    // Build share URL (force HTTPS behind proxy) — same logic as legacy
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const baseUrl = process.env.BASE_URL || `${proto}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/d/${result.shareId}`;
    logger.info({ event: 'pvf_shared', shareUrl }, `Share URL: ${shareUrl}`);

    // JSON response (for API integrations)
    if (req.query.format === 'json' || req.headers.accept === 'application/json') {
      return res.json({
        success: true,
        hash: result.hash,
        signature: result.signature.substring(0, 16) + '...',
        shareUrl,
        shareId: result.shareId,
        fileName: result.fileName,
        fileSize: result.pvfHtml.length,
        downloadUrl: `${baseUrl}/d/${result.shareId}/download`
      });
    }

    // Binary .pvf download with security headers
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('X-PVF-Share-URL', shareUrl);
    return res.send(result.pvfHtml);

  } catch (error) {
    logger.error({ err: error, event: 'create_pvf_error' }, 'Create PVF failed');
    return res.status(500).json({ success: false, error: 'Failed to create PVF' });
  }
}

// ============================================================================
// LEGACY PVF CREATION HANDLER  (Phase 1B rollback path)
// ============================================================================
// This is the previous (pre-Phase-1B) implementation, preserved verbatim.
// It is reachable only when PVF_PIPELINE_V2=0. Do NOT modify — if you find
// a bug here, fix it in services/pvf-pipeline.js too. This file exists
// solely so an emergency rollback is one env var away.
// ============================================================================
async function handleCreatePvfLegacy(req, res) {
  try {
    if (req.file) fixFilename(req.file);
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileBuffer = req.file.buffer;
    const originalName = (req.file.originalname || 'document').replace(/[<>:"/\\|?*]/g, '_'); // Sanitize filename
    const mimeType = req.file.mimetype || 'application/octet-stream';

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'text/plain', 'text/html',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.some(t => mimeType.startsWith(t.split('/')[0] + '/') || mimeType === t)) {
      await db.log('create_rejected', { reason: 'invalid_file_type', mimeType, ip: getClientIP(req) });
      return res.status(400).json({ success: false, error: 'Unsupported file type: ' + mimeType });
    }

    // Validate file not empty
    if (fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Empty file uploaded' });
    }

    // Step 1: Hash raw bytes (BLIND — never reads content)
    const fileHash = hashBytes(fileBuffer);

    // Step 2: HMAC sign the hash (proves it was registered by our server)
    const signature = signHash(fileHash);

    // Step 3: Generate session token
    const token = generateToken();
    const timestamp = new Date().toISOString();

    // Step 3.5: Recipient binding (optional)
    const recipient = req.body?.recipient || req.query?.recipient || null;
    let recipientHash = null;
    if (recipient) {
      recipientHash = crypto.createHash('sha256').update(recipient.toLowerCase().trim()).digest('hex');
    }

    // Step 4+5: Register document + get branding + update stats (parallelized)
    const isText = mimeType.startsWith('text/');
    let fileBase64;
    if (isText) {
      fileBase64 = fileBuffer.toString('utf-8')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      fileBase64 = fileBuffer.toString('base64');
    }

    const [, branding] = await Promise.all([
      db.createDocument({
        hash: fileHash,
        signature,
        originalName,
        mimeType,
        fileSize: fileBuffer.length,
        orgId: req.org.orgId,
        orgName: req.org.orgName,
        token,
        tokenCreatedAt: Date.now(),
        recipient,
        recipientHash
      }),
      db.getBranding(req.org.orgId),
      (req.apiKey && req.apiKey !== 'demo') ? db.incrementDocCount(req.apiKey).catch(e => logger.warn({ err: e }, 'incrementDocCount failed')) : Promise.resolve()
    ]);
    let pvfHtml = generatePvfHtml(fileBase64, originalName, fileHash, mimeType, signature, recipientHash, branding.custom_icon, branding.brand_color, req.org.orgName, req.org.orgId, branding.wave_color);

    // Inject PDF.js bundle for PDFs only (no-op for other MIME types).
    // Must run BEFORE obfuscatePvf — the obfuscator regex /<script>/ only
    // matches tags with no attributes, so our <script id="pdfjs-..."> tags
    // are skipped automatically. See services/pdfjs-inline.js for details.
    pvfHtml = injectPdfJsBundle(pvfHtml, mimeType);

    // Obfuscate the JavaScript inside the PVF (deterministic per document hash)
    const seed = parseInt(fileHash.substring(0, 8), 16);
    pvfHtml = await obfuscatePvf(pvfHtml, seed);

    // Compute code integrity hash + chained token (after obfuscation)
    const scriptMatch2 = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
    const codeIntegrity = scriptMatch2
      ? crypto.createHash('sha256').update(scriptMatch2[1]).digest('hex')
      : null;
    const chainedToken = crypto.createHmac('sha256', HMAC_SECRET)
      .update(fileHash + signature + req.org.orgId + codeIntegrity)
      .digest('hex');
    // Generate shareable link ID
    const shareId = crypto.randomBytes(8).toString('base64url'); // Short URL-safe ID

    // Parallelise independent DB writes
    await Promise.all([
      db.saveCodeIntegrity(fileHash, codeIntegrity, chainedToken),
      db.log('pvf_created', {
        orgId: req.org.orgId,
        hash: fileHash,
        originalName,
        mimeType,
        fileSize: fileBuffer.length,
        ip: getClientIP(req)
      }),
      db.setShareId(fileHash, shareId)
    ]);

    logger.info({ event: 'create_pvf', file: originalName, mimeType, hash: fileHash.substring(0, 24), org: req.org.orgName, sizeKB: (fileBuffer.length / 1024).toFixed(1) }, `PVF created: ${originalName}`);

    // Inject shareId into the PVF HTML now that it's been generated
    pvfHtml = pvfHtml.replace('var SHAREID=""', 'var SHAREID="' + shareId + '"');

    // Save PVF content to database (persists across deploys)
    await db.savePvfContent(fileHash, pvfHtml);

    // Register on blockchain (non-blocking — doesn't fail PVF creation)
    if (chain.isConnected()) {
      chain.register(fileHash, signature, req.org.orgName).then(async result => {
        if (result.success && result.txHash) {
          await db.log('blockchain_registered', { hash: fileHash, txHash: result.txHash, blockNumber: result.blockNumber });
        }
      }).catch(async err => {
        logger.warn({ err, event: 'blockchain_retry' }, 'Registration failed, queued for retry');
        await db.log('blockchain_failed', { hash: fileHash, orgId: req.org.orgId, error: err.message });
        // Store failed registration for retry
        if (!global._blockchainRetryQueue) global._blockchainRetryQueue = [];
        global._blockchainRetryQueue.push({ hash: fileHash, signature, orgName: req.org.orgName, failedAt: Date.now() });
      });
    }

    // Build share URL (force HTTPS behind proxy)
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const baseUrl = process.env.BASE_URL || `${proto}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/d/${shareId}`;

    logger.info({ event: 'pvf_shared', shareUrl }, `Share URL: ${shareUrl}`);

    // Check if client wants JSON response (for API integrations)
    if (req.query.format === 'json' || req.headers.accept === 'application/json') {
      return res.json({
        success: true,
        hash: fileHash,
        signature: signature.substring(0, 16) + '...',
        shareUrl,
        shareId,
        fileName: originalName.replace(/\.[^.]+$/, '') + '.pvf',
        fileSize: pvfHtml.length,
        downloadUrl: `${baseUrl}/d/${shareId}/download`
      });
    }

    // Return .pvf file with security headers
    const pvfFileName = originalName.replace(/\.[^.]+$/, '') + '.pvf';
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName}"`);
    res.setHeader('X-PVF-Share-URL', shareUrl);
    res.send(pvfHtml);

  } catch (error) {
    logger.error({ err: error, event: 'create_pvf_error' }, 'Create PVF failed');
    res.status(500).json({ success: false, error: 'Failed to create PVF' });
  }
}

module.exports = {
  HMAC_SECRET,
  hashBytes,
  signHash,
  verifySignature,
  generateToken,
  setPvfSecurityHeaders,
  fixFilename,
  handleCreatePvf,
  handleCreatePvfLegacy
};
