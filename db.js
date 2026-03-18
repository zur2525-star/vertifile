/**
 * Vertifile Database Layer — Hybrid PostgreSQL / SQLite
 *
 * If DATABASE_URL is set → PostgreSQL via pg.Pool (async, for production)
 * If not                  → SQLite via better-sqlite3 (sync, for local dev)
 *
 * All exported functions return the same shapes regardless of backend.
 * In PostgreSQL mode every function returns a Promise; in SQLite mode the
 * functions are synchronous (but wrapped to also return a value compatible
 * with `await`, so callers can use `await db.fn()` everywhere).
 */

const USE_PG = !!process.env.DATABASE_URL;

// ================================================================
// BACKEND: PostgreSQL
// ================================================================
function createPgBackend() {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Neon / managed PG
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[PG] Unexpected pool error:', err.message);
  });

  // ---- Schema bootstrap ----
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

  // This promise resolves once schema is ready.  Callers that need the DB
  // ready before proceeding can `await db._ready`.
  const _ready = (async () => {
    try {
      await pool.query(SCHEMA_SQL);
      console.log('[PG] Schema initialised');
    } catch (e) {
      console.error('[PG] Schema init error:', e.message);
      throw e;
    }
  })();

  // ---- Row mappers ----
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

  // ---- Documents ----
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

  // ---- API Keys ----
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

  // ---- Audit Log ----
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

  // ---- Webhooks ----
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

  // ---- Stats ----
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

  // ---- Migration (no-op for PG — data lives in the managed DB) ----
  async function migrateFromJson() {
    return { documents: 0, keys: 0 };
  }

  // ---- Close ----
  async function close() {
    await pool.end();
  }

  return {
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
}

// ================================================================
// BACKEND: SQLite (original implementation, kept for local dev)
// ================================================================
function createSqliteBackend() {
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');

  const DATA_DIR = path.join(__dirname, 'data');
  const DB_PATH = path.join(DATA_DIR, 'vertifile.db');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      hash TEXT PRIMARY KEY,
      signature TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      token TEXT,
      token_created_at INTEGER,
      org_id TEXT,
      org_name TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      api_key TEXT PRIMARY KEY,
      org_id TEXT UNIQUE NOT NULL,
      org_name TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now')),
      documents_created INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      rate_limit INTEGER DEFAULT 5,
      allowed_ips TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      secret TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_docs_org ON documents(org_id);
    CREATE INDEX IF NOT EXISTS idx_docs_created ON documents(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id);
  `);

  // Schema migrations
  try { db.exec(`ALTER TABLE documents ADD COLUMN recipient TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN recipient_hash TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN share_id TEXT`); } catch (_) {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_share ON documents(share_id) WHERE share_id IS NOT NULL`); } catch (_) {}

  // Prepared statements
  const stmts = {
    getDoc: db.prepare('SELECT * FROM documents WHERE hash = ?'),
    getDocByShareId: db.prepare('SELECT * FROM documents WHERE share_id = ?'),
    insertDoc: db.prepare(`
      INSERT INTO documents (hash, signature, original_name, mime_type, file_size, created_at, token, token_created_at, org_id, org_name, recipient, recipient_hash, share_id)
      VALUES (@hash, @signature, @original_name, @mime_type, @file_size, @created_at, @token, @token_created_at, @org_id, @org_name, @recipient, @recipient_hash, @share_id)
    `),
    updateShareId: db.prepare('UPDATE documents SET share_id = ? WHERE hash = ?'),
    updateToken: db.prepare('UPDATE documents SET token = ?, token_created_at = ? WHERE hash = ?'),
    docsByOrg: db.prepare('SELECT hash, original_name, mime_type, file_size, created_at, org_name FROM documents WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'),
    docCountByOrg: db.prepare('SELECT COUNT(*) as count FROM documents WHERE org_id = ?'),
    totalDocs: db.prepare('SELECT COUNT(*) as count FROM documents'),
    getKey: db.prepare('SELECT * FROM api_keys WHERE api_key = ?'),
    insertKey: db.prepare(`
      INSERT INTO api_keys (api_key, org_id, org_name, plan, created_at, documents_created, active, rate_limit, allowed_ips)
      VALUES (@api_key, @org_id, @org_name, @plan, @created_at, @documents_created, @active, @rate_limit, @allowed_ips)
    `),
    incrementDocs: db.prepare('UPDATE api_keys SET documents_created = documents_created + 1 WHERE api_key = ?'),
    listKeys: db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC'),
    totalOrgs: db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE active = 1'),
    insertAudit: db.prepare('INSERT INTO audit_log (timestamp, event, details) VALUES (?, ?, ?)'),
    getAudit: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?'),
    getAuditByEvent: db.prepare('SELECT * FROM audit_log WHERE event = ? ORDER BY id DESC LIMIT ? OFFSET ?'),
    getAuditByOrg: db.prepare("SELECT * FROM audit_log WHERE json_extract(details, '$.orgId') = ? ORDER BY id DESC LIMIT ? OFFSET ?"),
    totalAudit: db.prepare('SELECT COUNT(*) as count FROM audit_log'),
    getWebhooksByOrg: db.prepare('SELECT * FROM webhooks WHERE org_id = ? AND active = 1'),
    insertWebhook: db.prepare('INSERT INTO webhooks (org_id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)'),
    deleteWebhook: db.prepare('DELETE FROM webhooks WHERE id = ? AND org_id = ?'),
    allWebhooks: db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC'),
    allDocs: db.prepare('SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?'),
    searchDocs: db.prepare("SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash FROM documents WHERE hash LIKE ? OR original_name LIKE ? OR org_name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?"),
    deactivateKey: db.prepare('UPDATE api_keys SET active = 0 WHERE api_key = ?'),
  };

  // ---- Documents ----
  function getDocument(hash) {
    const row = stmts.getDoc.get(hash);
    if (!row) return null;
    return {
      hash: row.hash, signature: row.signature,
      originalName: row.original_name, mimeType: row.mime_type,
      fileSize: row.file_size, timestamp: row.created_at,
      token: row.token, tokenCreatedAt: row.token_created_at,
      orgId: row.org_id, orgName: row.org_name,
      recipient: row.recipient || null, recipientHash: row.recipient_hash || null,
    };
  }

  function createDocument({ hash, signature, originalName, mimeType, fileSize, orgId, orgName, token, tokenCreatedAt, recipient, recipientHash, shareId }) {
    stmts.insertDoc.run({
      hash, signature,
      original_name: originalName, mime_type: mimeType, file_size: fileSize,
      created_at: new Date().toISOString(),
      token: token || null, token_created_at: tokenCreatedAt || null,
      org_id: orgId, org_name: orgName,
      recipient: recipient || null, recipient_hash: recipientHash || null,
      share_id: shareId || null,
    });
  }

  function getDocumentByShareId(shareId) {
    const row = stmts.getDocByShareId.get(shareId);
    if (!row) return null;
    return {
      hash: row.hash, signature: row.signature,
      originalName: row.original_name, mimeType: row.mime_type,
      fileSize: row.file_size, timestamp: row.created_at,
      orgId: row.org_id, orgName: row.org_name,
      shareId: row.share_id,
      recipient: row.recipient || null, recipientHash: row.recipient_hash || null,
    };
  }

  function setShareId(hash, shareId) {
    stmts.updateShareId.run(shareId, hash);
  }

  const updateDocumentTokenTx = db.transaction((hash, token) => {
    stmts.updateToken.run(token, Date.now(), hash);
  });

  function updateDocumentToken(hash, token) {
    updateDocumentTokenTx(hash, token);
  }

  function getDocumentsByOrg(orgId, { limit = 50, offset = 0 } = {}) {
    return stmts.docsByOrg.all(orgId, limit, offset).map(row => ({
      hash: row.hash, originalName: row.original_name,
      mimeType: row.mime_type, fileSize: row.file_size,
      timestamp: row.created_at, orgName: row.org_name,
    }));
  }

  function getDocumentCount(orgId) {
    return stmts.docCountByOrg.get(orgId).count;
  }

  // ---- API Keys ----
  function getApiKey(key) {
    const row = stmts.getKey.get(key);
    if (!row) return null;
    return {
      orgId: row.org_id, orgName: row.org_name, plan: row.plan,
      created: row.created_at, documentsCreated: row.documents_created,
      active: row.active === 1, rateLimit: row.rate_limit,
      allowedIPs: row.allowed_ips ? (() => { try { return JSON.parse(row.allowed_ips); } catch (_) { return []; } })() : undefined,
    };
  }

  function createApiKey({ apiKey, orgId, orgName, plan = 'free', rateLimit = 5, allowedIPs }) {
    stmts.insertKey.run({
      api_key: apiKey, org_id: orgId, org_name: orgName, plan,
      created_at: new Date().toISOString(), documents_created: 0, active: 1,
      rate_limit: rateLimit,
      allowed_ips: allowedIPs ? JSON.stringify(allowedIPs) : null,
    });
  }

  function incrementDocCount(apiKey) {
    stmts.incrementDocs.run(apiKey);
  }

  function listApiKeys() {
    return stmts.listKeys.all().map(row => ({
      apiKey: row.api_key, orgId: row.org_id, orgName: row.org_name,
      plan: row.plan, created: row.created_at,
      documentsCreated: row.documents_created,
      active: row.active === 1, rateLimit: row.rate_limit,
    }));
  }

  // ---- Audit Log ----
  function log(event, details = {}) {
    try {
      stmts.insertAudit.run(new Date().toISOString(), event, JSON.stringify(details));
    } catch (e) {
      console.error('[AUDIT] Failed to write:', e.message);
    }
  }

  function getAuditLog({ limit = 50, offset = 0, event, orgId } = {}) {
    let rows;
    if (event) {
      rows = stmts.getAuditByEvent.all(event, limit, offset);
    } else if (orgId) {
      rows = stmts.getAuditByOrg.all(orgId, limit, offset);
    } else {
      rows = stmts.getAudit.all(limit, offset);
    }
    return rows.map(row => ({
      id: row.id, timestamp: row.timestamp, event: row.event,
      details: row.details ? (() => { try { return JSON.parse(row.details); } catch (_) { return {}; } })() : {},
    }));
  }

  // ---- Webhooks ----
  function getWebhooksByOrg(orgId) {
    return stmts.getWebhooksByOrg.all(orgId).map(row => ({
      id: row.id, url: row.url,
      events: (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })(),
      secret: row.secret, createdAt: row.created_at,
    }));
  }

  function registerWebhook(orgId, url, events, secret) {
    const result = stmts.insertWebhook.run(orgId, url, JSON.stringify(events), secret);
    return result.lastInsertRowid;
  }

  function removeWebhook(id, orgId) {
    return stmts.deleteWebhook.run(id, orgId).changes > 0;
  }

  function getAllWebhooks() {
    return stmts.allWebhooks.all().map(row => ({
      id: row.id, orgId: row.org_id, url: row.url,
      events: typeof row.events === 'string' ? (() => { try { return JSON.parse(row.events); } catch (_) { return []; } })() : row.events,
      active: !!row.active, createdAt: row.created_at,
    }));
  }

  // ---- Stats ----
  function getStats() {
    return {
      totalDocuments: stmts.totalDocs.get().count,
      totalOrganizations: stmts.totalOrgs.get().count,
      totalAuditEntries: stmts.totalAudit.get().count,
    };
  }

  function getOrgStats(orgId) {
    return { documentsCreated: stmts.docCountByOrg.get(orgId).count };
  }

  // ---- Admin ----
  function getAllDocuments({ limit = 50, offset = 0, search = '' } = {}) {
    let rows;
    if (search) {
      const pattern = '%' + search + '%';
      rows = stmts.searchDocs.all(pattern, pattern, pattern, limit, offset);
    } else {
      rows = stmts.allDocs.all(limit, offset);
    }
    return rows.map(row => ({
      hash: row.hash, originalName: row.original_name,
      mimeType: row.mime_type, fileSize: row.file_size,
      createdAt: row.created_at, orgId: row.org_id,
      orgName: row.org_name, recipient: row.recipient,
      recipientHash: row.recipient_hash,
    }));
  }

  function deactivateApiKey(apiKey) {
    return stmts.deactivateKey.run(apiKey);
  }

  // ---- Migration ----
  function migrateFromJson() {
    const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
    const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
    let migrated = { documents: 0, keys: 0 };

    if (fs.existsSync(DOCS_FILE)) {
      try {
        const docs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
        const insert = db.transaction(() => {
          for (const [hash, doc] of Object.entries(docs)) {
            try {
              stmts.insertDoc.run({
                hash: doc.hash || hash, signature: doc.signature || '',
                original_name: doc.originalName || null, mime_type: doc.mimeType || null,
                file_size: doc.fileSize || null,
                created_at: doc.timestamp || new Date().toISOString(),
                token: doc.token || null, token_created_at: doc.tokenCreatedAt || null,
                org_id: doc.orgId || null, org_name: doc.orgName || null,
                recipient: doc.recipient || null, recipient_hash: doc.recipientHash || null,
                share_id: null,
              });
              migrated.documents++;
            } catch (e) {
              if (!e.message.includes('UNIQUE')) {
                console.error(`[MIGRATE] Doc ${hash.substring(0, 12)}...: ${e.message}`);
              }
            }
          }
        });
        insert();
        console.log(`[MIGRATE] Imported ${migrated.documents} documents from JSON`);
      } catch (e) {
        console.error('[MIGRATE] Failed to migrate documents:', e.message);
      }
    }

    if (fs.existsSync(KEYS_FILE)) {
      try {
        const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        const insert = db.transaction(() => {
          for (const [key, data] of Object.entries(keys)) {
            try {
              stmts.insertKey.run({
                api_key: key, org_id: data.orgId || 'org_unknown',
                org_name: data.orgName || 'Unknown', plan: data.plan || 'free',
                created_at: data.created || new Date().toISOString(),
                documents_created: data.documentsCreated || 0,
                active: data.active !== false ? 1 : 0,
                rate_limit: data.rateLimit || 5,
                allowed_ips: data.allowedIPs ? JSON.stringify(data.allowedIPs) : null,
              });
              migrated.keys++;
            } catch (e) {
              if (!e.message.includes('UNIQUE')) {
                console.error(`[MIGRATE] Key ${key.substring(0, 12)}...: ${e.message}`);
              }
            }
          }
        });
        insert();
        console.log(`[MIGRATE] Imported ${migrated.keys} API keys from JSON`);
      } catch (e) {
        console.error('[MIGRATE] Failed to migrate API keys:', e.message);
      }
    }

    return migrated;
  }

  // ---- Close ----
  function close() {
    db.close();
  }

  return {
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
    _db: db,
    _ready: Promise.resolve(),
  };
}

// ================================================================
// SELECT BACKEND & EXPORT
// ================================================================
if (USE_PG) {
  console.log('[DB] Using PostgreSQL (DATABASE_URL is set)');
  module.exports = createPgBackend();
} else {
  console.log('[DB] Using SQLite (local development mode)');
  module.exports = createSqliteBackend();
}
