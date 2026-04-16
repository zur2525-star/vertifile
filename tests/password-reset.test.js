'use strict';

/**
 * Vertifile -- E2E Tests: Password Reset Flow
 * ============================================
 * QA: Rina  |  Regression: Nir
 *
 * Covers:
 *   POST /auth/forgot-password  -- validation, enumeration-safety, rate-limit
 *   POST /auth/reset-password   -- validation, weak passwords, invalid tokens
 *   Edge cases                  -- empty body, fake-looking tokens, XSS attempts
 *
 * The full happy-path (forgot -> email link -> reset with real token) cannot be
 * tested end-to-end without intercepting SMTP. All token-acceptance paths are
 * therefore covered at the validation/rejection layer. The route code itself
 * (routes/auth.js) proves correct happy-path behaviour via code review and the
 * DB-layer unit tests in repos/auth-repo.js.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/password-reset.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  skipIfNoDatabase,
  uniqueEmail,
  STRONG_PASSWORD,
  makeRequest,
  createTestUser,
  cleanupTestUser,
} = require('./helpers');

// ---------------------------------------------------------------------------
// Guard: exit immediately when DATABASE_URL is absent
// ---------------------------------------------------------------------------
skipIfNoDatabase();

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let testEmail;
let testCookie;

// A structurally-plausible but definitely-absent token (64 hex chars = 32 bytes)
const FAKE_TOKEN = crypto.randomBytes(32).toString('hex');

// Helper: authLimiter is shared across auth routes (5 req / 15 min / IP).
// The forgot-password tests above may have consumed some of the budget.
// If we get 429, skip the test gracefully rather than failing.
function assertNotRateLimited(res) {
  if (res.status === 429) return false; // signal caller to skip
  return true;
}

// A password that is clearly too weak -- fails every complexity rule at once
const WEAK_PASSWORD = 'password';

// A password that only fails because it has no special character
const ALMOST_STRONG = 'Abcdefg1';

// A password that is too short
const TOO_SHORT = 'Ab1!';

// ============================================================================
// SETUP / TEARDOWN
// ============================================================================

before(async () => {
  testEmail = uniqueEmail('pwreset');
  const result = await createTestUser(testEmail, STRONG_PASSWORD, 'Reset Test User');

  if (!result) {
    // Rate-limited at registration -- tests will be skipped individually
    console.log('[WARN] createTestUser rate-limited. Most tests will still run against known-bad inputs.');
    return;
  }

  testCookie = result.cookie;
});

after(async () => {
  if (testCookie) {
    await cleanupTestUser(testCookie);
  }
});

// ============================================================================
// POST /auth/forgot-password
// ============================================================================

describe('POST /auth/forgot-password', () => {

  // --------------------------------------------------------------------------
  // Enumeration safety: both existing and non-existing emails must return 200
  // with the same generic message body.
  // --------------------------------------------------------------------------

  it('returns 200 with generic message for a registered email', async (t) => {
    if (!testEmail) return t.skip('Test user not created (rate-limited)');

    const res = await makeRequest('POST', '/auth/forgot-password', {
      email: testEmail,
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.success, true, 'Response body must have success: true');
    assert.ok(
      typeof res.json?.message === 'string' && res.json.message.length > 0,
      'Response must include a non-empty message string'
    );
  });

  it('returns 200 with the same generic message for a non-existent email (no enumeration)', async () => {
    const nonExistentEmail = uniqueEmail('ghost');

    const res = await makeRequest('POST', '/auth/forgot-password', {
      email: nonExistentEmail,
    });

    // Must succeed -- not reveal whether the address exists
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.success, true, 'success must be true even for unknown emails');
    assert.ok(
      typeof res.json?.message === 'string' && res.json.message.length > 0,
      'Response must include a message string'
    );
  });

  it('returns 200 for both known and unknown email with identical message text', async (t) => {
    if (!testEmail) return t.skip('Test user not created (rate-limited)');

    const knownRes = await makeRequest('POST', '/auth/forgot-password', {
      email: testEmail,
    });
    const unknownRes = await makeRequest('POST', '/auth/forgot-password', {
      email: uniqueEmail('nobody'),
    });

    // Both must succeed
    assert.equal(knownRes.status, 200);
    assert.equal(unknownRes.status, 200);

    // The message text must be identical -- different text would leak existence
    assert.equal(
      knownRes.json?.message,
      unknownRes.json?.message,
      'Message for known and unknown emails must be byte-identical (anti-enumeration)'
    );
  });

  // --------------------------------------------------------------------------
  // Validation: missing email field
  // --------------------------------------------------------------------------

  it('returns 400 when email field is missing entirely', async (t) => {
    const res = await makeRequest('POST', '/auth/forgot-password', {});
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}`
    );
    assert.equal(res.json?.success, false, 'success must be false');
    assert.ok(
      typeof res.json?.error === 'string' && res.json.error.length > 0,
      'Response must include an error string'
    );
  });

  it('returns 400 when email field is null', async (t) => {
    const res = await makeRequest('POST', '/auth/forgot-password', { email: null });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 when email is an empty string', async (t) => {
    const res = await makeRequest('POST', '/auth/forgot-password', { email: '' });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  // --------------------------------------------------------------------------
  // Validation: invalid email format
  // Route uses EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  // sanitizeEmail() lowercases + trims, so an invalid format still hits the DB
  // lookup (no explicit regex check in forgot-password handler) -- the handler
  // only rejects a falsy/null email. Format-invalid addresses that are truthy
  // strings will result in a DB miss and the generic 200 message. We assert the
  // actual observable behaviour rather than a theorised one.
  // --------------------------------------------------------------------------

  it('handles a whitespace-only email gracefully (treats as missing)', async (t) => {
    // sanitizeEmail("   ") -> "" -> falsy -> 400
    const res = await makeRequest('POST', '/auth/forgot-password', { email: '   ' });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for whitespace-only email, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('does not error on a format-invalid email (returns generic 200 -- no DB match)', async (t) => {
    // The route does not regex-validate in /forgot-password -- it sanitizes
    // and looks up the DB. An invalid format just won't match any user.
    const res = await makeRequest('POST', '/auth/forgot-password', {
      email: 'not-an-email-at-all',
    });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    // Acceptable: either 200 (generic message, no user found) or 400 (rejected)
    assert.ok(
      res.status === 200 || res.status === 400 || res.status === 422,
      `Unexpected status ${res.status}: ${res.text}`
    );
    // Must never expose an internal error
    assert.notEqual(res.status, 500, 'Server must not return 500 for a malformed email');
  });

  // --------------------------------------------------------------------------
  // Rate limiting: forgotPasswordLimiter allows 3 per hour per email
  // We exhaust those within this test. This test runs LAST in this describe
  // block so earlier tests are not affected.
  // Note: the key is keyed on email, so we use a dedicated throwaway email to
  // avoid interfering with other tests that use testEmail.
  // --------------------------------------------------------------------------

  it('returns 429 after 3 requests for the same email within the rate-limit window', async () => {
    const rateLimitEmail = uniqueEmail('ratelimit');

    // Three requests are allowed (max: 3)
    for (let i = 1; i <= 3; i++) {
      const res = await makeRequest('POST', '/auth/forgot-password', { email: rateLimitEmail });
      // Each of the first 3 must succeed (200) -- the email doesn't exist so no
      // actual reset token is created, just the generic response is returned.
      assert.equal(
        res.status,
        200,
        `Request #${i} should return 200 before rate-limit, got ${res.status}: ${res.text}`
      );
    }

    // The 4th request for the same email must be blocked
    const blockedRes = await makeRequest('POST', '/auth/forgot-password', { email: rateLimitEmail });

    assert.equal(
      blockedRes.status,
      429,
      `Expected 429 on 4th request, got ${blockedRes.status}: ${blockedRes.text}`
    );
    assert.equal(blockedRes.json?.success, false, 'success must be false when rate-limited');
    assert.ok(
      typeof blockedRes.json?.error === 'string',
      'A rate-limit error message must be present'
    );
  });

});

// ============================================================================
// POST /auth/reset-password
// ============================================================================

describe('POST /auth/reset-password', () => {

  // --------------------------------------------------------------------------
  // Validation: missing required fields
  // --------------------------------------------------------------------------

  it('returns 400 when both token and password are missing', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {});
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    // Error message must mention both required fields or at least be present
    assert.ok(typeof res.json?.error === 'string' && res.json.error.length > 0);
  });

  it('returns 400 when token is present but password is missing', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      // password omitted
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    assert.ok(typeof res.json?.error === 'string' && res.json.error.length > 0);
  });

  it('returns 400 when password is present but token is missing', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      password: STRONG_PASSWORD,
      // token omitted
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    assert.ok(typeof res.json?.error === 'string' && res.json.error.length > 0);
  });

  it('returns 400 when token is an empty string', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: '',
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for empty token, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 when password is an empty string', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: '',
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for empty password, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  // --------------------------------------------------------------------------
  // Validation: weak / non-compliant passwords
  // Password rules (from validatePasswordComplexity + validatePassword):
  //   >= 8 chars, >= 1 uppercase, >= 1 lowercase, >= 1 digit, >= 1 special char
  //   <= 128 chars, not equal to email, not in common-passwords list
  // Even with a fake token the password validation runs first (before DB lookup).
  // --------------------------------------------------------------------------

  it('returns 400 for a completely weak password (no complexity rules satisfied)', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: WEAK_PASSWORD, // 'password' -- no uppercase, digit, or special char
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for weak password, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    assert.ok(typeof res.json?.error === 'string' && res.json.error.length > 0);
  });

  it('returns 400 for a password that is too short', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: TOO_SHORT, // 'Ab1!' -- only 4 chars
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for short password, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 for a password missing a special character', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: ALMOST_STRONG, // 'Abcdefg1' -- no special char
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for password missing special char, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 for a password with no uppercase letter', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: 'abcdefg1!',
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for password missing uppercase, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 for a password with no digit', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: 'Abcdefgh!',
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for password missing digit, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('returns 400 for a password that exceeds the 128-character maximum', async (t) => {
    const overlong = 'A1!' + 'x'.repeat(130); // 133 chars

    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: overlong,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for overlong password, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  // --------------------------------------------------------------------------
  // Invalid / expired token (with a password that would otherwise pass)
  // --------------------------------------------------------------------------

  it('returns 400 for a structurally valid token that does not exist in the DB', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for unknown token, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    assert.ok(
      typeof res.json?.error === 'string' && res.json.error.length > 0,
      'Must return an error message for an invalid token'
    );
    // Specifically: 'Invalid or expired reset link'
    assert.match(
      res.json.error,
      /invalid|expired/i,
      'Error message should describe the token as invalid or expired'
    );
  });

  it('returns 400 for a token that is entirely garbage (short random string)', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: 'garbage',
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for garbage token, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('never returns 500 for any combination of bad inputs', async (t) => {
    const badCombinations = [
      { token: null,      password: null },
      { token: 123,       password: 456 },
      { token: [],        password: {} },
      { token: FAKE_TOKEN, password: WEAK_PASSWORD },
      { token: '',        password: '' },
    ];

    for (const body of badCombinations) {
      const res = await makeRequest('POST', '/auth/reset-password', body);
      if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');
      assert.notEqual(
        res.status,
        500,
        `Server returned 500 for body: ${JSON.stringify(body)}`
      );
    }
  });

});

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases', () => {

  it('POST /auth/forgot-password -- empty body returns 400', async (t) => {
    // makeRequest with an explicit empty object serialises to {} -- the server
    // receives no email property. sanitizeEmail(undefined) returns null -> 400.
    const res = await makeRequest('POST', '/auth/forgot-password', {});
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for empty body, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('POST /auth/reset-password -- empty body returns 400', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {});
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.ok(
      res.status === 400 || res.status === 422,
      `Expected 400 or 422 for empty body, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
  });

  it('POST /auth/forgot-password -- XSS payload in email field is sanitized or rejected', async (t) => {
    const xssEmail = '<script>alert(1)</script>@evil.com';

    const res = await makeRequest('POST', '/auth/forgot-password', { email: xssEmail });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    // The server must not crash and must not echo raw script tags in the response
    assert.notEqual(res.status, 500, 'Server must not crash on XSS input');

    // The raw script tag must not appear in any JSON response value
    const rawBody = res.text || '';
    assert.ok(
      !rawBody.includes('<script>'),
      'Response must not echo the raw <script> tag back to the client'
    );
  });

  it('POST /auth/forgot-password -- very long email is rejected or handled without crashing', async (t) => {
    const longEmail = 'a'.repeat(500) + '@example.com';

    const res = await makeRequest('POST', '/auth/forgot-password', { email: longEmail });
    if (res.status === 429) return t.skip('rate-limited by authLimiter');

    // Must not 500
    assert.notEqual(res.status, 500, `Server must not 500 on a 512-char email, got: ${res.text}`);
  });

  it('POST /auth/reset-password -- token that looks valid but does not exist returns 400 with correct error', async (t) => {
    // 64-hex token is the exact format the server issues (32 random bytes hex-encoded)
    const plausibleFakeToken = crypto.randomBytes(32).toString('hex');

    const res = await makeRequest('POST', '/auth/reset-password', {
      token: plausibleFakeToken,
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.equal(
      res.status,
      400,
      `Expected 400 for a plausible-but-absent token, got ${res.status}: ${res.text}`
    );
    assert.equal(res.json?.success, false);
    assert.match(
      res.json?.error ?? '',
      /invalid|expired/i,
      'Error must describe the token as invalid or expired'
    );
  });

  it('POST /auth/reset-password -- SQL injection attempt in token field is rejected cleanly', async (t) => {
    const sqlInjectionToken = "' OR '1'='1"; // classic injection

    const res = await makeRequest('POST', '/auth/reset-password', {
      token: sqlInjectionToken,
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    // Must not crash and must not succeed
    assert.notEqual(res.status, 500, 'Server must not 500 on SQL injection in token');
    assert.equal(res.json?.success, false, 'SQL injection in token must not succeed');
  });

  it('POST /auth/reset-password -- numeric token type is coerced/rejected, not a server crash', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: 12345678,
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    assert.notEqual(res.status, 500, `Got 500: ${res.text}`);
    // Either rejected for being invalid, or treated as string "12345678" and not found
    assert.equal(res.json?.success, false);
  });

  it('response headers include Cache-Control: no-store for forgot-password', async () => {
    const res = await makeRequest('POST', '/auth/forgot-password', {
      email: uniqueEmail('cache'),
    });

    const cacheControl = res.headers.get('cache-control') || '';
    assert.ok(
      cacheControl.includes('no-store'),
      `Expected Cache-Control: no-store, got: "${cacheControl}"`
    );
  });

  it('response headers include Cache-Control: no-store for reset-password', async (t) => {
    const res = await makeRequest('POST', '/auth/reset-password', {
      token: FAKE_TOKEN,
      password: STRONG_PASSWORD,
    });
    if (!assertNotRateLimited(res)) return t.skip('rate-limited by authLimiter');

    const cacheControl = res.headers.get('cache-control') || '';
    assert.ok(
      cacheControl.includes('no-store'),
      `Expected Cache-Control: no-store, got: "${cacheControl}"`
    );
  });

});
