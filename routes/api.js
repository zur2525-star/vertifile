const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { signupLimiter, getClientIP } = require('../middleware/auth');
const logger = require('../services/logger');
const { escapeHtml } = require('../templates/pvf');
const { handleCreatePvf, verifySignature, generateToken, HMAC_SECRET } = require('../services/pvf-generator');

const router = express.Router();

// ===== OpenAPI Spec =====
router.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/api/openapi.json'));
});

// Rate limiter — PVF creation (stricter)
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: { success: false, error: 'Document creation limit reached. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter — verification (more generous)
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { success: false, error: 'Too many verification requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter — demo
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 per hour per IP
  message: { success: false, error: 'Demo limit reached (5/hour). Sign up for unlimited access at /signup' },
  standardHeaders: true,
  legacyHeaders: false
});

// Daily signup tracking per IP
const _dailySignups = new Map(); // IP -> { count, resetAt }

// ================================================================
// API: SIGNUP
// ================================================================
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    let { orgName, contactName, email, useCase } = req.body;

    if (!orgName || !contactName || !email) {
      return res.status(400).json({ success: false, error: 'orgName, contactName, and email are required' });
    }

    // Daily IP signup limit (max 3 per day)
    const clientIP = getClientIP(req);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ipEntry = _dailySignups.get(clientIP);
    if (ipEntry && ipEntry.resetAt > now) {
      if (ipEntry.count >= 3) {
        await db.log('signup_blocked', { reason: 'daily_ip_limit', ip: clientIP, email });
        return res.status(429).json({ success: false, error: 'Daily signup limit reached. Try again tomorrow.' });
      }
      ipEntry.count++;
    } else {
      _dailySignups.set(clientIP, { count: 1, resetAt: now + dayMs });
    }

    // Validate email format (strict)
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Sanitize inputs
    orgName = escapeHtml(orgName).substring(0, 100);
    contactName = escapeHtml(contactName).substring(0, 100);

    // Generate org ID and API key
    const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
    const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');

    const selectedPlan = 'free';
    const rateLimitVal = 5;

    await db.createApiKey({
      apiKey,
      orgId,
      orgName,
      plan: selectedPlan,
      rateLimit: rateLimitVal
    });

    await db.log('signup', {
      orgId,
      orgName,
      contactName,
      email,
      useCase: useCase || 'not specified',
      plan: selectedPlan,
      ip: getClientIP(req)
    });

    logger.info({ event: 'signup', orgName, plan: selectedPlan, email }, `New org: ${orgName}`);

    res.json({
      success: true,
      apiKey,
      orgId,
      orgName,
      plan: selectedPlan,
      rateLimit: rateLimitVal,
      message: 'Save this API key — it will not be shown again.'
    });

  } catch (error) {
    logger.error({ err: error, event: 'signup_error' }, 'Signup failed');
    res.status(500).json({ success: false, error: 'Signup failed. Please try again.' });
  }
});

// ================================================================
// API: DEMO — public PVF creation
// ================================================================
router.post('/demo/create-pvf', demoLimiter, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, (req, res) => {
  req.org = { orgId: 'org_demo', orgName: 'Demo User' };
  req.apiKey = 'demo';
  handleCreatePvf(req, res);
});

// ================================================================
// API: CREATE PVF — requires API key authentication
// ================================================================
router.post('/create-pvf', createLimiter, (req, res, next) => {
  const authenticateApiKey = req.app.get('authenticateApiKey');
  authenticateApiKey(req, res, next);
}, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, (req, res) => handleCreatePvf(req, res));

// ================================================================
// API: VERIFY
// ================================================================
router.post('/verify', verifyLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const chain = req.app.get('chain');
    const { hash, signature, content, recipientHash, created, orgId, codeIntegrity } = req.body;

    let lookupHash = hash;

    // Legacy support: if content object sent, compute hash
    if (!lookupHash && content) {
      lookupHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    }

    if (!lookupHash) {
      return res.status(400).json({ success: false, verified: false, error: 'Missing hash' });
    }

    // Validate hash format
    if (!/^[a-f0-9]{64}$/.test(lookupHash)) {
      return res.status(400).json({ success: false, verified: false, error: 'Invalid hash format' });
    }

    const doc = await db.getDocument(lookupHash);

    if (doc) {
      // Double-check: verify HMAC signature if provided
      let signatureValid = true;
      if (signature) {
        try {
          signatureValid = verifySignature(lookupHash, signature);
        } catch (e) {
          signatureValid = false;
        }
      }

      if (!signatureValid) {
        logger.warn({ event: 'verify_fail', reason: 'signature_mismatch', hash: lookupHash.substring(0, 16) }, 'Signature mismatch');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'invalid_signature' });
        return res.json({ success: true, verified: false, reason: 'invalid_signature' });
      }

      // Code integrity check
      if (codeIntegrity && doc.code_integrity) {
        if (codeIntegrity !== doc.code_integrity) {
          logger.warn({ event: 'verify_fail', reason: 'code_tampered', hash: lookupHash.substring(0, 16) }, 'Code integrity mismatch');
          await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'code_tampered' });
          return res.json({ success: true, verified: false, reason: 'code_tampered' });
        }

        // Chained token verification
        if (doc.chained_token) {
          const expectedChain = crypto.createHmac('sha256', HMAC_SECRET)
            .update(lookupHash + (signature || doc.signature) + doc.orgId + codeIntegrity)
            .digest('hex');
          const chainValid = crypto.timingSafeEqual(
            Buffer.from(doc.chained_token, 'hex'),
            Buffer.from(expectedChain, 'hex')
          );
          if (!chainValid) {
            logger.warn({ event: 'verify_fail', reason: 'chain_broken', hash: lookupHash.substring(0, 16) }, 'Chained token mismatch');
            await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'chain_broken' });
            return res.json({ success: true, verified: false, reason: 'chain_broken' });
          }
        }
      }

      // Recipient binding check
      if (doc.recipientHash && recipientHash && doc.recipientHash !== recipientHash) {
        logger.warn({ event: 'verify_fail', reason: 'recipient_mismatch', hash: lookupHash.substring(0, 16) }, 'Recipient mismatch');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'recipient_mismatch' });
        return res.json({ success: true, verified: false, reason: 'recipient_mismatch' });
      }

      const newToken = generateToken();
      await db.updateDocumentToken(lookupHash, newToken);

      logger.info({ event: 'verify_ok', hash: lookupHash.substring(0, 16) }, 'Document verified');
      await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'verified' });

      // Include blockchain verification if connected
      let blockchainProof = null;
      if (chain.isConnected()) {
        try {
          blockchainProof = await chain.verify(lookupHash, signature);
        } catch (e) { /* non-critical */ }
      }

      res.json({
        success: true,
        verified: true,
        hash: lookupHash,
        token: newToken,
        timestamp: doc.timestamp,
        orgName: doc.orgName,
        blockchain: blockchainProof
      });
    } else {
      logger.warn({ event: 'verify_fail', reason: 'not_found', hash: lookupHash.substring(0, 16) }, 'Document not found');
      await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'not_found' });
      res.json({ success: true, verified: false, hash: lookupHash });
    }
  } catch (error) {
    res.status(500).json({ success: false, verified: false, error: 'Verification error' });
  }
});

// ===== API: Token Refresh (heartbeat) =====
router.post('/token/refresh', verifyLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { hash } = req.body;

    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).json({ success: false, error: 'Invalid hash' });
    }

    const doc = await db.getDocument(hash);
    if (!doc) return res.json({ success: false, error: 'Not found' });

    if (doc.tokenCreatedAt && (Date.now() - doc.tokenCreatedAt) < 240000) {
      return res.json({ success: true, token: doc.token, expiresIn: 300, cached: true });
    }

    const newToken = generateToken();
    await db.updateDocumentToken(hash, newToken);
    res.json({ success: true, token: newToken, expiresIn: 30 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

// ===== API: Health =====
router.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Vertifile',
    version: '4.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

router.get('/health/deep', async (req, res) => {
  try {
    const db = req.app.get('db');
    const chain = req.app.get('chain');
    const stats = await db.getStats();
    res.json({
      status: 'online',
      service: 'Vertifile',
      version: '4.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      documents: stats.totalDocuments,
      organizations: stats.totalOrganizations,
      blockchain: chain.isConnected() ? 'connected' : 'off-chain'
    });
  } catch(e) { res.status(500).json({ status: 'error', error: 'Health check failed' }); }
});

// ===== API: Docs =====
router.get('/docs', (req, res) => {
  res.json({
    service: 'Vertifile API',
    version: '4.1.0',
    description: 'Document protection and verification platform with blockchain anchoring',
    security: {
      authentication: 'API Key (X-API-Key header) or Admin Secret (X-Admin-Secret header)',
      encryption: 'HMAC-SHA256 signatures, blind hashing (server never reads content)',
      pvfProtection: ['Code obfuscation', 'Recipient binding', 'Screen capture detection', 'DevTools detection', 'Unique visual fingerprint per document'],
      blockchain: 'Polygon (optional on-chain registration)'
    },
    endpoints: {
      document: {
        'POST /api/create-pvf': {
          description: 'Create a PVF file from an uploaded document',
          auth: 'X-API-Key header',
          body: 'multipart/form-data — file (required), recipient (optional email for binding)',
          response: '.pvf file download (obfuscated, with live verification stamp)',
          features: ['Blind hashing', 'HMAC signing', 'Code obfuscation', 'Recipient binding', 'On-chain registration (if blockchain enabled)', 'Unique animation per hash']
        },
        'POST /api/verify': {
          description: 'Verify a document hash (public endpoint)',
          auth: 'None',
          body: '{ hash, signature, recipientHash? }',
          response: '{ verified, token, timestamp, orgName, blockchain? }'
        },
        'POST /api/token/refresh': {
          description: 'Refresh session token (heartbeat, every 30s)',
          auth: 'None',
          body: '{ hash }',
          response: '{ token, expiresIn: 30 }'
        }
      },
      organization: {
        'GET /api/org/stats': {
          description: 'Organization statistics',
          auth: 'X-API-Key header'
        },
        'GET /api/org/documents': {
          description: 'Paginated document list for organization',
          auth: 'X-API-Key header',
          query: '?limit=50&offset=0'
        }
      },
      gateway: {
        'POST /api/gateway/intake': {
          description: 'Upload .pvf file for automated verification + original document extraction',
          auth: 'X-API-Key header',
          body: 'multipart/form-data with .pvf file',
          response: '{ verified, document, extractedFile (base64) }'
        },
        'POST /api/gateway/batch': {
          description: 'Batch verify up to 50 .pvf files at once',
          auth: 'X-API-Key header',
          body: 'multipart/form-data with multiple .pvf files',
          response: '{ results: [...], summary }'
        }
      },
      webhooks: {
        'POST /api/webhooks/register': {
          description: 'Register webhook for verification events',
          auth: 'X-API-Key header',
          body: '{ url, events: ["verification.success", "verification.failed"] }'
        },
        'GET /api/webhooks': {
          description: 'List registered webhooks',
          auth: 'X-API-Key header'
        },
        'DELETE /api/webhooks/:id': {
          description: 'Remove a webhook',
          auth: 'X-API-Key header'
        }
      },
      admin: {
        'GET /api/admin/stats': {
          description: 'Global system statistics + blockchain status',
          auth: 'X-Admin-Secret header'
        },
        'GET /api/admin/audit': {
          description: 'Audit log viewer (paginated, filterable by event/org)',
          auth: 'X-Admin-Secret header',
          query: '?limit=50&offset=0&event=pvf_created&orgId=org_xxx'
        },
        'POST /api/keys/create': {
          description: 'Create a new API key for an organization',
          auth: 'X-Admin-Secret header',
          body: '{ orgName, plan: "free"|"professional" }'
        },
        'GET /api/keys': {
          description: 'List all API keys',
          auth: 'X-Admin-Secret header'
        }
      },
      system: {
        'GET /api/health': { description: 'Service health check', auth: 'None' },
        'GET /api/docs': { description: 'This documentation', auth: 'None' }
      }
    },
    sdk: {
      cli: 'node sdk.js document.pdf [output.pvf]',
      library: 'const { convertToPvf } = require("./sdk"); await convertToPvf("file.pdf", "out.pvf")'
    }
  });
});

// ================================================================
// API: ORG ENDPOINTS (require API key)
// ================================================================
router.get('/org/stats', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  const db = req.app.get('db');
  const stats = await db.getOrgStats(req.org.orgId);
  res.json({ success: true, orgId: req.org.orgId, orgName: req.org.orgName, ...stats });
});

router.get('/org/documents', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  const db = req.app.get('db');
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const docs = await db.getDocumentsByOrg(req.org.orgId, { limit, offset });
  const total = await db.getDocumentCount(req.org.orgId);
  res.json({ success: true, documents: docs, total, limit, offset });
});

router.get('/org/profile', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const branding = await db.getBranding(req.org.orgId);
    res.json({
      success: true,
      orgId: req.org.orgId,
      orgName: req.org.orgName,
      plan: req.org.plan,
      documentsCreated: req.org.documentsCreated,
      rateLimit: req.org.rateLimit,
      created: req.org.created,
      branding: {
        customIcon: branding.custom_icon || null,
        brandColor: branding.brand_color || null,
        waveColor: branding.wave_color || null
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/org/branding', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { customIcon, brandColor, waveColor } = req.body;

    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'Invalid color format. Use hex (#RRGGBB)' });
    }
    if (waveColor && !/^#[0-9a-fA-F]{6}$/.test(waveColor)) {
      return res.status(400).json({ success: false, error: 'Invalid wave color format. Use hex (#RRGGBB)' });
    }

    if (customIcon) {
      const iconSize = Buffer.byteLength(customIcon, 'utf8');
      if (iconSize > 700 * 1024) {
        return res.status(400).json({ success: false, error: 'Icon too large. Maximum 512KB image file.' });
      }
      if (!customIcon.startsWith('data:image/') && !customIcon.startsWith('<svg')) {
        return res.status(400).json({ success: false, error: 'Icon must be SVG or image data URI' });
      }
    }

    await db.updateBranding(req.org.orgId, { customIcon, brandColor, waveColor });
    await db.log('branding_updated', { orgId: req.org.orgId, hasIcon: !!customIcon, color: brandColor, waveColor });

    res.json({ success: true, message: 'Branding updated' });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/org/branding', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const branding = await db.getBranding(req.org.orgId);
    res.json({
      success: true,
      customIcon: branding.custom_icon || null,
      brandColor: branding.brand_color || null,
      waveColor: branding.wave_color || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ================================================================
// CONTACT FORM
// ================================================================
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: 'Too many submissions' } });

router.post('/contact', contactLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { name, email, organization, orgType, message } = req.body;
    if (!name || !email || !organization) {
      return res.status(400).json({ success: false, error: 'Name, email, and organization are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }
    await db.log('contact_form', { name, email, organization, orgType: orgType || 'not specified', message: message || '', ip: getClientIP(req) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to submit contact form' }); }
});

module.exports = router;
