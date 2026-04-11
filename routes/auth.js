const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const passport = require('passport');
const logger = require('../services/logger');
const { sendPasswordResetEmail } = require('../services/email');
const rateLimit = require('express-rate-limit');
const { authLimiter, signupLimiter, getClientIP } = require('../middleware/auth');
const requireAuth = require('../middleware/requireAuth');
const { scheduleOnboardingEmails } = require('../services/onboarding-emails');

const router = express.Router();

// ---------------------------------------------------------------------------
// Configurable bcrypt rounds (floor of 12) — Issue #18
// ---------------------------------------------------------------------------
const BCRYPT_ROUNDS = Math.max(12, parseInt(process.env.BCRYPT_ROUNDS) || 12);

// ---------------------------------------------------------------------------
// Common password blacklist — Issue #7
// ---------------------------------------------------------------------------
const COMMON_PASSWORDS_PATH = path.join(__dirname, '..', 'data', 'common-passwords.txt');
let commonPasswords = new Set();
try {
  commonPasswords = new Set(
    fs.readFileSync(COMMON_PASSWORDS_PATH, 'utf8')
      .split('\n').map(p => p.trim().toLowerCase()).filter(Boolean)
  );
  logger.info({ count: commonPasswords.size }, 'Common password blacklist loaded');
} catch (e) {
  logger.warn('Common password blacklist not found at data/common-passwords.txt — skipping');
}

// ---------------------------------------------------------------------------
// Password complexity validation — Issue #6
// ---------------------------------------------------------------------------
function validatePasswordComplexity(password, email) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be less than 128 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Password cannot be your email address';
  if (commonPasswords.size > 0 && commonPasswords.has(password.toLowerCase())) {
    return 'This password is too common. Please choose a stronger password.';
  }
  return null; // valid
}

// ---------------------------------------------------------------------------
// Cache-Control middleware for all auth responses — Issue #17
// ---------------------------------------------------------------------------
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// ---------------------------------------------------------------------------
// Dedicated forgot-password rate limiter by email — Issue #16
// ---------------------------------------------------------------------------
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.body.email || '').toLowerCase().trim(),
  message: { success: false, error: 'Too many password reset requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_SESSIONS_PER_USER = 5;

function sanitizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.toLowerCase().trim();
}

/**
 * Enforce maximum concurrent sessions per user. Deletes the oldest sessions
 * when the count exceeds MAX_SESSIONS_PER_USER. Best-effort — failures are
 * swallowed so login/register flows are never blocked by session cleanup.
 */
async function enforceSessionLimit(db, userId) {
  const activeSessions = await db.query(
    `SELECT sid FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1 ORDER BY expire ASC`,
    [String(userId)]
  );
  if (activeSessions.rows.length > MAX_SESSIONS_PER_USER) {
    const toDelete = activeSessions.rows.slice(0, activeSessions.rows.length - MAX_SESSIONS_PER_USER);
    for (const s of toDelete) {
      await db.query('DELETE FROM sessions WHERE sid = $1', [s.sid]);
    }
  }
}

// ---------------------------------------------------------------------------
// GET /auth/me — return current authenticated user
// ---------------------------------------------------------------------------

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      avatar: u.avatar_url,
      provider: u.provider,
      email_verified: u.email_verified || false,
      plan: u.plan,
      subscription_status: u.subscription_status || 'none',
      selected_plan: u.selected_plan || null,
      onboarding_completed: u.onboarding_completed || false,
      documents_used: u.documents_used,
      documents_limit: u.documents_limit,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    },
  });
});

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/app?auth_error=google_failed' }),
  async (req, res) => {
    try {
      const db = req.app.get('db');
      await db.updateLastLogin(req.user.id);
      // Issue #26: Set session createdAt for absolute lifetime tracking
      req.session.createdAt = Date.now();
      // Issue #22: Audit log for OAuth login
      await db.log('login_success', { userId: req.user.id, ip: getClientIP(req), provider: 'google', userAgent: req.get('user-agent') });

      // Issue #14: Enforce session limit per user
      await enforceSessionLimit(db, req.user.id);

      // Schedule onboarding emails for new Google signups (idempotent -- skips if already scheduled)
      try {
        await scheduleOnboardingEmails(req.user.id, req.user.email, req.user.name);
      } catch (_) { /* best effort */ }
    } catch (e) {
      logger.warn({ err: e, userId: req.user?.id }, 'Failed to update last_login on Google callback');
    }
    res.redirect('/app');
  }
);

// ---------------------------------------------------------------------------
// POST /auth/register — email + password signup
// ---------------------------------------------------------------------------

router.post('/register', signupLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { password, name } = req.body;
    const email = sanitizeEmail(req.body.email);

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Issue #6: Password complexity validation
    const passwordError = validatePasswordComplexity(password, email);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }

    // Issue #1: Do NOT reveal whether email exists — generic response
    const existing = await db.getUserByEmail(email);
    if (existing) {
      // Silently succeed — do NOT reveal email exists
      // In production: send a "someone tried to register with your email" notification
      return res.json({ success: true, message: 'If this email is available, a verification code has been sent.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await db.createUser({
      email,
      name: name ? String(name).trim().substring(0, 255) : email.split('@')[0],
      passwordHash: hash,
      provider: 'email',
    });

    // Issue #25: Audit log for registration
    await db.log('user_registered', { userId: user.id, ip: getClientIP(req), provider: 'email' });

    req.login(user, async (err) => {
      if (err) {
        logger.error({ err }, 'Login after register failed');
        return res.status(500).json({ success: false, error: 'Login failed' });
      }
      // Issue #26: Set session createdAt for absolute lifetime tracking
      req.session.createdAt = Date.now();
      try { await db.updateLastLogin(user.id); } catch (_) { /* best effort */ }

      // Issue #14: Enforce session limit per user
      try { await enforceSessionLimit(db, user.id); } catch (_) { /* best effort */ }

      // Schedule onboarding email sequence (best effort -- never blocks signup)
      try {
        await scheduleOnboardingEmails(user.id, user.email, user.name);
      } catch (_) { /* best effort */ }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar_url,
        },
      });
    });
  } catch (e) {
    logger.error({ err: e }, 'Registration failed');
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/login — email + password
// ---------------------------------------------------------------------------

router.post('/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      logger.error({ err }, 'Login error');
      return res.status(500).json({ success: false, error: 'Server error' });
    }
    if (!user) {
      // Issue #22: Audit log for failed login
      const db = req.app.get('db');
      const email = (req.body.email || '').substring(0, 3) + '***';
      db.log('login_failed', { email, ip: getClientIP(req), reason: info?.message || 'invalid_credentials' }).catch(() => {});
      return res.status(401).json({ success: false, error: info?.message || 'Invalid credentials' });
    }
    req.login(user, async (loginErr) => {
      if (loginErr) {
        logger.error({ err: loginErr }, 'Session creation failed');
        return res.status(500).json({ success: false, error: 'Login failed' });
      }
      // Issue #26: Set session createdAt for absolute lifetime tracking
      req.session.createdAt = Date.now();
      try {
        const db = req.app.get('db');
        await db.updateLastLogin(user.id);
        // Issue #22: Audit log for successful login
        await db.log('login_success', { userId: user.id, ip: getClientIP(req), provider: 'email', userAgent: req.get('user-agent') });
      } catch (_) { /* best effort */ }

      // Issue #14: Enforce session limit per user
      try {
        const db = req.app.get('db');
        await enforceSessionLimit(db, user.id);
      } catch (_) { /* best effort */ }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar_url,
        },
      });
    });
  })(req, res, next);
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

router.post('/logout', (req, res) => {
  const sid = req.sessionID;
  req.logout(() => {
    req.session.destroy((err) => {
      if (err) logger.warn({ err, sid: sid?.substring(0, 8) }, 'Session destroy failed');
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

// ---------------------------------------------------------------------------
// POST /auth/forgot-password
// ---------------------------------------------------------------------------

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    const db = req.app.get('db');
    const user = await db.getUserByEmail(email);

    // Always return the same message to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await db.saveResetToken(user.id, token, expires);

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    logger.info({ email }, 'Password reset requested');

    // Send password reset email (fails gracefully if SMTP not configured)
    await sendPasswordResetEmail(email, resetUrl, 30);

    await db.log('password_reset_requested', { email });

    res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
  } catch (e) {
    logger.error({ err: e }, 'Forgot password failed');
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, error: 'Token and password required' });
    }

    // Issue #24/#6: Full password complexity validation on reset
    const passwordError = validatePasswordComplexity(password);
    if (passwordError) {
      return res.status(400).json({ success: false, error: passwordError });
    }

    const db = req.app.get('db');
    const reset = await db.getResetToken(token);
    if (!reset) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    }
    if (new Date(reset.expires_at) < new Date()) {
      await db.deleteResetToken(token);
      return res.status(400).json({ success: false, error: 'Reset link has expired' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.updateUserPassword(reset.user_id, hash);
    await db.deleteResetToken(token);

    // Issue #5: Invalidate ALL sessions for this user after password reset
    await db.query(
      `DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1`,
      [String(reset.user_id)]
    );
    await db.log('sessions_invalidated', { userId: reset.user_id, reason: 'password_reset' });
    await db.log('password_reset_completed', { userId: reset.user_id });

    res.json({ success: true, message: 'Password updated successfully. Please sign in with your new password.' });
  } catch (e) {
    logger.error({ err: e }, 'Reset password failed');
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

module.exports = router;
