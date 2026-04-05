/**
 * Vertifile — requireAuth middleware
 *
 * Checks that a valid authenticated session exists. If so, loads the full
 * user row from PostgreSQL and attaches it to req.user.
 *
 * Unlike the simpler `requireLogin` (which trusts whatever Passport left on
 * req.user), this middleware always round-trips to the DB so the caller gets
 * up-to-date user fields (plan, subscription status, email_verified, etc.).
 *
 * Usage:
 *   const requireAuth = require('../middleware/requireAuth');
 *   router.get('/protected', requireAuth, handler);
 */

const logger = require('../services/logger');

// Issue #13: 30-day absolute session lifetime
const ABSOLUTE_SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Issue #12: 7-day sliding window
const SLIDING_SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function requireAuth(req, res, next) {
  // Passport populates req.user from the session via deserializeUser.
  // If it's missing, the user is not authenticated.
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Authentication required. Please sign in.',
    });
  }

  // Issue #13: Absolute session lifetime check (30 days)
  if (req.session.createdAt && Date.now() - req.session.createdAt > ABSOLUTE_SESSION_MAX_MS) {
    return req.session.destroy(() => {
      res.status(401).json({
        success: false,
        error: 'session_expired',
        message: 'Session expired, please sign in again.',
      });
    });
  }

  try {
    const db = req.app.get('db');
    const user = await db.getUserById(req.user.id);

    if (!user) {
      // Session references a user that no longer exists (deleted account, etc.)
      logger.warn({ userId: req.user.id }, 'Session references non-existent user — destroying session');
      return req.logout(() => {
        res.status(401).json({
          success: false,
          error: 'unauthorized',
          message: 'Session expired. Please sign in again.',
        });
      });
    }

    // Issue #12: Sliding window session refresh — extend on every authenticated request
    req.session.cookie.maxAge = SLIDING_SESSION_MS;

    // Attach the fresh DB user to the request
    req.user = user;
    next();
  } catch (e) {
    logger.error({ err: e, userId: req.user.id }, 'requireAuth DB lookup failed');
    return res.status(500).json({
      success: false,
      error: 'internal',
      message: 'Authentication check failed. Please try again.',
    });
  }
}

/**
 * requireVerifiedEmail — use AFTER requireAuth on routes that need email verification.
 * Issue #10: Unverified users can't access sensitive protected routes.
 */
async function requireVerifiedEmail(req, res, next) {
  if (!req.user || !req.user.email_verified) {
    return res.status(403).json({
      success: false,
      error: 'email_not_verified',
      message: 'Please verify your email address before accessing this resource.',
    });
  }
  next();
}

module.exports = requireAuth;
module.exports.requireVerifiedEmail = requireVerifiedEmail;
