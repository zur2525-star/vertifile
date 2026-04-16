/**
 * Vertifile Neon DB Backup Script
 *
 * Connects to DATABASE_URL and exports critical tables to JSON files.
 * Compresses the output into a timestamped .tar.gz archive.
 *
 * Tables backed up:
 *   - users (full)
 *   - documents (metadata only, excludes pvf_content)
 *   - api_keys (full)
 *   - ed25519_keys (full)
 *   - webhooks (full)
 *   - audit_log (last 30 days only)
 *
 * Usage: node scripts/backup-neon.js
 */

'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[backup] FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const BACKUPS_ROOT = path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 7; // keep last 7 archives

// ---------------------------------------------------------------------------
// Table definitions
// ---------------------------------------------------------------------------

// Each entry describes what to export.  `where` is optional SQL WHERE clause.
// `excludeCols` lists columns to omit (SELECT * minus those columns).
const TABLE_SPECS = [
  { name: 'users' },
  {
    name: 'documents',
    excludeCols: ['pvf_content'],
  },
  { name: 'api_keys' },
  { name: 'ed25519_keys' },
  { name: 'webhooks' },
  {
    name: 'audit_log',
    where: "created_at >= NOW() - INTERVAL '30 days'",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('-') + '_' + [
    pad(d.getHours()),
    pad(d.getMinutes()),
  ].join('-');
}

async function getColumnsForTable(pool, tableName) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return rows.map((r) => r.column_name);
}

async function exportTable(pool, spec) {
  const { name, excludeCols, where } = spec;

  // Determine columns to select
  let cols = '*';
  if (excludeCols && excludeCols.length > 0) {
    const allCols = await getColumnsForTable(pool, name);
    const filtered = allCols.filter((c) => !excludeCols.includes(c));
    if (filtered.length === 0) {
      console.log(`[backup] WARN: no columns left for ${name} after exclusions, skipping`);
      return null;
    }
    cols = filtered.map((c) => `"${c}"`).join(', ');
  }

  let sql = `SELECT ${cols} FROM "${name}"`;
  if (where) {
    sql += ` WHERE ${where}`;
  }

  const { rows } = await pool.query(sql);
  return rows;
}

function cleanOldBackups() {
  if (!fs.existsSync(BACKUPS_ROOT)) return;
  const archives = fs.readdirSync(BACKUPS_ROOT)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort();
  while (archives.length > MAX_BACKUPS) {
    const old = archives.shift();
    const fullPath = path.join(BACKUPS_ROOT, old);
    fs.unlinkSync(fullPath);
    console.log(`[backup] Deleted old archive: ${old}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const ts = timestamp();
  const dirName = ts;
  const dirPath = path.join(BACKUPS_ROOT, dirName);
  const archiveName = `${dirName}.tar.gz`;
  const archivePath = path.join(BACKUPS_ROOT, archiveName);

  console.log(`[backup] Starting backup at ${ts}`);
  console.log(`[backup] Output directory: ${dirPath}`);

  // Ensure directories exist
  fs.mkdirSync(dirPath, { recursive: true });

  // Connect
  const sslConfig = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false };

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslConfig,
    max: 3,
    connectionTimeoutMillis: 15000,
  });

  try {
    // Verify connection
    await pool.query('SELECT 1');
    console.log('[backup] Database connection established');

    // Export each table
    const summary = {};
    for (const spec of TABLE_SPECS) {
      console.log(`[backup] Exporting ${spec.name}...`);
      try {
        const rows = await exportTable(pool, spec);
        if (rows === null) continue;

        const filePath = path.join(dirPath, `${spec.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
        summary[spec.name] = rows.length;
        console.log(`[backup] ${spec.name}: ${rows.length} rows`);
      } catch (err) {
        // Table might not exist yet -- warn and continue
        console.log(`[backup] WARN: ${spec.name} skipped (${err.message})`);
        summary[spec.name] = 'skipped';
      }
    }

    // Write manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      tables: summary,
      version: require('../package.json').version,
    };
    fs.writeFileSync(
      path.join(dirPath, '_manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log('[backup] Manifest written');

    // Compress to .tar.gz
    console.log(`[backup] Compressing to ${archiveName}...`);
    execSync(`tar -czf "${archivePath}" -C "${BACKUPS_ROOT}" "${dirName}"`, {
      stdio: 'inherit',
    });
    console.log(`[backup] Archive created: ${archivePath}`);

    // Clean up uncompressed directory
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log('[backup] Temporary directory removed');

    // Prune old backups
    cleanOldBackups();

    // Final summary
    console.log('[backup] Backup complete.');
    console.log('[backup] Summary:');
    for (const [table, count] of Object.entries(summary)) {
      console.log(`  ${table}: ${count} ${typeof count === 'number' ? 'rows' : ''}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backup] FATAL:', err.message);
  process.exit(1);
});
