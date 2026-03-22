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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

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
    plan TEXT DEFAULT 'free',
    created_at TEXT DEFAULT (now() AT TIME ZONE 'UTC'),
    documents_created INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    rate_limit INTEGER DEFAULT 5,
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
    documents_limit INT DEFAULT 1,
    plan TEXT DEFAULT 'free',
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
  try { await pool.query('ALTER TABLE documents ADD COLUMN user_id INT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN starred BOOLEAN DEFAULT false'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN pvf_content TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN code_integrity TEXT'); } catch (_) { /* already exists */ }
  try { await pool.query('ALTER TABLE documents ADD COLUMN chained_token TEXT'); } catch (_) { /* already exists */ }
  // Update free plan limit from 5 to 1
  try { await pool.query("UPDATE users SET documents_limit = 1 WHERE plan = 'free' AND documents_limit = 5"); } catch (_) { /* ok */ }
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
  };
}

async function createDocument({ hash, signature, originalName, mimeType, fileSize, orgId, orgName, token, tokenCreatedAt, recipient, recipientHash, shareId }) {
  await queryWithRetry(
    `INSERT INTO documents (hash, signature, original_name, mime_type, file_size, created_at, token, token_created_at, org_id, org_name, recipient, recipient_hash, share_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [hash, signature, originalName || null, mimeType || null, fileSize || null,
     new Date().toISOString(), token || null, tokenCreatedAt || null,
     orgId, orgName, recipient || null, recipientHash || null, shareId || null]
  );
}

async function setShareId(hash, shareId) {
  await pool.query('UPDATE documents SET share_id = $1 WHERE hash = $2', [shareId, hash]);
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

async function createApiKey({ apiKey, orgId, orgName, plan = 'free', rateLimit = 5, allowedIPs }) {
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
async function updateBranding(orgId, { customIcon, brandColor }) {
  await pool.query('UPDATE api_keys SET custom_icon = $1, brand_color = $2 WHERE org_id = $3', [customIcon || null, brandColor || null, orgId]);
}

async function getBranding(orgId) {
  const { rows } = await pool.query('SELECT custom_icon, brand_color FROM api_keys WHERE org_id = $1', [orgId]);
  return rows[0] || { custom_icon: null, brand_color: null };
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

async function changeUserPassword(userId, newPasswordHash) {
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM documents WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
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
// EXPORTS
// ================================================================
module.exports = {
  getDocument,
  getDocumentByShareId,
  createDocument,
  updateDocumentToken,
  setShareId,
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
  changeUserPassword,
  deleteUser,
  logHealthCheck,
  getHealthHistory,
  getUptimeStats,
  close,
  _db: pool,
  _ready,
};
