'use strict';

/**
 * Vertifile -- E2E Tests: API Key Lifecycle
 * ==========================================
 *
 * Tests the full lifecycle of user API keys:
 *   GET  /api/user/api-key  -- retrieve current key
 *   POST /api/user/api-key  -- generate (idempotent)
 *   X-API-Key header usage on /api/org/stats
 *
 * Key format: vf_live_ + 48 hex chars (24 random bytes)
 * POST is idempotent: a second call returns the same key, not a new one.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/api-key-lifecycle.test.js
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

skipIfNoDatabase();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate the API key format produced by POST /api/user/api-key.
 * Format: "vf_live_" followed by exactly 48 lowercase hex characters
 * (crypto.randomBytes(24).toString('hex')).
 */
function isValidApiKeyFormat(key) {
  if (typeof key !== 'string') return false;
  return /^vf_live_[0-9a-f]{48}$/.test(key);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('API Key Lifecycle', () => {
  let cookie = null;
  let rateLimited = false;

  // Shared state across test groups
  let firstKey = null;

  before(async () => {
    const email = uniqueEmail('apikey');
    const result = await createTestUser(email, STRONG_PASSWORD);

    if (!result) {
      rateLimited = true;
      console.log('[WARN] createTestUser returned null (rate-limited). All tests will be skipped.');
      return;
    }

    cookie = result.cookie;
  });

  after(async () => {
    await cleanupTestUser(cookie);
  });

  // =========================================================================
  // GET /api/user/api-key -- no key generated yet
  // =========================================================================

  describe('GET /api/user/api-key (before generation)', () => {
    it('returns 401 without authentication', async () => {
      const res = await makeRequest('GET', '/api/user/api-key');
      assert.equal(res.status, 401);
      assert.equal(res.json.success, false);
    });

    it('returns 200 with a valid session cookie', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');

      const res = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.equal(res.json.success, true);
    });

    it('response contains apiKey field that is null when no key has been generated', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');

      const res = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(res.status, 200);
      assert.ok('apiKey' in res.json, 'Response must contain apiKey field');
      // Fresh user -- no key yet
      assert.equal(res.json.apiKey, null, 'apiKey must be null before generation');
    });

    it('response shape is { success: true, apiKey: null }', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');

      const res = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json).sort(), ['apiKey', 'success'].sort());
      assert.equal(res.json.success, true);
      assert.equal(res.json.apiKey, null);
    });
  });

  // =========================================================================
  // POST /api/user/api-key -- generate
  // =========================================================================

  describe('POST /api/user/api-key (generate)', () => {
    it('returns 401 without authentication', async () => {
      const res = await makeRequest('POST', '/api/user/api-key', {});
      assert.equal(res.status, 401);
      assert.equal(res.json.success, false);
    });

    it('returns 200 with a valid session cookie and generates a key', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');

      const res = await makeRequest('POST', '/api/user/api-key', {}, cookie);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
      assert.equal(res.json.success, true);
      assert.ok(res.json.apiKey, 'apiKey must be present and non-null after generation');

      // Stash for downstream groups
      firstKey = res.json.apiKey;
    });

    it('generated key has correct format: vf_live_ prefix + 48 hex chars', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- previous test did not run');

      assert.ok(
        isValidApiKeyFormat(firstKey),
        `API key "${firstKey}" does not match expected format vf_live_[0-9a-f]{48}`
      );
    });

    it('generated key is returned directly in the POST response', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- previous test did not run');

      // The POST response already contained the key -- we verify by doing
      // another POST (idempotent) and comparing against what GET returns.
      const postRes = await makeRequest('POST', '/api/user/api-key', {}, cookie);
      assert.equal(postRes.status, 200);
      assert.equal(postRes.json.success, true);
      assert.equal(
        postRes.json.apiKey,
        firstKey,
        'POST response must return the generated key'
      );
    });
  });

  // =========================================================================
  // GET /api/user/api-key -- after generation
  // =========================================================================

  describe('GET /api/user/api-key (after generation)', () => {
    it('returns the same key that was generated via POST', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      const res = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(
        res.json.apiKey,
        firstKey,
        'GET must return the same key that POST generated'
      );
    });

    it('key is stable -- repeated GET calls return the same value', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      const res1 = await makeRequest('GET', '/api/user/api-key', null, cookie);
      const res2 = await makeRequest('GET', '/api/user/api-key', null, cookie);

      assert.equal(res1.status, 200);
      assert.equal(res2.status, 200);
      assert.equal(
        res1.json.apiKey,
        res2.json.apiKey,
        'Key must not change between GET calls'
      );
      assert.equal(res1.json.apiKey, firstKey, 'Key must match originally generated value');
    });

    it('response shape is { success: true, apiKey: string }', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      const res = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json).sort(), ['apiKey', 'success'].sort());
      assert.equal(res.json.success, true);
      assert.equal(typeof res.json.apiKey, 'string');
    });
  });

  // =========================================================================
  // POST /api/user/api-key -- idempotence (no regeneration)
  // =========================================================================

  describe('POST /api/user/api-key (idempotence)', () => {
    it('second POST returns the same key as the first (no rotation)', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      const res = await makeRequest('POST', '/api/user/api-key', {}, cookie);
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(
        res.json.apiKey,
        firstKey,
        'Second POST must return the existing key, not a new one'
      );
    });

    it('GET after second POST still returns the original key', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      // POST again
      await makeRequest('POST', '/api/user/api-key', {}, cookie);

      // GET must still show the same key
      const getRes = await makeRequest('GET', '/api/user/api-key', null, cookie);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.json.apiKey, firstKey, 'Key must be unchanged after repeated POST');
    });
  });

  // =========================================================================
  // API key usage via X-API-Key header
  // =========================================================================

  describe('API key usage on gateway endpoints', () => {
    it('generated key is accepted on GET /api/org/stats (returns 200)', async (t) => {
      if (rateLimited || !cookie) return t.skip('No session available');
      if (!firstKey) return t.skip('Key not available -- generation test did not run');

      // makeRequest only sets Cookie headers; use fetch directly for X-API-Key.
      const url = 'http://localhost:3002/api/org/stats';
      const raw = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': firstKey },
        redirect: 'manual',
      });
      const text = await raw.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }

      assert.equal(
        raw.status,
        200,
        `Expected 200 with valid API key, got ${raw.status}: ${text}`
      );
      assert.equal(json.success, true, 'Response success must be true');
      assert.ok('orgId' in json, 'Response must include orgId');
    });

    it('random/invalid API key is rejected with 401', async () => {
      const fakeKey = 'vf_live_' + crypto.randomBytes(24).toString('hex');

      const url = 'http://localhost:3002/api/org/stats';
      const raw = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': fakeKey },
        redirect: 'manual',
      });
      const text = await raw.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }

      assert.equal(
        raw.status,
        401,
        `Expected 401 for invalid key, got ${raw.status}: ${text}`
      );
      assert.equal(json.success, false);
    });

    it('missing X-API-Key header returns 401 with descriptive error', async () => {
      const url = 'http://localhost:3002/api/org/stats';
      const raw = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
      });
      const text = await raw.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }

      assert.equal(raw.status, 401);
      assert.equal(json.success, false);
      assert.ok(
        json.error.toLowerCase().includes('api key') || json.error.toLowerCase().includes('key'),
        `Error message should mention "API key", got: "${json.error}"`
      );
    });
  });
});
