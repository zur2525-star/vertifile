/**
 * Startup environment validation for Vertifile.
 *
 * Checks that critical environment variables are present and well-formed
 * before the application wires up middleware or routes. In production
 * (NODE_ENV=production or RENDER is set) missing required vars are fatal.
 * In development they are logged as warnings so the app can still start.
 *
 * @module services/env-validator
 */

const logger = require('./logger');

const PREFIX = '[env-validator]';

/**
 * Validate required environment variables at boot time.
 *
 * Call this EARLY in server.js -- after requires, before any app.use().
 */
function validateEnv() {
  const isProduction =
    process.env.NODE_ENV === 'production' || !!process.env.RENDER;

  const errors = [];   // fatal in production
  const warnings = []; // always non-fatal

  // ---- Required in production ------------------------------------------------
  const required = [
    { key: 'DATABASE_URL',   desc: 'database connection' },
    { key: 'HMAC_SECRET',    desc: 'PVF HMAC signatures' },
    { key: 'SESSION_SECRET', desc: 'session encryption' },
  ];

  for (const { key, desc } of required) {
    if (!process.env[key] || process.env[key].trim() === '') {
      errors.push(`${key} is required in production (${desc})`);
    }
  }

  // RESEND_API_KEY: warn-only -- email will be disabled but app can function
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.trim() === '') {
    warnings.push('RESEND_API_KEY is not set -- email sending will be disabled');
  }

  // ---- Conditional required --------------------------------------------------

  // Ed25519 signing key
  if (process.env.ED25519_REQUIRED === '1') {
    if (
      !process.env.ED25519_PRIVATE_KEY_PEM ||
      process.env.ED25519_PRIVATE_KEY_PEM.trim() === ''
    ) {
      errors.push(
        'ED25519_PRIVATE_KEY_PEM is required when ED25519_REQUIRED=1'
      );
    }
  }

  // Google OAuth: both sides must be present if either is set
  const hasGoogleId = !!process.env.GOOGLE_CLIENT_ID;
  const hasGoogleSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  if (hasGoogleId !== hasGoogleSecret) {
    const missing = hasGoogleId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID';
    errors.push(
      `${missing} must be set when its counterpart is set (Google OAuth incomplete)`
    );
  }

  // ---- Output ----------------------------------------------------------------

  // Warnings are always printed regardless of environment
  for (const msg of warnings) {
    logger.warn(`${PREFIX} WARN: ${msg}`);
  }

  if (errors.length === 0) {
    logger.info(`${PREFIX} OK: All required environment variables are set`);
    return;
  }

  if (isProduction) {
    // Fatal in production -- log every error then exit
    for (const msg of errors) {
      logger.fatal(`${PREFIX} FATAL: ${msg}`);
    }
    process.exit(1);
  } else {
    // Development -- warn but keep running
    for (const msg of errors) {
      logger.warn(`${PREFIX} WARN (dev): ${msg}`);
    }
  }
}

module.exports = { validateEnv };
