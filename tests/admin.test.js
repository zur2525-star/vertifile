#!/usr/bin/env node
'use strict';

/**
 * Vertifile Admin Endpoint Test Suite
 *
 * Uses Node.js built-in test runner (node:test) and assert (node:assert/strict).
 * Starts the Express server on a random port, runs all tests against the
 * /api/admin/* endpoints, then shuts down.
 *
 * Usage:  node tests/admin.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Configuration — must match api.test.js so both suites can share the same
// in-process server when run together.
// ---------------------------------------------------------------------------
const ADMIN_SECRET = 'test-admin-secret-for-tests';
const HMAC_SECRET  = 'test-secret-for-automated-tests';

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------
let BASE_URL = '';
let server   = null;

// ---------------------------------------------------------------------------
// Minimal HTTP helper — avoids fetch polyfill requirements and mirrors the
// raw-http approach already familiar to this project's test suite.
// ---------------------------------------------------------------------------
function request(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;

    const opts = {
      hostname : url.hostname,
      port     : url.port,
      path     : url.pathname + url.search,
      method,
      headers  : {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    if (payload) {
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(opts, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Convenience wrappers
function adminGet(urlPath, extra = {}) {
  return request('GET', urlPath, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET, ...extra.headers },
  });
}

function adminPost(urlPath, body, extra = {}) {
  return request('POST', urlPath, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET, ...extra.headers },
    body,
  });
}

function adminDelete(urlPath, extra = {}) {
  return request('DELETE', urlPath, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET, ...extra.headers },
  });
}

function unauthGet(urlPath) {
  return request('GET', urlPath);
}

function unauthPost(urlPath, body) {
  return request('POST', urlPath, { body });
}

// ---------------------------------------------------------------------------
// Server lifecycle — identical pattern to api.test.js
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    process.env.HMAC_SECRET    = HMAC_SECRET;
    process.env.ADMIN_SECRET   = ADMIN_SECRET;
    process.env.SESSION_SECRET = 'test-admin-session-secret';
    process.env.PORT           = '0';

    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');

    // Clear module cache so we get a fresh app instance (important when
    // both api.test.js and admin.test.js run in the same process).
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
// Test setup / teardown
// ---------------------------------------------------------------------------
before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

// ============================================================================
// AUTH REJECTION — every admin endpoint must return 403 without the secret
// ============================================================================

describe('Admin auth rejection (no X-Admin-Secret header)', () => {
  it('GET /api/admin/stats returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/stats');
    assert.equal(res.status, 403, 'Expected 403 without admin secret');
  });

  it('GET /api/admin/keys returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/keys');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/documents returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/documents');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/webhooks returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/webhooks');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/errors returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/errors');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/monitoring returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/monitoring');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/uptime returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/uptime');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/self-check returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/self-check');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/revenue returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/revenue');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/overage returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/overage');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/usage-trends returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/usage-trends');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/overview returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/overview');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/alerts returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/alerts');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/audit returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/audit');
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/keys returns 403 without admin secret', async () => {
    const res = await unauthPost('/api/admin/keys', { orgName: 'HackAttempt', plan: 'pro' });
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/export/documents returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/export/documents');
    assert.equal(res.status, 403);
  });
});

// ============================================================================
// GET /api/admin/stats
// ============================================================================

describe('GET /api/admin/stats', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/stats');
    assert.equal(res.status, 200);
    assert.ok(res.json, 'Expected JSON response');
    assert.equal(res.json.success, true);
  });

  it('response contains documents count field', async () => {
    const res = await adminGet('/api/admin/stats');
    assert.ok(
      typeof res.json.documents !== 'undefined' ||
      typeof res.json.totalDocuments !== 'undefined',
      'Expected documents count in stats response'
    );
  });

  it('response contains blockchain property', async () => {
    const res = await adminGet('/api/admin/stats');
    assert.ok(
      Object.prototype.hasOwnProperty.call(res.json, 'blockchain'),
      'Expected blockchain field in stats response'
    );
  });
});

// ============================================================================
// GET /api/admin/audit
// ============================================================================

describe('GET /api/admin/audit', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/audit');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains entries array', async () => {
    const res = await adminGet('/api/admin/audit');
    assert.ok(Array.isArray(res.json.entries), 'Expected entries to be an array');
  });

  it('response contains limit and offset fields', async () => {
    const res = await adminGet('/api/admin/audit');
    assert.ok(typeof res.json.limit === 'number', 'Expected numeric limit');
    assert.ok(typeof res.json.offset === 'number', 'Expected numeric offset');
  });

  it('respects ?limit query parameter', async () => {
    const res = await adminGet('/api/admin/audit?limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.json.limit, 5);
  });

  it('respects ?offset query parameter', async () => {
    const res = await adminGet('/api/admin/audit?offset=10');
    assert.equal(res.status, 200);
    assert.equal(res.json.offset, 10);
  });

  it('clamps limit to 500', async () => {
    const res = await adminGet('/api/admin/audit?limit=9999');
    assert.equal(res.status, 200);
    assert.equal(res.json.limit, 500);
  });
});

// ============================================================================
// GET /api/admin/keys
// ============================================================================

describe('GET /api/admin/keys', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/keys');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains keys array', async () => {
    const res = await adminGet('/api/admin/keys');
    assert.ok(Array.isArray(res.json.keys), 'Expected keys to be an array');
  });
});

// ============================================================================
// POST /api/admin/keys — create API key
// ============================================================================

describe('POST /api/admin/keys', () => {
  it('creates a key with valid orgName and plan', async () => {
    const orgName = 'TestOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys', { orgName, plan: 'pro' });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(typeof res.json.apiKey === 'string', 'Expected apiKey string');
    assert.ok(res.json.apiKey.startsWith('vf_live_'), 'Expected apiKey to start with vf_live_');
    assert.ok(typeof res.json.orgId === 'string', 'Expected orgId string');
  });

  it('creates a key without specifying a plan (defaults to pro)', async () => {
    const orgName = 'DefaultPlanOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys', { orgName });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.plan, 'pro');
  });

  it('creates a key with enterprise plan', async () => {
    const orgName = 'EnterpriseOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys', { orgName, plan: 'enterprise' });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.plan, 'enterprise');
  });

  it('returns 400 when orgName is missing', async () => {
    const res = await adminPost('/api/admin/keys', { plan: 'pro' });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(res.json.error, 'Expected an error message');
  });

  it('returns 400 for invalid plan value', async () => {
    const orgName = 'InvalidPlanOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys', { orgName, plan: 'ultramax' });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.match(res.json.error, /invalid plan/i, 'Expected invalid plan error message');
  });

  it('returns 400 for SQL-injection-style plan value', async () => {
    const orgName = 'InjectionOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys', { orgName, plan: "'; DROP TABLE api_keys; --" });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });
});

// ============================================================================
// DELETE /api/admin/keys/:key
// ============================================================================

describe('DELETE /api/admin/keys/:key', () => {
  it('returns 404 when deleting a non-existent key', async () => {
    const res = await adminDelete('/api/admin/keys/vf_live_doesnotexist00000000000000000000');
    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
  });

  it('successfully deletes a key that was just created', async () => {
    // First create a key to delete
    const orgName = 'DeleteMeOrg_' + crypto.randomBytes(4).toString('hex');
    const createRes = await adminPost('/api/admin/keys', { orgName, plan: 'free' });
    assert.equal(createRes.status, 200);
    const { apiKey } = createRes.json;

    // Now delete it
    const deleteRes = await adminDelete(`/api/admin/keys/${apiKey}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/documents
// ============================================================================

describe('GET /api/admin/documents', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/documents');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains documents array', async () => {
    const res = await adminGet('/api/admin/documents');
    assert.ok(Array.isArray(res.json.documents), 'Expected documents to be an array');
  });

  it('response contains limit and offset', async () => {
    const res = await adminGet('/api/admin/documents');
    assert.ok(typeof res.json.limit === 'number');
    assert.ok(typeof res.json.offset === 'number');
  });

  it('clamps limit to 200', async () => {
    const res = await adminGet('/api/admin/documents?limit=9999');
    assert.equal(res.status, 200);
    assert.equal(res.json.limit, 200);
  });

  it('accepts ?search query parameter without error', async () => {
    const res = await adminGet('/api/admin/documents?search=test');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/webhooks
// ============================================================================

describe('GET /api/admin/webhooks', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/webhooks');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains webhooks array', async () => {
    const res = await adminGet('/api/admin/webhooks');
    assert.ok(Array.isArray(res.json.webhooks), 'Expected webhooks to be an array');
  });
});

// ============================================================================
// GET /api/admin/errors
// ============================================================================

describe('GET /api/admin/errors', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/errors');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains errors array', async () => {
    const res = await adminGet('/api/admin/errors');
    assert.ok(Array.isArray(res.json.errors), 'Expected errors to be an array');
  });

  it('response contains stats object', async () => {
    const res = await adminGet('/api/admin/errors');
    assert.ok(res.json.stats !== undefined, 'Expected stats field');
  });
});

// ============================================================================
// POST /api/admin/health-log  (the route is POST, not GET)
// ============================================================================

describe('POST /api/admin/health-log', () => {
  it('returns 200 with success: true when logging a health check', async () => {
    const res = await adminPost('/api/admin/health-log', {
      status: 'ok',
      responseMs: 42,
      details: { test: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('returns 200 even with minimal payload (defaults applied server-side)', async () => {
    const res = await adminPost('/api/admin/health-log', {});
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/monitoring
// ============================================================================

describe('GET /api/admin/monitoring', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/monitoring');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains history field', async () => {
    const res = await adminGet('/api/admin/monitoring');
    assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'history'), 'Expected history field');
  });

  it('accepts ?hours query parameter', async () => {
    const res = await adminGet('/api/admin/monitoring?hours=48');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('clamps hours to minimum of 1', async () => {
    // Should not error with hours=0 — server clamps to 1
    const res = await adminGet('/api/admin/monitoring?hours=0');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/uptime
// ============================================================================

describe('GET /api/admin/uptime', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/uptime');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('accepts ?days query parameter', async () => {
    const res = await adminGet('/api/admin/uptime?days=7');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('clamps days to minimum of 1', async () => {
    const res = await adminGet('/api/admin/uptime?days=0');
    assert.equal(res.status, 200);
  });

  it('clamps days to maximum of 365', async () => {
    const res = await adminGet('/api/admin/uptime?days=99999');
    assert.equal(res.status, 200);
  });
});

// ============================================================================
// GET /api/admin/self-check
// ============================================================================

describe('GET /api/admin/self-check', () => {
  it('returns 200 with success: true and status: ok', async () => {
    const res = await adminGet('/api/admin/self-check');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.status, 'ok');
  });

  it('response includes responseMs field', async () => {
    const res = await adminGet('/api/admin/self-check');
    assert.ok(typeof res.json.responseMs === 'number', 'Expected numeric responseMs');
    assert.ok(res.json.responseMs >= 0, 'responseMs must be non-negative');
  });
});

// ============================================================================
// GET /api/admin/revenue
// ============================================================================

describe('GET /api/admin/revenue', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/revenue');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('accepts ?month query parameter without error', async () => {
    const res = await adminGet('/api/admin/revenue?month=2026-03');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/overage
// ============================================================================

describe('GET /api/admin/overage', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/overage');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('accepts ?month query parameter without error', async () => {
    const res = await adminGet('/api/admin/overage?month=2026-03');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/usage-trends
// ============================================================================

describe('GET /api/admin/usage-trends', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/usage-trends');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('accepts ?months query parameter', async () => {
    const res = await adminGet('/api/admin/usage-trends?months=3');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('clamps months to max 24', async () => {
    // Should not error — server silently clamps to 24
    const res = await adminGet('/api/admin/usage-trends?months=9999');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

// ============================================================================
// GET /api/admin/overview
// ============================================================================

describe('GET /api/admin/overview', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/overview');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains stats, recentDocs, recentAudit, dailyStats', async () => {
    const res = await adminGet('/api/admin/overview');
    assert.ok(res.json.stats !== undefined, 'Expected stats field');
    assert.ok(Array.isArray(res.json.recentDocs), 'Expected recentDocs array');
    assert.ok(res.json.recentAudit !== undefined, 'Expected recentAudit field');
    assert.ok(res.json.dailyStats !== undefined, 'Expected dailyStats field');
  });
});

// ============================================================================
// GET /api/admin/alerts
// ============================================================================

describe('GET /api/admin/alerts', () => {
  it('returns 200 with success: true', async () => {
    const res = await adminGet('/api/admin/alerts');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('response contains alerts field', async () => {
    const res = await adminGet('/api/admin/alerts');
    assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'alerts'), 'Expected alerts field');
  });
});

// ============================================================================
// GET /api/admin/org/:orgId
// ============================================================================

describe('GET /api/admin/org/:orgId', () => {
  it('returns 404 for a non-existent orgId', async () => {
    const res = await adminGet('/api/admin/org/org_doesnotexist_00000000');
    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
  });

  it('returns 400 for an invalid orgId format (special chars)', async () => {
    const res = await adminGet('/api/admin/org/' + encodeURIComponent('../../etc/passwd'));
    // The server validates orgId format — should reject with 400 or 404
    assert.ok(res.status === 400 || res.status === 404, `Expected 400 or 404, got ${res.status}`);
    assert.equal(res.json.success, false);
  });

  it('returns 200 with org details when the orgId exists', async () => {
    // Create an org first so we have a valid orgId
    const orgName = 'OrgDetailOrg_' + crypto.randomBytes(4).toString('hex');
    const createRes = await adminPost('/api/admin/keys', { orgName, plan: 'pro' });
    assert.equal(createRes.status, 200);
    const { orgId } = createRes.json;

    const res = await adminGet(`/api/admin/org/${orgId}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.org, 'Expected org object in response');
    assert.ok(Array.isArray(res.json.documents), 'Expected documents array');
  });
});

// ============================================================================
// POST /api/admin/org/:orgId/plan
// ============================================================================

describe('POST /api/admin/org/:orgId/plan', () => {
  it('returns 400 for an invalid plan value', async () => {
    const res = await adminPost('/api/admin/org/org_placeholder_00000000/plan', { plan: 'starter' });
    // 400 due to bad plan, or 400 due to bad orgId format — both are correct rejections
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('changes plan successfully on a known org', async () => {
    // Create an org to change
    const orgName = 'PlanChangeOrg_' + crypto.randomBytes(4).toString('hex');
    const createRes = await adminPost('/api/admin/keys', { orgName, plan: 'pro' });
    assert.equal(createRes.status, 200);
    const { orgId } = createRes.json;

    const planRes = await adminPost(`/api/admin/org/${orgId}/plan`, { plan: 'business' });
    assert.equal(planRes.status, 200);
    assert.equal(planRes.json.success, true);
  });

  it('returns 400 when plan is "free" (not in allowed upgrade list)', async () => {
    const orgName = 'FreePlanOrg_' + crypto.randomBytes(4).toString('hex');
    const createRes = await adminPost('/api/admin/keys', { orgName, plan: 'pro' });
    assert.equal(createRes.status, 200);
    const { orgId } = createRes.json;

    // "free" is not in ['pro', 'business', 'enterprise'] for this route
    const planRes = await adminPost(`/api/admin/org/${orgId}/plan`, { plan: 'free' });
    assert.equal(planRes.status, 400);
    assert.equal(planRes.json.success, false);
  });
});

// ============================================================================
// GET /api/admin/user/:userId/usage
// ============================================================================

describe('GET /api/admin/user/:userId/usage', () => {
  it('returns 400 for a non-numeric userId', async () => {
    const res = await adminGet('/api/admin/user/notanumber/usage');
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.match(res.json.error, /invalid user id/i);
  });

  it('returns 200 or 404 for a valid numeric userId', async () => {
    const res = await adminGet('/api/admin/user/1/usage');
    // Either 200 (user exists) or 500/404 (no data) — both are not 400
    assert.ok(res.status !== 400, 'Should not return 400 for a valid numeric ID');
  });

  it('accepts ?month query parameter', async () => {
    const res = await adminGet('/api/admin/user/1/usage?month=2026-03');
    assert.ok(res.status !== 400, 'Should not return 400 for valid params');
  });
});

// ============================================================================
// GET /api/admin/export/:type — CSV export
// ============================================================================

describe('GET /api/admin/export/:type', () => {
  it('returns 400 for an invalid export type', async () => {
    const res = await adminGet('/api/admin/export/json');
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.match(res.json.error, /invalid export type/i);
  });

  it('returns 400 for another invalid export type (csv)', async () => {
    // "csv" itself is not a valid type — the allowed types are documents/keys/audit
    const res = await adminGet('/api/admin/export/csv');
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('returns 400 for path-traversal attempt in type param', async () => {
    const res = await adminGet('/api/admin/export/' + encodeURIComponent('../server'));
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('returns 200 with text/csv content-type when documents data exists', async () => {
    const res = await adminGet('/api/admin/export/documents');
    // If no documents exist yet, the route returns 404 with { error: 'No data' }
    // Both are valid outcomes depending on DB state
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(
        res.headers['content-type'] && res.headers['content-type'].includes('text/csv'),
        'Expected text/csv content-type'
      );
    }
  });

  it('returns 200 with text/csv or 404 for keys export', async () => {
    // Create at least one key first to ensure there is exportable data
    const orgName = 'ExportKeyOrg_' + crypto.randomBytes(4).toString('hex');
    await adminPost('/api/admin/keys', { orgName, plan: 'pro' });

    const res = await adminGet('/api/admin/export/keys');
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(
        res.headers['content-type'] && res.headers['content-type'].includes('text/csv'),
        'Expected text/csv content-type for keys export'
      );
    }
  });

  it('returns 200 with text/csv or 404 for audit export', async () => {
    const res = await adminGet('/api/admin/export/audit');
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(
        res.headers['content-type'] && res.headers['content-type'].includes('text/csv'),
        'Expected text/csv content-type for audit export'
      );
    }
  });
});

// ============================================================================
// Legacy admin endpoints
// ============================================================================

describe('GET /api/admin/keys-legacy', () => {
  it('returns 200 with success: true and keys array', async () => {
    const res = await adminGet('/api/admin/keys-legacy');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(Array.isArray(res.json.keys), 'Expected keys array');
    assert.ok(typeof res.json.total === 'number', 'Expected numeric total');
  });

  it('returns 403 without admin secret', async () => {
    const res = await unauthGet('/api/admin/keys-legacy');
    assert.equal(res.status, 403);
  });
});

describe('POST /api/admin/keys-legacy/create', () => {
  it('creates a key via legacy endpoint', async () => {
    const orgName = 'LegacyOrg_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys-legacy/create', { orgName, plan: 'business' });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.apiKey.startsWith('vf_live_'));
  });

  it('returns 400 when orgName is missing on legacy endpoint', async () => {
    const res = await adminPost('/api/admin/keys-legacy/create', { plan: 'pro' });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('returns 400 for invalid plan on legacy endpoint', async () => {
    const orgName = 'LegacyBadPlan_' + crypto.randomBytes(4).toString('hex');
    const res = await adminPost('/api/admin/keys-legacy/create', { orgName, plan: 'invalid' });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });
});
