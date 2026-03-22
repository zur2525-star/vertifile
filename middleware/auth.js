const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Timing-safe admin secret comparison to prevent timing attacks
function isValidAdminSecret(provided) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  if (typeof provided !== 'string') return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function createAuthenticateApiKey(db) {
  return async function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const clientIP = getClientIP(req);

    if (!apiKey) {
      await db.log('auth_failed', { reason: 'missing_key', ip: clientIP, path: req.path });
      return res.status(401).json({
        success: false,
        error: 'API key required. Add X-API-Key header.',
        docs: '/api/docs'
      });
    }

    // Allow admin secret as API key — grants full access as admin org
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && isValidAdminSecret(apiKey)) {
      req.org = { orgId: 'org_admin', orgName: 'Vertifile Admin', plan: 'enterprise', documentsCreated: 0, rateLimit: 999, created: new Date().toISOString(), active: true };
      req.apiKey = apiKey;
      return next();
    }

    const keyData = await db.getApiKey(apiKey);

    if (!keyData) {
      await db.log('auth_failed', { reason: 'invalid_key', ip: clientIP, path: req.path, keyPrefix: apiKey.substring(0, 12) });
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    if (!keyData.active) {
      await db.log('auth_failed', { reason: 'disabled_key', ip: clientIP, orgId: keyData.orgId, path: req.path });
      return res.status(403).json({ success: false, error: 'API key is disabled' });
    }

    // IP whitelist check: if allowedIPs is set, only allow requests from those IPs
    if (keyData.allowedIPs && Array.isArray(keyData.allowedIPs) && keyData.allowedIPs.length > 0) {
      const normalizedClientIP = clientIP.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6
      const isAllowed = keyData.allowedIPs.some(ip => {
        const normalizedAllowed = ip.replace(/^::ffff:/, '');
        return normalizedClientIP === normalizedAllowed;
      });
      if (!isAllowed) {
        await db.log('auth_failed', { reason: 'ip_not_whitelisted', ip: clientIP, orgId: keyData.orgId, path: req.path });
        return res.status(403).json({ success: false, error: 'Request from unauthorized IP address' });
      }
    }

    // Attach org info to request
    req.org = keyData;
    req.apiKey = apiKey;
    next();
  };
}

function createAuthenticateAdmin(db) {
  return async function authenticateAdmin(req, res, next) {
    const adminSecret = req.headers['x-admin-secret'];
    if (!isValidAdminSecret(adminSecret)) {
      await db.log('auth_failed', { reason: 'invalid_admin_secret', ip: getClientIP(req), path: req.path });
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    next();
  };
}

function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Please sign in' });
  next();
}

// Helper to extract client IP from request
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

// Rate limiter — auth routes (strict: 5 attempts per 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { success: false, error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter — signup
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10, // 10 signups per hour per IP
  message: { success: false, error: 'Too many signup attempts. Try again later.' }
});

module.exports = {
  isValidAdminSecret,
  createAuthenticateApiKey,
  createAuthenticateAdmin,
  requireLogin,
  getClientIP,
  authLimiter,
  signupLimiter
};
