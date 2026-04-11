/**
 * Vertifile -- E2E Tests: Authentication Flow
 * =============================================
 * QA: Rina  |  Regression: Nir
 *
 * Tests complete authentication lifecycle: register, login, session,
 * protected routes, logout, password change, and invalid credentials.
 *
 * IMPORTANT: The signup rate limiter allows 3 signups per hour per IP.
 * This suite creates ONE user and reuses it across all tests. Tests
 * that cannot run due to rate limiting are marked as skipped.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/e2e-auth-flow.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  skipIfNoDatabase,
  uniqueEmail,
  STRONG_PASSWORD,
  makeRequest,
  cleanupTestUser,
} = require('./helpers');

skipIfNoDatabase();

describe('E2E Auth Flow', () => {
  const email = uniqueEmail('auth');
  let cookie;
  let userId;
  let rateLimited = false;

  // -----------------------------------------------------------------------
  // Setup: register one user for the entire suite
  // -----------------------------------------------------------------------
  before(async () => {
    const res = await makeRequest('POST', '/auth/register', {
      email,
      password: STRONG_PASSWORD,
      name: 'Auth E2E',
    });

    if (res.status === 429) {
      rateLimited = true;
      console.log('[WARN] Signup rate-limited (429). Tests requiring a fresh user will be skipped.');
      return;
    }

    assert.equal(res.status, 200, `Registration failed: ${res.text}`);
    assert.equal(res.json.success, true);
    cookie = res.cookies;
    userId = res.json.user?.id;
  });

  after(async () => {
    if (cookie) await cleanupTestUser(cookie);
  });

  // ===================================================================
  // REGISTRATION
  // ===================================================================

  it('1. POST /auth/register -- valid registration returns user + session', async (t) => {
    if (rateLimited) return t.skip('Rate-limited -- cannot test registration');

    // Already tested in before(), verify we have the data
    assert.ok(cookie, 'Session cookie must exist after registration');
    assert.ok(userId, 'User ID must exist');

    // Verify the cookie contains connect.sid
    assert.ok(cookie.includes('connect.sid'), 'Session cookie must contain connect.sid');
  });

  it('2. POST /auth/register -- missing email returns 400', async (t) => {
    const res = await makeRequest('POST', '/auth/register', {
      password: STRONG_PASSWORD,
    });

    // Either 400 (validation) or 429 (rate limit). Both are acceptable.
    assert.ok(
      [400, 429].includes(res.status),
      `Expected 400 or 429, got ${res.status}`
    );
    if (res.status === 400) {
      assert.equal(res.json.success, false);
    }
  });

  it('3. POST /auth/register -- invalid email format returns 400', async (t) => {
    const res = await makeRequest('POST', '/auth/register', {
      email: 'not-an-email',
      password: STRONG_PASSWORD,
    });

    assert.ok(
      [400, 429].includes(res.status),
      `Expected 400 or 429, got ${res.status}`
    );
    if (res.status === 400) {
      assert.equal(res.json.success, false);
    }
  });

  it('4. POST /auth/register -- weak password (too short) rejected', async (t) => {
    const res = await makeRequest('POST', '/auth/register', {
      email: uniqueEmail('weak-short'),
      password: 'Ab1!',
    });

    assert.ok(
      [400, 429].includes(res.status),
      `Expected 400 or 429, got ${res.status}`
    );
    if (res.status === 400) {
      assert.ok(res.json.error.toLowerCase().includes('8 characters'));
    }
  });

  it('5. POST /auth/register -- weak password (no uppercase) rejected', async (t) => {
    const res = await makeRequest('POST', '/auth/register', {
      email: uniqueEmail('weak-upper'),
      password: 'alllowercase1!',
    });

    assert.ok(
      [400, 429].includes(res.status),
      `Expected 400 or 429, got ${res.status}`
    );
    if (res.status === 400) {
      assert.ok(res.json.error.toLowerCase().includes('uppercase'));
    }
  });

  // ===================================================================
  // LOGIN
  // ===================================================================

  it('6. POST /auth/login -- valid credentials return user + session', async (t) => {
    if (rateLimited) return t.skip('No user registered');

    const res = await makeRequest('POST', '/auth/login', {
      email,
      password: STRONG_PASSWORD,
    });

    assert.equal(res.status, 200, `Login should succeed, got ${res.status}: ${res.text}`);
    assert.equal(res.json.success, true);
    assert.ok(res.json.user, 'Must return user object');
    assert.equal(res.json.user.email, email.toLowerCase());
    assert.ok(res.cookies.includes('connect.sid'), 'Session cookie must be set');

    // Update cookie for subsequent tests
    cookie = res.cookies;
  });

  it('7. POST /auth/login -- wrong password returns 401', async (t) => {
    if (rateLimited) return t.skip('No user registered');

    const res = await makeRequest('POST', '/auth/login', {
      email,
      password: 'Wr0ng_P@ss!',
    });

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
    assert.ok(res.json.error.toLowerCase().includes('invalid'));
    // Anti-enumeration: must NOT say "password is wrong"
    assert.ok(!res.json.error.toLowerCase().includes('password is wrong'));
  });

  it('8. POST /auth/login -- non-existent email returns generic 401', async () => {
    const res = await makeRequest('POST', '/auth/login', {
      email: `ghost-${crypto.randomBytes(4).toString('hex')}@test.vertifile.com`,
      password: STRONG_PASSWORD,
    });

    // 401 (wrong creds) or 429 (rate-limited auth)
    assert.ok(
      [401, 429].includes(res.status),
      `Expected 401 or 429, got ${res.status}`
    );
    if (res.status === 401) {
      assert.ok(res.json.error.toLowerCase().includes('invalid'));
    }
  });

  // ===================================================================
  // SESSION + PROTECTED ROUTES
  // ===================================================================

  it('9. GET /auth/me -- authenticated user gets profile', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const res = await makeRequest('GET', '/auth/me', null, cookie);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.user, 'Must return user object');
    assert.equal(res.json.user.email, email.toLowerCase());
    assert.ok('plan' in res.json.user, 'Profile must include plan');
    assert.ok('documents_used' in res.json.user, 'Profile must include documents_used');
    assert.ok('created_at' in res.json.user, 'Profile must include created_at');
  });

  it('10. GET /auth/me -- unauthenticated returns 401', async () => {
    const res = await makeRequest('GET', '/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
  });

  it('11. GET /api/user/documents -- unauthenticated returns 401', async () => {
    const res = await makeRequest('GET', '/api/user/documents');
    assert.equal(res.status, 401);
  });

  it('12. GET /api/user/stamp -- unauthenticated returns 401', async () => {
    const res = await makeRequest('GET', '/api/user/stamp');
    assert.equal(res.status, 401);
  });

  // ===================================================================
  // LOGOUT
  // ===================================================================

  it('13. POST /auth/logout -- destroys session', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    // First verify we are logged in
    const before = await makeRequest('GET', '/auth/me', null, cookie);
    assert.equal(before.status, 200, 'Should be authenticated before logout');

    // Save cookie before logout so we can test it is destroyed
    const oldCookie = cookie;

    // Logout
    const logoutRes = await makeRequest('POST', '/auth/logout', null, cookie);
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.json.success, true);

    // After logout, the old cookie should not work
    const after = await makeRequest('GET', '/auth/me', null, oldCookie);
    assert.equal(after.status, 401, 'Session must be destroyed after logout');

    // Re-login so subsequent tests still work
    const loginRes = await makeRequest('POST', '/auth/login', {
      email,
      password: STRONG_PASSWORD,
    });
    if (loginRes.status === 200) {
      cookie = loginRes.cookies;
    }
  });

  it('14. POST /auth/logout -- without session returns 200', async () => {
    const res = await makeRequest('POST', '/auth/logout');
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  // ===================================================================
  // PASSWORD CHANGE
  // ===================================================================

  it('15. POST /api/user/change-password -- successful password change', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const newPassword = 'N3w_P@ssw0rd!E2E';

    const res = await makeRequest('POST', '/api/user/change-password', {
      currentPassword: STRONG_PASSWORD,
      newPassword,
    }, cookie);

    assert.equal(res.status, 200, `Password change failed: ${res.text}`);
    assert.equal(res.json.success, true);

    // Login with new password
    const loginRes = await makeRequest('POST', '/auth/login', {
      email,
      password: newPassword,
    });

    if (loginRes.status === 200) {
      cookie = loginRes.cookies;
      assert.equal(loginRes.json.success, true);
    } else if (loginRes.status === 429) {
      // Rate-limited, can't verify login works
      console.log('  [INFO] Login rate-limited after password change -- skipping login verification');
    }

    // Change back to original password so other tests still work
    if (cookie) {
      const revertRes = await makeRequest('POST', '/api/user/change-password', {
        currentPassword: newPassword,
        newPassword: STRONG_PASSWORD,
      }, cookie);
      // Best effort -- don't fail test if revert fails
    }
  });

  it('16. POST /api/user/change-password -- wrong current password returns 401', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const res = await makeRequest('POST', '/api/user/change-password', {
      currentPassword: 'Wr0ng_0ld_P@ss!',
      newPassword: 'N3w_P@ssw0rd!',
    }, cookie);

    assert.equal(res.status, 401);
    assert.equal(res.json.success, false);
  });

  it('17. POST /api/user/change-password -- unauthenticated returns 401', async () => {
    const res = await makeRequest('POST', '/api/user/change-password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'N3w_P@ssw0rd!',
    });

    assert.equal(res.status, 401);
  });

  it('18. POST /api/user/change-password -- missing fields returns 400', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const res = await makeRequest('POST', '/api/user/change-password', {
      currentPassword: STRONG_PASSWORD,
      // newPassword missing
    }, cookie);

    assert.equal(res.status, 400);
  });

  // ===================================================================
  // SECURITY HEADERS
  // ===================================================================

  it('19. Session cookie has HttpOnly and SameSite flags', async (t) => {
    if (rateLimited) return t.skip('Rate-limited');

    // Login to get a fresh cookie with Set-Cookie header
    const res = await makeRequest('POST', '/auth/login', {
      email,
      password: STRONG_PASSWORD,
    });

    if (res.status === 429) return t.skip('Login rate-limited');

    const sidCookie = res.setCookie.find(c => c.includes('connect.sid'));
    assert.ok(sidCookie, 'connect.sid cookie must be set');
    assert.ok(sidCookie.toLowerCase().includes('httponly'), 'Must have HttpOnly');
    assert.ok(sidCookie.toLowerCase().includes('samesite'), 'Must have SameSite');

    cookie = res.cookies;
  });

  it('20. Auth responses include Cache-Control: no-store', async () => {
    const res = await makeRequest('GET', '/auth/me');
    const cc = res.headers.get('cache-control');
    assert.ok(cc, 'Cache-Control header must be present');
    assert.ok(cc.includes('no-store'), 'Must include no-store');
    assert.ok(cc.includes('no-cache'), 'Must include no-cache');
  });

  it('21. Auth responses include Pragma: no-cache', async () => {
    const res = await makeRequest('GET', '/auth/me');
    const pragma = res.headers.get('pragma');
    assert.ok(pragma, 'Pragma header must be present');
    assert.equal(pragma, 'no-cache');
  });

  // ===================================================================
  // PROFILE
  // ===================================================================

  it('22. PUT /api/user/profile -- updates user name', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const res = await makeRequest('PUT', '/api/user/profile', {
      name: 'New Name E2E',
    }, cookie);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);

    // Verify via /api/user/me
    const me = await makeRequest('GET', '/api/user/me', null, cookie);
    assert.equal(me.json.user.name, 'New Name E2E');
  });

  it('23. PUT /api/user/profile -- rejects empty name', async (t) => {
    if (rateLimited || !cookie) return t.skip('No session available');

    const res = await makeRequest('PUT', '/api/user/profile', {
      name: '',
    }, cookie);

    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });
});
