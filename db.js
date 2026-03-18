/**
 * Vertifile Database Layer — PostgreSQL only (via pg.Pool)
 *
 * Connects using process.env.DATABASE_URL.
 * All exported functions are async and return Promises.
 * Call `db._ready` (or `await db._ready`) before using any function
 * to ensure the schema has been created.
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] FATAL: DATABASE_URL environment variable is not set.');
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
  console.error('[PG] Unexpected pool error:', err.message);
});

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
    console.log('[PG] Schema initialised');
  } catch (e) {
    console.error('[PG] Schema init error:', e.message);
    throw e;
  }
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
  const { rows } = await pool.query('SELECT * FROM documents WHERE hash = $1', [hash]);
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
  await pool.query(
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
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE api_key = $1', [key]);
  return rows.length ? mapKeyRow(rows[0]) : null;
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
    await pool.query(
      'INSERT INTO audit_log (timestamp, event, details) VALUES ($1, $2, $3)',
      [new Date().toISOString(), event, JSON.stringify(details)]
    );
  } catch (e) {
    console.error('[AUDIT] Failed to write:', e.message);
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
// CLOSE
// ================================================================
async function close() {
  await pool.end();
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
  migrateFromJson,
  close,
  _db: pool,
  _ready,
};
