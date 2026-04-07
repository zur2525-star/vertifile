/**
 * Shared database connection configuration helpers.
 *
 * Single source of truth for:
 *   - Detecting local vs remote databases (for SSL decisions)
 *   - Building the pg Pool `ssl` option
 *   - Production environment safety guards
 *
 * Used by: db.js (application pool), scripts/migrate.js (migration runner)
 */

'use strict';

/**
 * Returns true if the given DATABASE_URL points to a local database.
 * Uses WHATWG URL parsing — NOT regex — so hostnames like
 * "localhost.evil.com" do NOT false-match.
 */
function isLocalDatabase(dbUrl) {
  if (!dbUrl || typeof dbUrl !== 'string') return false;
  try {
    const u = new URL(dbUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  } catch (e) {
    return false; // Malformed URL → treat as remote (safest — forces SSL)
  }
}

/**
 * Returns the pg Pool `ssl` option for the given DATABASE_URL.
 * - Local DB → false (no SSL, CI service containers don't support it)
 * - Remote DB → { rejectUnauthorized: false } (managed Postgres with
 *   self-signed or incomplete cert chains like Neon/Render/etc)
 */
function getPoolSslConfig(dbUrl) {
  return isLocalDatabase(dbUrl) ? false : { rejectUnauthorized: false };
}

/**
 * Hostname safe for logging — no credentials, no path.
 * Falls back to '[invalid-url]' on parse failure.
 */
function getSafeHostForLogging(dbUrl) {
  if (!dbUrl) return '[no-url]';
  try {
    return new URL(dbUrl).hostname;
  } catch (e) {
    return '[invalid-url]';
  }
}

/**
 * Production startup guard. Call this at module load time in db.js
 * and scripts/migrate.js. Kills the process if NODE_ENV=production
 * (or RENDER env var is set) AND the DB URL is local.
 *
 * This prevents the silent SSL-downgrade misconfiguration scenario
 * where someone accidentally commits a localhost DATABASE_URL to
 * production.
 */
function assertProductionNotLocal(dbUrl, logger) {
  // Phase 1B (Avi): match logger.js semantics — `!!process.env.RENDER`
  // catches all truthy values (e.g. 'true', '1', 'yes') instead of only the
  // literal string 'true'. Render sets this var on every deploy.
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  if (isProd && isLocalDatabase(dbUrl)) {
    const host = getSafeHostForLogging(dbUrl);
    const msg = '[DB] FATAL: production environment cannot use a local DATABASE_URL (host=' + host + '). Refusing to start to prevent silent plaintext transport. If this is intentional, unset NODE_ENV/RENDER.';
    if (logger && typeof logger.error === 'function') {
      logger.error(msg);
    } else {
      process.stderr.write(msg + '\n');
    }
    process.exit(1);
  }
}

module.exports = {
  isLocalDatabase,
  getPoolSslConfig,
  getSafeHostForLogging,
  assertProductionNotLocal
};
