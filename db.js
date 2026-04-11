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
  // Migrate legacy free plan users to pro
  try { await pool.query("UPDATE users SET plan = 'pro', documents_limit = 500 WHERE plan = 'free'"); } catch (_) { /* ok */ }
  // Performance indexes
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_docs_user_id ON documents(user_id)'); } catch (_) { /* already exists */ }
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id)'); } catch (_) { /* already exists */ }
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
})();

// ================================================================
// ROW MAPPERS
// ================================================================
function mapDocRow(row) {
  if (!row) return null;
  return {
    hash: row.hash,
    signature: row.signature,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    timestamp: row.created_at,
    token: row.token,
    tokenCreatedAt: row.token_created_at != null ? Number(row.token_created_at) : null,
    orgId: row.org_id,
    orgName: row.org_name,
    recipient: row.recipient || null,
    recipientHash: row.recipient_hash || null,
    shareId: row.share_id || undefined,
    // Integrity + owner columns — required by /api/verify and the
    // Layer 2 dual-hash fallback for stamp overrides.
    code_integrity: row.code_integrity || null,
    chained_token: row.chained_token || null,
    user_id: row.user_id || null,
    // Ed25519 dual-signature columns (Phase 2A — null until Phase 2B activates signing)
    ed25519_signature: row.ed25519_signature || null,
    ed25519_key_id: row.ed25519_key_id || null,
    // Zero-knowledge columns (PVF 2.0)
    slug: row.slug || null,
    encrypted: !!row.encrypted,
    iv: row.iv || null,
    pvf_version: row.pvf_version || '1.0',
  };
}

function mapKeyRow(row) {
  if (!row) return null;
  return {
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: Number(row.documents_created),
    active: Number(row.active) === 1,
    rateLimit: Number(row.rate_limit),
    allowedIPs: row.allowed_ips
      ? (() => { try { return JSON.parse(row.allowed_ips); } catch (_) { return []; } })()
      : undefined,
  };
}

function mapKeyListRow(row) {
  return {
    apiKey: row.api_key,
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: Number(row.documents_created),
    active: Number(row.active) === 1,
    rateLimit: Number(row.rate_limit),
  };
}

function mapAuditRow(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    event: row.event,
    details: row.details
      ? (() => { try { return JSON.parse(row.details); } catch (_) { return {}; } })()
      : {},
  };
}

function mapWebhookRow(row) {
  return {
    id: row.id,
    url: row.url,
    events: (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })(),
    secret: row.secret,
    createdAt: row.created_at,
  };
}

function mapAllWebhookRow(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    events: typeof row.events === 'string'
      ? (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })()
      : row.events,
    active: !!Number(row.active),
    createdAt: row.created_at,
  };
}

function mapAllDocRow(row) {
  return {
    hash: row.hash,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    createdAt: row.created_at,
    orgId: row.org_id,
    orgName: row.org_name,
    recipient: row.recipient,
    recipientHash: row.recipient_hash,
  };
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

async function getAllDocuments({ limit = 50, offset = 0, search = '' } = {}) {
  let rows;
  if (search) {
    const pattern = '%' + search + '%';
    const res = await pool.query(
      `SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash
       FROM documents WHERE hash LIKE $1 OR original_name LIKE $2 OR org_name LIKE $3
       ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [pattern, pattern, pattern, limit, offset]
    );
    rows = res.rows;
  } else {
    const res = await pool.query(
      `SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash
       FROM documents ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    rows = res.rows;
  }
  return rows.map(mapAllDocRow);
}

// ================================================================
// API KEYS
// ================================================================
async function getApiKey(key) {
  const { rows } = await queryWithRetry('SELECT * FROM api_keys WHERE api_key = $1', [key]);
  return rows.length ? mapKeyRow(rows[0]) : null;
}

async function getOrgByOrgId(orgId) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE org_id = $1', [orgId]);
  return rows.length ? rows[0] : null;
}

async function createApiKey({ apiKey, orgId, orgName, plan = 'pro', rateLimit = 100, allowedIPs }) {
  await pool.query(
    `INSERT INTO api_keys (api_key, org_id, org_name, plan, created_at, documents_created, active, rate_limit, allowed_ips)
     VALUES ($1,$2,$3,$4,$5,0,1,$6,$7)`,
    [apiKey, orgId, orgName, plan, new Date().toISOString(), rateLimit,
     allowedIPs ? JSON.stringify(allowedIPs) : null]
  );
}

async function incrementDocCount(apiKey) {
  await pool.query('UPDATE api_keys SET documents_created = documents_created + 1 WHERE api_key = $1', [apiKey]);
}

async function listApiKeys() {
  const { rows } = await pool.query('SELECT * FROM api_keys ORDER BY created_at DESC');
  return rows.map(mapKeyListRow);
}

async function deactivateApiKey(apiKey) {
  await pool.query('UPDATE api_keys SET active = 0 WHERE api_key = $1', [apiKey]);
}

// Alias for compatibility — some callers may reference deleteApiKey
const deleteApiKey = deactivateApiKey;

// ================================================================
// AUDIT LOG
// ================================================================
async function log(event, details = {}) {
  try {
    await queryWithRetry(
      'INSERT INTO audit_log (timestamp, event, details) VALUES ($1, $2, $3)',
      [new Date().toISOString(), event, JSON.stringify(details)]
    );
  } catch (e) {
    logger.error('[AUDIT] Failed to write:', e.message);
  }
}

async function getAuditLog({ limit = 50, offset = 0, event, orgId } = {}) {
  let rows;
  if (event) {
    const res = await pool.query(
      'SELECT * FROM audit_log WHERE event = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [event, limit, offset]
    );
    rows = res.rows;
  } else if (orgId) {
    const res = await pool.query(
      "SELECT * FROM audit_log WHERE details::jsonb->>'orgId' = $1 ORDER BY id DESC LIMIT $2 OFFSET $3",
      [orgId, limit, offset]
    );
    rows = res.rows;
  } else {
    const res = await pool.query(
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    rows = res.rows;
  }
  return rows.map(mapAuditRow);
}

// ================================================================
// WEBHOOKS
// ================================================================
async function getWebhooksByOrg(orgId) {
  const { rows } = await pool.query('SELECT * FROM webhooks WHERE org_id = $1 AND active = 1', [orgId]);
  return rows.map(mapWebhookRow);
}

async function registerWebhook(orgId, url, events, secret) {
  const { rows } = await pool.query(
    'INSERT INTO webhooks (org_id, url, events, secret, active) VALUES ($1,$2,$3,$4,1) RETURNING id',
    [orgId, url, JSON.stringify(events), secret]
  );
  return rows[0].id;
}

async function removeWebhook(id, orgId) {
  const { rowCount } = await pool.query('DELETE FROM webhooks WHERE id = $1 AND org_id = $2', [id, orgId]);
  return rowCount > 0;
}

async function getAllWebhooks() {
  const { rows } = await pool.query('SELECT * FROM webhooks ORDER BY created_at DESC');
  return rows.map(mapAllWebhookRow);
}

// ================================================================
// STATS
// ================================================================
async function getStats() {
  const [d, o, a] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM documents'),
    pool.query('SELECT COUNT(*) as count FROM api_keys WHERE active = 1'),
    pool.query('SELECT COUNT(*) as count FROM audit_log'),
  ]);
  return {
    totalDocuments: Number(d.rows[0].count),
    totalOrganizations: Number(o.rows[0].count),
    totalAuditEntries: Number(a.rows[0].count),
  };
}

async function getOrgStats(orgId) {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM documents WHERE org_id = $1', [orgId]);
  return { documentsCreated: Number(rows[0].count) };
}

// ================================================================
// MIGRATION (no-op for PostgreSQL — data lives in the managed DB)
// ================================================================
async function migrateFromJson() {
  return { documents: 0, keys: 0 };
}

// ================================================================
// BRANDING
// ================================================================
async function updateBranding(orgId, data) {
  const icon = data.customIcon || data.custom_icon || null;
  const color = data.brandColor || data.brand_color || null;
  const waveCol = data.waveColor || data.wave_color || null;
  await pool.query('UPDATE api_keys SET custom_icon = $1, brand_color = $2, wave_color = $3 WHERE org_id = $4', [icon, color, waveCol, orgId]);
}

async function getBranding(orgId) {
  const { rows } = await pool.query('SELECT custom_icon, brand_color, wave_color FROM api_keys WHERE org_id = $1', [orgId]);
  return rows[0] || { custom_icon: null, brand_color: null, wave_color: null };
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

async function updateUserDocCount(userId) {
  await pool.query('UPDATE users SET documents_used = documents_used + 1 WHERE id = $1', [userId]);
}

async function getUserDocuments(userId, { limit = 20, offset = 0, search = '', starred = false } = {}) {
  let query = 'SELECT * FROM documents WHERE user_id = $1';
  const params = [userId];
  let idx = 2;
  if (starred) {
    query += ` AND starred = $${idx}`;
    params.push(true);
    idx++;
  }
  if (search) {
    const pattern = '%' + search + '%';
    query += ` AND (original_name ILIKE $${idx} OR hash ILIKE $${idx + 1})`;
    params.push(pattern, pattern);
    idx += 2;
  }
  query += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
  params.push(limit, offset);
  const { rows } = await pool.query(query, params);
  return rows.map(mapDocRow);
}

async function getUserDocumentCount(userId) {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM documents WHERE user_id = $1', [userId]);
  return Number(rows[0].count);
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

async function updateUserProfile(userId, { name }) {
  await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
}

// ================================================================
// STAMP CONFIG (Layer 2 — visual wrapper, not part of doc hash)
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
  // Validation guard — strip any non-allowed keys to prevent injection
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
    // Empty after sanitization → store empty string (template falls back to orgName)
    safe.brandText = bt;
  }

  await pool.query(
    'UPDATE users SET stamp_config = $1::jsonb, stamp_updated_at = NOW() WHERE id = $2',
    [JSON.stringify(safe), userId]
  );
  return safe;
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

async function deleteUser(userId) {
  await pool.query('DELETE FROM documents WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ================================================================
// DASHBOARD HELPERS
// ================================================================
async function getRecentDocuments(limit = 10) {
  const { rows } = await pool.query('SELECT hash, original_name, mime_type, file_size, created_at, org_id, verified FROM documents ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getDailyStats(days = 30) {
  const { rows } = await pool.query(`
    SELECT DATE(created_at::timestamptz) as date, COUNT(*) as documents
    FROM documents
    WHERE created_at::timestamptz > NOW() - INTERVAL '1 day' * $1
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date
  `, [days]);
  return rows;
}

async function getSecurityAlerts(limit = 50) {
  const { rows } = await pool.query(`
    SELECT * FROM audit_log
    WHERE event IN ('auth_failed', 'verify_failed', 'rate_limited', 'code_tampered', 'chain_broken', 'invalid_signature')
    ORDER BY timestamp DESC LIMIT $1
  `, [limit]);
  return rows;
}

async function getApiKeyByOrgId(orgId) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE org_id = $1', [orgId]);
  return rows[0] || null;
}

async function updateOrgPlan(orgId, plan) {
  const limits = { pro: 500, business: 10000, enterprise: 100000 };
  await pool.query('UPDATE api_keys SET plan = $1, rate_limit = $2 WHERE org_id = $3', [plan, limits[plan], orgId]);
}

async function getAllDocumentsForExport() {
  const { rows } = await pool.query('SELECT hash, original_name, mime_type, file_size, created_at, org_id, verified FROM documents ORDER BY created_at DESC');
  return rows;
}

async function getAllKeysForExport() {
  const { rows } = await pool.query('SELECT org_id, org_name, plan, rate_limit, documents_created, active, created_at FROM api_keys ORDER BY created_at DESC');
  return rows;
}

async function getAllAuditForExport() {
  const { rows } = await pool.query('SELECT event, details, timestamp FROM audit_log ORDER BY timestamp DESC LIMIT 10000');
  return rows;
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
  // Phase 3B Avi FIX 4 — JWKS pending-key leak defense.
  //
  // Prior to this filter, the WHERE clause was `valid_until IS NULL OR
  // valid_until > NOW()` which matched pending (state='pending',
  // valid_until=NULL) rows. That caused /.well-known/vertifile-jwks.json
  // to publish the public keys of not-yet-activated keys the instant the
  // operator ran `generate` — an information leak to external verifiers.
  //
  // Fix: require state IN ('active', 'grace'). This filters out:
  //   - state='pending'  (not yet activated — should never be published)
  //   - state='expired'  (past grace window — should no longer be published)
  // while keeping state='grace' keys visible so documents signed under
  // the previous rotation continue to verify for the full grace window.
  //
  // Note: this query requires the Phase 3A `state` column to exist. A test
  // DB that skipped the migration will throw — which is acceptable because
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
// PHASE 3A — KEY ROTATION MIGRATION + HELPERS
// ================================================================
// Exposed for use by Phase 3B (rotation command), 3C (public rotation log
// endpoint), 3D (tests), and 3E (health endpoints). Phase 3A itself needs
// runPhase3aMigration + getEd25519KeyState + listRotationLog from the tests.

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
 * the opposite direction would defeat the invariant — callers MUST surface
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

/**
 * Returns the current state of an ed25519 key.
 *
 * Throws Ed25519KeyNotFoundError if the key id does not exist in the
 * ed25519_keys table. Callers (notably Phase 3B's rotation command)
 * MUST distinguish "wrong key id" from "key in unexpected state" — a
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
 * inserts the rotation log row, and commits — all atomically. Passing the
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
 * state is 'grace' — that's the moment the key transitions from "issuing
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
    // state transition" — see runPhase3aMigration trigger body. Match on
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
 * It is DB-only — the public rotation log must never surface who ran
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
 * This is Avi F1 / Ori R10 — silent truncation of operator context is
 * worse than a loud error.
 *
 * `reason` is capped at 280 chars, `actor` at 255 chars. Both caps throw
 * rather than truncate — an operator writing "emergency rotation due to
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

// ================================================================
// CLOSE
// ================================================================
async function close() {
  await pool.end();
}

// ================================================================
// ================================================================
// MONITORING
// ================================================================
async function logHealthCheck(status, responseMs, details = {}) {
  await pool.query('INSERT INTO health_checks (status, response_ms, details) VALUES ($1, $2, $3)', [status, responseMs, JSON.stringify(details)]);
  // Keep only last 30 days
  await pool.query("DELETE FROM health_checks WHERE checked_at < NOW() - INTERVAL '30 days'");
}

async function getHealthHistory(hours = 24) {
  const { rows } = await pool.query(
    'SELECT * FROM health_checks WHERE checked_at > NOW() - ($1 || \' hours\')::INTERVAL ORDER BY checked_at DESC LIMIT 500',
    [hours]
  );
  return rows;
}

async function getUptimeStats(days = 30) {
  const { rows: total } = await pool.query(
    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'ok') as ok FROM health_checks WHERE checked_at > NOW() - ($1 || ' days')::INTERVAL",
    [days]
  );
  const r = total[0];
  const uptimePercent = r.total > 0 ? ((r.ok / r.total) * 100).toFixed(2) : '100.00';
  const { rows: incidents } = await pool.query(
    "SELECT checked_at, details FROM health_checks WHERE status != 'ok' AND checked_at > NOW() - ($1 || ' days')::INTERVAL ORDER BY checked_at DESC LIMIT 20",
    [days]
  );
  const { rows: avgResp } = await pool.query(
    "SELECT ROUND(AVG(response_ms)) as avg_ms FROM health_checks WHERE status = 'ok' AND checked_at > NOW() - ($1 || ' days')::INTERVAL",
    [days]
  );
  return {
    uptimePercent,
    totalChecks: parseInt(r.total),
    okChecks: parseInt(r.ok),
    failedChecks: parseInt(r.total) - parseInt(r.ok),
    avgResponseMs: avgResp[0]?.avg_ms || 0,
    incidents
  };
}

// ================================================================
// PAYWALL
// ================================================================
async function markDocumentPreviewOnly(hash, previewOnly) {
  await pool.query('UPDATE documents SET preview_only = $1 WHERE hash = $2', [previewOnly, hash]);
}

// ================================================================
// HEALTH CHECK
// ================================================================
async function healthCheck() {
  const start = Date.now();
  try {
    const { rows } = await pool.query('SELECT NOW() AS server_time, current_database() AS db_name');
    const ms = Date.now() - start;
    return {
      ok: true,
      responseMs: ms,
      serverTime: rows[0].server_time,
      database: rows[0].db_name,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (e) {
    const ms = Date.now() - start;
    return {
      ok: false,
      responseMs: ms,
      error: e.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  }
}

// ================================================================
// LOGIN TRACKING
// ================================================================
async function updateLastLogin(userId) {
  await pool.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [userId]);
}

async function setEmailVerified(userId, verified = true) {
  await pool.query('UPDATE users SET email_verified = $1, updated_at = NOW() WHERE id = $2', [verified, userId]);
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

async function updateUserPassword(userId, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
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
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::INTERVAL)`,
    [email, code, type, String(expiresInMinutes)]
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
     WHERE email = $1 AND created_at > NOW() - ($2 || ' minutes')::INTERVAL`,
    [email, String(minutesWindow)]
  );
  return rows[0].cnt;
}

// ================================================================
// EXPORTS
// ================================================================
module.exports = {
  getDocument,
  getDocumentByShareId,
  createDocument,
  updateDocumentToken,
  setShareId,
  // Zero-Knowledge / PVF 2.0 slug helpers
  getDocumentBySlug,
  setSlug,
  getPvfContentBySlug,
  getDocumentsByOrg,
  getDocumentCount,
  getAllDocuments,
  getApiKey,
  createApiKey,
  incrementDocCount,
  listApiKeys,
  deactivateApiKey,
  deleteApiKey,
  log,
  getAuditLog,
  getWebhooksByOrg,
  registerWebhook,
  removeWebhook,
  getAllWebhooks,
  getStats,
  getOrgStats,
  updateBranding,
  getBranding,
  migrateFromJson,
  createUser,
  getUserByEmail,
  getUserById,
  getUserByProviderId,
  updateUserDocCount,
  getUserDocuments,
  getUserDocumentCount,
  starDocument,
  setDocumentUserId,
  getOrgByOrgId,
  deleteDocument,
  saveCodeIntegrity,
  savePvfContent,
  getPvfContent,
  updateUserProfile,
  getUserStampConfig,
  updateUserStampConfig,
  changeUserPassword,
  deleteUser,
  logHealthCheck,
  getHealthHistory,
  getUptimeStats,
  getRecentDocuments,
  getDailyStats,
  getSecurityAlerts,
  getApiKeyByOrgId,
  updateOrgPlan,
  getAllDocumentsForExport,
  getAllKeysForExport,
  getAllAuditForExport,
  markDocumentPreviewOnly,
  saveResetToken,
  getResetToken,
  deleteResetToken,
  updateUserPassword,
  healthCheck,
  updateLastLogin,
  setEmailVerified,
  // Ed25519 key CRUD (Phase 2A)
  getEd25519KeyById,
  getPrimaryEd25519Key,
  listActiveEd25519Keys,
  insertEd25519Key,
  // Key rotation helpers (Phase 3A schema; consumers wired up in 3B-3E)
  runPhase3aMigration,
  Ed25519KeyNotFoundError,
  Ed25519ForbiddenTransitionError,
  getEd25519KeyState,
  setEd25519KeyState,
  listRotationLog,
  insertRotationLog,
  countEd25519KeysByState,
  // Verification codes (onboarding email verification)
  createVerificationCode,
  getVerificationCode,
  getLatestVerificationCode,
  incrementCodeAttempts,
  markCodeUsed,
  cleanExpiredCodes,
  getCodeSendCount,
  query: queryWithRetry,
  close,
  _db: pool,
  _ready,
};
