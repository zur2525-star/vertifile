const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const logger = require('../services/logger');
const { sendDocumentReadyEmail } = require('../services/email');

// Configurable bcrypt rounds (floor of 12) — match auth.js convention
const BCRYPT_ROUNDS = Math.max(12, parseInt(process.env.BCRYPT_ROUNDS) || 12);

const requireAuth = require('../middleware/requireAuth');
const { hashBytes, signHash, fixFilename, HMAC_SECRET } = require('../services/pvf-generator');
const { generatePvfHtml, escapeHtml } = require('../templates/pvf');
const { obfuscatePvf } = require('../obfuscate');
// Phase 1B: unified PVF creation pipeline. Lazy-required inside the upload
// handler so the legacy code path keeps working unchanged when the feature
// flag is off.
const pvfPipeline = require('../services/pvf-pipeline');
const { validatePassword } = require('../services/password-validator');

// Rate limiter for upload endpoints — 30 uploads per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Upload limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for general user actions (POST/PUT) — 30 per 15 min per IP
const userActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limiter for destructive operations (DELETE) — 10 per hour per IP
const destructiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Delete limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const router = express.Router();

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  res.json({ success: true, user: {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    avatar: req.user.avatar_url,
    plan: req.user.plan,
    isAdmin: adminEmails.has((req.user.email || '').toLowerCase()),
    documentsUsed: req.user.documents_used,
    documentsLimit: req.user.documents_limit,
    email_verified: !!req.user.email_verified,
    stampConfig: req.user.stamp_config || {},
    stampUpdatedAt: req.user.stamp_updated_at
  }});
});

// Stamp config (Layer 2 — visual wrapper)
router.get('/stamp', requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const result = await db.getUserStampConfig(req.user.id);
    res.json({ success: true, stampConfig: result?.config || {}, updatedAt: result?.updatedAt });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load stamp config' }); }
});

router.post('/stamp', requireAuth, userActionLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid body' });
    }
    if (JSON.stringify(req.body).length > 10000) {
      return res.status(400).json({ success: false, error: 'Stamp configuration too large' });
    }
    const saved = await db.updateUserStampConfig(req.user.id, req.body);
    // Invalidate cache so next /d/:shareId/raw rebuilds with new stamp
    if (req.app.get('stampCache')) req.app.get('stampCache').delete(req.user.id);
    await db.log('stamp_config_updated', { userId: req.user.id });
    res.json({ success: true, stampConfig: saved });
  } catch(e) {
    logger.error({ err: e }, 'Stamp config update failed');
    res.status(400).json({ success: false, error: 'Failed to update stamp config' });
  }
});

router.get('/documents', requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const starred = req.query.starred === 'true';
    const docs = await db.getUserDocuments(req.user.id, { limit, offset, search, starred });
    const total = await db.getUserDocumentCount(req.user.id);
    // Sanitize the Ed25519 columns before sending them over the wire:
    //   * drop the raw 64-byte signature blob (the dashboard never needs it —
    //     the /d/{shareId} viewer verifies signatures server-side),
    //   * expose a cheap is_dual_signed boolean that the sidebar renders,
    //   * keep ed25519_key_id so the sidebar can show which key signed it.
    const sanitized = docs.map(function(d) {
      var isDualSigned = !!d.ed25519_signature;
      var out = Object.assign({}, d);
      delete out.ed25519_signature;
      out.is_dual_signed = isDualSigned;
      return out;
    });
    res.json({ success: true, documents: sanitized, total, limit, offset });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load documents' }); }
});

// ============================================================================
// POST /api/user/upload — dashboard PVF creation
// ============================================================================
//
// Phase 1B: thin wrapper around services/pvf-pipeline.createPvf().
// Feature flag PVF_PIPELINE_V2 (default ON):
//   - PVF_PIPELINE_V2 !== '0'  → unified pipeline path
//   - PVF_PIPELINE_V2 === '0'  → legacy 121-line per-endpoint path (rollback)
// The legacy implementation is preserved verbatim as `uploadLegacy` below.
// ============================================================================
router.post('/upload', requireAuth, uploadLimiter, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files'
        : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
        : 'File upload failed';
      return res.status(400).json({ success: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  // Emergency rollback path
  if (process.env.PVF_PIPELINE_V2 === '0') {
    return uploadLegacy(req, res);
  }

  try {
    const db = req.app.get('db');

    if (req.file) fixFilename(req.file);
    // Overage tracking — never block uploads, charge overage instead
    const overLimit = req.user.documents_used >= req.user.documents_limit;
    const overageFlag = overLimit && req.user.plan !== 'enterprise';
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    // Dashboard's strict allowlist (5 types). The pipeline's allowlist is a
    // superset; we enforce the dashboard restriction here at the boundary so
    // dashboard users continue to see the same rejection behavior.
    const dashboardAllowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain'];
    if (!dashboardAllowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }

    let result;
    try {
      result = await pvfPipeline.createPvf({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        owner: {
          type: 'user',
          id: req.user.id,
          plan: req.user.plan,
          email: req.user.email,
          displayName: req.user.name || req.user.email.split('@')[0]
        },
        // Dashboard legacy did NOT sanitize filenames — preserve byte-identity
        sanitizeFilename: false,
        req
      });
    } catch (err) {
      if (err && (err.message === 'INVALID_MIME_TYPE' || err.message === 'EMPTY_FILE')) {
        return res.status(400).json({ success: false, error: 'Unsupported file type' });
      }
      throw err;
    }

    // Track overage in overage_log (non-blocking — never fail the upload)
    let overageInfo = null;
    try {
      overageInfo = await db.trackOverage(req.user.id, req.user.plan || 'pro');
    } catch (trackErr) {
      logger.error('[OVERAGE TRACK]', trackErr.message);
    }

    // Build response — match the legacy two-shape contract exactly
    if (result.preview) {
      return res.json({
        success: true,
        preview: true,
        previewUrl: '/d/' + result.shareId,
        shareId: result.shareId,
        hash: result.hash,
        fileName: req.file.originalname,
        message: 'Document protected! Subscribe to download.',
        upgradeUrl: '/pricing',
        documentsUsed: req.user.documents_used + 1,
        documentsLimit: req.user.documents_limit,
        overage: overageFlag,
        overageInfo
      });
    }

    // Send document-ready notification email (best effort -- never blocks upload response)
    if (req.user.email) {
      const docShareUrl = `${req.protocol}://${req.get('host')}/d/${result.shareId}`;
      sendDocumentReadyEmail(req.user.email, req.file.originalname, docShareUrl).catch(() => {});
    }

    return res.json({
      success: true,
      hash: result.hash,
      shareId: result.shareId,
      fileName: req.file.originalname,
      documentsUsed: req.user.documents_used + 1,
      documentsLimit: req.user.documents_limit,
      overage: overageFlag,
      overageInfo
    });
  } catch(e) {
    logger.error('[USER UPLOAD]', e.message);
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ============================================================================
// POST /api/user/upload-encrypted — Zero-Knowledge PVF 2.0 creation
// ============================================================================
// The client encrypts the document with AES-256-GCM before upload. The server
// receives only the encrypted blob, the client-computed SHA-256 hash, the IV,
// and metadata. The AES key never touches the server.
//
// Form fields (multipart):
//   file          - encrypted blob (binary)
//   hash          - SHA-256 hex of original content (64 chars)
//   iv            - base64 IV (decodes to 12 bytes)
//   mimeType      - original MIME type
//   originalName  - original filename
// ============================================================================
router.post('/upload-encrypted', requireAuth, uploadLimiter, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files'
        : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
        : 'File upload failed';
      return res.status(400).json({ success: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  try {
    const db = req.app.get('db');

    // Overage tracking — never block uploads, charge overage instead
    const encOverLimit = req.user.documents_used >= req.user.documents_limit;
    const encOverageFlag = encOverLimit && req.user.plan !== 'enterprise';
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    if (!req.body.hash || !req.body.iv) {
      return res.status(400).json({ success: false, error: 'Missing encryption parameters (hash, iv)' });
    }

    // Dashboard's strict allowlist for original MIME type
    const mimeType = req.body.mimeType || 'application/octet-stream';
    const dashboardAllowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain'];
    if (!dashboardAllowedTypes.includes(mimeType)) {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }

    // ── Idempotency: prevent replay attacks (Yonatan P0) ─────────────
    // If a document with the same content hash already exists AND belongs
    // to this user, return the existing shareId/slug instead of creating
    // a duplicate. This neutralises replay of captured upload requests.
    const existingDoc = await db.getDocument(req.body.hash);
    if (existingDoc && existingDoc.user_id === req.user.id) {
      return res.json({
        success: true,
        hash: existingDoc.hash,
        shareId: existingDoc.shareId,
        slug: existingDoc.slug,
        shareUrl: '/d/' + (existingDoc.slug || existingDoc.shareId),
        fileName: (req.body.originalName || req.file.originalname || 'document').replace(/\.[^.]+$/, '') + '.pvf',
        documentsUsed: req.user.documents_used,
        documentsLimit: req.user.documents_limit,
        deduplicated: true
      });
    }

    let result;
    try {
      result = await pvfPipeline.createPvfEncrypted({
        encryptedBlob: req.file.buffer,
        hash: req.body.hash,
        iv: req.body.iv,
        mimeType,
        originalName: req.body.originalName || req.file.originalname || 'document',
        owner: {
          type: 'user',
          id: req.user.id,
          plan: req.user.plan,
          email: req.user.email,
          displayName: req.user.name || req.user.email.split('@')[0]
        },
        req
      });
    } catch (err) {
      if (err && err.message === 'INVALID_MIME_TYPE') {
        return res.status(400).json({ success: false, error: 'Unsupported file type' });
      }
      if (err && err.message === 'INVALID_HASH') {
        return res.status(400).json({ success: false, error: 'Invalid hash format. Expected 64-char lowercase hex.' });
      }
      if (err && err.message === 'INVALID_IV') {
        return res.status(400).json({ success: false, error: 'Invalid IV. Must be base64-encoded 12 bytes.' });
      }
      if (err && err.message === 'EMPTY_FILE') {
        return res.status(400).json({ success: false, error: 'Empty file' });
      }
      throw err;
    }

    // Track overage in overage_log (non-blocking)
    let encOverageInfo = null;
    try {
      encOverageInfo = await db.trackOverage(req.user.id, req.user.plan || 'pro');
    } catch (trackErr) {
      logger.error('[OVERAGE TRACK]', trackErr.message);
    }

    // Build response
    if (result.preview) {
      return res.json({
        success: true,
        preview: true,
        previewUrl: '/d/' + result.slug,
        shareId: result.shareId,
        slug: result.slug,
        shareUrl: '/d/' + result.slug,
        hash: result.hash,
        fileName: (req.body.originalName || req.file.originalname || 'document').replace(/\.[^.]+$/, '') + '.pvf',
        message: 'Document protected! Subscribe to download.',
        upgradeUrl: '/pricing',
        documentsUsed: req.user.documents_used + 1,
        documentsLimit: req.user.documents_limit,
        overage: encOverageFlag,
        overageInfo: encOverageInfo
      });
    }

    return res.json({
      success: true,
      hash: result.hash,
      shareId: result.shareId,
      slug: result.slug,
      shareUrl: '/d/' + result.slug,
      fileName: (req.body.originalName || req.file.originalname || 'document').replace(/\.[^.]+$/, '') + '.pvf',
      documentsUsed: req.user.documents_used + 1,
      documentsLimit: req.user.documents_limit,
      overage: encOverageFlag,
      overageInfo: encOverageInfo
    });
  } catch (e) {
    logger.error('[ENCRYPTED UPLOAD]', e.message);
    return res.status(500).json({ success: false, error: 'Encrypted upload failed' });
  }
});

// ============================================================================
// LEGACY UPLOAD HANDLER  (Phase 1B rollback path)
// ============================================================================
// Pre-Phase-1B implementation, preserved verbatim. Reachable only when
// PVF_PIPELINE_V2=0. Do NOT modify — fix bugs in services/pvf-pipeline.js
// instead. This file exists solely for the 30-second rollback safety net.
// ============================================================================
async function uploadLegacy(req, res) {
  try {
    const db = req.app.get('db');

    if (req.file) fixFilename(req.file);
    // Overage tracking — never block uploads, charge overage instead
    const legacyOverLimit = req.user.documents_used >= req.user.documents_limit;
    const legacyOverageFlag = legacyOverLimit && req.user.plan !== 'enterprise';
    // Reuse existing PVF creation logic - set req.org for handleCreatePvf
    req.org = { orgId: 'user_' + req.user.id, orgName: req.user.name || req.user.email.split('@')[0] };
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }

    const fileHash = hashBytes(file.buffer);
    const signature = signHash(fileHash);
    const isText = file.mimetype.startsWith('text/');
    let fileBase64;
    if (isText) {
      fileBase64 = file.buffer.toString('utf-8')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      fileBase64 = file.buffer.toString('base64');
    }

    // Get user branding
    let branding = { custom_icon: null, brand_color: null, wave_color: null };
    try {
      const userBranding = await db.getBranding(req.org.orgId);
      if (userBranding) branding = userBranding;
    } catch(e) { /* use defaults */ }

    await db.createDocument({
      hash: fileHash,
      signature,
      orgId: req.org.orgId,
      orgName: req.org.orgName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size
    });

    // Set user_id on document
    await db.setDocumentUserId(fileHash, req.user.id);
    await db.updateUserDocCount(req.user.id);

    let pvfHtml = generatePvfHtml(fileBase64, file.originalname, fileHash, file.mimetype, signature, null, branding.custom_icon, branding.brand_color, req.org.orgName, req.org.orgId, branding.wave_color);

    // Obfuscate PVF
    const seed = parseInt(fileHash.substring(0, 8), 16);
    pvfHtml = await obfuscatePvf(pvfHtml, seed);

    // Compute code integrity hash (hash of the script content after obfuscation)
    const scriptMatch = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
    const codeIntegrity = scriptMatch
      ? crypto.createHash('sha256').update(scriptMatch[1]).digest('hex')
      : null;

    // Save chained token
    const chainedToken = crypto.createHmac('sha256', HMAC_SECRET)
      .update(fileHash + signature + req.org.orgId + codeIntegrity)
      .digest('hex');
    await db.saveCodeIntegrity(fileHash, codeIntegrity, chainedToken);

    // Generate share ID and save PVF to database
    const shareId = crypto.randomBytes(8).toString('base64url');
    await db.setShareId(fileHash, shareId);

    // Inject shareId into the PVF HTML
    pvfHtml = pvfHtml.replace('var SHAREID=""', 'var SHAREID="' + shareId + '"');

    await db.savePvfContent(fileHash, pvfHtml);

    // Admin bypass — loaded from ADMIN_EMAILS env var (no hardcoded emails)
    const adminEmails = new Set(
      (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    );
    const isAdmin = adminEmails.has((req.user.email || '').toLowerCase());
    const isPaidPlan = isAdmin || (req.user.plan && !['free', 'trial'].includes(req.user.plan));

    // Track overage in overage_log (non-blocking)
    let legacyOverageInfo = null;
    try {
      legacyOverageInfo = await db.trackOverage(req.user.id, req.user.plan || 'pro');
    } catch (trackErr) {
      logger.error('[OVERAGE TRACK]', trackErr.message);
    }

    if (!isPaidPlan) {
      // Unpaid/trial: create PVF but return preview-only response
      await db.markDocumentPreviewOnly(fileHash, true);
      return res.json({
        success: true,
        preview: true,
        previewUrl: '/d/' + shareId,
        shareId,
        hash: fileHash,
        fileName: file.originalname,
        message: 'Document protected! Subscribe to download.',
        upgradeUrl: '/pricing',
        documentsUsed: req.user.documents_used + 1,
        documentsLimit: req.user.documents_limit,
        overage: legacyOverageFlag,
        overageInfo: legacyOverageInfo
      });
    }

    res.json({
      success: true,
      hash: fileHash,
      shareId,
      fileName: file.originalname,
      documentsUsed: req.user.documents_used + 1,
      documentsLimit: req.user.documents_limit,
      overage: legacyOverageFlag,
      overageInfo: legacyOverageInfo
    });
  } catch(e) {
    logger.error('[USER UPLOAD]', e.message);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
}

router.post('/documents/:hash/star', userActionLimiter, requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    // Security: validate hash format before DB lookup
    if (!req.params.hash || !/^[a-f0-9]{64}$/.test(req.params.hash)) {
      return res.status(400).json({ success: false, error: 'Invalid document hash' });
    }
    const doc = await db.getDocument(req.params.hash);
    if (!doc || doc.user_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }
    const { starred } = req.body;
    await db.starDocument(req.params.hash, !!starred);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to update' }); }
});

// DELETE user document
router.delete('/documents/:hash', requireAuth, destructiveLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    // Security: validate hash format before DB lookup
    if (!req.params.hash || !/^[a-f0-9]{64}$/.test(req.params.hash)) {
      return res.status(400).json({ success: false, error: 'Invalid document hash' });
    }
    const doc = await db.getDocument(req.params.hash);
    const deleted = await db.deleteDocument(req.params.hash, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Document not found' });
    // Also remove PVF file from disk if it exists
    try {
      if (doc && doc.shareId) {
        const pvfPath = path.join(__dirname, '..', 'data', 'pvf', doc.shareId + '.html');
        if (fs.existsSync(pvfPath)) fs.unlinkSync(pvfPath);
      }
    } catch(e) { /* file cleanup is best-effort */ }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to delete' }); }
});

// UPDATE user profile
router.put('/profile', requireAuth, userActionLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    if (name && (typeof name !== 'string' || name.length > 100)) {
      return res.status(400).json({ success: false, error: 'Name must be 100 characters or less' });
    }
    // Sanitize name to prevent stored XSS (name is rendered in PVF stamps and dashboard views)
    const sanitizedName = escapeHtml(name.trim()).substring(0, 100);
    await db.updateUserProfile(req.user.id, { name: sanitizedName });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to update profile' }); }
});

// CHANGE password — Issue #5: passes session ID so current session is preserved
router.post('/change-password', userActionLimiter, requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, error: 'Both passwords required' });
    const pwResult = validatePassword(newPassword, req.user.email);
    if (!pwResult.valid) return res.status(400).json({ success: false, error: 'Password does not meet requirements', details: pwResult.errors });
    const user = await db.getUserById(req.user.id);
    if (!user || !user.password_hash) return res.status(400).json({ success: false, error: 'Cannot change password for OAuth accounts' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Issue #5: Pass current session ID to preserve it, invalidate all others
    await db.changeUserPassword(req.user.id, hash, req.sessionID);
    await db.log('password_changed', { userId: req.user.id });
    await db.log('sessions_invalidated', { userId: req.user.id, reason: 'password_change', preservedSession: req.sessionID?.substring(0, 8) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to change password' }); }
});

// DELETE account
router.delete('/account', requireAuth, destructiveLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    await db.log('user_deleted', { userId: req.user.id, email: req.user.email, ip: req.ip });
    await db.deleteUser(req.user.id);
    req.logout(() => {
      res.json({ success: true });
    });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to delete account' }); }
});

// Get user branding
router.get('/branding', requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const branding = await db.getBranding(orgId);
    res.json({ success: true, customIcon: branding.custom_icon || null, brandColor: branding.brand_color || null, waveColor: branding.wave_color || null });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load branding' }); }
});

// Save user branding
router.post('/branding', requireAuth, userActionLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const { brandColor, customIcon, orgName, stampText, waveColor } = req.body;
    if (orgName && (typeof orgName !== 'string' || orgName.length > 200)) {
      return res.status(400).json({ success: false, error: 'Organization name must be 200 characters or less' });
    }
    if (stampText && (typeof stampText !== 'string' || stampText.length > 500)) {
      return res.status(400).json({ success: false, error: 'Stamp text must be 500 characters or less' });
    }
    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'Invalid color format. Use hex (#RRGGBB)' });
    }
    // waveColor can be an array of hex colors or a single hex string
    let waveColorValue = waveColor;
    if (Array.isArray(waveColor)) {
      // Validate each color in the array
      const validColors = waveColor.every(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
      if (!validColors || waveColor.length < 3 || waveColor.length > 10) {
        return res.status(400).json({ success: false, error: 'Invalid wave colors. Provide 3-10 hex colors (#RRGGBB).' });
      }
      waveColorValue = JSON.stringify(waveColor);
    } else if (waveColor && typeof waveColor === 'string') {
      // Could be a JSON string already or a single hex
      if (waveColor.startsWith('[')) {
        try {
          const parsed = JSON.parse(waveColor);
          if (!Array.isArray(parsed) || parsed.length < 3 || parsed.length > 10) {
            return res.status(400).json({ success: false, error: 'Invalid wave color array. Provide 3-10 colors.' });
          }
          waveColorValue = waveColor; // Already a JSON string
        } catch(e) {
          return res.status(400).json({ success: false, error: 'Invalid wave color JSON format.' });
        }
      } else if (!/^#[0-9a-fA-F]{6}$/.test(waveColor)) {
        return res.status(400).json({ success: false, error: 'Invalid wave color format. Use hex (#RRGGBB) or array of hex colors.' });
      } else {
        waveColorValue = waveColor;
      }
    }
    if (customIcon) {
      const iconSize = Buffer.byteLength(customIcon, 'utf8');
      if (iconSize > 700 * 1024) {
        return res.status(400).json({ success: false, error: 'Logo too large. Maximum 512KB image file.' });
      }
      if (!customIcon.startsWith('data:image/') && !customIcon.startsWith('<svg')) {
        return res.status(400).json({ success: false, error: 'Logo must be a PNG image or SVG' });
      }
    }
    await db.updateBranding(orgId, { brand_color: brandColor || null, custom_icon: customIcon || null, wave_color: waveColorValue || null });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to save branding' }); }
});

// Get user's API key
router.get('/api-key', requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const org = await db.getOrgByOrgId(orgId);
    if (org && org.api_key) {
      res.json({ success: true, apiKey: org.api_key });
    } else {
      res.json({ success: true, apiKey: null });
    }
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to get API key' }); }
});

// Generate API key for user
router.post('/api-key', userActionLimiter, requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const orgName = req.user.name || req.user.email;
    const existing = await db.getOrgByOrgId(orgId);
    if (existing && existing.api_key) {
      return res.json({ success: true, apiKey: existing.api_key });
    }
    const apiKey = 'vf_live_' + crypto.randomBytes(24).toString('hex');
    await db.createApiKey({ apiKey, orgId, orgName, plan: req.user.plan || 'pro', rateLimit: 100 });
    res.json({ success: true, apiKey });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to generate API key' }); }
});

module.exports = router;
