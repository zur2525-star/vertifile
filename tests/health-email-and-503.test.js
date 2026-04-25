#!/usr/bin/env node
'use strict';

/**
 * Vertifile -- Email Service Health + send-code 503 Failure Path
 * =================================================================
 * Backend: Moshe
 *
 * Tests:
 *   POST /api/auth/send-code     -> 503 when SMTP is not configured
 *   GET  /api/health/email       -> admin-only, reports configured:false
 *                                   and never leaks SMTP_PASS
 *
 * These tests deliberately clear SMTP_HOST/PORT/USER/PASS *before* requiring
 * server.js so the lazy-initialized email transporter sees an empty config.
 *
 * Run:
 *   DATABASE_URL="..." ADMIN_SECRET="..." node --test tests/health-email-and-503.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  console.log('[SKIP] DATABASE_URL not set -- skipping health-email-and-503 tests');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Force SMTP-not-configured BEFORE server load.
// services/email.js reads these on first send via getTransporter().
// ---------------------------------------------------------------------------
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
// SMTP_FROM is informational only — leave it untouched.

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-admin-secret-for-tests';
process.env.ADMIN_SECRET = ADMIN_SECRET;

let BASE_URL = '';
let server = null;

function startServer() {
  return new Promise((resolve, reject) => {
    process.env.PORT = '0';
    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');
    const app = require(appPath);
    const db  = require(dbPath);
    db._ready.then(() => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
      server.on('error', reject);
    }).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => server ? server.close(() => resolve()) : resolve());
}

async function get(p, headers = {}) {
  const res = await fetch(`${BASE_URL}${p}`, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

async function post(p, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

// ============================================================================
// 1. send-code returns 503 when SMTP unavailable
// ============================================================================

describe('POST /api/auth/send-code -- SMTP unavailable', () => {
  it('returns 503 with email_service_unavailable when SMTP not configured', async () => {
    const email = `e2e-503-${Date.now().toString(36)}@test.vertifile.com`;
    const res = await post('/api/auth/send-code', { email });

    assert.equal(res.status, 503, `Expected 503, got ${res.status}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.success, false);
    assert.equal(res.json.error, 'email_service_unavailable');
    assert.ok(typeof res.json.message === 'string' && res.json.message.length > 0,
      'Should include a user-friendly message');

    // Defense-in-depth: response must not leak SMTP internals.
    const blob = JSON.stringify(res.json).toLowerCase();
    assert.ok(!blob.includes('smtp_host'), 'must not leak SMTP_HOST key');
    assert.ok(!blob.includes('smtp_pass'), 'must not leak SMTP_PASS key');
    assert.ok(!blob.includes('nodemailer'), 'must not leak transport-library names');
  });
});

// ============================================================================
// 2. GET /api/health/email shape + admin gate
// ============================================================================

describe('GET /api/health/email', () => {
  it('rejects unauthenticated requests with 403', async () => {
    const res = await get('/api/health/email');
    assert.equal(res.status, 403, `Expected 403 without admin secret, got ${res.status}`);
  });

  it('returns expected JSON shape for admin when SMTP not configured', async () => {
    const res = await get('/api/health/email', { 'X-Admin-Secret': ADMIN_SECRET });

    assert.equal(res.status, 200);
    assert.equal(typeof res.json.configured, 'boolean');
    assert.equal(typeof res.json.verified, 'boolean');
    assert.equal(res.json.configured, false, 'configured must be false when SMTP env missing');
    assert.equal(res.json.verified, false, 'verified must be false when configured is false');
    assert.equal(res.json.error, 'smtp_not_configured');
    // host/port/from must be present (may be null/string/number).
    assert.ok('host' in res.json, 'response must include host field');
    assert.ok('port' in res.json, 'response must include port field');
    assert.ok('from' in res.json, 'response must include from field');

    // Critical: must NEVER expose SMTP_PASS or any auth value.
    const blob = JSON.stringify(res.json).toLowerCase();
    assert.ok(!blob.includes('pass'), `response must not include "pass": ${JSON.stringify(res.json)}`);
    assert.ok(!blob.includes('secret'), `response must not include "secret": ${JSON.stringify(res.json)}`);
  });
});
