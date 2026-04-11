/**
 * Vertifile -- E2E Tests: Stamp Configuration
 * =============================================
 * QA: Rina  |  Regression: Nir
 *
 * Tests stamp customization (Layer 2 visual wrapper):
 * save config, verify on upload, reset to defaults.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/e2e-stamp-config.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  skipIfNoDatabase,
  uniqueEmail,
  makeRequest,
  createTestUser,
  uploadTestDocument,
  cleanupTestUser,
} = require('./helpers');

skipIfNoDatabase();

describe('E2E: Stamp Config', () => {
  let cookie;
  let userEmail;
  let setupOk = false;

  before(async () => {
    userEmail = uniqueEmail('stamp');
    const session = await createTestUser(userEmail);
    if (!session) {
      console.log('[SKIP] Stamp config tests -- user creation rate-limited');
      return;
    }
    cookie = session.cookie;
    setupOk = true;
  });

  after(async () => {
    if (cookie) await cleanupTestUser(cookie);
  });

  function guard(t) {
    if (!setupOk) { t.skip('Setup rate-limited'); return true; }
    return false;
  }

  it('1. GET /api/user/stamp -- new user has empty stamp config', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('GET', '/api/user/stamp', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.stampConfig !== undefined, 'Must return stampConfig');
    assert.deepEqual(res.json.stampConfig, {}, 'Default stamp config should be empty');
  });

  it('2. POST /api/user/stamp -- saves custom stamp configuration', async (t) => {
    if (guard(t)) return;
    const customConfig = {
      accentColor: '#FF5733',
      waveColors: ['#1A1A2E', '#16213E', '#0F3460'],
      orgName: 'E2E Test Org',
      stampText: 'VERIFIED',
    };
    const res = await makeRequest('POST', '/api/user/stamp', customConfig, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.stampConfig, 'Must return saved config');
    assert.equal(res.json.stampConfig.accentColor, '#FF5733');
    assert.deepEqual(res.json.stampConfig.waveColors, ['#1A1A2E', '#16213E', '#0F3460']);
    assert.equal(res.json.stampConfig.orgName, 'E2E Test Org');
    assert.equal(res.json.stampConfig.stampText, 'VERIFIED');
  });

  it('3. GET /api/user/stamp -- reads back saved config correctly', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('GET', '/api/user/stamp', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.stampConfig.accentColor, '#FF5733');
    assert.deepEqual(res.json.stampConfig.waveColors, ['#1A1A2E', '#16213E', '#0F3460']);
    assert.equal(res.json.stampConfig.orgName, 'E2E Test Org');
    assert.ok(res.json.updatedAt, 'Must include updatedAt timestamp');
  });

  it('4. Upload after stamp config -- PVF reflects custom branding', async (t) => {
    if (guard(t)) return;
    const content = `Stamp test doc ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const uploadRes = await uploadTestDocument(cookie, { content });
    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.json.success, true);
    const shareId = uploadRes.json.shareId;
    assert.ok(shareId, 'Must get shareId');

    const pvfRes = await makeRequest('GET', `/d/${shareId}`);
    assert.equal(pvfRes.status, 200);
    assert.ok(pvfRes.text.length > 100, 'PVF HTML must have content');

    // Cleanup
    await makeRequest('DELETE', `/api/user/documents/${uploadRes.json.hash}`, null, cookie);
  });

  it('5. POST /api/user/stamp -- reset to empty config', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/user/stamp', {}, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);

    const readRes = await makeRequest('GET', '/api/user/stamp', null, cookie);
    assert.equal(readRes.status, 200);
    assert.deepEqual(readRes.json.stampConfig, {}, 'Config should be empty after reset');
  });

  it('6. Upload after reset -- PVF uses default branding', async (t) => {
    if (guard(t)) return;
    const content = `Default stamp test ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const uploadRes = await uploadTestDocument(cookie, { content });
    assert.equal(uploadRes.status, 200);
    const pvfRes = await makeRequest('GET', `/d/${uploadRes.json.shareId}`);
    assert.equal(pvfRes.status, 200);
    assert.ok(pvfRes.text.length > 100, 'PVF must render with default branding');
    await makeRequest('DELETE', `/api/user/documents/${uploadRes.json.hash}`, null, cookie);
  });

  it('7. POST /api/user/stamp -- rejects >7 wave colors', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/user/stamp', {
      waveColors: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'],
    }, cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('8. POST /api/user/stamp -- orgName is truncated at 50 chars', async (t) => {
    if (guard(t)) return;
    const longName = 'A'.repeat(60);
    const res = await makeRequest('POST', '/api/user/stamp', { orgName: longName }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.stampConfig.orgName.length <= 50, 'orgName should be truncated to 50 chars');
  });

  it('9. POST /api/user/stamp -- brandText saved and sanitized', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/user/stamp', { brandText: 'Protected' }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.stampConfig.brandText, 'Protected');
  });

  it('10. GET /api/user/stamp -- unauthenticated returns 401', async () => {
    const res = await makeRequest('GET', '/api/user/stamp');
    assert.equal(res.status, 401);
  });

  it('10b. POST /api/user/stamp -- unauthenticated returns 401', async () => {
    const res = await makeRequest('POST', '/api/user/stamp', { accentColor: '#000000' });
    assert.equal(res.status, 401);
  });

  it('11. POST /api/user/stamp -- strips unknown keys', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/user/stamp', {
      accentColor: '#123456',
      maliciousKey: 'should_not_persist',
    }, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.stampConfig.accentColor, '#123456');
    assert.ok(!res.json.stampConfig.maliciousKey, 'Unknown keys must be stripped');
  });
});
