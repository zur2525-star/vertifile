/**
 * Vertifile E2E Test Helpers
 * ==========================
 * Shared utilities for all E2E test suites.
 *
 * Provides:
 *   - createTestUser(email, password)  -- register + login, return session cookie
 *   - uploadTestDocument(cookie, opts) -- upload a file, return response
 *   - cleanupTestUser(email)           -- delete test user and their documents
 *   - makeRequest(method, path, body, cookie) -- HTTP request wrapper
 *   - uniqueEmail(tag)                 -- collision-free email for each run
 *   - STRONG_PASSWORD                  -- meets all complexity rules
 *   - skipIfNoDatabase()               -- guard for CI / no-DB environments
 *
 * Convention: every E2E file imports from this module so the HTTP plumbing
 * lives in one place.
 */

const crypto = require('node:crypto');
const { Readable } = require('node:stream');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';
const AUTH_URL = `${BASE_URL}/auth`;
const API_URL  = `${BASE_URL}/api`;
const USER_URL = `${BASE_URL}/api/user`;

// Unique per test-process run to avoid email collisions
const RUN_ID = crypto.randomBytes(4).toString('hex');

// Password that satisfies all complexity rules:
//   >= 8 chars, uppercase, lowercase, digit, special char
const STRONG_PASSWORD = 'V3r!tiF1le_E2E';

// ---------------------------------------------------------------------------
// Guard: skip entire file when DATABASE_URL is not set
// ---------------------------------------------------------------------------
function skipIfNoDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('[SKIP] DATABASE_URL not set -- skipping E2E tests');
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Unique email generator
// ---------------------------------------------------------------------------
function uniqueEmail(tag = 'e2e') {
  return `e2e-${tag}-${RUN_ID}-${Date.now().toString(36)}@test.vertifile.com`;
}

// ---------------------------------------------------------------------------
// makeRequest  --  thin fetch wrapper, returns parsed response
// ---------------------------------------------------------------------------
async function makeRequest(method, path, body = null, cookie = '') {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;

  const opts = { method, headers, redirect: 'manual' };

  if (body !== null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    // Let fetch set the Content-Type with the boundary
    opts.body = body;
  }

  const res = await fetch(url, opts);

  // Collect all Set-Cookie headers
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookieString = setCookie.map(c => c.split(';')[0]).join('; ');

  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return {
    status: res.status,
    json,
    text,
    headers: res.headers,
    cookies: cookieString || cookie, // preserve incoming cookie if no new one
    setCookie,
  };
}

// ---------------------------------------------------------------------------
// createTestUser  --  register + login, return { cookie, user, userId }
// ---------------------------------------------------------------------------
// Returns null (instead of throwing) when rate-limited. Callers should
// check the return value and skip tests when null.
async function createTestUser(email, password = STRONG_PASSWORD, name = 'E2E Test') {
  const res = await makeRequest('POST', '/auth/register', {
    email,
    password,
    name,
  });

  // Happy path: registration succeeded
  if (res.status === 200 && res.json?.success && res.json?.user) {
    return {
      cookie: res.cookies,
      user: res.json.user,
      userId: res.json.user.id,
    };
  }

  // Rate-limited: return null so callers can skip gracefully
  if (res.status === 429) {
    console.log(`[RATE-LIMITED] createTestUser(${email}) -- signup rate-limited (429)`);
    return null;
  }

  // Duplicate email (silent success without user object) -- try to login
  if (res.status === 200 && !res.json?.user) {
    const loginRes = await makeRequest('POST', '/auth/login', { email, password });
    if (loginRes.status === 200 && loginRes.json?.success) {
      return {
        cookie: loginRes.cookies,
        user: loginRes.json.user,
        userId: loginRes.json.user.id,
      };
    }
    return null;
  }

  throw new Error(
    `createTestUser(${email}) failed: HTTP ${res.status} -- ${res.json?.error || res.text}`
  );
}

// ---------------------------------------------------------------------------
// loginTestUser  --  login with existing credentials
// ---------------------------------------------------------------------------
async function loginTestUser(email, password = STRONG_PASSWORD) {
  const res = await makeRequest('POST', '/auth/login', { email, password });

  if (res.status !== 200 || !res.json?.success) {
    throw new Error(
      `loginTestUser(${email}) failed: HTTP ${res.status} -- ${res.json?.error || res.text}`
    );
  }

  return {
    cookie: res.cookies,
    user: res.json.user,
    userId: res.json.user.id,
  };
}

// ---------------------------------------------------------------------------
// uploadTestDocument  --  upload a text file via multipart, return response
// ---------------------------------------------------------------------------
async function uploadTestDocument(cookie, opts = {}) {
  const {
    content = `Vertifile E2E test document ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`,
    filename = 'e2e-test.txt',
    mimeType = 'text/plain',
  } = opts;

  const blob = new Blob([content], { type: mimeType });

  const form = new FormData();
  form.append('file', blob, filename);

  const url = `${USER_URL}/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
    redirect: 'manual',
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  const cookieString = setCookie.map(c => c.split(';')[0]).join('; ');

  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return {
    status: res.status,
    json,
    text,
    headers: res.headers,
    cookies: cookieString || cookie,
  };
}

// ---------------------------------------------------------------------------
// cleanupTestUser  --  delete all docs + user by email via direct DB
// ---------------------------------------------------------------------------
// NOTE: This uses the DELETE /api/user/account endpoint (requires auth).
// If the user session is gone, orphaned rows will be cleaned up by the
// next test run's unique emails (no collision risk).
async function cleanupTestUser(cookie) {
  if (!cookie) return;
  try {
    await makeRequest('DELETE', '/api/user/account', null, cookie);
  } catch {
    // Best-effort cleanup -- never fail a test because of cleanup
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  BASE_URL,
  AUTH_URL,
  API_URL,
  USER_URL,
  RUN_ID,
  STRONG_PASSWORD,
  skipIfNoDatabase,
  uniqueEmail,
  makeRequest,
  createTestUser,
  loginTestUser,
  uploadTestDocument,
  cleanupTestUser,
};
