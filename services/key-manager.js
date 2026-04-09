/**
 * Ed25519 key management for Vertifile.
 *
 * Responsibilities:
 *   - Load up to TWO private key slots at boot:
 *       * _primary — from ED25519_PRIVATE_KEY_PEM / ED25519_PRIMARY_KEY_ID
 *         (always expected in production)
 *       * _next    — from ED25519_NEXT_PRIVATE_KEY_PEM / ED25519_NEXT_KEY_ID
 *         (only during a rotation window)
 *   - Hold each as a crypto.KeyObject in memory (never as a string after load).
 *   - Expose getPrimary() → { keyId, privateKey } — the historical "primary
 *     slot" (what's loaded in ED25519_PRIVATE_KEY_PEM). Synchronous, preserves
 *     the pre-Phase-3B contract.
 *   - Expose getActivePrimary() → { keyId, privateKey } — the slot whose keyId
 *     matches the DB's state='active' row. This is what signEd25519 consults.
 *     Async because it may query the DB; results cached for 30s.
 *   - Expose getLoadedSlots() → { primary, next } for /health/deep visibility.
 *   - Expose getPublicKeyById(keyId) → KeyObject for verification, backed
 *     by the ed25519_keys DB table (with in-memory cache).
 *
 * SECURITY INVARIANTS:
 *   - Private key is NEVER returned from any exported function except via
 *     getPrimary() / getActivePrimary() (signing only).
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
 *
 * PHASE 3B BEHAVIOR (two-slot / rotation):
 *   - Both slots are loaded at boot if the corresponding env vars exist.
 *   - An identical keyId in both slots aborts boot (misconfiguration).
 *   - Phase 2E's ED25519_REQUIRED=1 check accepts EITHER slot (primary OR next)
 *     as a loaded key — the DB's state='active' row decides which one signs,
 *     and Phase 2E enforcement is layered at the pipeline.
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// State held at module scope
// Slot shape: { keyId: string, privateKey: crypto.KeyObject }
let _primary = null;  // loaded from ED25519_PRIVATE_KEY_PEM — historical primary
let _next    = null;  // loaded from ED25519_NEXT_PRIVATE_KEY_PEM — rotation staging slot
// Cache value shape: { publicKey: KeyObject, pem: string }
// Phase 2D: cache the PEM alongside the KeyObject so /api/verify-public can
// compute a stable fingerprint without re-hitting the DB.
let _publicKeyCache = new Map();
let _initialized = false;

// Phase 3B active-primary cache. Stores the keyId the DB currently reports as
// state='active' plus the load timestamp. Refreshed every 30s; invalidated by
// the rotation command (via invalidateActivePrimaryCache) for local zero-wait
// cutover. Production processes running on other hosts pick up the change at
// the next 30s cache boundary OR on next restart.
const ACTIVE_PRIMARY_CACHE_MS = 30 * 1000;
let _activePrimaryCache = null; // { keyId: string, loadedAt: number }

/**
 * Internal: load one key slot from a pair of env vars.
 *
 * Returns { keyId, privateKey } on success, or null if the PEM env var is
 * unset (graceful skip — the slot simply isn't present). If the env var IS
 * set but contains invalid data, exits the process (fail-closed for bad
 * config — Phase 2E invariant).
 *
 * @param {string} pemEnvVar    - e.g. 'ED25519_PRIVATE_KEY_PEM'
 * @param {string} keyIdEnvVar  - e.g. 'ED25519_PRIMARY_KEY_ID'
 * @param {string} slotName     - 'primary' or 'next' (logging only)
 * @returns {{ keyId: string, privateKey: crypto.KeyObject } | null}
 */
function _loadKeySlot(pemEnvVar, keyIdEnvVar, slotName) {
  let privPem = process.env[pemEnvVar];
  const keyId = process.env[keyIdEnvVar];

  if (!privPem) {
    // Slot not present — this is fine. The primary slot missing is a
    // Phase 2A "invisible mode" signal; the next slot missing is the
    // normal non-rotation state.
    return null;
  }

  // Phase 2B fix: Render and other env-var systems sometimes strip real
  // newlines from multi-line values. Operators can paste a single-line PEM
  // using literal '\n' as a line separator (e.g.
  // '-----BEGIN PRIVATE KEY-----\n<base64>\n-----END PRIVATE KEY-----\n').
  // This replace is a no-op for properly multi-line PEMs (no '\n' literals
  // to find) so it preserves both formats.
  privPem = privPem.replace(/\\n/g, '\n');

  if (!keyId) {
    logger.error({ slot: slotName, pemEnvVar, keyIdEnvVar }, `[key-manager] ${pemEnvVar} is set but ${keyIdEnvVar} is not. Refusing to boot with inconsistent ${slotName} key config.`);
    process.exit(1);
  }

  // Phase 2B Fix #4: validate keyId format at boot. The DB column is
  // VARCHAR(16); an operator who sets a non-16-hex-char keyId would boot fine
  // but crash at the first Ed25519 INSERT with a SQL length error — a latent
  // runtime failure. Fail-closed at boot instead. Log only a truncated keyId
  // (first 8 chars + ellipsis) to avoid leaking the full identifier.
  if (!/^[a-f0-9]{16}$/.test(keyId)) {
    logger.error({ slot: slotName, keyId: keyId.slice(0, 8) + '...' }, `[key-manager] ${keyIdEnvVar} must be exactly 16 lowercase hex characters`);
    process.exit(1);
  }

  try {
    const privateKey = crypto.createPrivateKey({ key: privPem, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      logger.error({ slot: slotName, type: privateKey.asymmetricKeyType }, `[key-manager] ${pemEnvVar} is not an Ed25519 key`);
      process.exit(1);
    }

    // Phase 3B Avi A4 — verify the supplied keyId actually corresponds to
    // this private key. Without this check, an operator who pastes the
    // PEM of key A but the keyId label of key B (easy to do when managing
    // two `generate` runs in parallel during a rotation window) would
    // boot successfully, sign documents with key A, and silently break
    // verification because the DB row for key B has key B's public key.
    // Phase 2A had this gap for one slot; Phase 3B's two-slot architecture
    // doubles the surface area and makes the check essential.
    //
    // The keyId convention (Vertifile): keyId = sha256(publicKeyPem).slice(0,16)
    // where publicKeyPem is the exact string crypto.KeyObject.export(...)
    // returns. See _loadPublicKeyEntry for the canonicalization rationale.
    const publicKeyPem = crypto
      .createPublicKey(privateKey)
      .export({ type: 'spki', format: 'pem' });
    const computedKeyId = crypto
      .createHash('sha256')
      .update(publicKeyPem)
      .digest('hex')
      .slice(0, 16);

    if (computedKeyId !== keyId) {
      logger.error({
        slot: slotName,
        suppliedKeyId: keyId.slice(0, 8) + '...',
        computedKeyId: computedKeyId.slice(0, 8) + '...'
      }, '[key-manager] keyId env var does NOT match the keyId computed from the loaded PEM. ' +
         'Operator copy-paste error between two generate runs is the most likely cause. ' +
         'Refusing to boot to prevent silent verification failures.');
      process.exit(1);
    }

    logger.info({ slot: slotName, keyId, type: 'ed25519' }, `[key-manager] ${slotName} key slot loaded`);
    return { keyId, privateKey };
  } catch (e) {
    logger.error({ slot: slotName, err: e.message }, `[key-manager] failed to parse ${pemEnvVar}`);
    process.exit(1);
  }
}

/**
 * Initializes the key manager. Call ONCE at boot, before any route handler runs.
 * Idempotent: safe to call multiple times.
 *
 * Phase 3B: loads BOTH _primary (from ED25519_PRIVATE_KEY_PEM) and _next
 * (from ED25519_NEXT_PRIVATE_KEY_PEM, if set). During a rotation window,
 * the two slots hold the outgoing and incoming signing keys respectively.
 * The DB's `state='active'` row is the authoritative "which slot signs"
 * pointer — getActivePrimary() is the function that consults it.
 */
function initialize() {
  if (_initialized) return;
  // _initialized=true here is intentional — the function is fully synchronous
  // and the early-return gate prevents double-init. Do NOT add any `await`
  // inside initialize() without revisiting this gate and the Phase 2E boot
  // check below.
  _initialized = true;

  // Slot 1 (primary) — the historical primary slot. In Phase 2A/2B this was
  // the only slot; in Phase 3B+ it's the outgoing key during a rotation and
  // the sole key at steady state.
  _primary = _loadKeySlot('ED25519_PRIVATE_KEY_PEM', 'ED25519_PRIMARY_KEY_ID', 'primary');

  if (!_primary) {
    logger.info('[key-manager] ED25519_PRIVATE_KEY_PEM not set — Ed25519 signing disabled (Phase 2A invisible mode)');
    // Fall through to the Phase 2E boot guard below so an operator who set
    // ED25519_REQUIRED=1 without configuring a key fails loudly at boot.
  }

  // Slot 2 (next) — only present during a rotation window. The operator
  // generates a new key via `scripts/rotate-ed25519-key.js generate`, pastes
  // the PEM into ED25519_NEXT_PRIVATE_KEY_PEM + ED25519_NEXT_KEY_ID, waits
  // for the app to redeploy (so both slots are loaded), then runs the
  // activate subcommand. After rotation completes the operator promotes the
  // NEXT env vars to PRIMARY and deletes the NEXT env vars.
  _next = _loadKeySlot('ED25519_NEXT_PRIVATE_KEY_PEM', 'ED25519_NEXT_KEY_ID', 'next');

  // Config sanity: primary and next MUST have distinct keyIds. A config where
  // both slots hold the same keyId is almost certainly an operator mistake
  // (e.g. they copied the primary env vars into the next-slot vars instead of
  // the freshly generated key). Continuing would make getActivePrimary's
  // slot-match logic ambiguous — fail loudly at boot instead.
  if (_primary && _next && _primary.keyId === _next.keyId) {
    logger.error({
      primaryKeyId: _primary.keyId.slice(0, 8) + '...',
      nextKeyId: _next.keyId.slice(0, 8) + '...'
    }, '[key-manager] ED25519_PRIMARY_KEY_ID and ED25519_NEXT_KEY_ID are identical — config error, refusing to boot');
    process.exit(1);
  }

  // Phase 2E — fail-closed boot check.
  // If the operator set ED25519_REQUIRED=1 but we did NOT successfully load
  // a key in EITHER slot, refuse to boot. Silent HMAC-only operation in a
  // Phase 2E environment is a production bug, not a graceful degradation.
  // STRICT '1' equality — see tests/pipeline-phase2e.test.js Scenario E.
  // Truthy coercion is FORBIDDEN here. See services/pvf-pipeline.js:274 for the
  // matching signing-side check. Both must stay byte-identical.
  //
  // Phase 3B adaptation: we accept EITHER slot as a loaded key. The rationale
  // is that during a rotation window the "active signing key" may live in
  // the next slot (after the DB state flip, before the env-var promotion),
  // and boot-blocking on that intermediate state would cause a needless
  // outage. The pipeline-layer Phase 2E check (pvf-pipeline.js:279) still
  // catches the "no signature produced" failure mode at request time.
  if (process.env.ED25519_REQUIRED === '1' && !_primary && !_next) {
    logger.error('[key-manager] ED25519_REQUIRED=1 but no Ed25519 key loaded (neither primary nor next). Refusing to boot. Either unset ED25519_REQUIRED or configure ED25519_PRIVATE_KEY_PEM + ED25519_PRIMARY_KEY_ID.');
    process.exit(1);
  }

  // Positive observability: when Phase 2E IS active and at least one slot IS
  // loaded, emit an info log so on-call can grep for it after a cutover.
  // Without this, there is no positive signal that Phase 2E enforcement is
  // running — only the absence of the error log above, which is unobservable
  // in practice.
  if (process.env.ED25519_REQUIRED === '1' && (_primary || _next)) {
    logger.info({
      primary: _primary ? _primary.keyId : null,
      next: _next ? _next.keyId : null,
      event: 'phase2e_active'
    }, '[key-manager] Phase 2E fail-closed enforcement ACTIVE — every new PVF will be dual-signed or rejected');
  }
}

/**
 * Returns the HISTORICAL primary slot (the one loaded from
 * ED25519_PRIVATE_KEY_PEM / ED25519_PRIMARY_KEY_ID), or null if not configured.
 *
 * This preserves the pre-Phase-3B synchronous contract. Callers that need the
 * DB-authoritative "currently signing" key must use getActivePrimary() instead
 * — at steady state (no rotation in progress) the two resolve to the same
 * slot, but during a rotation window getActivePrimary() may resolve to the
 * next slot while getPrimary() still returns the outgoing historical slot.
 *
 * @returns {{ keyId: string, privateKey: crypto.KeyObject } | null}
 */
function getPrimary() {
  return _primary;
}

/**
 * Returns the DB-authoritative active signing slot, or null.
 *
 * Consults ed25519_keys WHERE state='active' to decide which loaded slot
 * should sign the next document. Results cached for 30s to avoid hammering
 * the DB on every signing call (signing is on the hot path for PVF
 * creation). The rotation command invalidates this cache locally via
 * invalidateActivePrimaryCache() so the new active key takes effect
 * immediately in the local process; other processes pick it up on their
 * next cache expiry or on restart.
 *
 * Failure modes:
 *   - DB lookup errors → warn and return null (signing degrades to HMAC-only
 *     via the pipeline's inner try/catch, or fails closed under Phase 2E).
 *   - No active row in DB → warn and return null (same handling).
 *   - Active keyId doesn't match any loaded slot → warn and return null. This
 *     is the "rotation in progress, env vars not yet promoted" state. Phase 2E
 *     at the pipeline layer will convert this to a clear error.
 *
 * @returns {Promise<{ keyId: string, privateKey: crypto.KeyObject } | null>}
 */
async function getActivePrimary() {
  // Fast path: cache hit AND the cached keyId is still a loaded slot.
  // We re-validate against the loaded slots because in principle a call to
  // invalidateActivePrimaryCache() should have been made if the DB state
  // changed, but belt-and-suspenders the match check here so a stale cache
  // doesn't return a slot the DB no longer considers active.
  if (_activePrimaryCache && Date.now() - _activePrimaryCache.loadedAt < ACTIVE_PRIMARY_CACHE_MS) {
    if (_primary && _primary.keyId === _activePrimaryCache.keyId) return _primary;
    if (_next && _next.keyId === _activePrimaryCache.keyId) return _next;
    // Cached keyId doesn't match any loaded slot — fall through to a fresh
    // DB lookup. This can happen if the operator invalidated the cache then
    // swapped slot env vars without a restart (not the normal flow, but
    // handled safely).
  }

  // Query the DB for the current active keyId.
  const db = require('../db');
  let activeKeyId = null;
  try {
    const { rows } = await db.query("SELECT id FROM ed25519_keys WHERE state = 'active' LIMIT 1");
    if (rows.length > 0) activeKeyId = rows[0].id;
  } catch (e) {
    logger.warn({ err: e.message }, '[key-manager] getActivePrimary DB lookup failed');
    return null;
  }

  if (!activeKeyId) {
    // No active key in DB — misconfiguration at the DB level. We fail
    // GRACEFULLY here (return null) and let the pipeline's Phase 2E check
    // convert that to the loud ED25519_REQUIRED_NO_SIGNATURE error. This is
    // safer than exiting the process: a momentary DB blip during a rotation
    // would otherwise crash every running instance.
    logger.warn('[key-manager] getActivePrimary: no row in ed25519_keys with state=active');
    return null;
  }

  // Cache the result (TTL 30s).
  _activePrimaryCache = { keyId: activeKeyId, loadedAt: Date.now() };

  // Match the DB's active keyId against the loaded slots.
  if (_primary && _primary.keyId === activeKeyId) return _primary;
  if (_next && _next.keyId === activeKeyId) return _next;

  // DB says this keyId is active, but neither slot matches. This is a
  // CONFIG ERROR: the operator has state='active' for keyId X in the DB
  // but neither ED25519_PRIVATE_KEY_PEM nor ED25519_NEXT_PRIVATE_KEY_PEM
  // contains a key with id X. This typically means a rotation was
  // committed but the env vars haven't been promoted (or the app process
  // hasn't been restarted to pick them up). Phase 2E at the pipeline
  // layer converts this null into ED25519_REQUIRED_NO_SIGNATURE.
  logger.warn({
    dbActiveKeyId: activeKeyId.slice(0, 8) + '...',
    primaryKeyId: _primary ? _primary.keyId.slice(0, 8) + '...' : null,
    nextKeyId: _next ? _next.keyId.slice(0, 8) + '...' : null,
    event: 'key_slot_mismatch'
  }, '[key-manager] DB active key does not match any loaded slot — rotation in progress?');
  return null;
}

/**
 * Invalidates the active-primary cache so the next getActivePrimary() call
 * re-queries the DB. Called by the rotation command right after COMMIT so
 * the new active key takes effect in the local process without waiting for
 * the 30s TTL to expire.
 *
 * This only affects the current Node process. Other processes (running on
 * different hosts, e.g. Render autoscaled instances) will pick up the new
 * active key on their own next cache expiry OR on the next restart. For
 * zero-wait multi-process cutover, Phase 3C will add an admin endpoint.
 */
function invalidateActivePrimaryCache() {
  _activePrimaryCache = null;
}

/**
 * TEST-ONLY: directly set the loaded slots without calling initialize().
 * Used by tests/rotation-phase3b.test.js to exercise the DB-lookup →
 * slot-match logic in getActivePrimary() without spawning a child process.
 *
 * NEVER call this from production code. It bypasses every boot-time
 * sanity check (PEM parsing, keyId validation, identical-key fail-closed).
 * The production gate below will throw if called with NODE_ENV=production
 * unless ALLOW_TEST_HOOKS=1 is set (intentionally awkward — you should
 * have to go out of your way to use this in a prod-ish environment).
 *
 * @param {{primary: object|null, next: object|null}} slots
 */
function _setSlotsForTesting(slots) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_HOOKS !== '1') {
    throw new Error('_setSlotsForTesting is forbidden in production');
  }
  _primary = slots.primary || null;
  _next = slots.next || null;
  _activePrimaryCache = null;  // invalidate any cached lookups
}

/**
 * Returns the currently loaded key slot keyIds for observability. Used by
 * /api/health/deep to expose "which keys are in memory right now" without
 * revealing any private key material. Either field may be null.
 *
 * This is the primary signal the rotation command's pre-flight check
 * queries to verify that the running app has loaded the new key before
 * flipping the DB state.
 *
 * @returns {{ primary: string | null, next: string | null }}
 */
function getLoadedSlots() {
  return {
    primary: _primary ? _primary.keyId : null,
    next: _next ? _next.keyId : null
  };
}

/**
 * Returns the historical primary slot's keyId, or null if not configured.
 * Preserved for existing callers (notably /api/health/deep.primary_key_id).
 *
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
 * Phase 3B Avi A1 — resolve via DB active state, not env-var slot identity.
 * During a rotation, after `activate` commits but BEFORE the operator
 * promotes the ED25519_NEXT_* env vars to primary, the running app's
 * `_primary` slot still points at the OLD (now grace-state) key. If
 * /.well-known/vertifile-pubkey.pem kept serving the old PEM while the
 * pipeline was actively signing new documents with the NEW key, external
 * verifiers would see "forged" documents that in fact verify correctly
 * against the DB-authoritative active key. The fix: consult
 * getActivePrimary() to find the slot whose keyId matches the DB's
 * state='active' row, then serve that slot's canonical PEM.
 *
 * Fallback: if getActivePrimary() returns null (rotation-in-progress
 * mismatch, DB blip, or no slot loaded at all), fall back to the env-var
 * `_primary` slot with a warn log. Better to serve a stale-but-valid PEM
 * than to 404 an endpoint that verifiers depend on.
 *
 * @returns {Promise<string | null>}
 */
async function getPrimaryPublicKeyPem() {
  let activeSlot = null;
  try {
    activeSlot = await getActivePrimary();
  } catch (e) {
    logger.warn({ err: e.message }, '[key-manager] getActivePrimary failed in getPrimaryPublicKeyPem');
  }

  // Resolve PEM via the public-key cache for whichever slot we landed on.
  // Fall back to _primary if getActivePrimary returned null (rotation-in-
  // progress safety net) — serving a stale PEM is better than serving
  // nothing for an endpoint verifiers depend on.
  const slot = activeSlot || _primary;
  if (!slot) return null;

  const entry = await _loadPublicKeyEntry(slot.keyId);
  return entry ? entry.pem : null;
}

module.exports = {
  initialize,
  getPrimary,
  getActivePrimary,
  getLoadedSlots,
  getPrimaryKeyId,
  getPublicKeyById,
  getPublicKeyPemById,
  listActivePublicKeys,
  getPrimaryPublicKeyPem,
  invalidateActivePrimaryCache,
  _setSlotsForTesting
};
