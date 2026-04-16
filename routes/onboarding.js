const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../services/logger');
const db = require('../db');
const { sendVerificationCode } = require('../services/email');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Periodic cleanup of expired verification codes (every hour)
// ---------------------------------------------------------------------------
setInterval(async () => {
  try {
    const deleted = await db.cleanExpiredCodes();
    if (deleted > 0) logger.info({ deleted }, 'Cleaned expired verification codes');
  } catch (e) {
    logger.error({ err: e }, 'Failed to clean expired verification codes');
  }
}, 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEND_LIMIT = 3;
const SEND_WINDOW_MINUTES = 60; // 1 hour
const CODE_TTL_MINUTES = 10;    // 10 minutes
const MAX_ATTEMPTS = 5;

function generateCode() {
  // crypto.randomInt(min, max) — max exclusive, so 1000000 gives 000000–999999
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Route-level rate limiter (coarse guard on top of per-email logic)
// ---------------------------------------------------------------------------

const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for onboarding state updates — 30 per 15 min per IP
const onboardingStateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limiter for code verification — 10 per 15 min per IP
const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many verification attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ---------------------------------------------------------------------------
// POST /api/auth/send-code
// Send a 6-digit verification code to the given email address.
// Rate limited to 3 sends per email per hour.
// ---------------------------------------------------------------------------

router.post('/auth/send-code', sendCodeLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Per-email rate limit: max 3 sends per hour (checked in DB)
    const sendCount = await db.getCodeSendCount(normalizedEmail, SEND_WINDOW_MINUTES);
    if (sendCount >= SEND_LIMIT) {
      return res.status(429).json({
        success: false,
        error: 'Too many codes sent. Please wait before requesting another.'
      });
    }

    const code = generateCode();
    await db.createVerificationCode(normalizedEmail, code, 'onboarding', CODE_TTL_MINUTES);

    // Send verification code via email (Resend SMTP)
    const emailSent = await sendVerificationCode(normalizedEmail, code, CODE_TTL_MINUTES);
    if (!emailSent) {
      logger.warn({ email: normalizedEmail }, 'Verification code created but email not sent (SMTP not configured)');
    }

    logger.info({ email: normalizedEmail, emailSent }, 'Verification code generated');

    // In development expose the code in the response to ease testing.
    const isDev = process.env.NODE_ENV !== 'production';
    res.json({
      success: true,
      message: 'Verification code sent',
      ...(isDev && { _dev_code: code })
    });
  } catch (e) {
    logger.error({ err: e }, 'send-code failed');
    res.status(500).json({ success: false, error: 'Failed to send code' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-code
// Validate the 6-digit code. Marks the user's email as verified on success.
// Max 5 attempts; code expires after 10 minutes.
// ---------------------------------------------------------------------------

router.post('/auth/verify-code', verifyCodeLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Look up the latest non-expired, non-used code for this email
    const entry = await db.getLatestVerificationCode(normalizedEmail);

    if (!entry) {
      return res.status(400).json({ success: false, error: 'No verification code found for this email' });
    }

    if (entry.attempts >= MAX_ATTEMPTS) {
      // Mark exhausted code as used to prevent further attempts
      await db.markCodeUsed(normalizedEmail, entry.code);
      return res.status(400).json({ success: false, error: 'Too many failed attempts. Please request a new code.' });
    }

    // Timing-safe comparison
    const provided = Buffer.from(String(code).trim());
    const expected = Buffer.from(entry.code);
    const match = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

    if (!match) {
      await db.incrementCodeAttempts(entry.id);
      const remaining = MAX_ATTEMPTS - (entry.attempts + 1);
      return res.status(400).json({
        success: false,
        error: 'Incorrect code',
        attempts_remaining: remaining
      });
    }

    // Success — mark as used and verify user's email
    await db.markCodeUsed(normalizedEmail, entry.code);

    // If user is authenticated in session, update req.user too
    if (req.user) {
      req.user.email_verified = true;
    }

    logger.info({ email: normalizedEmail }, 'Email verified successfully');

    res.json({
      success: true,
      message: 'Email verified',
      redirect: '/onboarding'
    });
  } catch (e) {
    logger.error({ err: e }, 'verify-code failed');
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// ---------------------------------------------------------------------------
// All routes below require an authenticated session
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/onboarding/state
// Return the wizard state for the current user.
// ---------------------------------------------------------------------------

router.get('/onboarding/state', requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');

    const result = await db.query(
      `SELECT current_step, selections, stamp_config, started_at, completed_at, last_active_at
       FROM onboarding_state
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // No state yet — return defaults so the client can start fresh
      return res.json({
        success: true,
        state: {
          current_step: 1,
          selections: {},
          stamp_config: {},
          started_at: null,
          completed_at: null,
          last_active_at: null
        }
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      state: {
        current_step: row.current_step,
        selections: row.selections,
        stamp_config: row.stamp_config,
        started_at: row.started_at,
        completed_at: row.completed_at,
        last_active_at: row.last_active_at
      }
    });
  } catch (e) {
    logger.error({ err: e, userId: req.user.id }, 'GET onboarding/state failed');
    res.status(500).json({ success: false, error: 'Failed to load onboarding state' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/onboarding/state
// Upsert {current_step, selections, stamp_config} for the current user.
// ---------------------------------------------------------------------------

router.put('/onboarding/state', requireAuth, onboardingStateLimiter, async (req, res) => {
  try {
    const { current_step, selections, stamp_config } = req.body;

    if (current_step === undefined && selections === undefined && stamp_config === undefined) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const db = req.app.get('db');

    await db.query(
      `INSERT INTO onboarding_state (user_id, current_step, selections, stamp_config, last_active_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET current_step    = COALESCE($2, onboarding_state.current_step),
             selections      = CASE WHEN $3::jsonb IS NOT NULL
                                    THEN onboarding_state.selections || $3::jsonb
                                    ELSE onboarding_state.selections END,
             stamp_config    = CASE WHEN $4::jsonb IS NOT NULL
                                    THEN onboarding_state.stamp_config || $4::jsonb
                                    ELSE onboarding_state.stamp_config END,
             last_active_at  = NOW()`,
      [
        req.user.id,
        current_step ?? null,
        selections ? JSON.stringify(selections) : null,
        stamp_config ? JSON.stringify(stamp_config) : null
      ]
    );

    res.json({ success: true, message: 'State saved' });
  } catch (e) {
    logger.error({ err: e, userId: req.user.id }, 'PUT onboarding/state failed');
    res.status(500).json({ success: false, error: 'Failed to save onboarding state' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/onboarding/complete
// Finalize the wizard: persist user profile fields, mark wizard done.
// ---------------------------------------------------------------------------

router.post('/onboarding/complete', onboardingStateLimiter, requireAuth, async (req, res) => {
  try {
    const db = req.app.get('db');

    // Pull the latest full state from DB so we always work from the canonical version
    const stateResult = await db.query(
      `SELECT selections, stamp_config FROM onboarding_state WHERE user_id = $1`,
      [req.user.id]
    );

    if (stateResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No onboarding state found. Complete the wizard first.' });
    }

    const { selections = {}, stamp_config = {} } = stateResult.rows[0];

    const {
      user_type,
      industry,
      industry_other,
      document_types,
      estimated_volume,
      selected_plan
    } = selections;

    // Persist to user_profiles
    await db.query(
      `INSERT INTO user_profiles (user_id, user_type, industry, industry_other, document_types, estimated_volume,
                                  selected_plan, plan_selected_at, onboarding_completed, onboarding_completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), TRUE, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET user_type                = EXCLUDED.user_type,
             industry                 = EXCLUDED.industry,
             industry_other           = EXCLUDED.industry_other,
             document_types           = EXCLUDED.document_types,
             estimated_volume         = EXCLUDED.estimated_volume,
             selected_plan            = EXCLUDED.selected_plan,
             plan_selected_at         = EXCLUDED.plan_selected_at,
             onboarding_completed     = TRUE,
             onboarding_completed_at  = EXCLUDED.onboarding_completed_at`,
      [
        req.user.id,
        user_type || null,
        industry || null,
        industry_other || null,
        document_types || null,
        estimated_volume || null,
        selected_plan || null
      ]
    );

    // Persist stamp config if provided
    if (stamp_config && Object.keys(stamp_config).length > 0) {
      const { accent_color, wave_color, logo_url, stamp_size } = stamp_config;
      await db.query(
        `INSERT INTO stamp_configs (user_id, accent_color, wave_color, logo_url, stamp_size, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET accent_color = COALESCE($2, stamp_configs.accent_color),
               wave_color   = COALESCE($3, stamp_configs.wave_color),
               logo_url     = COALESCE($4, stamp_configs.logo_url),
               stamp_size   = COALESCE($5, stamp_configs.stamp_size),
               updated_at   = NOW()`,
        [
          req.user.id,
          accent_color || null,
          wave_color || null,
          logo_url || null,
          stamp_size || null
        ]
      );
    }

    // Update users table
    await db.query(
      `UPDATE users
       SET onboarding_completed = TRUE,
           selected_plan        = $2
       WHERE id = $1`,
      [req.user.id, selected_plan || null]
    );

    // Mark wizard complete in onboarding_state
    await db.query(
      `UPDATE onboarding_state SET completed_at = NOW() WHERE user_id = $1`,
      [req.user.id]
    );

    logger.info({ userId: req.user.id, selected_plan }, 'Onboarding completed');

    res.json({
      success: true,
      message: 'Onboarding complete',
      redirect: '/app'
    });
  } catch (e) {
    logger.error({ err: e, userId: req.user.id }, 'POST onboarding/complete failed');
    res.status(500).json({ success: false, error: 'Failed to complete onboarding' });
  }
});

module.exports = router;
