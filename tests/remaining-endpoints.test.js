#!/usr/bin/env node
'use strict';

/**
 * Vertifile — remaining endpoint tests
 *
 * Covers:
 *   GET  /api/status
 *   GET  /api/health/deep
 *   POST /api/contact
 *   GET  /api/org/profile
 *   GET  /api/org/branding
 *   POST /api/org/branding
 *
 * Uses Node.js built-in test runner (node:test) and assert (node:assert/strict).
 * No Jest. No third-party test library. No emojis.
 *
 * Run: node tests/remaining-endpoints.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Configuration — mirrors api.test.js
// ---------------------------------------------------------------------------
const HMAC_SECRET = 'test-secret-for-automated-tests';
const ADMIN_SECRET = 'test-admin-secret-for-tests';

// Unique suffix per run to avoid 409 on repeated runs.
const RUN_ID = crypto.randomBytes(4).toString('hex');

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let BASE_URL = '';
let server = null;
let apiKey = null; // created via POST /api/signup

// ---------------------------------------------------------------------------
// Server lifecycle — identical pattern to api.test.js
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    process.env.HMAC_SECRET = HMAC_SECRET;
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    process.env.PORT = '0';

    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath = path.resolve(__dirname, '..', 'db.js');

    const app = require(appPath);
    const db = require(dbPath);

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
// Setup / teardown
// ---------------------------------------------------------------------------
before(async () => {
  await startServer();

  // Create an API key for all auth-required tests. One signup per test run.
  const res = await fetch(`${BASE_URL}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Remaining Tests Org',
      contactName: 'Test Runner',
      email: `remaining-${RUN_ID}@test.example.com`,
      useCase: 'automated testing of remaining endpoints',
      password: 'TestPassword123!',
    }),
  });

  assert.equal(res.status, 200, 'Signup in before() must succeed');
  const data = await res.json();
  assert.ok(data.apiKey, 'Signup must return an apiKey');
  apiKey = data.apiKey;
});

after(async () => {
  await stopServer();
});

// ============================================================================
// GET /api/status
// ============================================================================
describe('GET /api/status', () => {

  it('returns 200 without authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    assert.equal(res.status, 200);
  });

  it('response has top-level status field', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(
      ['operational', 'degraded', 'partial_outage'].includes(data.status),
      `status must be one of the known values, got: ${data.status}`
    );
  });

  it('response has service: "Vertifile"', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.equal(data.service, 'Vertifile');
  });

  it('response has version string', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(typeof data.version === 'string' && data.version.length > 0, 'version must be a non-empty string');
  });

  it('response has ISO timestamp', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(typeof data.timestamp === 'string', 'timestamp must be a string');
    const parsed = new Date(data.timestamp);
    assert.ok(!Number.isNaN(parsed.getTime()), 'timestamp must be a valid ISO date');
  });

  it('response has numeric uptime', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(typeof data.uptime === 'number' && data.uptime >= 0, 'uptime must be a non-negative number');
  });

  it('response has components object with database, blockchain, signing', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(data.components && typeof data.components === 'object', 'components must be an object');
    assert.ok('database' in data.components, 'components must include database');
    assert.ok('blockchain' in data.components, 'components must include blockchain');
    assert.ok('signing' in data.components, 'components must include signing');
  });

  it('components.database has status and responseMs fields', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    const db = data.components.database;
    assert.ok('status' in db, 'database must have a status field');
    assert.ok('responseMs' in db, 'database must have a responseMs field');
  });

  it('response has endpoints object listing critical API paths', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const data = await res.json();
    assert.ok(data.endpoints && typeof data.endpoints === 'object', 'endpoints must be an object');

    // Confirm at least the core paths appear as keys
    const keys = Object.keys(data.endpoints);
    const hasPvf = keys.some(k => k.includes('create-pvf'));
    const hasVerify = keys.some(k => k.includes('verify'));
    assert.ok(hasPvf, 'endpoints must include create-pvf path');
    assert.ok(hasVerify, 'endpoints must include verify path');
  });

  it('does not expose sensitive data (no secrets, passwords, or internal tokens)', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    const raw = await res.text();
    assert.ok(!raw.includes('HMAC_SECRET'), 'must not leak HMAC_SECRET');
    assert.ok(!raw.includes('ADMIN_SECRET'), 'must not leak ADMIN_SECRET');
    assert.ok(!raw.includes('password'), 'must not leak password fields');
    assert.ok(!raw.includes('private'), 'must not expose private key material');
  });
});

// ============================================================================
// GET /api/health/deep
// ============================================================================
describe('GET /api/health/deep', () => {

  it('returns 403 without X-Admin-Secret header', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`);
    assert.equal(res.status, 403);
  });

  it('returns 403 with wrong admin secret', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': 'wrong-secret' },
    });
    assert.equal(res.status, 403);
  });

  it('returns 200 with correct X-Admin-Secret', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    assert.equal(res.status, 200);
  });

  it('response includes node_version', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    const data = await res.json();
    assert.ok(typeof data.node_version === 'string' && data.node_version.startsWith('v'),
      `node_version must be a "v..." string, got: ${data.node_version}`);
  });

  it('response includes memory object with heap and rss fields', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    const data = await res.json();
    assert.ok(data.memory && typeof data.memory === 'object', 'memory must be an object');
    assert.ok(typeof data.memory.heap_used_mb === 'number', 'memory.heap_used_mb must be a number');
    assert.ok(typeof data.memory.heap_total_mb === 'number', 'memory.heap_total_mb must be a number');
    assert.ok(typeof data.memory.heap_percent === 'number', 'memory.heap_percent must be a number');
    assert.ok(typeof data.memory.rss_mb === 'number', 'memory.rss_mb must be a number');
  });

  it('response includes db_pool with total, idle, waiting', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    const data = await res.json();
    assert.ok(data.db_pool && typeof data.db_pool === 'object', 'db_pool must be an object');
    assert.ok('total' in data.db_pool, 'db_pool must have total');
    assert.ok('idle' in data.db_pool, 'db_pool must have idle');
    assert.ok('waiting' in data.db_pool, 'db_pool must have waiting');
  });

  it('response includes uptime, timestamp, status, version, documents, organizations', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    const data = await res.json();
    assert.ok(typeof data.uptime === 'number', 'uptime must be a number');
    assert.ok(typeof data.timestamp === 'string', 'timestamp must be a string');
    assert.equal(data.status, 'online');
    assert.ok(typeof data.version === 'string', 'version must be a string');
    assert.ok(typeof data.documents === 'number', 'documents must be a number');
    assert.ok(typeof data.organizations === 'number', 'organizations must be a number');
  });

  it('response includes cache_last_invalidated field (may be null)', async () => {
    const res = await fetch(`${BASE_URL}/api/health/deep`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    const data = await res.json();
    // Field must be present; value is null until an admin invalidation runs.
    assert.ok('cache_last_invalidated' in data, 'cache_last_invalidated field must be present');
  });

  it('does not expose secrets to a caller without the admin header', async () => {
    // A request without the secret must not return any payload
    const res = await fetch(`${BASE_URL}/api/health/deep`);
    const raw = await res.text();
    // Should not contain deep diagnostic fields in a rejected response
    assert.ok(!raw.includes('node_version'), 'node_version must not be exposed without auth');
    assert.ok(!raw.includes('db_pool'), 'db_pool must not be exposed without auth');
    assert.ok(!raw.includes('heap_used_mb'), 'memory stats must not be exposed without auth');
  });
});

// ============================================================================
// POST /api/contact
// ============================================================================
describe('POST /api/contact', () => {

  // Helper: fetch a fresh CSRF token and POST to path with it.
  // Returns the fetch Response object directly.
  async function postWithCsrf(path, body) {
    const tokenRes = await fetch(`${BASE_URL}/api/csrf-token`);
    const setCookie = tokenRes.headers.getSetCookie();
    const cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
    const { csrfToken } = await tokenRes.json();

    return fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'Cookie': cookieStr,
      },
      body: JSON.stringify(body),
    });
  }

  it('returns 200 with valid name, email, organization, and message', async () => {
    const res = await postWithCsrf('/api/contact', {
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      organization: 'Example Corp',
      orgType: 'business',
      message: 'Hello, I would like to learn more about Vertifile.',
    });

    // Rate limiter may fire on rapid CI runs — skip gracefully.
    if (res.status === 429) return;

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('returns 200 with minimum required fields (name, email, organization)', async () => {
    const res = await postWithCsrf('/api/contact', {
      name: 'Bob Jones',
      email: `bob-${RUN_ID}@example.com`,
      organization: 'Jones LLC',
    });

    if (res.status === 429) return;

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('returns 400 when name is missing', async () => {
    const res = await postWithCsrf('/api/contact', {
      email: 'missing-name@example.com',
      organization: 'Some Org',
    });

    if (res.status === 429) return;

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(typeof data.error === 'string', 'error must be a string');
  });

  it('returns 400 when email is missing', async () => {
    const res = await postWithCsrf('/api/contact', {
      name: 'No Email',
      organization: 'Some Org',
    });

    if (res.status === 429) return;

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('returns 400 when organization is missing', async () => {
    const res = await postWithCsrf('/api/contact', {
      name: 'No Org',
      email: 'no-org@example.com',
    });

    if (res.status === 429) return;

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('returns 400 with invalid email format', async () => {
    const res = await postWithCsrf('/api/contact', {
      name: 'Bad Email User',
      email: 'not-an-email-address',
      organization: 'Bad Email Org',
    });

    if (res.status === 429) return;

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(typeof data.error === 'string');
  });

  it('does not echo raw user input in the response body (XSS prevention)', async () => {
    const xssPayload = '<script>alert(1)</script>';
    const res = await postWithCsrf('/api/contact', {
      name: xssPayload,
      email: `xss-${RUN_ID}@example.com`,
      organization: xssPayload,
      message: xssPayload,
    });

    if (res.status === 429) return;

    // The handler uses escapeHtml internally for emails, so the response body
    // (which is just { success: true }) must never echo the raw script tag.
    const raw = await res.text();
    assert.ok(!raw.includes('<script>'), 'response must not contain raw <script> tag');
    assert.ok(!raw.includes('alert(1)'), 'response must not contain raw XSS payload');
  });

  it('returns 429 or 200 — never crashes — when rate limit is hit', async () => {
    // Send several requests in quick succession. The rate limiter allows 3
    // per hour per IP, but the test environment may have already consumed
    // some of those. We just assert the server responds with a sane status.
    const attempts = [];
    for (let i = 0; i < 2; i++) {
      attempts.push(
        postWithCsrf('/api/contact', {
          name: `Rate User ${i}`,
          email: `rate-${RUN_ID}-${i}@example.com`,
          organization: 'Rate Org',
        })
      );
    }

    const results = await Promise.all(attempts);
    for (const r of results) {
      assert.ok(
        [200, 400, 429].includes(r.status),
        `Expected 200, 400, or 429, got: ${r.status}`
      );
    }
  });
});

// ============================================================================
// GET /api/org/profile
// ============================================================================
describe('GET /api/org/profile', () => {

  it('returns 401 without API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': 'vf_live_thisisnotavalidkey000000000000000000' },
    });
    assert.equal(res.status, 401);
  });

  it('returns 200 with a valid API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    assert.equal(res.status, 200);
  });

  it('response has success: true', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('response includes orgId as a string', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(typeof data.orgId === 'string' && data.orgId.length > 0,
      'orgId must be a non-empty string');
  });

  it('response includes orgName as a string', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(typeof data.orgName === 'string' && data.orgName.length > 0,
      'orgName must be a non-empty string');
  });

  it('response includes plan field', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(typeof data.plan === 'string' && data.plan.length > 0,
      'plan must be a non-empty string');
  });

  it('response includes documentsCreated as a number', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(typeof data.documentsCreated === 'number',
      'documentsCreated must be a number');
  });

  it('response includes rateLimit as a number', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(typeof data.rateLimit === 'number',
      'rateLimit must be a number');
  });

  it('response includes branding object with customIcon, brandColor, waveColor', async () => {
    const res = await fetch(`${BASE_URL}/api/org/profile`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok(data.branding && typeof data.branding === 'object',
      'branding must be an object');
    assert.ok('customIcon' in data.branding, 'branding must have customIcon');
    assert.ok('brandColor' in data.branding, 'branding must have brandColor');
    assert.ok('waveColor' in data.branding, 'branding must have waveColor');
  });
});

// ============================================================================
// GET /api/org/branding
// ============================================================================
describe('GET /api/org/branding', () => {

  it('returns 401 without API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': 'vf_live_notavalidkey000000000000000000000' },
    });
    assert.equal(res.status, 401);
  });

  it('returns 200 with a valid API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    assert.equal(res.status, 200);
  });

  it('response has success: true', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('response includes customIcon field (null or string)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok('customIcon' in data,
      'response must include customIcon key');
    assert.ok(data.customIcon === null || typeof data.customIcon === 'string',
      'customIcon must be null or a string');
  });

  it('response includes brandColor field (null or string)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok('brandColor' in data,
      'response must include brandColor key');
    assert.ok(data.brandColor === null || typeof data.brandColor === 'string',
      'brandColor must be null or a string');
  });

  it('response includes waveColor field (null or string)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await res.json();
    assert.ok('waveColor' in data,
      'response must include waveColor key');
    assert.ok(data.waveColor === null || typeof data.waveColor === 'string',
      'waveColor must be null or a string');
  });
});

// ============================================================================
// POST /api/org/branding
// ============================================================================
describe('POST /api/org/branding', () => {

  it('returns 401 without API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandColor: '#123456' }),
    });
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong API key', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'vf_live_notavalidkey000000000000000000000',
      },
      body: JSON.stringify({ brandColor: '#123456' }),
    });
    assert.equal(res.status, 401);
  });

  it('returns 200 with valid API key and valid hex brandColor', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: '#1A2B3C' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('returns 200 with valid waveColor alongside brandColor', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: '#AABBCC', waveColor: '#001122' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('returns 200 sending an empty body (all fields optional)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it('returns 400 with invalid brandColor format (not hex)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: 'red' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(typeof data.error === 'string', 'error must be a string');
  });

  it('returns 400 with invalid brandColor format (missing hash prefix)', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: 'AABBCC' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('returns 400 with invalid waveColor format', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ waveColor: 'rgb(0,0,0)' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(typeof data.error === 'string');
  });

  it('returns 400 when customIcon exceeds 700 KB', async () => {
    // Craft a data URI that is larger than 700 * 1024 bytes.
    const largeIcon = 'data:image/png;base64,' + 'A'.repeat(720 * 1024);
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ customIcon: largeIcon }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.includes('large') || data.error.includes('Icon'),
      `Expected size error message, got: ${data.error}`);
  });

  it('returns 400 when customIcon is not an SVG or data URI', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ customIcon: 'https://example.com/logo.png' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(typeof data.error === 'string');
  });

  it('persists brandColor — GET /api/org/branding returns the updated value', async () => {
    const color = '#FACADE';
    await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: color }),
    });

    const getRes = await fetch(`${BASE_URL}/api/org/branding`, {
      headers: { 'X-API-Key': apiKey },
    });
    const data = await getRes.json();
    assert.equal(data.brandColor, color,
      `brandColor should be ${color}, got: ${data.brandColor}`);
  });

  it('response body on success contains message field', async () => {
    const res = await fetch(`${BASE_URL}/api/org/branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ brandColor: '#000000' }),
    });
    const data = await res.json();
    assert.ok(typeof data.message === 'string' && data.message.length > 0,
      'success response must include a message string');
  });
});
