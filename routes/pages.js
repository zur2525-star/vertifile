const express = require('express');
const path = require('path');
const fs = require('fs');
const { escapeHtml } = require('../templates/pvf');
const { setPvfSecurityHeaders } = require('../services/pvf-generator');
const { getClientIP } = require('../middleware/auth');

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

router.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog.html'));
});

// Blog post routes
router.get('/blog/:slug', (req, res) => {
  const slugFile = path.join(__dirname, '..', 'public', 'blog', req.params.slug + '.html');
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
    const doc = await db.getDocument(req.params.hash);
    if (doc && doc.shareId) return res.redirect('/d/' + doc.shareId);
    return res.status(404).send(notFoundPage('Document not found'));
  } catch(e) { return res.status(500).send(notFoundPage('Server error')); }
});

// View PVF document in-browser
router.get('/d/:shareId', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { shareId } = req.params;

    if (!shareId || shareId.length < 6 || shareId.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(shareId)) {
      return res.status(404).send(notFoundPage('Invalid document link'));
    }

    const doc = await db.getDocumentByShareId(shareId);
    if (!doc) {
      return res.status(404).send(notFoundPage('Document not found'));
    }

    let pvfContent = await db.getPvfContent(shareId);
    if (!pvfContent) {
      return res.status(404).send(notFoundPage('Document file not available'));
    }

    // Layer 2 stamp injection — fresh per-view, hash unchanged
    pvfContent = await injectStampConfig(req, shareId, pvfContent, db);

    await db.log('document_viewed', { shareId, hash: doc.hash, ip: getClientIP(req) });

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
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self'",
      "frame-src 'self' data: blob:",
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
// inline <script> + <style> block at the top of the PVF that overrides
// the wave colors and accent color at view time. Doc content (Layer 1)
// is untouched, so the hash remains valid.
async function injectStampConfig(req, shareId, pvfContent, db) {
  try {
    const cache = req.app.get('stampCache');
    const doc = await db.getDocumentByShareId(shareId);
    if (!doc || !doc.user_id) return pvfContent;
    const userId = doc.user_id;

    let cfg = cache && cache._get ? cache._get(userId) : null;
    if (!cfg) {
      const result = await db.getUserStampConfig(userId);
      cfg = result?.config || {};
      if (cache && cache._set) cache._set(userId, cfg);
    }
    // Empty config = no override
    if (!cfg || Object.keys(cfg).length === 0) return pvfContent;

    // Build override SVG/CSS
    const waveColors = Array.isArray(cfg.waveColors) && cfg.waveColors.length
      ? cfg.waveColors.slice(0, 7).map(c => String(c).replace(/[^#0-9a-fA-F]/g, ''))
      : null;
    const accent = cfg.accentColor && /^#?[0-9a-fA-F]{3,6}$/.test(String(cfg.accentColor).trim().replace('#',''))
      ? String(cfg.accentColor).startsWith('#') ? cfg.accentColor : '#' + cfg.accentColor
      : null;
    const customLogo = cfg.customLogo && typeof cfg.customLogo === 'string' && cfg.customLogo.startsWith('data:image/')
      ? cfg.customLogo : null;

    // Build the override script
    const overrideScript = `<script>(function(){
      window.__VF_STAMP_OVERRIDE__ = ${JSON.stringify({ waveColors, accent, customLogo })};
      function applyOverride(){
        var o = window.__VF_STAMP_OVERRIDE__;
        if (!o) return;
        // 1. Override wave path strokes (they have stroke="..." attribute)
        if (o.waveColors && o.waveColors.length) {
          var paths = document.querySelectorAll('.holo-waves path[stroke], .vfs-wave-svg path[stroke]');
          for (var i=0; i<paths.length && i<o.waveColors.length; i++) {
            paths[i].setAttribute('stroke', o.waveColors[i]);
          }
        }
        // 2. Override accent color (CSS variable + brand color)
        if (o.accent) {
          document.documentElement.style.setProperty('--vf-accent', o.accent);
          var brandEls = document.querySelectorAll('.vfs-brand, .stamp-brand-name');
          for (var j=0; j<brandEls.length; j++) brandEls[j].style.color = o.accent;
        }
        // 3. Replace logo if customLogo set
        if (o.customLogo) {
          var logoSlots = document.querySelectorAll('.vfs-stamp-logo, .vfs-center svg, .stamp-logo-slot');
          for (var k=0; k<logoSlots.length; k++) {
            var img = document.createElement('div');
            img.style.cssText='position:absolute;top:22%;left:22%;width:56%;height:56%;border-radius:50%;overflow:hidden;background:#fff;border:1px solid rgba(124,58,237,.12);z-index:10';
            img.innerHTML = '<img src="' + o.customLogo + '" style="width:100%;height:100%;object-fit:cover;display:block"/>';
            var coin = logoSlots[k].closest('.vfs-stamp-coin') || logoSlots[k].parentElement;
            if (coin) coin.appendChild(img);
            // Hide brand/verified text since logo replaces them
            var center = coin && coin.querySelector('.vfs-center');
            if (center) center.style.display = 'none';
            break;
          }
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyOverride);
      } else {
        applyOverride();
      }
    })();</script>`;
    // Inject right before </body> so DOM is ready
    if (pvfContent.indexOf('</body>') !== -1) {
      return pvfContent.replace('</body>', overrideScript + '</body>');
    }
    return pvfContent + overrideScript;
  } catch(e) {
    return pvfContent; // Fail open — original PVF still displays
  }
}

// Download route — /d/:shareId/download
router.get('/d/:shareId/download', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { shareId } = req.params;
    if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) return res.status(404).json({ success: false, error: 'Invalid link' });

    const doc = await db.getDocumentByShareId(shareId);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Check if document is preview-only (free plan) and user hasn't upgraded
    if (doc.preview_only) {
      // Check if the requesting user is on a paid plan
      const isPaidUser = req.user && req.user.plan && req.user.plan !== 'free';
      if (!isPaidUser) {
        return res.status(403).json({
          success: false,
          error: 'Download requires a Pro or Enterprise plan.',
          upgradeUrl: '/pricing',
          preview: true
        });
      }
    }

    let pvfContent = await db.getPvfContent(shareId);
    if (!pvfContent) {
      return res.status(404).json({ success: false, error: 'Document file not available' });
    }

    // Layer 2 — apply current owner stamp config to the downloaded snapshot
    // so the user gets a fresh copy with their latest stamp branding
    pvfContent = await injectStampConfig(req, shareId, pvfContent, db);

    const pvfFileName = (doc.originalName || 'document').replace(/\.[^.]+$/, '') + '.pvf';
    res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName}"`);
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

router.get('/demo-forged-pvf', (req, res) => {
  const p = path.join(__dirname, '..', 'demo.pvf');
  if (fs.existsSync(p)) {
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/var SIG="([a-f0-9]+)"/, 'var SIG="0000000000000000000000000000000000000000000000000000000000000000"');
    res.send(content);
  } else {
    res.status(404).send('demo.pvf not found');
  }
});

// 404 handler for unknown routes
router.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

module.exports = router;
