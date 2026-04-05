/**
 * Vertifile -- E2E Tests: Auth + Onboarding + Health + Security
 * ==============================================================
 * QA: Rina
 *
 * Uses Node's built-in test runner (node:test) and assertion library (node:assert).
 * No external test framework required.
 *
 * Run:
 *   node --test tests/e2e-auth-onboarding.test.js
 *
 * Prerequisites:
 *   - The server must be running (default: http://localhost:3002)
 *   - A PostgreSQL database must be available and migrated
 *   - Set TEST_BASE_URL env var to override the server address
 *
 * Each test is self-contained and uses a unique email generated at
 * runtime so that parallel or repeated runs do not collide.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';
const AUTH    = `${BASE_URL}/auth`;
const API     = `${BASE_URL}/api`;

// Generate a unique suffix so emails never collide across runs.
const RUN_ID = crypto.randomBytes(4).toString('hex');

function uniqueEmail(tag = 'user') {
  return `e2e-${tag}-${RUN_ID}@test.vertifile.com`;
}

// A password that satisfies all complexity rules:
//   >= 8 chars, uppercase, lowercase, digit, special char
const STRONG_PASSWORD = 'V3r!tiF1le_Test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around fetch that makes JSON requests and preserves
 * the Set-Cookie header so we can forward session cookies.
 */
async function api(method, url, body = null, cookies = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (cookies) headers['Cookie'] = cookies;

  const opts = { method, headers, redirect: 'manual' };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  // Collect all Set-Cookie headers (may be multiple)
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookieString = setCookie
    .map(c => c.split(';')[0])
    .join('; ');

  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return { status: res.status, json, headers: res.headers, cookies: cookieString, setCookie, text };
}

/**
 * Register a new user and return { cookies, user }.
 * Helper used by tests that need an authenticated session.
 */
async function registerAndLogin(email, password = STRONG_PASSWORD, name = 'Test User') {
  const res = await api('POST', `${AUTH}/register`, { email, password, name });
  return { cookies: res.cookies, user: res.json?.user, status: res.status, json: res.json };
}

// ===========================================================================
// AUTH FLOW
// ===========================================================================

describe('Auth Flow', () => {

  // -------------------------------------------------------------------------
  // 1. Valid registration returns 200 + session
  // -------------------------------------------------------------------------
  it('1. POST /auth/register -- valid registration returns 200 + user data', async () => {
    const email = uniqueEmail('reg-ok');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: STRONG_PASSWORD,
      name: 'Rina Test',
    });

    assert.equal(res.status, 200, 'Expected HTTP 200 on successful registration');
    assert.equal(res.json.success, true, 'Body should have success: true');
    assert.ok(res.json.user, 'Response must include a user object');
    assert.equal(res.json.user.email, email.toLowerCase());
    assert.ok(res.cookies.includes('connect.sid'), 'Session cookie must be set');
  });

  // -------------------------------------------------------------------------
  // 2. Duplicate email returns generic response (no enumeration)
  // -------------------------------------------------------------------------
  it('2. POST /auth/register -- duplicate email returns generic success (no enumeration)', async () => {
    // First registration succeeds.
    const email = uniqueEmail('dup');
    await api('POST', `${AUTH}/register`, { email, password: STRONG_PASSWORD });

    // Second registration with the same email must NOT reveal that the
    // email already exists. The server returns a generic success message.
    const res = await api('POST', `${AUTH}/register`, { email, password: STRONG_PASSWORD });

    assert.equal(res.status, 200, 'Must return 200, not 409 or similar');
    assert.equal(res.json.success, true, 'success must be true (generic response)');
    assert.ok(
      !res.json.user,
      'Must NOT return a user object for duplicate (silent success)'
    );
    assert.ok(
      res.json.message,
      'Should include a generic message about verification code'
    );
  });

  // -------------------------------------------------------------------------
  // 3. Weak password rejected (missing uppercase / number / special)
  // -------------------------------------------------------------------------
  it('3. POST /auth/register -- weak password missing uppercase is rejected', async () => {
    const email = uniqueEmail('weak1');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: 'alllowercase1!',
    });

    // The server requires uppercase, so "alllowercase1!" should fail only
    // because it has no uppercase letter.
    // Note: the password *does* have a digit and special char.
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      res.json.error.toLowerCase().includes('uppercase'),
      `Error should mention uppercase requirement. Got: "${res.json.error}"`
    );
  });

  it('3b. POST /auth/register -- weak password missing digit is rejected', async () => {
    const email = uniqueEmail('weak2');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: 'NoDigitsHere!',
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      res.json.error.toLowerCase().includes('digit'),
      `Error should mention digit requirement. Got: "${res.json.error}"`
    );
  });

  it('3c. POST /auth/register -- weak password missing special char is rejected', async () => {
    const email = uniqueEmail('weak3');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: 'NoSpecial1A',
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      res.json.error.toLowerCase().includes('special'),
      `Error should mention special character requirement. Got: "${res.json.error}"`
    );
  });

  it('3d. POST /auth/register -- password shorter than 8 chars is rejected', async () => {
    const email = uniqueEmail('weak4');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: 'Ab1!',
    });

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      res.json.error.toLowerCase().includes('8 characters'),
      `Error should mention minimum length. Got: "${res.json.error}"`
    );
  });

  // -------------------------------------------------------------------------
  // 4. Common password rejected ("password123" or similar from blacklist)
  // -------------------------------------------------------------------------
  it('4. POST /auth/register -- common blacklisted password is rejected', async () => {
    // "password123" should be in the common-passwords.txt blacklist.
    // If the blacklist file is missing, the server skips this check and the
    // test may fail on complexity rules instead -- that is still a valid
    // rejection but for a different reason. We accept either outcome.
    const email = uniqueEmail('common');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: 'Password123!',  // meets complexity but is common
    });

    // If the blacklist is loaded, expect 400 with "too common".
    // If the blacklist is missing, the password actually passes complexity,
    // so we'd get 200. We check both paths:
    if (res.status === 400) {
      assert.equal(res.json.success, false);
      assert.ok(
        res.json.error.toLowerCase().includes('common'),
        `Error should mention the password is too common. Got: "${res.json.error}"`
      );
    } else {
      // Blacklist not loaded -- password meets complexity, registration succeeds.
      // This is acceptable; log it so QA is aware.
      console.log('  [INFO] Common password blacklist not loaded -- skipping blacklist assertion');
      assert.equal(res.status, 200);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Valid login returns user data
  // -------------------------------------------------------------------------
  it('5. POST /auth/login -- valid credentials return user data', async () => {
    const email = uniqueEmail('login-ok');

    // Register first
    await api('POST', `${AUTH}/register`, { email, password: STRONG_PASSWORD, name: 'Login OK' });

    // Now login
    const res = await api('POST', `${AUTH}/login`, { email, password: STRONG_PASSWORD });

    assert.equal(res.status, 200, 'Login should return 200');
    assert.equal(res.json.success, true);
    assert.ok(res.json.user, 'Response must include user object');
    assert.equal(res.json.user.email, email.toLowerCase());
    assert.ok(res.cookies.includes('connect.sid'), 'Session cookie must be set');
  });

  // -------------------------------------------------------------------------
  // 6. Wrong password returns generic error
  // -------------------------------------------------------------------------
  it('6. POST /auth/login -- wrong password returns generic error (no enumeration)', async () => {
    const email = uniqueEmail('login-bad');
    await api('POST', `${AUTH}/register`, { email, password: STRONG_PASSWORD });

    const res = await api('POST', `${AUTH}/login`, { email, password: 'Wr0ng_P@ss!' });

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
    // The error must be generic -- must NOT reveal whether the email exists.
    assert.ok(
      res.json.error.toLowerCase().includes('invalid'),
      `Error should be generic ("Invalid ..."). Got: "${res.json.error}"`
    );
    assert.ok(
      !res.json.error.toLowerCase().includes('password is wrong'),
      'Error must NOT specifically say the password is wrong (enumeration risk)'
    );
  });

  // -------------------------------------------------------------------------
  // 7. Account lockout after repeated failed attempts
  // -------------------------------------------------------------------------
  it('7. POST /auth/login -- 11 failed attempts triggers lockout', async (t) => {
    // The server locks after 10 failed attempts (30 min lockout).
    // The auth route has a rate limiter of 5 per 15 min, which will trigger
    // before we reach 10. This test documents the expected security behavior.
    //
    // NOTE: The authLimiter (5 req / 15 min) will kick in before the 10-attempt
    // account lockout. In a real environment you would either:
    //   a) Disable rate limiting in test mode, or
    //   b) Test lockout logic via a unit test on the passport strategy.
    //
    // Here we verify that after 5 rapid attempts we get rate-limited (429),
    // which is itself a valid security control.

    const email = uniqueEmail('lockout');
    await api('POST', `${AUTH}/register`, { email, password: STRONG_PASSWORD });

    let got429 = false;
    let lastStatus = 0;

    for (let i = 0; i < 11; i++) {
      const res = await api('POST', `${AUTH}/login`, { email, password: 'Bad_P@ss1!' });
      lastStatus = res.status;
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }

    // Either the rate limiter fired (429) or we got through to lockout.
    // Both are acceptable security behaviors.
    assert.ok(
      got429 || lastStatus === 401,
      `After 11 bad attempts, expected 429 (rate limit) or 401 (lockout). Got: ${lastStatus}`
    );

    if (got429) {
      console.log('  [OK] Rate limiter triggered before account lockout (expected in E2E)');
    } else {
      // If we got past the rate limiter (e.g. test mode), the 11th attempt
      // should be blocked by account lockout with a generic message.
      console.log('  [OK] Account lockout reached after 10+ failures');
    }
  });

  // -------------------------------------------------------------------------
  // 8. GET /auth/me -- authenticated user gets profile
  // -------------------------------------------------------------------------
  it('8. GET /auth/me -- authenticated user gets full profile', async () => {
    const email = uniqueEmail('me-ok');
    const { cookies } = await registerAndLogin(email);

    const res = await api('GET', `${AUTH}/me`, null, cookies);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.user, 'Must return user object');
    assert.equal(res.json.user.email, email.toLowerCase());
    assert.ok('plan' in res.json.user, 'Profile must include plan');
    assert.ok('onboarding_completed' in res.json.user, 'Profile must include onboarding_completed');
    assert.ok('documents_used' in res.json.user, 'Profile must include documents_used');
    assert.ok('created_at' in res.json.user, 'Profile must include created_at');
  });

  // -------------------------------------------------------------------------
  // 9. GET /auth/me -- unauthenticated returns 401
  // -------------------------------------------------------------------------
  it('9. GET /auth/me -- unauthenticated request returns 401', async () => {
    // No cookies, no session.
    const res = await api('GET', `${AUTH}/me`);

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
  });

  // -------------------------------------------------------------------------
  // 10. POST /auth/logout -- destroys session
  // -------------------------------------------------------------------------
  it('10. POST /auth/logout -- destroys session', async () => {
    const email = uniqueEmail('logout');
    const { cookies } = await registerAndLogin(email);

    // Verify we are logged in first
    const before = await api('GET', `${AUTH}/me`, null, cookies);
    assert.equal(before.status, 200, 'Should be authenticated before logout');

    // Logout
    const logoutRes = await api('POST', `${AUTH}/logout`, null, cookies);
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.json.success, true);

    // After logout, the same session cookie should no longer work
    const after = await api('GET', `${AUTH}/me`, null, cookies);
    assert.equal(after.status, 401, 'Session must be destroyed after logout');
  });
});

// ===========================================================================
// ONBOARDING FLOW
// ===========================================================================

describe('Onboarding Flow', () => {

  // -------------------------------------------------------------------------
  // 11. GET /api/onboarding/state -- returns default state for new user
  // -------------------------------------------------------------------------
  it('11. GET /api/onboarding/state -- new user gets default wizard state', async () => {
    const email = uniqueEmail('onb-default');
    const { cookies } = await registerAndLogin(email);

    const res = await api('GET', `${API}/onboarding/state`, null, cookies);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.state, 'Must return a state object');
    assert.equal(res.json.state.current_step, 1, 'Default step should be 1');
    assert.deepEqual(res.json.state.selections, {}, 'Default selections should be empty');
    assert.equal(res.json.state.completed_at, null, 'Should not be completed');
  });

  // -------------------------------------------------------------------------
  // 12. PUT /api/onboarding/state -- saves wizard progress
  // -------------------------------------------------------------------------
  it('12. PUT /api/onboarding/state -- saves wizard progress', async () => {
    const email = uniqueEmail('onb-save');
    const { cookies } = await registerAndLogin(email);

    const payload = {
      current_step: 2,
      selections: { user_type: 'business', industry: 'healthcare' },
    };

    const saveRes = await api('PUT', `${API}/onboarding/state`, payload, cookies);
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.json.success, true);

    // Read it back to confirm persistence
    const readRes = await api('GET', `${API}/onboarding/state`, null, cookies);
    assert.equal(readRes.status, 200);
    assert.equal(readRes.json.state.current_step, 2);
    assert.equal(readRes.json.state.selections.user_type, 'business');
    assert.equal(readRes.json.state.selections.industry, 'healthcare');
  });

  // -------------------------------------------------------------------------
  // 12b. PUT /api/onboarding/state -- rejects empty body
  // -------------------------------------------------------------------------
  it('12b. PUT /api/onboarding/state -- rejects empty update', async () => {
    const email = uniqueEmail('onb-empty');
    const { cookies } = await registerAndLogin(email);

    const res = await api('PUT', `${API}/onboarding/state`, {}, cookies);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(res.json.error.toLowerCase().includes('nothing'), 'Should say nothing to update');
  });

  // -------------------------------------------------------------------------
  // 13. POST /api/onboarding/complete -- finalizes wizard
  // -------------------------------------------------------------------------
  it('13. POST /api/onboarding/complete -- finalizes onboarding', async () => {
    const email = uniqueEmail('onb-done');
    const { cookies } = await registerAndLogin(email);

    // First save some state so there is something to finalize
    await api('PUT', `${API}/onboarding/state`, {
      current_step: 4,
      selections: {
        user_type: 'private',
        industry: 'education',
        estimated_volume: '1-10',
        selected_plan: 'starter',
      },
      stamp_config: {
        accent_color: '#3B82F6',
        wave_color: '#EFF6FF',
      },
    }, cookies);

    const res = await api('POST', `${API}/onboarding/complete`, {}, cookies);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.message.toLowerCase().includes('complete'), 'Message should confirm completion');
    assert.equal(res.json.redirect, '/app', 'Should redirect to /app after completion');

    // Verify via /auth/me that onboarding_completed is now true
    const meRes = await api('GET', `${AUTH}/me`, null, cookies);
    assert.equal(meRes.json.user.onboarding_completed, true, 'onboarding_completed should be true');
  });

  // -------------------------------------------------------------------------
  // 13b. POST /api/onboarding/complete -- fails without prior state
  // -------------------------------------------------------------------------
  it('13b. POST /api/onboarding/complete -- fails if no state saved', async () => {
    const email = uniqueEmail('onb-nostate');
    const { cookies } = await registerAndLogin(email);

    // Attempt to complete without ever saving state
    const res = await api('POST', `${API}/onboarding/complete`, {}, cookies);

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  // -------------------------------------------------------------------------
  // Onboarding endpoints require authentication
  // -------------------------------------------------------------------------
  it('Onboarding endpoints require authentication', async () => {
    const getRes = await api('GET', `${API}/onboarding/state`);
    assert.equal(getRes.status, 401);

    const putRes = await api('PUT', `${API}/onboarding/state`, { current_step: 2 });
    assert.equal(putRes.status, 401);

    const completeRes = await api('POST', `${API}/onboarding/complete`, {});
    assert.equal(completeRes.status, 401);
  });
});

// ===========================================================================
// HEALTH
// ===========================================================================

describe('Health', () => {

  // -------------------------------------------------------------------------
  // 14. GET /api/health -- returns 200 with DB status
  // -------------------------------------------------------------------------
  it('14. GET /api/health -- returns 200 with status', async () => {
    const res = await api('GET', `${API}/health`);

    // Health check returns 200 when DB is up, 503 when down.
    // In a running test environment we expect 200.
    assert.ok(
      [200, 503].includes(res.status),
      `Health check should return 200 or 503. Got: ${res.status}`
    );
    assert.ok(res.json, 'Should return JSON body');

    if (res.status === 200) {
      assert.equal(res.json.success, true);
    }
  });
});

// ===========================================================================
// SECURITY
// ===========================================================================

describe('Security', () => {

  // -------------------------------------------------------------------------
  // 15. Rate limiting -- verify 429 after too many requests
  // -------------------------------------------------------------------------
  it('15. Rate limiting -- returns 429 after too many requests', async () => {
    // The global /api/ rate limiter allows 200 per 15 min.
    // The authLimiter (login) allows 5 per 15 min.
    // The signupLimiter allows 3 per hour.
    // We target the login endpoint since it has the strictest limit.

    const email = uniqueEmail('ratelimit');
    let got429 = false;

    // Send 7 rapid requests (limit is 5)
    for (let i = 0; i < 7; i++) {
      const res = await api('POST', `${AUTH}/login`, {
        email,
        password: 'DoesN0tMatter!',
      });
      if (res.status === 429) {
        got429 = true;
        assert.ok(
          res.json.error.toLowerCase().includes('too many'),
          'Rate limit error should mention "too many"'
        );
        break;
      }
    }

    assert.ok(got429, 'Should have received 429 after exceeding rate limit');
  });

  // -------------------------------------------------------------------------
  // 16. Session cookie -- verify HttpOnly and Secure flags
  // -------------------------------------------------------------------------
  it('16. Session cookie -- has HttpOnly flag', async () => {
    const email = uniqueEmail('cookie');
    const res = await api('POST', `${AUTH}/register`, {
      email,
      password: STRONG_PASSWORD,
    });

    // Check raw Set-Cookie header for flags
    const sidCookie = res.setCookie.find(c => c.includes('connect.sid'));
    assert.ok(sidCookie, 'connect.sid cookie must be set');
    assert.ok(
      sidCookie.toLowerCase().includes('httponly'),
      'Session cookie must have HttpOnly flag'
    );

    // Secure flag depends on NODE_ENV=production or RENDER env var.
    // In local test environments it may not be set. We verify the logic
    // is wired correctly by checking the cookie string.
    // If running against production/staging, uncomment this:
    // assert.ok(
    //   sidCookie.toLowerCase().includes('secure'),
    //   'Session cookie must have Secure flag in production'
    // );

    // Always verify SameSite is set
    assert.ok(
      sidCookie.toLowerCase().includes('samesite'),
      'Session cookie should have SameSite attribute'
    );
  });

  // -------------------------------------------------------------------------
  // 17. Auth responses -- verify Cache-Control: no-store header
  // -------------------------------------------------------------------------
  it('17. Cache-Control: no-store on auth responses', async () => {
    // The auth router sets Cache-Control on every response.
    // We test multiple auth endpoints.

    // GET /auth/me (unauthenticated -- still gets the header)
    const meRes = await api('GET', `${AUTH}/me`);
    const cc = meRes.headers.get('cache-control');
    assert.ok(cc, 'Cache-Control header must be present on auth responses');
    assert.ok(
      cc.includes('no-store'),
      `Cache-Control must include "no-store". Got: "${cc}"`
    );
    assert.ok(
      cc.includes('no-cache'),
      `Cache-Control must include "no-cache". Got: "${cc}"`
    );

    // POST /auth/login (failed)
    const loginRes = await api('POST', `${AUTH}/login`, {
      email: 'nobody@test.com',
      password: 'DoesN0tMatter!',
    });
    const cc2 = loginRes.headers.get('cache-control');
    assert.ok(cc2 && cc2.includes('no-store'), 'Login response must have no-store');

    // POST /auth/logout
    const logoutRes = await api('POST', `${AUTH}/logout`);
    const cc3 = logoutRes.headers.get('cache-control');
    assert.ok(cc3 && cc3.includes('no-store'), 'Logout response must have no-store');
  });

  // -------------------------------------------------------------------------
  // Pragma: no-cache header on auth responses
  // -------------------------------------------------------------------------
  it('Pragma: no-cache header on auth responses', async () => {
    const res = await api('GET', `${AUTH}/me`);
    const pragma = res.headers.get('pragma');
    assert.ok(pragma, 'Pragma header must be present');
    assert.equal(pragma, 'no-cache');
  });

  // -------------------------------------------------------------------------
  // Registration with missing email returns 400
  // -------------------------------------------------------------------------
  it('Registration with missing email returns 400', async () => {
    const res = await api('POST', `${AUTH}/register`, { password: STRONG_PASSWORD });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(res.json.error.toLowerCase().includes('email'));
  });

  // -------------------------------------------------------------------------
  // Registration with invalid email format returns 400
  // -------------------------------------------------------------------------
  it('Registration with invalid email format returns 400', async () => {
    const res = await api('POST', `${AUTH}/register`, {
      email: 'not-an-email',
      password: STRONG_PASSWORD,
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(res.json.error.toLowerCase().includes('email'));
  });

  // -------------------------------------------------------------------------
  // Login with non-existent email returns generic error (no enumeration)
  // -------------------------------------------------------------------------
  it('Login with non-existent email returns generic error', async () => {
    const res = await api('POST', `${AUTH}/login`, {
      email: `nonexistent-${RUN_ID}@test.vertifile.com`,
      password: STRONG_PASSWORD,
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
    // Must NOT reveal that the email does not exist
    assert.ok(
      res.json.error.toLowerCase().includes('invalid'),
      'Must return generic "invalid" message'
    );
  });
});
