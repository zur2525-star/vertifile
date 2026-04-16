/**
 * Auth Repository -- users, sessions, passwords, verification codes,
 * profiles, stamp config, and account management.
 *
 * Part of the Phase 0 microservices migration. This module receives its
 * pool and queryWithRetry references via init() at boot time, called by
 * db.js after pool creation.
 */

let pool;
let queryWithRetry;

function init(p, qwr) {
  pool = p;
  queryWithRetry = qwr;
}

// ================================================================
// USERS
// ================================================================
async function createUser({ email, name, passwordHash, provider, providerId, avatarUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, provider, provider_id, avatar_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [email, name || null, passwordHash || null, provider || 'email', providerId || null, avatarUrl || null]
  );
  return rows[0];
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows.length ? rows[0] : null;
}

async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows.length ? rows[0] : null;
}

async function getUserByProviderId(provider, providerId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE provider = $1 AND provider_id = $2', [provider, providerId]);
  return rows.length ? rows[0] : null;
}

async function updateUserProfile(userId, { name }) {
  await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
}

async function updateUserDocCount(userId) {
  await pool.query('UPDATE users SET documents_used = documents_used + 1 WHERE id = $1', [userId]);
}

async function getUserDocumentCount(userId) {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM documents WHERE user_id = $1', [userId]);
  return Number(rows[0].count);
}

// ================================================================
// LOGIN TRACKING
// ================================================================
async function updateLastLogin(userId) {
  await pool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [userId]);
}

/**
 * Record a failed login attempt for the given email in the DB.
 * @param {string} email - normalised email address
 * @param {string|null} ip - client IP (may be null)
 */
async function recordFailedLogin(email, ip = null) {
  await pool.query(
    'INSERT INTO login_attempts (email, ip) VALUES ($1, $2)',
    [email, ip || null]
  );
}

/**
 * Count failed login attempts for the given email within the rolling window.
 * @param {string} email - normalised email address
 * @param {number} windowMinutes - look-back window in minutes (default 15)
 * @returns {Promise<number>}
 */
async function getRecentFailedAttempts(email, windowMinutes = 15) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM login_attempts
     WHERE email = $1
       AND attempted_at > NOW() - make_interval(mins => $2::int)`,
    [email, windowMinutes]
  );
  return rows[0].cnt;
}

/**
 * Delete all stored failed login attempts for the given email.
 * Called on successful login.
 * @param {string} email - normalised email address
 */
async function clearFailedAttempts(email) {
  await pool.query(
    'DELETE FROM login_attempts WHERE email = $1',
    [email]
  );
}

async function setEmailVerified(userId, verified = true) {
  await pool.query('UPDATE users SET email_verified = $1, updated_at = NOW() WHERE id = $2', [verified, userId]);
}

// ================================================================
// PASSWORD MANAGEMENT
// ================================================================
async function updateUserPassword(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

async function changeUserPassword(userId, newPasswordHash, currentSessionId) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
  // Issue #5: Invalidate all sessions EXCEPT current when password is changed
  if (currentSessionId) {
    await pool.query(
      `DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1 AND sid != $2`,
      [String(userId), currentSessionId]
    );
  } else {
    await pool.query(
      `DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1`,
      [String(userId)]
    );
  }
}

// ================================================================
// PASSWORD RESET
// ================================================================
async function saveResetToken(userId, token, expiresAt) {
  await pool.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
  await pool.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, token, expiresAt]);
}

async function getResetToken(token) {
  const { rows } = await pool.query('SELECT * FROM password_resets WHERE token = $1', [token]);
  return rows[0] || null;
}

async function deleteResetToken(token) {
  await pool.query('DELETE FROM password_resets WHERE token = $1', [token]);
}

// ================================================================
// STAMP CONFIG (Layer 2 -- visual wrapper, not part of doc hash)
// ================================================================
async function getUserStampConfig(userId) {
  const { rows } = await pool.query('SELECT stamp_config, stamp_updated_at FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  return {
    config: rows[0].stamp_config || {},
    updatedAt: rows[0].stamp_updated_at
  };
}

async function updateUserStampConfig(userId, config) {
  // Validation guard -- strip any non-allowed keys to prevent injection
  const ALLOWED_KEYS = ['waveColors', 'accentColor', 'customLogo', 'orgName', 'stampText', 'size', 'brandText'];
  const safe = {};
  for (const k of ALLOWED_KEYS) {
    if (config[k] !== undefined) safe[k] = config[k];
  }
  // Hard limits
  if (safe.waveColors && (!Array.isArray(safe.waveColors) || safe.waveColors.length > 7)) {
    throw new Error('waveColors must be an array of <=7 hex strings');
  }
  if (safe.customLogo && typeof safe.customLogo === 'string') {
    // Must be data URL (no external URLs allowed per Avi)
    if (!safe.customLogo.startsWith('data:image/')) {
      throw new Error('customLogo must be a data: URL (no external URLs)');
    }
    // Limit to 500KB base64 (~365KB binary)
    if (safe.customLogo.length > 500 * 1024) {
      throw new Error('customLogo too large (max 500KB)');
    }
  }
  if (safe.orgName && safe.orgName.length > 50) safe.orgName = safe.orgName.substring(0, 50);
  if (safe.stampText && safe.stampText.length > 30) safe.stampText = safe.stampText.substring(0, 30);
  // brandText: user-visible custom stamp label (max 16 chars, Unicode-safe, no blocklist per boss)
  if (safe.brandText !== undefined && safe.brandText !== null) {
    if (typeof safe.brandText !== 'string') {
      throw new Error('brandText must be a string');
    }
    let bt = String(safe.brandText).normalize('NFKC');
    // Strip RTL override + zero-width chars (spoofing protection)
    bt = bt.replace(/[\u202A-\u202E\u200B-\u200F\u2066-\u2069]/g, '');
    bt = bt.trim();
    // Surrogate-pair-safe truncate to 16 chars max
    bt = [...bt].slice(0, 16).join('');
    // Empty after sanitization -> store empty string (template falls back to orgName)
    safe.brandText = bt;
  }

  await pool.query(
    'UPDATE users SET stamp_config = $1::jsonb, stamp_updated_at = NOW() WHERE id = $2',
    [JSON.stringify(safe), userId]
  );
  return safe;
}

// ================================================================
// ACCOUNT DELETION
// ================================================================
async function deleteUser(userId) {
  await pool.query('DELETE FROM documents WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ================================================================
// VERIFICATION CODES (email verification for onboarding)
// ================================================================

/**
 * Insert a new verification code for the given email.
 * @param {string} email - normalised email address
 * @param {string} code  - the 6-digit code
 * @param {string} type  - code purpose, default 'onboarding'
 * @param {number} expiresInMinutes - TTL in minutes (default 10)
 */
async function createVerificationCode(email, code, type = 'onboarding', expiresInMinutes = 10) {
  await pool.query(
    `INSERT INTO verification_codes (email, code, type, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4::int))`,
    [email, code, type, expiresInMinutes]
  );
}

/**
 * Retrieve a valid (not expired, not used) verification code.
 * Returns the row or null.
 */
async function getVerificationCode(email, code) {
  const { rows } = await pool.query(
    `SELECT * FROM verification_codes
     WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, code]
  );
  return rows[0] || null;
}

/**
 * Get the most recent non-used, non-expired code for an email (any code).
 * Used to check attempts count.
 */
async function getLatestVerificationCode(email) {
  const { rows } = await pool.query(
    `SELECT * FROM verification_codes
     WHERE email = $1 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

/**
 * Increment the attempts counter on a verification code row.
 */
async function incrementCodeAttempts(id) {
  await pool.query(
    'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1',
    [id]
  );
}

/**
 * Mark a verification code as used.
 */
async function markCodeUsed(email, code) {
  await pool.query(
    `UPDATE verification_codes SET used = true
     WHERE email = $1 AND code = $2`,
    [email, code]
  );
}

/**
 * Delete all expired codes (housekeeping).
 */
async function cleanExpiredCodes() {
  const result = await pool.query(
    'DELETE FROM verification_codes WHERE expires_at < NOW()'
  );
  return result.rowCount;
}

/**
 * Count how many codes were sent to this email within the given window.
 * Used for per-email rate limiting (e.g. max 3 per hour).
 */
async function getCodeSendCount(email, minutesWindow = 60) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM verification_codes
     WHERE email = $1 AND created_at > NOW() - make_interval(mins => $2::int)`,
    [email, minutesWindow]
  );
  return rows[0].cnt;
}

module.exports = {
  init,
  functions: {
    createUser,
    getUserByEmail,
    getUserById,
    getUserByProviderId,
    updateUserProfile,
    updateUserDocCount,
    getUserDocumentCount,
    updateLastLogin,
    setEmailVerified,
    updateUserPassword,
    changeUserPassword,
    saveResetToken,
    getResetToken,
    deleteResetToken,
    getUserStampConfig,
    updateUserStampConfig,
    deleteUser,
    createVerificationCode,
    getVerificationCode,
    getLatestVerificationCode,
    incrementCodeAttempts,
    markCodeUsed,
    cleanExpiredCodes,
    getCodeSendCount,
    recordFailedLogin,
    getRecentFailedAttempts,
    clearFailedAttempts,
  },
};
