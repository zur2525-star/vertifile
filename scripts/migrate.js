#!/usr/bin/env node

/**
 * Vertifile — Migration Runner
 *
 * Reads every *.sql file from /migrations/ in sorted (lexicographic) order
 * and executes them against the PostgreSQL database.
 *
 * Usage:
 *   DATABASE_URL=postgres://… node scripts/migrate.js
 *
 * Notes:
 *   - All migration files MUST be idempotent (CREATE IF NOT EXISTS, etc.)
 *     because we do not track a "migrations" table — every file runs on
 *     every invocation.
 *   - Files are sorted by name, so prefix with 001_, 002_, etc.
 *   - Exits 0 on success, 1 on any failure.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// ------------------------------------------------------------------ helpers

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function logError(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  process.stderr.write(`[${ts}] ERROR: ${msg}\n`);
}

// ------------------------------------------------------------------ main

async function main() {
  if (!process.env.DATABASE_URL) {
    logError('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  // Verify connectivity
  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    log(`Connected to database: ${rows[0].db}`);
  } catch (e) {
    logError(`Cannot connect to database: ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  // Collect .sql files
  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort(); // lexicographic — 001_users.sql, onboarding.sql, etc.
  } catch (e) {
    logError(`Cannot read migrations directory (${MIGRATIONS_DIR}): ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  if (files.length === 0) {
    log('No .sql files found in migrations/. Nothing to do.');
    await pool.end();
    process.exit(0);
  }

  log(`Found ${files.length} migration file(s): ${files.join(', ')}`);

  let succeeded = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    let sql;
    try {
      sql = fs.readFileSync(filePath, 'utf8').trim();
    } catch (e) {
      logError(`Cannot read ${file}: ${e.message}`);
      failed++;
      continue;
    }

    if (!sql) {
      log(`  SKIP  ${file} (empty)`);
      continue;
    }

    const start = Date.now();
    try {
      await pool.query(sql);
      const ms = Date.now() - start;
      log(`  OK    ${file} (${ms}ms)`);
      succeeded++;
    } catch (e) {
      const ms = Date.now() - start;
      logError(`  FAIL  ${file} (${ms}ms): ${e.message}`);
      failed++;
      // Continue to next file — migrations should be independent
    }
  }

  log(`\nDone. ${succeeded} succeeded, ${failed} failed out of ${files.length} total.`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  logError(`Unexpected error: ${e.message}`);
  process.exit(1);
});
