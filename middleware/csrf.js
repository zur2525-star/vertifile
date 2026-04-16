// CSRF protection middleware using the synchronizer token pattern.
// Tokens are stored in the session and validated on state-changing requests
// (POST, PUT, DELETE). Routes that use API key authentication instead of
// sessions are excluded — they have their own auth layer.

const { csrfSync } = require('csrf-sync');
const logger = require('../services/logger');

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => {
    return req.headers['x-csrf-token'] || req.body?._csrf;
  }
});

// Paths that are excluded from CSRF protection.
// These routes authenticate via API key, webhook signature, or are
// public/read-only endpoints that do not rely on session cookies.
const CSRF_EXCLUDED_PREFIXES = [
  '/api/create-pvf',
  '/api/demo/create-pvf',
  '/api/gateway/',
  '/api/webhooks/',
  '/api/verify',
  '/.well-known/',
  // /api/signup and /api/token/refresh are programmatic API endpoints
  // (no session cookies). CSRF protection is not applicable.
  '/api/signup',
  '/api/token/refresh',
  // Admin endpoints authenticate via X-Admin-Secret header, not sessions.
  '/api/admin/',
  // Org endpoints authenticate via X-API-Key header (programmatic), not sessions.
  '/api/org/'
];

function isCsrfExcluded(reqPath) {
  for (const prefix of CSRF_EXCLUDED_PREFIXES) {
    if (reqPath === prefix || reqPath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

// Middleware that applies CSRF validation only to session-based routes.
// Safe methods (GET, HEAD, OPTIONS) are skipped by csrf-sync internally.
function csrfProtection(req, res, next) {
  // Build the full path as mounted by Express. For routes mounted under
  // a prefix (e.g. app.use('/auth', authRoutes)), req.path only contains
  // the sub-path. req.originalUrl contains the full URL including query
  // string, so we strip the query portion for a clean comparison.
  const fullPath = (req.originalUrl || req.url).split('?')[0];

  if (isCsrfExcluded(fullPath)) {
    return next();
  }

  csrfSynchronisedProtection(req, res, next);
}

// Endpoint handler that returns a fresh CSRF token for the current session.
// Frontend pages call GET /api/csrf-token on load and attach the value to
// subsequent POST/PUT/DELETE requests as an X-CSRF-Token header.
function csrfTokenEndpoint(req, res) {
  const token = generateToken(req, res);
  res.json({ success: true, csrfToken: token });
}

module.exports = {
  csrfProtection,
  csrfTokenEndpoint,
  generateToken
};
