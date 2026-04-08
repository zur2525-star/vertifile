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
// Cache value shape: { publicKey: KeyObject, pem: string }
// Phase 2D: cache the PEM alongside the KeyObject so /api/verify-public can
// compute a stable fingerprint without re-hitting the DB.
let _publicKeyCache = new Map();
let _initialized = false;

/**
 * Initializes the key manager. Call ONCE at boot, before any route handler runs.
 * Idempotent: safe to call multiple times.
 */
function initialize() {
  if (_initialized) return;
  // _initialized=true here is intentional — the function is fully synchronous
  // and the early-return gate prevents double-init. Do NOT add any `await`
  // inside initialize() without revisiting this gate and the Phase 2E boot
  // check below.
  _initialized = true;

  let privPem = process.env.ED25519_PRIVATE_KEY_PEM;
  const primaryKeyId = process.env.ED25519_PRIMARY_KEY_ID;

  if (!privPem) {
    logger.info('[key-manager] ED25519_PRIVATE_KEY_PEM not set — Ed25519 signing disabled (Phase 2A invisible mode)');
    // Fall through to the Phase 2E boot guard below so an operator who set
    // ED25519_REQUIRED=1 without configuring a key fails loudly at boot.
  } else {
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

  // Phase 2E — fail-closed boot check.
  // If the operator set ED25519_REQUIRED=1 but we did NOT successfully load
  // a primary key (either because PEM is unset, or because the try/catch
  // above hit a non-fatal code path in the future), refuse to boot. Silent
  // HMAC-only operation in a Phase 2E environment is a production bug, not
  // a graceful degradation.
  // STRICT '1' equality — see tests/pipeline-phase2e.test.js Scenario E.
  // Truthy coercion is FORBIDDEN here. See services/pvf-pipeline.js:274 for the
  // matching signing-side check. Both must stay byte-identical.
  if (process.env.ED25519_REQUIRED === '1' && !_primary) {
    logger.error('[key-manager] ED25519_REQUIRED=1 but no Ed25519 primary key loaded. Refusing to boot. Either unset ED25519_REQUIRED or configure ED25519_PRIVATE_KEY_PEM + ED25519_PRIMARY_KEY_ID.');
    process.exit(1);
  }

  // Positive observability: when Phase 2E IS active and the key IS loaded, emit
  // an info log so on-call can grep for it after a cutover. Without this, there
  // is no positive signal that Phase 2E enforcement is running — only the absence
  // of the error log above, which is unobservable in practice.
  if (process.env.ED25519_REQUIRED === '1' && _primary) {
    logger.info({
      keyId: _primary.keyId,
      event: 'phase2e_active'
    }, '[key-manager] Phase 2E fail-closed enforcement ACTIVE — every new PVF will be dual-signed or rejected');
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
  const entry = await _loadPublicKeyEntry(keyId);
  return entry ? entry.publicKey : null;
}

/**
 * Returns the cached PEM string for a key id, or null if unknown / expired.
 * Used by /api/verify-public to compute a stable fingerprint.
 *
 * The PEM bytes are the canonical form for the human-comparable fingerprint:
 * sha256(pem) hex. Two callers running on different boxes against the same
 * ed25519_keys row will compute the same fingerprint.
 *
 * @param {string} keyId
 * @returns {Promise<string | null>}
 */
async function getPublicKeyPemById(keyId) {
  const entry = await _loadPublicKeyEntry(keyId);
  return entry ? entry.pem : null;
}

/**
 * Internal: load (and cache) the {publicKey, pem} entry for a keyId.
 * Both getPublicKeyById and getPublicKeyPemById delegate here to keep the
 * cache and the expiry/validation logic in one place.
 *
 * @param {string} keyId
 * @returns {Promise<{publicKey: crypto.KeyObject, pem: string} | null>}
 */
async function _loadPublicKeyEntry(keyId) {
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

    // Sanitize literal '\n' escapes — matches the Phase 2B fix in initialize()
    // for private keys. An operator who pastes a PEM into a single-line DB field
    // (Neon console UI, quick admin SQL) may end up with '\n' as a two-char
    // literal instead of a real newline. Node's PEM parser rejects that;
    // normalizing first keeps us tolerant. This is a pre-parse sanitization
    // layer — the canonicalization fix below still applies.
    const pemForParse = row.public_key_pem.replace(/\\n/g, '\n');
    const publicKey = crypto.createPublicKey({ key: pemForParse, format: 'pem' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return null;

    // PEM CANONICALIZATION (critical for fingerprint stability):
    //
    // The PEM stored in the DB may have lost its trailing '\n' during manual
    // INSERT (e.g., a Neon/pgAdmin console paste that trimmed whitespace).
    // The Vertifile keyId convention is keyId = sha256(pubPem).slice(0,16)
    // where pubPem is the EXACT string `crypto.KeyObject.export(...)` returns
    // — which always ends in a single '\n'. If we hash the raw DB bytes, we
    // get a different fingerprint than the one the keyId was derived from,
    // breaking the `fingerprint.slice(0,16) === keyId` contract that
    // /api/verify-public and SECURITY.md rely on.
    //
    // Fix: re-export the parsed KeyObject. This produces the canonical
    // byte-stable PEM regardless of whatever whitespace quirks the DB row
    // contains. All downstream callers (/api/verify-public fingerprint,
    // /.well-known/vertifile-pubkey.pem, the JWKS builder) now see the same
    // bytes as the operator who originally generated the key.
    const canonicalPem = publicKey.export({ type: 'spki', format: 'pem' });

    const entry = { publicKey, pem: canonicalPem };
    _publicKeyCache.set(keyId, entry);
    return entry;
  } catch (e) {
    logger.warn({ err: e.message, keyId }, '[key-manager] _loadPublicKeyEntry error');
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
 * Returns the CANONICAL primary public key PEM for /.well-known/vertifile-pubkey.pem.
 *
 * Routes through _loadPublicKeyEntry so the served bytes match whatever
 * crypto.KeyObject.export(...) produces — the same form the keyId and the
 * published fingerprint were computed against. See the PEM CANONICALIZATION
 * comment in _loadPublicKeyEntry for the full reasoning.
 *
 * @returns {Promise<string | null>}
 */
async function getPrimaryPublicKeyPem() {
  if (!_primary) return null;
  const entry = await _loadPublicKeyEntry(_primary.keyId);
  return entry ? entry.pem : null;
}

module.exports = {
  initialize,
  getPrimary,
  getPrimaryKeyId,
  getPublicKeyById,
  getPublicKeyPemById,
  listActivePublicKeys,
  getPrimaryPublicKeyPem
};
