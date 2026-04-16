/**
 * Vertifile Database Layer — PostgreSQL only (via pg.Pool)
 *
 * Connects using process.env.DATABASE_URL.
 * All exported functions are async and return Promises.
 * Call `db._ready` (or `await db._ready`) before using any function
 * to ensure the schema has been created.
 */

const { Pool } = require('pg');
const logger = require('./services/logger');

if (!process.env.DATABASE_URL) {
  logger.error('[DB] FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

// Escape LIKE/ILIKE wildcard characters to prevent pattern injection.
// Callers building LIKE patterns from user input MUST wrap the raw
// string through this helper before concatenating the leading/trailing %.
function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

const dbConfig = require('./services/db-config');
const dbUrl = process.env.DATABASE_URL;

// Production startup guard: refuse to boot if production + local DB URL.
// Prevents silent SSL downgrade from a misconfigured env var.
dbConfig.assertProductionNotLocal(dbUrl, logger);

const sslConfig = dbConfig.getPoolSslConfig(dbUrl);
const dbHost = dbConfig.getSafeHostForLogging(dbUrl);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Observability: log the SSL state and host at boot so operators can
// verify production is always SSL-on. NEVER logs the URL itself.
logger.info({ ssl: sslConfig !== false, host: dbHost }, '[DB] pool initialized');

pool.on('error', (err) => {
  logger.error('[PG] Unexpected pool error:', err.message);
});

// ================================================================
// QUERY RETRY WITH BACKOFF
// ================================================================
async function queryWithRetry(text, params, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 500; // 500ms, 1000ms, 1500ms
      logger.warn({ attempt, delay, error: e.message }, 'DB query retry');
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ================================================================
// SCHEMA
// ================================================================
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS documents (
    hash TEXT PRIMARY KEY,
    signature TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    file_size BIGINT,
    -- PHASE 2C INVARIANT: created_at MUST remain TEXT.
    -- pg returns Date for TIMESTAMPTZ, and String(Date) -> 'Wed Apr 09 2026...'
    -- which is NOT byte-equivalent to the ISO string Phase 2B signed.
    -- Migrating to TIMESTAMPTZ would silently break every Ed25519 verification.
    created_at TEXT DEFAULT (now() AT TIME ZONE 'UTC'),
    token TEXT,
    token_created_at BIGINT,
    org_id TEXT,
    org_name TEXT,
    recipient TEXT,
    recipient_hash TEXT,
    share_id TEXT
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    api_key TEXT PRIMARY KEY,
    org_id TEXT UNIQUE NOT NULL,
    org_name TEXT NOT NULL,
    plan TEXT DEFAULT 'pro',
    created_at TEXT DEFAULT (now() AT TIME ZONE 'UTC'),
    documents_created INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    rate_limit INTEGER DEFAULT 100,
    allowed_ips TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    timestamp TEXT DEFAULT (now() AT TIME ZONE 'UTC'),
    event TEXT NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id SERIAL PRIMARY KEY,
    org_id TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL,
    secret TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (now() AT TIME ZONE 'UTC')
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT,
    provider TEXT DEFAULT 'email',
    provider_id TEXT,
    avatar_url TEXT,
    documents_used INT DEFAULT 0,
    documents_limit INT DEFAULT 500,
    plan TEXT DEFAULT 'pro',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (sid)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

  CREATE INDEX IF NOT EXISTS idx_docs_org ON documents(org_id);
  CREATE INDEX IF NOT EXISTS idx_docs_created ON documents(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);
  CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_share ON documents(share_id) WHERE share_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS ed25519_keys (
    id              VARCHAR(16) PRIMARY KEY,
    public_key_pem  TEXT NOT NULL,
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until     TIMESTAMPTZ,
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ed25519_keys_primary ON ed25519_keys(is_primary) WHERE is_primary = TRUE;
  CREATE INDEX IF NOT EXISTS idx_ed25519_keys_valid ON ed25519_keys(valid_until);
`;

// _ready resolves once the schema is bootstrapped.
const _ready = (async () => {
  try {
    await pool.query(SCHEMA_SQL);
    logger.info('[PG] Schema initialised');
  } catch (e) {
    logger.error('[PG] Schema init error:', e.message);
    throw e;
  }

  // Migrations — add columns if they don't exist yet
  try { await pool.query('ALTER TABLE api_keys ADD COLUMN custom_icon TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE api_keys ADD COLUMN brand_color TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE api_keys ADD COLUMN wave_color TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN user_id INT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN starred BOOLEAN DEFAULT false'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN pvf_content TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN code_integrity TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN chained_token TEXT'); } catch (_) { /* already exists */ }
  // Migrate legacy free plan users to pro (no free plan exists)
  try { await pool.query("UPDATE users SET plan = 'pro', documents_limit = 500 WHERE plan = 'free'"); } catch (_) { /* ok */ }
  // Migrate business plan users to new 1000-doc limit
  try { await pool.query("UPDATE users SET documents_limit = 1000 WHERE plan = 'business' AND documents_limit < 1000"); } catch (_) { /* ok */ }
  // Performance indexes
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_docs_user_id ON documents(user_id)'); } catch (_) { /* already exists */ }
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id)'); } catch (_) { /* already exists */ }
  // Composite index: user documents sorted by date (common dashboard query)
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_docs_user_created ON documents(user_id, created_at DESC)'); } catch (_) {}
  // Password resets by user_id (DELETE on new reset request)
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id)'); } catch (_) {}
  // Audit log: JSONB expression index for org-scoped queries
  try { await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log ((details::jsonb->>'orgId'))"); } catch (_) {}
  // Sessions: JSONB expression index for user session cleanup on logout
  try { await pool.query("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions ((sess::jsonb->'passport'->>'user'))"); } catch (_) {}
  // Health checks: composite for status+time filtered queries
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_health_status_time ON health_checks(checked_at, status)'); } catch (_) {}
  // Verification codes: composite for the common lookup pattern
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup ON verification_codes(email, used, expires_at)'); } catch (_) {}
  // Monitoring table
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS health_checks (
      id SERIAL PRIMARY KEY,
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT NOT NULL,
      response_ms INT,
      details JSONB DEFAULT '{}'
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_health_time ON health_checks(checked_at)');
  } catch (_) { /* already exists */ }
  // Password resets table
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch (_) { /* already exists */ }
  // Verification codes table (email verification for onboarding)
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(10) NOT NULL,
      type VARCHAR(50) DEFAULT 'onboarding',
      attempts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes(expires_at)');
  } catch (_) { /* already exists */ }
  // Preview-only column for paywall
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS preview_only BOOLEAN DEFAULT FALSE'); } catch (_) {}
  // Ed25519 dual-signature columns (Phase 2A) — populated by Phase 2B
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS ed25519_signature TEXT'); } catch (_) {}
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS ed25519_key_id VARCHAR(16)'); } catch (_) {}
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_docs_ed25519_key ON documents(ed25519_key_id) WHERE ed25519_key_id IS NOT NULL'); } catch (_) {}

  // ================================================================
  // PHASE 3A — KEY ROTATION SCHEMA (transaction-wrapped)
  // ================================================================
  // The actual migration SQL lives in `runPhase3aMigration()` below, defined
  // as a top-level function so tests can call it independently to verify
  // idempotency (see tests/rotation-schema.test.js Scenario 1).
  //
  // We acquire a dedicated client and run the migration inside BEGIN/COMMIT
  // so partial failures (e.g. trigger creation failing halfway) leave the
  // DB in a clean state instead of a half-migrated one. On error, ROLLBACK
  // undoes every Phase 3A change and the exception is re-thrown so _ready
  // rejects and the app refuses to boot — matching the fail-closed posture
  // Phase 2E established.
  // ----------------------------------------------------------------
  {
    const phase3aClient = await pool.connect();
    try {
      await phase3aClient.query('BEGIN');
      const result = await runPhase3aMigration(phase3aClient, logger);
      await phase3aClient.query('COMMIT');
      logger.info({ genesisRowsInserted: result.genesisRowsInserted }, '[PG][phase3a] migration committed');
    } catch (e) {
      try { await phase3aClient.query('ROLLBACK'); } catch (_) { /* swallow — already aborted is fine */ }
      logger.error({ err: e.message }, '[PG][phase3a] migration rolled back');
      throw e;
    } finally {
      phase3aClient.release();
    }
  }
  // ================================================================
  // END PHASE 3A
  // ================================================================

  // Auth columns — email_verified, last_login_at, updated_at, provider narrowing
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE'); } catch (_) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ'); } catch (_) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()'); } catch (_) {}
  // Issue #4: Per-account login failure tracking + lockout columns
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0'); } catch (_) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ'); } catch (_) {}
  // Stamp branding config — Layer 2 visual wrapper (waveColors, accentColor, customLogo, etc.)
  // Per ADR: stored as JSONB, applied dynamically at /d/:shareId render time
  try { await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stamp_config JSONB DEFAULT '{}'::jsonb"); } catch (_) {}
  try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS stamp_updated_at TIMESTAMPTZ'); } catch (_) {}
  // user_profiles table (referenced by onboarding routes)
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch (_) {}

  // ================================================================
  // ZERO-KNOWLEDGE ARCHITECTURE — PVF 2.0 schema additions
  // ================================================================
  // Slug column for human-readable URLs (/d/patent-claims-final instead of /d/aB3x_kLm)
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS slug TEXT'); } catch (_) {}
  try { await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_slug ON documents(slug) WHERE slug IS NOT NULL'); } catch (_) {}
  // Encryption flag (false for v1.0 docs, true for v2.0 encrypted docs)
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT false'); } catch (_) {}
  // Initialization vector (base64 string, null for v1.0 docs)
  try { await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS iv TEXT'); } catch (_) {}
  // PVF version tag for query filtering
  try { await pool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS pvf_version TEXT DEFAULT '1.0'"); } catch (_) {}
  // ================================================================
  // END ZERO-KNOWLEDGE SCHEMA
  // ================================================================

  // ================================================================
  // OVERAGE TRACKING — per-user monthly usage & overage billing
  // ================================================================
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS overage_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      month VARCHAR(7) NOT NULL,
      documents_used INTEGER DEFAULT 0,
      documents_limit INTEGER DEFAULT 500,
      overage_count INTEGER DEFAULT 0,
      overage_rate DECIMAL(10,4) DEFAULT 0.15,
      overage_charge DECIMAL(10,2) DEFAULT 0.00,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, month)
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_overage_log_month ON overage_log(month)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_overage_log_user ON overage_log(user_id)');
  } catch (_) { /* already exists */ }
  // ================================================================
  // END OVERAGE TRACKING
  // ================================================================
})();

// ================================================================
// PHASE 0 REPOSITORY MODULES
// ================================================================
// Functions have been extracted into domain-specific repos under ./repos/.
// db.js remains the single import point for backward compatibility.
// Each repo is initialized with the pool and queryWithRetry references.
const authRepo = require('./repos/auth-repo');
const documentRepo = require('./repos/document-repo');
const adminRepo = require('./repos/admin-repo');
const gatewayRepo = require('./repos/gateway-repo');

authRepo.init(pool, queryWithRetry);
documentRepo.init(pool, queryWithRetry);
adminRepo.init(pool, queryWithRetry);
gatewayRepo.init(pool);

/**
 * Runs the Phase 3A key rotation schema migration against an open client.
 * Called once at boot from the `_ready` bootstrap (inside a transaction)
 * AND called a second time from tests/rotation-schema.test.js Scenario 1
 * to verify idempotency for real — the test's second call must succeed
 * without inserting a duplicate genesis row.
 *
 * Every statement is guarded by IF NOT EXISTS / CREATE OR REPLACE / WHERE
 * NOT EXISTS so re-runs are no-ops, and the whole block is designed to be
 * wrapped by the caller in BEGIN/COMMIT (the caller owns the transaction
 * lifecycle — this function does NOT call BEGIN/COMMIT itself).
 *
 * INVARIANTS (locked in by Zur, do not weaken without explicit approval):
 *   1. State machine is STRICTLY MONOTONIC FORWARD. grace -> active is
 *      forbidden — enforced at the DB layer by the BEFORE UPDATE trigger
 *      below. Rollback is always a NEW rotation with a NEW key.
 *   2. audit_log.actor is DB-only; the public rotation log endpoint (3C)
 *      must NOT surface it. listRotationLog() deliberately omits it.
 *   3. Every SQL statement is idempotent.
 *
 * SCOPE NOTE: partial UNIQUE indexes on state='active' and state='pending'
 * (Avi F2/F3, Ori "exactly one active") are intentionally DEFERRED to
 * Phase 3B, where they will be added alongside the rotation command that
 * needs them. Adding them now conflicts with the existing test fixtures
 * that insert test rows in state='active' (Scenarios 2, 6, 7, 8), which
 * would require extensive test rewrites using transaction+rollback
 * patterns on the genesis row. The threat these indexes close (two
 * concurrent rotation commands racing to INSERT active rows) cannot be
 * reached until Phase 3B ships the rotation command itself.
 *
 * @param {import('pg').PoolClient} client - open pg client (caller owns transaction)
 * @param {Object} log - pino-shaped logger with an .error({obj}, msg) method
 * @returns {Promise<{genesisRowsInserted: number}>} for idempotency assertions
 */
async function runPhase3aMigration(client, log) {
  // 1. Add state / retired_at / rotation_reason columns to ed25519_keys.
  //    The existing production primary key row inherits state='active' via
  //    the DEFAULT clause when the column is added, so no explicit backfill
  //    is needed. (Previous versions had a no-op UPDATE here as documentation;
  //    it was removed because it unnecessarily fired the BEFORE UPDATE
  //    trigger on every boot.)
  try {
    await client.query(`
      ALTER TABLE ed25519_keys
        ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active'
          CHECK (state IN ('pending','active','grace','expired')),
        ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rotation_reason TEXT
    `);
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3a] ed25519_keys column add failed');
    throw e;
  }

  // 1b. Phase 3B hardening — partial UNIQUE indexes enforcing "at most one
  //     active" and "at most one pending" row at any moment in time. Without
  //     these, two concurrent rotation commands could race to INSERT a second
  //     active row (each one passes its own pre-flight check, then both
  //     commit), leaving getActivePrimary() unable to choose a single
  //     authoritative slot. The activate command would then become
  //     non-deterministic.
  //
  //     These were intentionally deferred from the Phase 3A migration because
  //     several test fixtures in tests/rotation-schema.test.js insert test
  //     rows with state='active', and adding the index without rewriting
  //     those scenarios would have broken CI. Phase 3B rewrites the affected
  //     scenarios to use a transaction-rollback pattern around the genesis
  //     row, so the index can land here.
  //
  //     Production safety: at index-creation time the production DB has
  //     exactly ONE row in state='active' (the genesis 0f65ad1b92590c92).
  //     CREATE UNIQUE INDEX with WHERE state='active' will succeed because
  //     a one-row partial unique index is trivially valid. CREATE UNIQUE
  //     INDEX IF NOT EXISTS makes this idempotent for the second/Nth boot.
  try {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ed25519_keys_one_active
        ON ed25519_keys(state) WHERE state = 'active'
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ed25519_keys_one_pending
        ON ed25519_keys(state) WHERE state = 'pending'
    `);
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3b] state partial unique indexes create failed');
    throw e;
  }

  // 2. Create the key_rotation_log table + indexes. Backs the public
  //    /.well-known/vertifile-rotation-log.json endpoint that 3C will add.
  //    NO FOREIGN KEYS to ed25519_keys — the architect's plan explicitly
  //    forbids them so that deleting a key cannot cascade-orphan rotation
  //    history.
  //
  //    The genesis-row partial UNIQUE index (M7) prevents two concurrent
  //    boots from both passing the WHERE NOT EXISTS guard below and
  //    double-inserting the same initial-key row. The second INSERT will
  //    collide with this index and be rolled back by the outer transaction.
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS key_rotation_log (
        id              SERIAL PRIMARY KEY,
        rotated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        old_key_id      VARCHAR(16),
        new_key_id      VARCHAR(16) NOT NULL,
        old_fingerprint TEXT,
        new_fingerprint TEXT NOT NULL,
        grace_until     TIMESTAMPTZ,
        reason          TEXT,
        actor           TEXT
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_key_rotation_log_rotated_at ON key_rotation_log(rotated_at DESC)');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_key_rotation_log_one_genesis
        ON key_rotation_log(new_key_id) WHERE reason = 'initial-key'
    `);
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3a] key_rotation_log create failed');
    throw e;
  }

  // 3. Genesis entry: retroactively log the first key Vertifile ever issued.
  //    The current production primary key (0f65ad1b92590c92) predates
  //    rotation infrastructure, so it was never logged as a "rotation event".
  //    We insert it now so the public rotation log (3C) starts with a
  //    complete history instead of appearing to spring into existence at
  //    the first real rotation.
  //
  //    Idempotent via WHERE NOT EXISTS; the row count is also returned so
  //    the idempotency test can assert `genesisRowsInserted === 0` on the
  //    second run (the hard proof that the guard is working).
  let genesisRowsInserted = 0;
  try {
    const genesisResult = await client.query(`
      INSERT INTO key_rotation_log (
        rotated_at, old_key_id, new_key_id, old_fingerprint, new_fingerprint,
        grace_until, reason, actor
      )
      SELECT
        valid_from,
        NULL,
        '0f65ad1b92590c92',
        NULL,
        '0f65ad1b92590c9255b3de67758c49c7fe5169fdd47abb187e795a2edf03a372',
        NULL,
        'initial-key',
        'system-genesis'
      FROM ed25519_keys
      WHERE id = '0f65ad1b92590c92'
        AND NOT EXISTS (
          SELECT 1 FROM key_rotation_log WHERE new_key_id = '0f65ad1b92590c92'
        )
    `);
    genesisRowsInserted = genesisResult.rowCount || 0;
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3a] genesis rotation log insert failed');
    throw e;
  }

  // 4. State-transition enforcement trigger. This is the security
  //    boundary that makes rollback impossible at the DB layer.
  //
  //    CHECK constraints can only reference the NEW row, so they cannot
  //    express "state may only move forward". A BEFORE UPDATE trigger
  //    comparing OLD vs NEW is the only way to enforce monotonic
  //    transitions.
  //
  //    Allowed:  pending -> active | expired
  //              active  -> grace
  //              grace   -> expired
  //              (no-op, same state)
  //
  //    Forbidden (rejected with RAISE EXCEPTION):
  //              grace   -> active   <-- the rollback Zur explicitly banned
  //              active  -> pending
  //              active  -> expired  (must pass through grace)
  //              expired -> anything
  //              pending -> grace    (must activate first)
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION ed25519_keys_enforce_state_transition()
      RETURNS TRIGGER AS $$
      BEGIN
        -- No-op UPDATEs on the state column are always allowed.
        IF OLD.state = NEW.state THEN
          RETURN NEW;
        END IF;

        -- Allowed forward transitions.
        IF OLD.state = 'pending' AND NEW.state IN ('active', 'expired') THEN
          RETURN NEW;
        END IF;
        IF OLD.state = 'active' AND NEW.state = 'grace' THEN
          RETURN NEW;
        END IF;
        IF OLD.state = 'grace' AND NEW.state = 'expired' THEN
          RETURN NEW;
        END IF;

        -- Everything else is forbidden. The grace->active rollback is
        -- the only "tempting" path that gets rejected here. Per the
        -- Phase 3 decision: rollback is a NEW rotation, never a state
        -- regression.
        RAISE EXCEPTION 'ed25519_keys: forbidden state transition % -> % for key %. State machine is monotonic forward (Phase 3 invariant). To recover from a bad rotation, run a NEW rotation with a NEW key.', OLD.state, NEW.state, OLD.id;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_ed25519_keys_state_transition ON ed25519_keys');
    await client.query(`
      CREATE TRIGGER trg_ed25519_keys_state_transition
        BEFORE UPDATE OF state ON ed25519_keys
        FOR EACH ROW
        EXECUTE FUNCTION ed25519_keys_enforce_state_transition()
    `);
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3a] state-transition trigger create failed');
    throw e;
  }

  // 5. Audit trigger — write an audit_log row every time state changes.
  //    Runs AFTER UPDATE, so if the BEFORE trigger above rejects the
  //    transition, no audit row is written (we only record transitions
  //    that actually happened).
  //
  //    audit_log.details is TEXT (not jsonb) per the schema, so we cast
  //    jsonb_build_object()::text before inserting. audit_log.timestamp
  //    is also TEXT (ISO string), so we use to_char(NOW() AT TIME ZONE
  //    'UTC', ...) to match the shape that db.log() writes.
  //
  //    NOTE on current_user (important — Avi R2): through Neon's connection
  //    pooler, current_user resolves to the POOL OWNER, NOT the operator
  //    who ran the rotation command. Every request through the pooler
  //    sees the same current_user. This field is useful for detecting
  //    raw-SQL tampering vs. application-driven writes, but it does NOT
  //    identify the human actor. The authoritative "who rotated" is in
  //    key_rotation_log.actor, populated by the Phase 3B rotation command
  //    with the operator-supplied actor string.
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION ed25519_keys_audit_state_change()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.state IS DISTINCT FROM NEW.state THEN
          INSERT INTO audit_log (timestamp, event, details)
          VALUES (
            to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'ed25519_key_state_change',
            jsonb_build_object(
              'key_id',       OLD.id,
              'old_state',    OLD.state,
              'new_state',    NEW.state,
              'session_user', current_user
            )::text
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query('DROP TRIGGER IF EXISTS trg_ed25519_keys_audit_state ON ed25519_keys');
    await client.query(`
      CREATE TRIGGER trg_ed25519_keys_audit_state
        AFTER UPDATE OF state ON ed25519_keys
        FOR EACH ROW
        EXECUTE FUNCTION ed25519_keys_audit_state_change()
    `);
  } catch (e) {
    log.error({ err: e.message }, '[PG][phase3a] audit trigger create failed');
    throw e;
  }

  return { genesisRowsInserted };
}

// ================================================================
// CLOSE
// ================================================================
async function close() {
  await pool.end();
}

// ================================================================
// EXPORTS (thin facade -- delegates to repo modules)
// ================================================================
module.exports = {
  // db.js-local: pool, ready, schema migration, query, close
  runPhase3aMigration,
  query: queryWithRetry,
  close,
  _db: pool,
  _ready,
  // Spread all repo functions for backward compatibility.
  // Every existing `require('../db').someFunction` call continues to work.
  ...authRepo.functions,
  ...documentRepo.functions,
  ...adminRepo.functions,
  ...gatewayRepo.functions,
};
