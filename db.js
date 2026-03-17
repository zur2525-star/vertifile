/**
 * Vertifile Database Layer — SQLite
 * Replaces JSON file storage with proper database
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'vertifile.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ================================================================
// SCHEMA
// ================================================================
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

// ===== Schema migrations (add columns if missing) =====
try {
  db.exec(`ALTER TABLE documents ADD COLUMN recipient TEXT`);
} catch (e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE documents ADD COLUMN recipient_hash TEXT`);
} catch (e) { /* column already exists */ }

// ================================================================
// PREPARED STATEMENTS
// ================================================================
const stmts = {
  // Documents
  getDoc: db.prepare('SELECT * FROM documents WHERE hash = ?'),
  insertDoc: db.prepare(`
    INSERT INTO documents (hash, signature, original_name, mime_type, file_size, created_at, token, token_created_at, org_id, org_name, recipient, recipient_hash)
    VALUES (@hash, @signature, @original_name, @mime_type, @file_size, @created_at, @token, @token_created_at, @org_id, @org_name, @recipient, @recipient_hash)
  `),
  updateToken: db.prepare('UPDATE documents SET token = ?, token_created_at = ? WHERE hash = ?'),
  docsByOrg: db.prepare('SELECT hash, original_name, mime_type, file_size, created_at, org_name FROM documents WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'),
  docCountByOrg: db.prepare('SELECT COUNT(*) as count FROM documents WHERE org_id = ?'),
  totalDocs: db.prepare('SELECT COUNT(*) as count FROM documents'),

  // API Keys
  getKey: db.prepare('SELECT * FROM api_keys WHERE api_key = ?'),
  insertKey: db.prepare(`
    INSERT INTO api_keys (api_key, org_id, org_name, plan, created_at, documents_created, active, rate_limit, allowed_ips)
    VALUES (@api_key, @org_id, @org_name, @plan, @created_at, @documents_created, @active, @rate_limit, @allowed_ips)
  `),
  incrementDocs: db.prepare('UPDATE api_keys SET documents_created = documents_created + 1 WHERE api_key = ?'),
  listKeys: db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC'),
  totalOrgs: db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE active = 1'),

  // Audit
  insertAudit: db.prepare('INSERT INTO audit_log (timestamp, event, details) VALUES (?, ?, ?)'),
  getAudit: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?'),
  getAuditByEvent: db.prepare('SELECT * FROM audit_log WHERE event = ? ORDER BY id DESC LIMIT ? OFFSET ?'),
  getAuditByOrg: db.prepare("SELECT * FROM audit_log WHERE json_extract(details, '$.orgId') = ? ORDER BY id DESC LIMIT ? OFFSET ?"),
  totalAudit: db.prepare('SELECT COUNT(*) as count FROM audit_log'),

  // Webhooks
  getWebhooksByOrg: db.prepare('SELECT * FROM webhooks WHERE org_id = ? AND active = 1'),
  insertWebhook: db.prepare('INSERT INTO webhooks (org_id, url, events, secret, active) VALUES (?, ?, ?, ?, 1)'),
  deleteWebhook: db.prepare('DELETE FROM webhooks WHERE id = ? AND org_id = ?'),
};

// ================================================================
// DOCUMENTS
// ================================================================
function getDocument(hash) {
  const row = stmts.getDoc.get(hash);
  if (!row) return null;
  return {
    hash: row.hash,
    signature: row.signature,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    timestamp: row.created_at,
    token: row.token,
    tokenCreatedAt: row.token_created_at,
    orgId: row.org_id,
    orgName: row.org_name,
    recipient: row.recipient || null,
    recipientHash: row.recipient_hash || null
  };
}

function createDocument({ hash, signature, originalName, mimeType, fileSize, orgId, orgName, token, tokenCreatedAt, recipient, recipientHash }) {
  stmts.insertDoc.run({
    hash,
    signature,
    original_name: originalName,
    mime_type: mimeType,
    file_size: fileSize,
    created_at: new Date().toISOString(),
    token: token || null,
    token_created_at: tokenCreatedAt || null,
    org_id: orgId,
    org_name: orgName,
    recipient: recipient || null,
    recipient_hash: recipientHash || null
  });
}

function updateDocumentToken(hash, token) {
  stmts.updateToken.run(token, Date.now(), hash);
}

function getDocumentsByOrg(orgId, { limit = 50, offset = 0 } = {}) {
  return stmts.docsByOrg.all(orgId, limit, offset).map(row => ({
    hash: row.hash,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    timestamp: row.created_at,
    orgName: row.org_name
  }));
}

function getDocumentCount(orgId) {
  return stmts.docCountByOrg.get(orgId).count;
}

// ================================================================
// API KEYS
// ================================================================
function getApiKey(key) {
  const row = stmts.getKey.get(key);
  if (!row) return null;
  return {
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: row.documents_created,
    active: row.active === 1,
    rateLimit: row.rate_limit,
    allowedIPs: row.allowed_ips ? JSON.parse(row.allowed_ips) : undefined
  };
}

function createApiKey({ apiKey, orgId, orgName, plan = 'free', rateLimit = 5, allowedIPs }) {
  stmts.insertKey.run({
    api_key: apiKey,
    org_id: orgId,
    org_name: orgName,
    plan,
    created_at: new Date().toISOString(),
    documents_created: 0,
    active: 1,
    rate_limit: rateLimit,
    allowed_ips: allowedIPs ? JSON.stringify(allowedIPs) : null
  });
}

function incrementDocCount(apiKey) {
  stmts.incrementDocs.run(apiKey);
}

function listApiKeys() {
  return stmts.listKeys.all().map(row => ({
    apiKey: row.api_key,
    orgId: row.org_id,
    orgName: row.org_name,
    plan: row.plan,
    created: row.created_at,
    documentsCreated: row.documents_created,
    active: row.active === 1,
    rateLimit: row.rate_limit
  }));
}

// ================================================================
// AUDIT LOG
// ================================================================
function log(event, details = {}) {
  try {
    stmts.insertAudit.run(
      new Date().toISOString(),
      event,
      JSON.stringify(details)
    );
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
    id: row.id,
    timestamp: row.timestamp,
    event: row.event,
    details: row.details ? JSON.parse(row.details) : {}
  }));
}

// ================================================================
// WEBHOOKS
// ================================================================
function getWebhooksByOrg(orgId) {
  return stmts.getWebhooksByOrg.all(orgId).map(row => ({
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events),
    secret: row.secret,
    createdAt: row.created_at
  }));
}

function registerWebhook(orgId, url, events, secret) {
  const result = stmts.insertWebhook.run(orgId, url, JSON.stringify(events), secret);
  return result.lastInsertRowid;
}

function removeWebhook(id, orgId) {
  return stmts.deleteWebhook.run(id, orgId).changes > 0;
}

// ================================================================
// STATS
// ================================================================
function getStats() {
  return {
    totalDocuments: stmts.totalDocs.get().count,
    totalOrganizations: stmts.totalOrgs.get().count,
    totalAuditEntries: stmts.totalAudit.get().count
  };
}

function getOrgStats(orgId) {
  return {
    documentsCreated: stmts.docCountByOrg.get(orgId).count
  };
}

// ================================================================
// MIGRATION — import existing JSON data
// ================================================================
function migrateFromJson() {
  const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
  const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');

  let migrated = { documents: 0, keys: 0 };

  // Migrate documents
  if (fs.existsSync(DOCS_FILE)) {
    try {
      const docs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8'));
      const insert = db.transaction(() => {
        for (const [hash, doc] of Object.entries(docs)) {
          try {
            stmts.insertDoc.run({
              hash: doc.hash || hash,
              signature: doc.signature || '',
              original_name: doc.originalName || null,
              mime_type: doc.mimeType || null,
              file_size: doc.fileSize || null,
              created_at: doc.timestamp || new Date().toISOString(),
              token: doc.token || null,
              token_created_at: doc.tokenCreatedAt || null,
              org_id: doc.orgId || null,
              org_name: doc.orgName || null,
              recipient: doc.recipient || null,
              recipient_hash: doc.recipientHash || null
            });
            migrated.documents++;
          } catch (e) {
            // Skip duplicates
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

  // Migrate API keys
  if (fs.existsSync(KEYS_FILE)) {
    try {
      const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      const insert = db.transaction(() => {
        for (const [key, data] of Object.entries(keys)) {
          try {
            stmts.insertKey.run({
              api_key: key,
              org_id: data.orgId || 'org_unknown',
              org_name: data.orgName || 'Unknown',
              plan: data.plan || 'free',
              created_at: data.created || new Date().toISOString(),
              documents_created: data.documentsCreated || 0,
              active: data.active !== false ? 1 : 0,
              rate_limit: data.rateLimit || 5,
              allowed_ips: data.allowedIPs ? JSON.stringify(data.allowedIPs) : null
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

// ================================================================
// CLOSE (for graceful shutdown)
// ================================================================
function close() {
  db.close();
}

module.exports = {
  // Documents
  getDocument,
  createDocument,
  updateDocumentToken,
  getDocumentsByOrg,
  getDocumentCount,

  // API Keys
  getApiKey,
  createApiKey,
  incrementDocCount,
  listApiKeys,

  // Audit
  log,
  getAuditLog,

  // Webhooks
  getWebhooksByOrg,
  registerWebhook,
  removeWebhook,

  // Stats
  getStats,
  getOrgStats,

  // Migration & Lifecycle
  migrateFromJson,
  close,

  // Direct DB access (for advanced queries)
  _db: db
};
