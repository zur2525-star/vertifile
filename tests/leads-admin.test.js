#!/usr/bin/env node
'use strict';

/**
 * Vertifile Leads + Admin Dashboard Test Suite
 *
 * Covers the leads-capture + admin-dashboard backend (spec sections B, C, D):
 *   - POST /api/contact accepts a valid submission WITHOUT organization and
 *     creates a lead (org is no longer required); rejects missing name/email
 *     and invalid emails.
 *   - Admin data endpoints require auth (403 without secret/session).
 *   - POST /api/admin/login (timing-safe), /logout, /session.
 *   - GET /api/admin/users NEVER returns password_hash.
 *   - PATCH /api/admin/leads/:id validates status.
 *
 * Uses the Node.js built-in test runner (node:test). Starts the Express app
 * on a random port. Skips entirely when DATABASE_URL is unset (CI / no-DB).
 *
 * Usage:  node --test tests/leads-admin.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Guard: skip the whole file when DATABASE_URL is not configured.
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  console.log('[SKIP] DATABASE_URL not set -- skipping leads-admin tests');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Server lifecycle (mirrors api.test.js / csrf.test.js)
// ---------------------------------------------------------------------------
const HMAC_SECRET  = 'test-secret-leads-admin-suite';
const ADMIN_SECRET = 'test-admin-secret-leads-admin-suite';
// NOTE: ADMIN_PASSWORD intentionally left UNSET so login exercises the
// documented fallback to ADMIN_SECRET.

let BASE_URL = '';
let server   = null;
let db       = null;

function startServer() {
  return new Promise((resolve, reject) => {
    process.env.HMAC_SECRET    = HMAC_SECRET;
    process.env.ADMIN_SECRET   = ADMIN_SECRET;
    process.env.SESSION_SECRET = 'test-leads-admin-session-secret';
    process.env.PORT           = '0';
    delete process.env.ADMIN_PASSWORD;

    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');

    delete require.cache[appPath];
    delete require.cache[dbPath];

    const app = require(appPath);
    db = require(dbPath);

    db._ready.then(() => {
      server = app.listen(0, '127.0.0.1', () => {
        BASE_URL = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on('error', reject);
    }).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

before(async () => { await startServer(); });
after(async () => {
  // Clean up the test leads this run created so the shared DB stays tidy.
  // Best-effort — never fail the suite on cleanup.
  try {
    if (db && db.query) {
      await db.query("DELETE FROM leads WHERE email LIKE $1", [`%-${RUN_TAG}@test.vertifile.com`]);
    }
  } catch { /* ignore */ }
  await stopServer();
});

// ---------------------------------------------------------------------------
// Minimal fetch wrapper. Returns { status, json, text, cookies }.
// ---------------------------------------------------------------------------
async function request(method, urlPath, { body = null, headers = {}, cookie = '' } = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const opts = { method, headers: { ...headers }, redirect: 'manual' };
  if (cookie) opts.headers['Cookie'] = cookie;
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookies = setCookie.map(c => c.split(';')[0]).join('; ');
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text, cookies: cookies || cookie };
}

// /api/contact is CSRF-protected (session route). Grab a token + session cookie.
async function fetchCsrfToken(cookie = '') {
  const res = await request('GET', '/api/csrf-token', { cookie });
  assert.equal(res.status, 200, `csrf-token returned ${res.status}: ${res.text}`);
  assert.ok(res.json?.csrfToken, 'csrfToken missing');
  return { csrfToken: res.json.csrfToken, cookie: res.cookies || cookie };
}

// Submit the contact form with a valid CSRF token + session cookie.
async function postContact(payload) {
  const { csrfToken, cookie } = await fetchCsrfToken();
  return request('POST', '/api/contact', {
    body: payload,
    headers: { 'x-csrf-token': csrfToken },
    cookie,
  });
}

// Log in as admin and return a fresh authenticated session cookie.
// NOTE: POST /api/admin/login is rate-limited (5 / 15 min, shared with all
// auth routes), so callers must use this sparingly. Data-endpoint tests share
// a single cached cookie via getAdminCookie() to stay under the limit.
async function adminLogin() {
  const res = await request('POST', '/api/admin/login', { body: { password: ADMIN_SECRET } });
  assert.equal(res.status, 200, `admin login failed: ${res.status} ${res.text}`);
  assert.equal(res.json?.success, true);
  assert.ok(res.cookies, 'login must set a session cookie');
  return res.cookies;
}

// One shared admin session for all the data-endpoint tests (logs in once).
let _adminCookie = null;
async function getAdminCookie() {
  if (!_adminCookie) _adminCookie = await adminLogin();
  return _adminCookie;
}

// A unique marker so we can find the lead this run created.
const RUN_TAG = crypto.randomBytes(4).toString('hex');

// ============================================================================
// B. POST /api/contact — works WITHOUT organization, creates a lead
// ============================================================================
describe('POST /api/contact (Contract B)', () => {
  it('accepts a valid submission WITHOUT organization and returns success', async () => {
    const email = `lead-${RUN_TAG}@test.vertifile.com`;
    const res = await postContact({
      name: `Lead ${RUN_TAG}`,
      email,
      subject: 'general',
      phone: '050-1234567',
      message: 'No org field sent on purpose',
      wantsCallback: true,
      // organization intentionally omitted
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.success, true);
  });

  it('the submission was persisted as a lead (visible to admin)', async () => {
    const cookie = await getAdminCookie();
    const res = await request('GET', '/api/admin/leads?limit=500', { cookie });
    assert.equal(res.status, 200);
    const match = (res.json?.leads || []).find(l => l.email === `lead-${RUN_TAG}@test.vertifile.com`);
    assert.ok(match, 'lead created by /api/contact must appear in admin leads list');
    assert.equal(match.wants_callback, true, 'wants_callback should round-trip');
    assert.equal(match.status, 'new', 'new leads default to status=new');
    assert.equal(match.organization, null, 'organization was omitted -> stored null');
  });

  // NOTE: POST /api/contact is rate-limited to 3 / hour / IP. The valid
  // submission above is request #1; the two validation cases below are #2 and
  // #3, keeping the whole suite within the limit. (A missing name and a missing
  // email both exercise the same `!name || !email` guard.)
  it('rejects a submission with no name (400)', async () => {
    const res = await postContact({ email: `noname-${RUN_TAG}@test.vertifile.com` });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.success, false);
  });

  it('rejects an invalid email (400)', async () => {
    const res = await postContact({ name: 'Bad Email', email: 'not-an-email' });
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.success, false);
  });
});

// ============================================================================
// C/D. Admin endpoints require auth
// ============================================================================
describe('Admin endpoints require auth', () => {
  it('GET /api/admin/leads returns 403 without auth', async () => {
    const res = await request('GET', '/api/admin/leads');
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/users returns 403 without auth', async () => {
    const res = await request('GET', '/api/admin/users');
    assert.equal(res.status, 403);
  });

  it('PATCH /api/admin/leads/:id returns 403 without auth', async () => {
    const res = await request('PATCH', '/api/admin/leads/1', { body: { status: 'contacted' } });
    assert.equal(res.status, 403);
  });

  it('valid X-Admin-Secret header still authorizes (existing path preserved)', async () => {
    const res = await request('GET', '/api/admin/leads', { headers: { 'X-Admin-Secret': ADMIN_SECRET } });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
  });
});

// ============================================================================
// C. Admin auth — login / session / logout
// ============================================================================
describe('Admin auth (Contract C)', () => {
  it('GET /api/admin/session reports isAdmin=false before login', async () => {
    const res = await request('GET', '/api/admin/session');
    assert.equal(res.status, 200);
    assert.equal(res.json?.isAdmin, false);
  });

  it('POST /api/admin/login with a wrong password returns generic 401', async () => {
    const res = await request('POST', '/api/admin/login', { body: { password: 'wrong-password' } });
    assert.equal(res.status, 401);
    assert.equal(res.json?.success, false);
    assert.ok(!('error' in (res.json || {})) || typeof res.json.error !== 'string' || res.json.error.length < 200);
  });

  it('POST /api/admin/login with the correct secret sets a working admin session', async () => {
    const cookie = await adminLogin();

    // Session reflects logged-in state
    const sess = await request('GET', '/api/admin/session', { cookie });
    assert.equal(sess.json?.isAdmin, true);

    // The session cookie authorizes a protected endpoint (no header needed)
    const leads = await request('GET', '/api/admin/leads', { cookie });
    assert.equal(leads.status, 200);
    assert.equal(leads.json?.success, true);
  });

  it('POST /api/admin/logout clears the admin session', async () => {
    const cookie = await adminLogin();
    const out = await request('POST', '/api/admin/logout', { cookie, body: {} });
    assert.equal(out.status, 200);

    const sess = await request('GET', '/api/admin/session', { cookie: out.cookies || cookie });
    assert.equal(sess.json?.isAdmin, false);
  });
});

// ============================================================================
// D. GET /api/admin/leads — shape + counts
// ============================================================================
describe('GET /api/admin/leads (Contract D)', () => {
  it('returns leads + counts including pendingCallbacks', async () => {
    const cookie = await getAdminCookie();
    const res = await request('GET', '/api/admin/leads', { cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json?.leads));
    const c = res.json?.counts || {};
    for (const k of ['new', 'contacted', 'closed', 'total', 'pendingCallbacks']) {
      assert.equal(typeof c[k], 'number', `counts.${k} must be a number`);
    }
  });

  it('rejects an invalid status filter (400)', async () => {
    const cookie = await getAdminCookie();
    const res = await request('GET', '/api/admin/leads?status=bogus', { cookie });
    assert.equal(res.status, 400);
  });
});

// ============================================================================
// D. PATCH /api/admin/leads/:id — status validation
// ============================================================================
describe('PATCH /api/admin/leads/:id (Contract D)', () => {
  it('rejects an invalid status (400)', async () => {
    const cookie = await getAdminCookie();
    const res = await request('PATCH', '/api/admin/leads/1', { cookie, body: { status: 'archived' } });
    assert.equal(res.status, 400);
    assert.equal(res.json?.success, false);
  });

  it('returns 404 for a non-existent lead id with a valid status', async () => {
    const cookie = await getAdminCookie();
    const res = await request('PATCH', '/api/admin/leads/999999999', { cookie, body: { status: 'contacted' } });
    assert.equal(res.status, 404);
  });

  it('updates the status of a real lead', async () => {
    const cookie = await getAdminCookie();
    // Find the lead created earlier in this run.
    const list = await request('GET', '/api/admin/leads?limit=500', { cookie });
    const mine = (list.json?.leads || []).find(l => l.email === `lead-${RUN_TAG}@test.vertifile.com`);
    assert.ok(mine, 'expected the run lead to exist');
    const res = await request('PATCH', `/api/admin/leads/${mine.id}`, { cookie, body: { status: 'contacted' } });
    assert.equal(res.status, 200);
    assert.equal(res.json?.lead?.status, 'contacted');
  });
});

// ============================================================================
// D. GET /api/admin/users — NEVER leaks password_hash
// ============================================================================
describe('GET /api/admin/users (Contract D)', () => {
  it('returns users + total + newLast7d, and NEVER includes password_hash', async () => {
    const cookie = await getAdminCookie();
    const res = await request('GET', '/api/admin/users', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json?.success, true);
    assert.ok(Array.isArray(res.json?.users), 'users must be an array');
    assert.equal(typeof res.json?.total, 'number');
    assert.equal(typeof res.json?.newLast7d, 'number');

    // Hard security assertion: no user object may carry password_hash.
    for (const u of res.json.users) {
      assert.ok(!('password_hash' in u), 'password_hash must NEVER be returned');
    }
    // Also assert it is absent from the raw response text (defense in depth).
    assert.ok(!res.text.includes('password_hash'), 'response body must not mention password_hash');
  });

  it('accepts a search query without error', async () => {
    const cookie = await getAdminCookie();
    const res = await request('GET', '/api/admin/users?search=test', { cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json?.users));
  });
});
