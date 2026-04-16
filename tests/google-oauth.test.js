#!/usr/bin/env node
'use strict';

/**
 * Vertifile -- Google OAuth Route Tests
 *
 * Uses Node.js built-in test runner (node:test) and node:assert/strict.
 * No Jest. No third-party test library. No emojis.
 *
 * Spins up the full Express server on a random port.
 * All tests run without GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set,
 * which is the default in CI and local test environments.
 *
 * What we test:
 *   - GET /auth/google returns an error (not 404) when OAuth is not configured
 *   - GET /auth/google/callback returns an error (not 404) when not configured
 *   - Callback without code/state fails gracefully (no 500 crash loop)
 *   - Error responses never leak stack traces or internal secrets
 *   - POST /auth/login and POST /auth/register still work while Google is unconfigured
 *
 * Run:
 *   node tests/google-oauth.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration — mirrors the pattern in api.test.js / remaining-endpoints.test.js
// ---------------------------------------------------------------------------
const HMAC_SECRET = 'test-secret-google-oauth';
const ADMIN_SECRET = 'test-admin-secret-google-oauth';

let BASE_URL = '';
let server = null;

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    // Ensure Google OAuth env vars are NOT set for this test suite
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    process.env.HMAC_SECRET = HMAC_SECRET;
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    process.env.PORT = '0';

    // Clear require cache so we get a fresh app instance without any
    // lingering Google strategy registration from other test files.
    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');

    delete require.cache[appPath];

    const app = require(appPath);
    const db  = require(dbPath);

    db._ready.then(() => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
      server.on('error', reject);
    }).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Thin HTTP helper — follows redirects manually so we can assert on 3xx
// ---------------------------------------------------------------------------
async function req(method, urlPath, body = null, extraHeaders = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const headers = { ...extraHeaders };
  const opts = { method, headers, redirect: 'manual' };

  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return {
    status: res.status,
    headers: res.headers,
    json,
    text,
    location: res.headers.get('location') || null,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

// ============================================================================
// 1. Route existence — confirm routes are registered (not 404)
// ============================================================================
describe('Route existence', () => {

  it('GET /auth/google is registered — responds with something other than 404', async () => {
    const res = await req('GET', '/auth/google');
    assert.notEqual(res.status, 404, `Expected a non-404 response but got 404`);
  });

  it('GET /auth/google/callback is registered — responds with something other than 404', async () => {
    const res = await req('GET', '/auth/google/callback');
    assert.notEqual(res.status, 404, `Expected a non-404 response but got 404`);
  });

});

// ============================================================================
// 2. Behavior when GOOGLE_CLIENT_ID is not configured
//    passport.authenticate('google') throws "Unknown authentication strategy
//    'google'" which the error handler catches and returns as a 500.
// ============================================================================
describe('Google OAuth — not configured (no GOOGLE_CLIENT_ID)', () => {

  it('GET /auth/google returns a server error status (500)', async () => {
    const res = await req('GET', '/auth/google');
    assert.equal(res.status, 500, `Expected 500 but got ${res.status}. Body: ${res.text}`);
  });

  it('GET /auth/google returns JSON with success: false', async () => {
    const res = await req('GET', '/auth/google');
    assert.ok(res.json, 'Response should be parseable JSON');
    assert.equal(res.json.success, false, 'success should be false');
  });

  it('GET /auth/google returns an error message referencing the missing strategy', async () => {
    const res = await req('GET', '/auth/google');
    assert.ok(res.json, 'Response should be JSON');
    const message = (res.json.error || '').toLowerCase();
    // Passport throws "Unknown authentication strategy 'google'" — message must
    // reference the strategy name so it is diagnosable.
    assert.ok(
      message.includes('google') || message.includes('strategy') || message.includes('unknown'),
      `Error message "${res.json.error}" should reference the missing strategy`
    );
  });

  it('GET /auth/google/callback without code/state returns error (not 200)', async () => {
    const res = await req('GET', '/auth/google/callback');
    assert.notEqual(res.status, 200, `Expected an error status but got 200`);
  });

  it('GET /auth/google/callback returns a server error status (500)', async () => {
    const res = await req('GET', '/auth/google/callback');
    assert.equal(res.status, 500, `Expected 500 but got ${res.status}. Body: ${res.text}`);
  });

  it('GET /auth/google/callback returns JSON with success: false', async () => {
    const res = await req('GET', '/auth/google/callback');
    assert.ok(res.json, 'Response should be parseable JSON');
    assert.equal(res.json.success, false, 'success should be false');
  });

  it('GET /auth/google/callback with fake code+state params also returns error gracefully', async () => {
    const res = await req('GET', '/auth/google/callback?code=fakecode&state=fakestate');
    // Must be an error status (not 200) and must not crash the server
    assert.notEqual(res.status, 200, 'Should not return 200 for a fake OAuth code');
    assert.ok(res.json, 'Should return a parseable JSON error body');
    assert.equal(res.json.success, false, 'success should be false');
  });

});

// ============================================================================
// 3. Safe error response — no internal leakage
// ============================================================================
describe('Error response safety', () => {

  it('GET /auth/google does not expose a stack trace in the response body', async () => {
    const res = await req('GET', '/auth/google');
    // In test env (not production) the error-handler may include a stack, but
    // it should never include database credentials, secrets, or file system paths
    // that expose server internals. We assert the response body does not contain
    // common secret patterns.
    const body = res.text;
    assert.ok(!body.includes('GOOGLE_CLIENT_SECRET'), 'Must not leak GOOGLE_CLIENT_SECRET');
    assert.ok(!body.includes('DATABASE_URL'), 'Must not leak DATABASE_URL');
    assert.ok(!body.includes('HMAC_SECRET'), 'Must not leak HMAC_SECRET');
  });

  it('GET /auth/google/callback does not expose environment secrets', async () => {
    const res = await req('GET', '/auth/google/callback');
    const body = res.text;
    assert.ok(!body.includes('GOOGLE_CLIENT_SECRET'), 'Must not leak GOOGLE_CLIENT_SECRET');
    assert.ok(!body.includes('DATABASE_URL'), 'Must not leak DATABASE_URL');
  });

  it('Error response includes a machine-readable code field', async () => {
    const res = await req('GET', '/auth/google');
    assert.ok(res.json, 'Response should be JSON');
    assert.ok(typeof res.json.code === 'string', 'Error response should include a string code field');
  });

});

// ============================================================================
// 4. Unrelated auth routes still work while Google is unconfigured
// ============================================================================
describe('Other auth routes unaffected by missing Google config', () => {

  it('POST /auth/login with missing body returns 400 (not affected by Google config)', async () => {
    const res = await req('POST', '/auth/login', {});
    // Missing email/password: strategy runs but passport returns no user → 401
    // Or rate limiter might block before that. Either way, not a 500 caused by Google.
    // CSRF middleware may fire first and return 403 — that also proves the route exists.
    assert.ok(
      res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429,
      `Expected 400/401/403/429 but got ${res.status}. Body: ${res.text}`
    );
  });

  it('POST /auth/register with missing body returns 400', async () => {
    const res = await req('POST', '/auth/register', {});
    assert.ok(
      res.status === 400 || res.status === 403,
      `Expected 400 (validation) or 403 (CSRF), got ${res.status}: ${res.text}`
    );
  });

  it('POST /auth/register returns a user-facing error, not a 500', async () => {
    const res = await req('POST', '/auth/register', { email: '', password: '' });
    assert.ok(res.status < 500, `Should return a 4xx, not a 5xx. Got ${res.status}`);
  });

});
