const express = require('express');
const path = require('path');
const fs = require('fs');
const { escapeHtml } = require('../templates/pvf');
const { setPvfSecurityHeaders } = require('../services/pvf-generator');
const { getClientIP } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();

// 404 page helper
function notFoundPage(message) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Document Not Found — Vertifile</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f0e17;color:#e2e0f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{text-align:center;padding:40px}
h1{font-size:72px;font-weight:900;color:#7c3aed;margin-bottom:16px}
p{font-size:18px;color:#9ca3af;margin-bottom:32px}
a{display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;transition:.2s}
a:hover{background:#6d28d9;transform:translateY(-1px)}
</style></head><body><div class="c">
<h1>404</h1>
<p>${escapeHtml(message)}</p>
<a href="/">Back to Vertifile</a>
</div></body></html>`;
}

// Language path redirects — i18n is client-side, /he /ar etc redirect to /?lang=xx
const SUPPORTED_LANGS = ['he','ar','fr','es','de','ru','zh','ja','pt'];
SUPPORTED_LANGS.forEach(lang => {
  router.get('/' + lang, (req, res) => res.redirect('/?lang=' + lang));
});

// Static page routes
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

router.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'upload.html'));
});

router.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'verify.html'));
});

router.get('/dashboard', (req, res) => res.redirect('/app'));

router.get('/enterprise', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'enterprise.html'));
});

router.get('/integration', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'integration.html'));
});

router.get('/open', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'open.html'));
});

router.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'signup.html'));
});

router.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pricing.html'));
});

router.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'support.html'));
});

router.get('/legal', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'legal.html'));
});

router.get('/cookie-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cookie-policy.html'));
});

router.get('/healthcare', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'healthcare.html'));
});

router.get('/education', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'education.html'));
});

router.get('/finance', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'finance.html'));
});

router.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reset-password.html'));
});

router.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog.html'));
});

// Blog post routes
router.get('/blog/:slug', (req, res) => {
  const slug = req.params.slug;
  // Security: reject path traversal attempts (../, encoded variants, null bytes)
  if (!slug || /[\/\\]|\.\.|\x00/.test(slug) || slug.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return res.status(404).send(notFoundPage('Blog post not found'));
  }
  const slugFile = path.join(__dirname, '..', 'public', 'blog', slug + '.html');
  // Double-check resolved path stays within the blog directory
  const blogDir = path.resolve(path.join(__dirname, '..', 'public', 'blog'));
  if (!path.resolve(slugFile).startsWith(blogDir + path.sep)) {
    return res.status(404).send(notFoundPage('Blog post not found'));
  }
  if (fs.existsSync(slugFile)) {
    res.sendFile(slugFile);
  } else {
    res.status(404).send(notFoundPage('Blog post not found'));
  }
});

// ================================================================
// SHAREABLE DOCUMENT LINKS — /d/:shareId
// ================================================================

// Redirect from hash to share link (used by PVF Viewer browser button)
router.get('/view-by-hash/:hash', async (req, res) => {
  try {
    const db = req.app.get('db');
    // Security: validate hash format before DB lookup
    if (!req.params.hash || !/^[a-f0-9]{64}$/.test(req.params.hash)) {
      return res.status(404).send(notFoundPage('Invalid document link'));
    }
    const doc = await db.getDocument(req.params.hash);
    if (doc && doc.shareId) return res.redirect('/d/' + doc.shareId);
    return res.status(404).send(notFoundPage('Document not found'));
  } catch(e) { return res.status(500).send(notFoundPage('Server error')); }
});

// View PVF document in-browser
// Supports both shareId (legacy, base64url, 6-20 chars) and slug (PVF 2.0, up to 80 chars)
router.get('/d/:identifier', async (req, res) => {
  try {
    const db = req.app.get('db');
    const identifier = req.params.identifier;

    // Basic validation — allow alphanumeric, hyphens, underscores (covers both shareId and slug)
    if (!identifier || identifier.length < 3 || identifier.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(identifier)) {
      return res.status(404).send(notFoundPage('Invalid document link'));
    }

    // Try slug first (PVF 2.0), then fall back to shareId (PVF 1.0)
    let doc = await db.getDocumentBySlug(identifier);
    if (!doc) {
      doc = await db.getDocumentByShareId(identifier);
    }
    if (!doc) {
      return res.status(404).send(notFoundPage('Document not found'));
    }

    // Fetch PVF content — try by shareId (the pvf_content column is keyed by share_id)
    let pvfContent = await db.getPvfContent(doc.shareId);
    if (!pvfContent) {
      return res.status(404).send(notFoundPage('Document file not available'));
    }

    // Layer 2 stamp injection — fresh per-view, hash unchanged
    pvfContent = await injectStampConfig(req, doc.shareId, pvfContent, db);

    await db.log('document_viewed', { shareId: doc.shareId, slug: doc.slug, hash: doc.hash, ip: getClientIP(req) });

    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(pvfContent);
  } catch(e) { return res.status(500).send(notFoundPage('Server error')); }
});

// Raw route — /d/:shareId/raw — serves PVF HTML for iframe embedding
router.get('/d/:shareId/raw', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { shareId } = req.params;
    if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) return res.status(404).send('Not found');

    let pvfContent = await db.getPvfContent(shareId);
    if (!pvfContent) return res.status(404).send('Not found');

    // Layer 2 — inject the document owner's latest stamp config dynamically.
    // Doc content (Layer 1) is unchanged → hash stays valid.
    pvfContent = await injectStampConfig(req, shareId, pvfContent, db);

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "frame-src 'self' data: blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'"
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(pvfContent);
  } catch(e) { return res.status(500).send('Server error'); }
});

// ============================================================
// Stamp config injection — Layer 2 visual wrapper
// ============================================================
// Looks up the document owner's current stamp_config and injects an
// inline <script data-vf-stamp-override> block immediately before the
// REAL </body> tag (not a fake one inside obfuscated JS string literals)
// that overrides the wave colors and accent color at view time.
// Doc content (Layer 1) is untouched, so the hash remains valid.
//
// Verified docs call /api/verify with a client-side sha256 of all
// <script> textContent concatenated. For NEW docs the client-side
// hasher skips scripts tagged with data-vf-stamp-override so the
// hash still matches doc.code_integrity. For OLD docs the client
// includes the override script in its hash, and /api/verify uses
// a dual-hash fallback (see routes/api.js) that reconstructs the
// expected hash from the deterministic override text.
const { buildOverrideScriptTag } = require('../services/stamp-override');

async function injectStampConfig(req, shareId, pvfContent, db) {
  try {
    const cache = req.app.get('stampCache');
    const doc = await db.getDocumentByShareId(shareId);
    if (!doc) {
      logger.info({ event: 'stamp_inject', shareId, ok: false, reason: 'doc_not_found' });
      return pvfContent;
    }

    // Fallback: if user_id is null, try to extract user from orgId
    // (API-created docs sometimes encode the user in orgId as "user_<id>")
    let userId = doc.user_id;
    if (!userId && typeof doc.orgId === 'string' && doc.orgId.startsWith('user_')) {
      userId = doc.orgId.slice('user_'.length);
    }
    if (!userId) {
      logger.info({ event: 'stamp_inject', shareId, ok: false, reason: 'no_user_id' });
      return pvfContent;
    }

    let cfg = cache && cache._get ? cache._get(userId) : null;
    if (!cfg) {
      const result = await db.getUserStampConfig(userId);
      cfg = result?.config || {};
      if (cache && cache._set) cache._set(userId, cfg);
    }
    // Empty config = no override — return unchanged
    if (!cfg || Object.keys(cfg).length === 0) {
      logger.info({ event: 'stamp_inject', shareId, ok: false, reason: 'empty_cfg' });
      return pvfContent;
    }

    // Build the override script tag (empty string if cfg has no valid fields)
    const overrideScript = buildOverrideScriptTag(cfg);
    if (!overrideScript) {
      logger.info({ event: 'stamp_inject', shareId, ok: false, reason: 'no_valid_fields' });
      return pvfContent;
    }

    // CRITICAL FIX: use lastIndexOf('</body>') + slice, not
    // replace('</body>', ...). The naive .replace() hits the FIRST
    // occurrence, which in an obfuscated PVF is often a false match
    // inside a JS string literal (e.g. "</body>" embedded in minified
    // code). The REAL closing tag is always the last one.
    const bodyIdx = pvfContent.lastIndexOf('</body>');
    if (bodyIdx === -1) {
      logger.warn({ event: 'stamp_inject', shareId, ok: false, reason: 'no_body_tag' });
      return pvfContent + overrideScript;
    }

    logger.info({ event: 'stamp_inject', shareId, ok: true, reason: 'injected' });
    return pvfContent.slice(0, bodyIdx) + overrideScript + pvfContent.slice(bodyIdx);
  } catch(e) {
    logger.warn({ event: 'stamp_inject', shareId, ok: false, reason: 'exception', err: e && e.message });
    return pvfContent; // Fail open — original PVF still displays
  }
}

// Download route — /d/:identifier/download (supports both shareId and slug)
router.get('/d/:identifier/download', async (req, res) => {
  try {
    const db = req.app.get('db');
    const identifier = req.params.identifier;
    if (!identifier || identifier.length < 3 || identifier.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(identifier)) return res.status(404).json({ success: false, error: 'Invalid link' });

    // Try slug first (PVF 2.0), then fall back to shareId (PVF 1.0)
    let doc = await db.getDocumentBySlug(identifier);
    if (!doc) {
      doc = await db.getDocumentByShareId(identifier);
    }
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Check if document is preview-only (legacy gating)
    if (doc.preview_only) {
      const isPaidUser = req.user && req.user.plan && !['free', 'trial'].includes(req.user.plan);
      if (!isPaidUser) {
        return res.status(403).json({
          success: false,
          error: 'Download requires a Pro or Enterprise plan.',
          upgradeUrl: '/pricing',
          preview: true
        });
      }
    }

    let pvfContent = await db.getPvfContent(doc.shareId);
    if (!pvfContent) {
      return res.status(404).json({ success: false, error: 'Document file not available' });
    }

    // Layer 2 — apply current owner stamp config to the downloaded snapshot
    // so the user gets a fresh copy with their latest stamp branding
    pvfContent = await injectStampConfig(req, doc.shareId, pvfContent, db);

    // Security: sanitize filename for Content-Disposition header to prevent header injection
    const rawName = (doc.originalName || 'document').replace(/\.[^.]+$/, '');
    const pvfFileName = rawName.replace(/[^\w\s.-]/g, '_').substring(0, 200) + '.pvf';
    res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName.replace(/"/g, '\\"')}"`);
    res.send(pvfContent);
  } catch(e) { return res.status(500).json({ success: false, error: 'Server error' }); }
});

// Document info API — /d/:shareId/info
router.get('/d/:shareId/info', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { shareId } = req.params;
    if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) return res.status(404).json({ success: false, error: 'Invalid link' });

    const doc = await db.getDocumentByShareId(shareId);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    res.json({
      success: true,
      document: {
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        issuedAt: doc.timestamp,
        issuedBy: doc.orgName
      }
    });
  } catch(e) { return res.status(500).json({ success: false, error: 'Server error' }); }
});

// Demo routes
router.get('/demo', (req, res) => {
  res.sendFile('demo.html', { root: path.join(__dirname, '..', 'public') });
});

router.get('/demo-pvf', (req, res) => {
  const p = path.join(__dirname, '..', 'demo.pvf');
  if (fs.existsSync(p)) {
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(p);
  } else {
    res.status(404).send('demo.pvf not found');
  }
});

// Cache the forged demo PVF in memory to avoid synchronous file reads on every request
let _forgedDemoCache = null;
router.get('/demo-forged-pvf', (req, res) => {
  if (!_forgedDemoCache) {
    const p = path.join(__dirname, '..', 'demo.pvf');
    try {
      const content = fs.readFileSync(p, 'utf8');
      _forgedDemoCache = content.replace(/var SIG="([a-f0-9]+)"/, 'var SIG="0000000000000000000000000000000000000000000000000000000000000000"');
    } catch (e) {
      return res.status(404).send('demo.pvf not found');
    }
  }
  setPvfSecurityHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_forgedDemoCache);
});

// 404 handler for unknown routes
router.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

module.exports = router;
