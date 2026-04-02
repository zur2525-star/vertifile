const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const logger = require('../services/logger');
const { requireLogin } = require('../middleware/auth');
const { hashBytes, signHash, fixFilename, HMAC_SECRET } = require('../services/pvf-generator');
const { generatePvfHtml } = require('../templates/pvf');
const { obfuscatePvf } = require('../obfuscate');

const router = express.Router();

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.json({ success: true, user: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar_url, plan: req.user.plan, documentsUsed: req.user.documents_used, documentsLimit: req.user.documents_limit } });
});

router.get('/documents', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const starred = req.query.starred === 'true';
    const docs = await db.getUserDocuments(req.user.id, { limit, offset, search, starred });
    const total = await db.getUserDocumentCount(req.user.id);
    res.json({ success: true, documents: docs, total, limit, offset });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load documents' }); }
});

router.post('/upload', requireLogin, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const db = req.app.get('db');

    if (req.file) fixFilename(req.file);
    // Check document limit
    if (req.user.documents_used >= req.user.documents_limit) {
      return res.status(403).json({ success: false, error: 'Document limit reached. Upgrade your plan for more.' });
    }
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

    const isPaidPlan = req.user.plan && req.user.plan !== 'free';

    if (!isPaidPlan) {
      // Free plan: create PVF but return preview-only response
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
        documentsLimit: req.user.documents_limit
      });
    }

    res.json({
      success: true,
      hash: fileHash,
      shareId,
      fileName: file.originalname,
      documentsUsed: req.user.documents_used + 1,
      documentsLimit: req.user.documents_limit
    });
  } catch(e) {
    logger.error('[USER UPLOAD]', e.message);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

router.post('/documents/:hash/star', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
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
router.delete('/documents/:hash', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const deleted = await db.deleteDocument(req.params.hash, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Document not found' });
    // Also remove PVF file from disk if it exists
    try {
      const doc = await db.getDocument(req.params.hash);
      if (doc && doc.shareId) {
        const pvfPath = path.join(__dirname, '..', 'data', 'pvf', doc.shareId + '.html');
        if (fs.existsSync(pvfPath)) fs.unlinkSync(pvfPath);
      }
    } catch(e) { /* file cleanup is best-effort */ }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to delete' }); }
});

// UPDATE user profile
router.put('/profile', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    await db.updateUserProfile(req.user.id, { name: name.trim() });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to update profile' }); }
});

// CHANGE password
router.post('/change-password', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    const user = await db.getUserById(req.user.id);
    if (!user || !user.password_hash) return res.status(400).json({ success: false, error: 'Cannot change password for OAuth accounts' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await db.changeUserPassword(req.user.id, hash);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to change password' }); }
});

// DELETE account
router.delete('/account', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    await db.deleteUser(req.user.id);
    req.logout(() => {
      res.json({ success: true });
    });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to delete account' }); }
});

// Get user branding
router.get('/branding', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const branding = await db.getBranding(orgId);
    res.json({ success: true, customIcon: branding.custom_icon || null, brandColor: branding.brand_color || null, waveColor: branding.wave_color || null });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load branding' }); }
});

// Save user branding
router.post('/branding', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const { brandColor, customIcon, orgName, stampText, waveColor } = req.body;
    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'Invalid color format. Use hex (#RRGGBB)' });
    }
    if (waveColor && !/^#[0-9a-fA-F]{6}$/.test(waveColor)) {
      return res.status(400).json({ success: false, error: 'Invalid wave color format. Use hex (#RRGGBB)' });
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
    await db.updateBranding(orgId, { brand_color: brandColor || null, custom_icon: customIcon || null, wave_color: waveColor || null });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to save branding' }); }
});

// Get user's API key
router.get('/api-key', requireLogin, async (req, res) => {
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
router.post('/api-key', requireLogin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const orgId = 'user_' + req.user.id;
    const orgName = req.user.name || req.user.email;
    const existing = await db.getOrgByOrgId(orgId);
    if (existing && existing.api_key) {
      return res.json({ success: true, apiKey: existing.api_key });
    }
    const apiKey = 'vf_live_' + crypto.randomBytes(24).toString('hex');
    await db.createApiKey({ apiKey, orgId, orgName, plan: req.user.plan || 'free', rateLimit: 5 });
    res.json({ success: true, apiKey });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to generate API key' }); }
});

module.exports = router;
