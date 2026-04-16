/**
 * Vertifile -- E2E Tests: User Branding
 * =======================================
 * Tests the GET /api/user/branding and POST /api/user/branding endpoints:
 * authentication guards, response shape, field validation, and round-trip
 * persistence.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/user-branding.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

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
// Shared session state
// ---------------------------------------------------------------------------

let cookie;
let setupOk = false;

function guard(t) {
  if (!setupOk) { t.skip('Setup rate-limited or failed'); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  const email = uniqueEmail('branding');
  const session = await createTestUser(email, STRONG_PASSWORD);
  if (!session) {
    console.log('[SKIP] User branding tests -- user creation rate-limited');
    return;
  }
  cookie = session.cookie;
  setupOk = true;
});

after(async () => {
  if (cookie) await cleanupTestUser(cookie);
});

// ---------------------------------------------------------------------------
// GET /api/user/branding
// ---------------------------------------------------------------------------

describe('GET /api/user/branding', () => {
  it('returns 401 without authentication', async () => {
    const res = await makeRequest('GET', '/api/user/branding');
    assert.equal(res.status, 401);
    assert.equal(res.json?.success, false);
  });

  it('returns 200 with a valid session cookie', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('GET', '/api/user/branding', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('returns the default branding shape when nothing has been set', async (t) => {
    if (guard(t)) return;
    // Use a fresh user so there is guaranteed no prior branding saved
    const freshEmail = uniqueEmail('branding-fresh');
    const freshSession = await createTestUser(freshEmail, STRONG_PASSWORD);
    if (!freshSession) { t.skip('Setup rate-limited'); return; }

    try {
      const res = await makeRequest('GET', '/api/user/branding', null, freshSession.cookie);
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);

      // The three fields the route always returns
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'customIcon'),
        'Response must include customIcon');
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'brandColor'),
        'Response must include brandColor');
      assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'waveColor'),
        'Response must include waveColor');

      // Defaults are null
      assert.equal(res.json.customIcon, null);
      assert.equal(res.json.brandColor, null);
      assert.equal(res.json.waveColor, null);
    } finally {
      await cleanupTestUser(freshSession.cookie);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/user/branding
// ---------------------------------------------------------------------------

describe('POST /api/user/branding', () => {
  it('returns 401 without authentication', async () => {
    const res = await makeRequest('POST', '/api/user/branding', { brandColor: '#aabbcc' });
    assert.equal(res.status, 401);
    assert.equal(res.json?.success, false);
  });

  it('returns 200 with valid branding data', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/user/branding', {
      brandColor: '#1a2b3c',
      waveColor: '#4d5e6f',
    }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('rejects orgName longer than 200 characters', async (t) => {
    if (guard(t)) return;
    const tooLong = 'O'.repeat(201);
    const res = await makeRequest('POST', '/api/user/branding', { orgName: tooLong }, cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      typeof res.json.error === 'string' && res.json.error.length > 0,
      'Must include an error message'
    );
  });

  it('accepts orgName of exactly 200 characters', async (t) => {
    if (guard(t)) return;
    const exactly200 = 'N'.repeat(200);
    const res = await makeRequest('POST', '/api/user/branding', { orgName: exactly200 }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('rejects stampText longer than 500 characters', async (t) => {
    if (guard(t)) return;
    const tooLong = 'S'.repeat(501);
    const res = await makeRequest('POST', '/api/user/branding', { stampText: tooLong }, cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.ok(
      typeof res.json.error === 'string' && res.json.error.length > 0,
      'Must include an error message'
    );
  });

  it('accepts stampText of exactly 500 characters', async (t) => {
    if (guard(t)) return;
    const exactly500 = 'T'.repeat(500);
    const res = await makeRequest('POST', '/api/user/branding', { stampText: exactly500 }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  it('does not persist unknown / extra fields', async (t) => {
    if (guard(t)) return;
    // POST with an unknown field
    const postRes = await makeRequest('POST', '/api/user/branding', {
      brandColor: '#123456',
      unknownField: 'should-not-appear',
      __proto__: 'ignored',
    }, cookie);
    // The endpoint must either reject (400) or succeed (200) without echoing the unknown field
    if (postRes.status === 400) {
      // Strict rejection is acceptable
      assert.equal(postRes.json.success, false);
    } else {
      assert.equal(postRes.status, 200);
      assert.equal(postRes.json.success, true);

      // Verify via GET that the unknown field is not persisted
      const getRes = await makeRequest('GET', '/api/user/branding', null, cookie);
      assert.equal(getRes.status, 200);
      assert.ok(
        !Object.prototype.hasOwnProperty.call(getRes.json, 'unknownField'),
        'unknownField must not appear in GET response'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('Round-trip: POST then GET', () => {
  it('values saved via POST are returned by GET', async (t) => {
    if (guard(t)) return;
    const payload = {
      brandColor: '#ff0099',
      waveColor: '#00ccff',
    };

    const postRes = await makeRequest('POST', '/api/user/branding', payload, cookie);
    assert.equal(postRes.status, 200);
    assert.equal(postRes.json.success, true);

    const getRes = await makeRequest('GET', '/api/user/branding', null, cookie);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.success, true);
    assert.equal(getRes.json.brandColor, payload.brandColor,
      'brandColor must match what was POSTed');
    assert.equal(getRes.json.waveColor, payload.waveColor,
      'waveColor must match what was POSTed');
  });

  it('second POST overwrites first -- GET reflects updated values', async (t) => {
    if (guard(t)) return;
    // First save
    await makeRequest('POST', '/api/user/branding', {
      brandColor: '#aaaaaa',
      waveColor: '#bbbbbb',
    }, cookie);

    // Second save with new values
    const updated = {
      brandColor: '#111111',
      waveColor: '#222222',
    };
    const postRes = await makeRequest('POST', '/api/user/branding', updated, cookie);
    assert.equal(postRes.status, 200);
    assert.equal(postRes.json.success, true);

    const getRes = await makeRequest('GET', '/api/user/branding', null, cookie);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.brandColor, updated.brandColor,
      'brandColor must reflect the second POST');
    assert.equal(getRes.json.waveColor, updated.waveColor,
      'waveColor must reflect the second POST');
  });
});
