/**
 * Ed25519 key management for Vertifile.
 *
 * Responsibilities:
 *   - Load the primary private key from ED25519_PRIVATE_KEY_PEM once at boot.
 *   - Hold it as a crypto.KeyObject in memory (never as a string after load).
 *   - Expose getPrimary() → { keyId, privateKey } for signing.
 *   - Expose getPublicKeyById(keyId) → KeyObject for verification, backed
 *     by the ed25519_keys DB table (with in-memory cache).
 *
 * SECURITY INVARIANTS:
 *   - Private key is NEVER returned from any exported function except via
 *     getPrimary() (signing only).
 *   - Private key PEM string is dropped after KeyObject conversion — only
 *     the KeyObject is retained.
 *   - Public keys are cacheable without security risk.
 *
 * PHASE 2A BEHAVIOR:
 *   - If ED25519_PRIVATE_KEY_PEM is NOT set, initialize() logs a warning
 *     and continues. No key is loaded. signing.signEd25519() returns null.
 *     The app is fully functional without Ed25519 — this is the invisible
 *     phase.
 *   - If ED25519_PRIVATE_KEY_PEM IS set but malformed, initialize() logs
 *     an error and exits the process (fail-closed for bad config).
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// State held at module scope
let _primary = null;       // { keyId, privateKey: KeyObject } | null
let _publicKeyCache = new Map();  // keyId → KeyObject
let _initialized = false;

/**
 * Initializes the key manager. Call ONCE at boot, before any route handler runs.
 * Idempotent: safe to call multiple times.
 */
function initialize() {
  if (_initialized) return;
  _initialized = true;

  let privPem = process.env.ED25519_PRIVATE_KEY_PEM;
  const primaryKeyId = process.env.ED25519_PRIMARY_KEY_ID;

  if (!privPem) {
    logger.info('[key-manager] ED25519_PRIVATE_KEY_PEM not set — Ed25519 signing disabled (Phase 2A invisible mode)');
    return;
  }

  // Phase 2B fix: Render and other env-var systems sometimes strip real
  // newlines from multi-line values. Operators can paste a single-line PEM
  // using literal '\n' as a line separator (e.g.
  // '-----BEGIN PRIVATE KEY-----\n<base64>\n-----END PRIVATE KEY-----\n').
  // This replace is a no-op for properly multi-line PEMs (no '\n' literals
  // to find) so it preserves both formats.
  privPem = privPem.replace(/\\n/g, '\n');

  if (!primaryKeyId) {
    logger.error('[key-manager] ED25519_PRIVATE_KEY_PEM is set but ED25519_PRIMARY_KEY_ID is not. Refusing to boot with inconsistent key config.');
    process.exit(1);
  }

  // Phase 2B Fix #4: validate keyId format at boot. The DB column is
  // VARCHAR(16); an operator who sets a non-16-hex-char keyId would boot fine
  // but crash at the first Ed25519 INSERT with a SQL length error — a latent
  // runtime failure. Fail-closed at boot instead. Log only a truncated keyId
  // (first 8 chars + ellipsis) to avoid leaking the full identifier.
  if (!/^[a-f0-9]{16}$/.test(primaryKeyId)) {
    logger.error({ keyId: primaryKeyId.slice(0, 8) + '...' }, '[key-manager] ED25519_PRIMARY_KEY_ID must be exactly 16 lowercase hex characters');
    process.exit(1);
  }

  try {
    const privateKey = crypto.createPrivateKey({ key: privPem, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      logger.error({ type: privateKey.asymmetricKeyType }, '[key-manager] ED25519_PRIVATE_KEY_PEM is not an Ed25519 key');
      process.exit(1);
    }
    _primary = { keyId: primaryKeyId, privateKey };
    logger.info({ keyId: primaryKeyId, type: 'ed25519' }, '[key-manager] primary key loaded');
  } catch (e) {
    logger.error({ err: e.message }, '[key-manager] failed to parse ED25519_PRIVATE_KEY_PEM');
    process.exit(1);
  }
}

/**
 * Returns the primary signing key, or null if not configured.
 * @returns {{ keyId: string, privateKey: crypto.KeyObject } | null}
 */
function getPrimary() {
  return _primary;
}

/**
 * Returns the primary key ID, or null if not configured.
 * @returns {string | null}
 */
function getPrimaryKeyId() {
  return _primary ? _primary.keyId : null;
}

/**
 * Looks up a public key by its keyId. Used by verifyEd25519.
 * Caches results in memory to avoid repeated DB lookups.
 *
 * @param {string} keyId
 * @returns {Promise<crypto.KeyObject | null>}
 */
async function getPublicKeyById(keyId) {
  if (!keyId || typeof keyId !== 'string') return null;
  if (_publicKeyCache.has(keyId)) return _publicKeyCache.get(keyId);

  try {
    // Lazy require — db.js requires services/logger which doesn't touch us
    const db = require('../db');
    const row = await db.getEd25519KeyById(keyId);
    if (!row || !row.public_key_pem) return null;

    // Reject expired keys
    if (row.valid_until && new Date(row.valid_until) < new Date()) {
      logger.warn({ keyId }, '[key-manager] key expired');
      return null;
    }

    const publicKey = crypto.createPublicKey({ key: row.public_key_pem, format: 'pem' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return null;

    _publicKeyCache.set(keyId, publicKey);
    return publicKey;
  } catch (e) {
    logger.warn({ err: e.message, keyId }, '[key-manager] getPublicKeyById error');
    return null;
  }
}

/**
 * Returns a JWKS-ready list of currently valid public keys.
 * Used by /.well-known/vertifile-jwks.json.
 *
 * @returns {Promise<Array<{ kid, kty, crv, x, valid_from, valid_until }>>}
 */
async function listActivePublicKeys() {
  try {
    const db = require('../db');
    const rows = await db.listActiveEd25519Keys();
    return rows.map(row => ({
      kid: row.id,
      kty: 'OKP',
      crv: 'Ed25519',
      // Convert PEM → raw public key → base64url (JWK format)
      x: (() => {
        try {
          const pk = crypto.createPublicKey({ key: row.public_key_pem, format: 'pem' });
          const der = pk.export({ type: 'spki', format: 'der' });
          // Ed25519 SPKI has a 12-byte prefix; the raw key is the last 32 bytes
          const rawPub = der.subarray(der.length - 32);
          return rawPub.toString('base64url');
        } catch (e) {
          return null;
        }
      })(),
      valid_from: row.valid_from,
      valid_until: row.valid_until || null
    })).filter(k => k.x !== null);
  } catch (e) {
    logger.warn({ err: e.message }, '[key-manager] listActivePublicKeys error');
    return [];
  }
}

/**
 * Returns the primary public key PEM for /.well-known/vertifile-pubkey.pem.
 * @returns {Promise<string | null>}
 */
async function getPrimaryPublicKeyPem() {
  if (!_primary) return null;
  try {
    const db = require('../db');
    const row = await db.getEd25519KeyById(_primary.keyId);
    return row ? row.public_key_pem : null;
  } catch (e) {
    logger.warn({ err: e.message }, '[key-manager] getPrimaryPublicKeyPem error');
    return null;
  }
}

module.exports = {
  initialize,
  getPrimary,
  getPrimaryKeyId,
  getPublicKeyById,
  listActivePublicKeys,
  getPrimaryPublicKeyPem
};
