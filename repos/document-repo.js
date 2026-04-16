/**
 * Document Repository -- documents, PVF creation, verification,
 * slugs, sharing, Ed25519 keys, and key rotation.
 *
 * Part of the Phase 0 microservices migration. This module receives its
 * pool and queryWithRetry references via init() at boot time, called by
 * db.js after pool creation.
 */

const { mapDocRow } = require('./helpers');

let pool;
let queryWithRetry;

function init(p, qwr) {
  pool = p;
  queryWithRetry = qwr;
}

// ================================================================
// DOCUMENTS
// ================================================================
async function getDocument(hash) {
  const { rows } = await queryWithRetry('SELECT * FROM documents WHERE hash = $1', [hash]);
  return rows.length ? mapDocRow(rows[0]) : null;
}

async function getDocumentByShareId(shareId) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE share_id = $1', [shareId]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    hash: row.hash,
    signature: row.signature,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    timestamp: row.created_at,
    orgId: row.org_id,
    orgName: row.org_name,
    shareId: row.share_id,
    recipient: row.recipient || null,
    recipientHash: row.recipient_hash || null,
    // Needed by injectStampConfig to look up the owner's stamp_config.
    user_id: row.user_id || null,
  };
}

async function createDocument({ hash, signature, originalName, mimeType, fileSize, createdAt, orgId, orgName, token, tokenCreatedAt, recipient, recipientHash, shareId, ed25519_signature, ed25519_key_id }) {
  // Phase 2B Fix #1: createdAt is threaded from the pipeline so the DB value
  // matches the timestamp used to build the Ed25519 signing payload. Legacy
  // callers without the field fall back to a fresh ISO string (byte-identical
  // to the previous behavior).
  await queryWithRetry(
    `INSERT INTO documents (hash, signature, original_name, mime_type, file_size, created_at, token, token_created_at, org_id, org_name, recipient, recipient_hash, share_id, ed25519_signature, ed25519_key_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [hash, signature, originalName || null, mimeType || null, fileSize || null,
     createdAt || new Date().toISOString(), token || null, tokenCreatedAt || null,
     orgId, orgName, recipient || null, recipientHash || null, shareId || null,
     ed25519_signature || null, ed25519_key_id || null]
  );
}

async function setShareId(hash, shareId) {
  await pool.query('UPDATE documents SET share_id = $1 WHERE hash = $2', [shareId, hash]);
}

// ================================================================
// SLUG LOOKUP (Zero-Knowledge / PVF 2.0)
// ================================================================
async function getDocumentBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE slug = $1', [slug]);
  return rows.length ? mapDocRow(rows[0]) : null;
}

async function setSlug(hash, slug) {
  await pool.query('UPDATE documents SET slug = $1 WHERE hash = $2', [slug, hash]);
}

async function getPvfContentBySlug(slug) {
  const { rows } = await pool.query('SELECT pvf_content FROM documents WHERE slug = $1', [slug]);
  return rows.length ? rows[0].pvf_content : null;
}

async function updateDocumentToken(hash, token) {
  await pool.query('UPDATE documents SET token = $1, token_created_at = $2 WHERE hash = $3',
    [token, Date.now(), hash]);
}

async function getDocumentsByOrg(orgId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    'SELECT hash, original_name, mime_type, file_size, created_at, org_name FROM documents WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [orgId, limit, offset]
  );
  return rows.map(row => ({
    hash: row.hash,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    timestamp: row.created_at,
    orgName: row.org_name,
  }));
}

async function getDocumentCount(orgId) {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM documents WHERE org_id = $1', [orgId]);
  return Number(rows[0].count);
}

async function getUserDocuments(userId, { limit = 20, offset = 0, search = '', starred = false } = {}) {
  const { escapeLike } = require('./helpers');
  let query = 'SELECT * FROM documents WHERE user_id = $1';
  const params = [userId];
  let idx = 2;
  if (starred) {
    query += ` AND starred = $${idx}`;
    params.push(true);
    idx++;
  }
  if (search) {
    const pattern = '%' + escapeLike(search) + '%';
    query += ` AND (original_name ILIKE $${idx} OR hash ILIKE $${idx + 1})`;
    params.push(pattern, pattern);
    idx += 2;
  }
  query += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
  params.push(limit, offset);
  const { rows } = await pool.query(query, params);
  return rows.map(mapDocRow);
}

async function starDocument(hash, starred) {
  await pool.query('UPDATE documents SET starred = $1 WHERE hash = $2', [starred, hash]);
}

async function setDocumentUserId(hash, userId) {
  await pool.query('UPDATE documents SET user_id = $1 WHERE hash = $2', [userId, hash]);
}

async function saveCodeIntegrity(hash, codeIntegrity, chainedToken) {
  await pool.query('UPDATE documents SET code_integrity = $1, chained_token = $2 WHERE hash = $3', [codeIntegrity, chainedToken, hash]);
}

async function savePvfContent(hash, pvfHtml) {
  await pool.query('UPDATE documents SET pvf_content = $1 WHERE hash = $2', [pvfHtml, hash]);
}

async function getPvfContent(shareId) {
  const { rows } = await pool.query('SELECT pvf_content FROM documents WHERE share_id = $1', [shareId]);
  return rows.length ? rows[0].pvf_content : null;
}

async function deleteDocument(hash, userId) {
  const { rowCount } = await pool.query('DELETE FROM documents WHERE hash = $1 AND user_id = $2', [hash, userId]);
  if (rowCount > 0) {
    await pool.query('UPDATE users SET documents_used = GREATEST(documents_used - 1, 0) WHERE id = $1', [userId]);
  }
  return rowCount > 0;
}

async function markDocumentPreviewOnly(hash, previewOnly) {
  await pool.query('UPDATE documents SET preview_only = $1 WHERE hash = $2', [previewOnly, hash]);
}

// ================================================================
// ED25519 KEY CRUD (Phase 2A)
// ================================================================
async function getEd25519KeyById(keyId) {
  if (!keyId || typeof keyId !== 'string') return null;
  const { rows } = await queryWithRetry(
    'SELECT id, public_key_pem, valid_from, valid_until, is_primary FROM ed25519_keys WHERE id = $1',
    [keyId]
  );
  return rows[0] || null;
}

async function getPrimaryEd25519Key() {
  const { rows } = await queryWithRetry(
    'SELECT id, public_key_pem, valid_from, valid_until, is_primary FROM ed25519_keys WHERE is_primary = TRUE LIMIT 1'
  );
  return rows[0] || null;
}

async function listActiveEd25519Keys() {
  // Phase 3B Avi FIX 4 -- JWKS pending-key leak defense.
  //
  // Prior to this filter, the WHERE clause was `valid_until IS NULL OR
  // valid_until > NOW()` which matched pending (state='pending',
  // valid_until=NULL) rows. That caused /.well-known/vertifile-jwks.json
  // to publish the public keys of not-yet-activated keys the instant the
  // operator ran `generate` -- an information leak to external verifiers.
  //
  // Fix: require state IN ('active', 'grace'). This filters out:
  //   - state='pending'  (not yet activated -- should never be published)
  //   - state='expired'  (past grace window -- should no longer be published)
  // while keeping state='grace' keys visible so documents signed under
  // the previous rotation continue to verify for the full grace window.
  //
  // Note: this query requires the Phase 3A `state` column to exist. A test
  // DB that skipped the migration will throw -- which is acceptable because
  // the Phase 3A migration is mandatory for every deployment.
  const { rows } = await queryWithRetry(
    "SELECT id, public_key_pem, valid_from, valid_until, is_primary FROM ed25519_keys WHERE state IN ('active', 'grace') AND (valid_until IS NULL OR valid_until > NOW()) ORDER BY is_primary DESC, valid_from DESC"
  );
  return rows || [];
}

async function insertEd25519Key({ id, publicKeyPem, validFrom, validUntil, isPrimary }) {
  await queryWithRetry(
    'INSERT INTO ed25519_keys (id, public_key_pem, valid_from, valid_until, is_primary) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
    [id, publicKeyPem, validFrom || new Date(), validUntil || null, !!isPrimary]
  );
}

// ================================================================
// PHASE 3A -- KEY ROTATION HELPERS
// ================================================================

/**
 * Error thrown when a lookup helper is asked about an ed25519 key that
 * does not exist in the `ed25519_keys` table. Callers (notably the Phase
 * 3B rotation command) rely on this specific error class to distinguish
 * "operator typo / wrong key id" from "key exists but in an unexpected
 * state". Swallowing this into a generic null return would have hidden
 * bugs at the call site.
 */
class Ed25519KeyNotFoundError extends Error {
  constructor(keyId) {
    super(`Ed25519 key not found: ${keyId}`);
    this.name = 'Ed25519KeyNotFoundError';
    this.keyId = keyId;
  }
}

/**
 * Error thrown by setEd25519KeyState when the Phase 3A trigger rejects a
 * state transition (e.g. grace -> active, active -> expired). The trigger
 * raises a generic SQL exception with a free-form message; setEd25519KeyState
 * wraps it in this typed error so the rotation command can distinguish a
 * forbidden-transition mistake from a database connectivity failure and emit
 * a precise message to the operator.
 *
 * Phase 3 invariant: rollback is a NEW rotation with a NEW key, never a
 * state regression. Catching this error and re-issuing the same UPDATE in
 * the opposite direction would defeat the invariant -- callers MUST surface
 * the error to the operator and force them to start a new rotation.
 */
class Ed25519ForbiddenTransitionError extends Error {
  constructor(keyId, fromState, toState, triggerMessage) {
    super(`Ed25519 state transition rejected: ${fromState} -> ${toState} for key ${keyId}. ${triggerMessage}`);
    this.name = 'Ed25519ForbiddenTransitionError';
    this.keyId = keyId;
    this.fromState = fromState;
    this.toState = toState;
    this.triggerMessage = triggerMessage;
  }
}

/**
 * Returns the current state of an ed25519 key.
 *
 * Throws Ed25519KeyNotFoundError if the key id does not exist in the
 * ed25519_keys table. Callers (notably Phase 3B's rotation command)
 * MUST distinguish "wrong key id" from "key in unexpected state" -- a
 * silent null return conflates them, and the previous behavior would
 * let an operator typo silently no-op instead of surfacing the mistake.
 *
 * @param {string} keyId
 * @returns {Promise<'pending'|'active'|'grace'|'expired'>}
 * @throws {Error} if keyId is not a non-empty string
 * @throws {Ed25519KeyNotFoundError} if the key does not exist
 */
async function getEd25519KeyState(keyId) {
  if (typeof keyId !== 'string' || !keyId) {
    throw new Error('getEd25519KeyState: keyId must be a non-empty string');
  }
  const { rows } = await queryWithRetry(
    'SELECT state FROM ed25519_keys WHERE id = $1',
    [keyId]
  );
  if (rows.length === 0) {
    throw new Ed25519KeyNotFoundError(keyId);
  }
  return rows[0].state;
}

/**
 * Updates an ed25519 key's state, with structured error wrapping.
 *
 * Takes an OPEN pg client (NOT the pool) so the caller controls the
 * transaction lifecycle. The Phase 3B rotation command opens a transaction,
 * calls setEd25519KeyState twice (demote outgoing, promote incoming),
 * inserts the rotation log row, and commits -- all atomically. Passing the
 * pool here would auto-commit each UPDATE, breaking the atomicity guarantee.
 *
 * The Phase 3A BEFORE UPDATE trigger enforces the monotonic-forward state
 * machine; if a forbidden transition is attempted, the trigger raises a
 * SQL exception with a message containing "forbidden state transition".
 * We catch that specific shape and rethrow as Ed25519ForbiddenTransitionError
 * so the rotation command can distinguish "operator typo on the new state"
 * from "the underlying DB query failed for some other reason".
 *
 * The function reads the current state BEFORE the UPDATE so the wrapped
 * error can carry both fromState and toState for the operator's log. If the
 * key id is unknown, throws Ed25519KeyNotFoundError to match the contract
 * of the other Phase 3A helpers.
 *
 * As a convenience, this also stamps `retired_at = NOW()` whenever the new
 * state is 'grace' -- that's the moment the key transitions from "issuing
 * new signatures" to "verification only" and is the natural point to record
 * the retirement timestamp. The trigger does not enforce this; the column
 * defaults to NULL and stays NULL until the rotation command sets it via
 * this helper.
 *
 * `reason` is optional. When supplied (typically the operator-supplied
 * --reason flag), it overwrites the rotation_reason column on the row;
 * passing null leaves any existing value intact via COALESCE.
 *
 * @param {import('pg').PoolClient} client - open client (caller owns the txn)
 * @param {string} keyId
 * @param {'pending'|'active'|'grace'|'expired'} newState
 * @param {Object} [opts]
 * @param {string|null} [opts.reason]
 * @returns {Promise<void>}
 * @throws {Ed25519KeyNotFoundError} if the key id does not exist
 * @throws {Ed25519ForbiddenTransitionError} if the state-transition trigger rejects
 * @throws {Error} if keyId or newState fail input validation
 */
async function setEd25519KeyState(client, keyId, newState, { reason = null } = {}) {
  if (typeof keyId !== 'string' || !keyId) {
    throw new Error('setEd25519KeyState: keyId must be a non-empty string');
  }
  if (!['pending', 'active', 'grace', 'expired'].includes(newState)) {
    throw new Error(`setEd25519KeyState: invalid newState '${newState}' (must be one of pending|active|grace|expired)`);
  }
  if (reason !== null && reason !== undefined && typeof reason !== 'string') {
    throw new Error('setEd25519KeyState: reason must be a string, null, or undefined');
  }

  // Read current state for the error wrapping below. Doing this before the
  // UPDATE means we can report fromState/toState even if the trigger fires.
  const beforeResult = await client.query(
    'SELECT state FROM ed25519_keys WHERE id = $1',
    [keyId]
  );
  if (beforeResult.rows.length === 0) {
    throw new Ed25519KeyNotFoundError(keyId);
  }
  const fromState = beforeResult.rows[0].state;

  try {
    await client.query(
      `UPDATE ed25519_keys
         SET state = $1,
             rotation_reason = COALESCE($2, rotation_reason),
             retired_at = CASE WHEN $1 = 'grace' THEN NOW() ELSE retired_at END
       WHERE id = $3`,
      [newState, reason, keyId]
    );
  } catch (e) {
    // The Phase 3A trigger raises with the literal substring "forbidden
    // state transition" -- see runPhase3aMigration trigger body. Match on
    // that and wrap. Any OTHER error (connectivity, lock timeout, etc.)
    // bubbles up untouched.
    if (e && e.message && /forbidden state transition/i.test(e.message)) {
      throw new Ed25519ForbiddenTransitionError(keyId, fromState, newState, e.message);
    }
    throw e;
  }
}

/**
 * Lists rotation log entries, newest first.
 *
 * SECURITY INVARIANT: the `actor` column is intentionally NOT returned.
 * It is DB-only -- the public rotation log must never surface who ran
 * the rotation command. Exposing `actor` would leak operator identity
 * and/or CI system names to any third-party verifier. If you need to
 * audit actors, query audit_log.details->>'session_user' directly.
 *
 * Pagination is mandatory (even if the current log has one row) so the
 * public endpoint in Phase 3C does not inadvertently become an unbounded
 * DB query. Defaults (limit=100, offset=0) make this a non-breaking
 * change for existing callers.
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit=100] - max rows to return (1..1000)
 * @param {number} [opts.offset=0]  - offset from newest row
 * @returns {Promise<Array<{id, rotated_at, old_key_id, new_key_id, old_fingerprint, new_fingerprint, grace_until, reason}>>}
 */
async function listRotationLog({ limit = 100, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('listRotationLog: limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('listRotationLog: offset must be a non-negative integer');
  }
  const { rows } = await queryWithRetry(
    `SELECT id, rotated_at, old_key_id, new_key_id, old_fingerprint, new_fingerprint, grace_until, reason
     FROM key_rotation_log
     ORDER BY rotated_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/**
 * Inserts a new rotation log entry. Used by the Phase 3B rotation command.
 *
 * Validation is strict: `reason` and `actor` MUST be strings (or null /
 * undefined). Non-string values (numbers, buffers, arrays, objects) throw
 * at the call site instead of being silently coerced via `String(...)`.
 * This is Avi F1 / Ori R10 -- silent truncation of operator context is
 * worse than a loud error.
 *
 * `reason` is capped at 280 chars, `actor` at 255 chars. Both caps throw
 * rather than truncate -- an operator writing "emergency rotation due to
 * compromise of key X because..." should see the cap as an error and
 * rewrite, not have the tail of the explanation silently dropped.
 *
 * @param {Object} entry
 * @param {string|null} entry.oldKeyId
 * @param {string} entry.newKeyId
 * @param {string|null} entry.oldFingerprint
 * @param {string} entry.newFingerprint
 * @param {string|Date|null} entry.graceUntil
 * @param {string|null} entry.reason
 * @param {string|null} entry.actor
 * @returns {Promise<number>} The new id
 */
async function insertRotationLog({ oldKeyId, newKeyId, oldFingerprint, newFingerprint, graceUntil, reason, actor }) {
  if (typeof newKeyId !== 'string' || !newKeyId) {
    throw new Error('insertRotationLog: newKeyId must be a non-empty string');
  }
  if (typeof newFingerprint !== 'string' || !newFingerprint) {
    throw new Error('insertRotationLog: newFingerprint must be a non-empty string');
  }

  // reason: must be string | null | undefined. Throw on other types.
  let validatedReason = null;
  if (reason !== null && reason !== undefined) {
    if (typeof reason !== 'string') {
      throw new Error('insertRotationLog: reason must be a string, null, or undefined');
    }
    if (reason.length > 280) {
      throw new Error(`insertRotationLog: reason exceeds 280 char limit (got ${reason.length})`);
    }
    validatedReason = reason;
  }

  // actor: same contract, with a 255-char cap.
  let validatedActor = null;
  if (actor !== null && actor !== undefined) {
    if (typeof actor !== 'string') {
      throw new Error('insertRotationLog: actor must be a string, null, or undefined');
    }
    if (actor.length > 255) {
      throw new Error(`insertRotationLog: actor exceeds 255 char limit (got ${actor.length})`);
    }
    validatedActor = actor;
  }

  const { rows } = await queryWithRetry(
    `INSERT INTO key_rotation_log
       (old_key_id, new_key_id, old_fingerprint, new_fingerprint, grace_until, reason, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      oldKeyId || null,
      newKeyId,
      oldFingerprint || null,
      newFingerprint,
      graceUntil || null,
      validatedReason,
      validatedActor
    ]
  );
  return rows[0].id;
}

/**
 * Returns the count of ed25519_keys rows grouped by state.
 * Used by health endpoints and Phase 3D tests. States with zero rows
 * are returned as 0 (not omitted) so callers never have to null-guard.
 *
 * @returns {Promise<{pending: number, active: number, grace: number, expired: number}>}
 */
async function countEd25519KeysByState() {
  const { rows } = await queryWithRetry(
    'SELECT state, COUNT(*)::int AS n FROM ed25519_keys GROUP BY state'
  );
  const out = { pending: 0, active: 0, grace: 0, expired: 0 };
  for (const row of rows) {
    if (out[row.state] !== undefined) out[row.state] = Number(row.n);
  }
  return out;
}

module.exports = {
  init,
  functions: {
    getDocument,
    getDocumentByShareId,
    createDocument,
    updateDocumentToken,
    setShareId,
    getDocumentBySlug,
    setSlug,
    getPvfContentBySlug,
    getDocumentsByOrg,
    getDocumentCount,
    getUserDocuments,
    starDocument,
    setDocumentUserId,
    saveCodeIntegrity,
    savePvfContent,
    getPvfContent,
    deleteDocument,
    markDocumentPreviewOnly,
    // Ed25519 key CRUD (Phase 2A)
    getEd25519KeyById,
    getPrimaryEd25519Key,
    listActiveEd25519Keys,
    insertEd25519Key,
    // Key rotation helpers (Phase 3A schema; consumers wired up in 3B-3E)
    Ed25519KeyNotFoundError,
    Ed25519ForbiddenTransitionError,
    getEd25519KeyState,
    setEd25519KeyState,
    listRotationLog,
    insertRotationLog,
    countEd25519KeysByState,
  },
};
