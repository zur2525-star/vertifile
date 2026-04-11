/**
 * Vertifile -- E2E Tests: Overage System
 * ========================================
 * QA: Rina  |  Regression: Nir
 *
 * Tests the overage tracking system:
 * - Upload documents, verify counter increments
 * - Verify overageFlag in upload response
 * - Verify documents_used tracks correctly
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/e2e-overage.test.js
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

describe('E2E: Overage System', () => {
  let cookie;
  let userEmail;
  let setupOk = false;
  let uploadedHashes = [];

  before(async () => {
    userEmail = uniqueEmail('overage');
    const session = await createTestUser(userEmail);
    if (!session) {
      console.log('[SKIP] Overage tests -- user creation rate-limited');
      return;
    }
    cookie = session.cookie;
    setupOk = true;
  });

  after(async () => {
    for (const hash of uploadedHashes) {
      await makeRequest('DELETE', `/api/user/documents/${hash}`, null, cookie).catch(() => {});
    }
    if (cookie) await cleanupTestUser(cookie);
  });

  function guard(t) {
    if (!setupOk) { t.skip('Setup rate-limited'); return true; }
    return false;
  }

  it('1. GET /api/user/me -- new user starts with 0 documents used', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('GET', '/api/user/me', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.user.documentsUsed, 0, 'New user should have 0 documents used');
    assert.ok(res.json.user.documentsLimit > 0, 'documentsLimit must be positive');
  });

  it('2. Upload increments documentsUsed counter', async (t) => {
    if (guard(t)) return;
    const content1 = `Overage test 1 ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const res1 = await uploadTestDocument(cookie, { content: content1 });
    assert.equal(res1.status, 200);
    assert.equal(res1.json.documentsUsed, 1, 'documentsUsed should be 1 after first upload');
    uploadedHashes.push(res1.json.hash);

    const content2 = `Overage test 2 ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const res2 = await uploadTestDocument(cookie, { content: content2 });
    assert.equal(res2.status, 200);
    assert.equal(res2.json.documentsUsed, 2, 'documentsUsed should be 2 after second upload');
    uploadedHashes.push(res2.json.hash);
  });

  it('3. Upload response includes overage field', async (t) => {
    if (guard(t)) return;
    const content = `Overage field test ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const res = await uploadTestDocument(cookie, { content });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok('overage' in res.json, 'Response must include overage field');
    assert.equal(typeof res.json.overage, 'boolean', 'overage must be a boolean');
    assert.equal(res.json.overage, false, 'Should not be in overage with few uploads');
    uploadedHashes.push(res.json.hash);
  });

  it('4. Upload response includes documentsLimit', async (t) => {
    if (guard(t)) return;
    const content = `Limit test ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const res = await uploadTestDocument(cookie, { content });
    assert.equal(res.status, 200);
    assert.ok(typeof res.json.documentsLimit === 'number', 'documentsLimit must be a number');
    assert.ok(res.json.documentsLimit > 0, 'documentsLimit must be positive');
    uploadedHashes.push(res.json.hash);
  });

  it('5. GET /api/user/me -- reflects updated document count', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('GET', '/api/user/me', null, cookie);
    assert.equal(res.status, 200);
    assert.ok(
      res.json.user.documentsUsed >= 4,
      `documentsUsed should be >= 4 (got ${res.json.user.documentsUsed})`
    );
  });

  it('6. Deleting a document decrements documentsUsed', async (t) => {
    if (guard(t)) return;
    const beforeRes = await makeRequest('GET', '/api/user/me', null, cookie);
    const beforeCount = beforeRes.json.user.documentsUsed;

    const hashToDelete = uploadedHashes.shift();
    const delRes = await makeRequest('DELETE', `/api/user/documents/${hashToDelete}`, null, cookie);
    assert.equal(delRes.status, 200);

    const afterRes = await makeRequest('GET', '/api/user/me', null, cookie);
    assert.equal(
      afterRes.json.user.documentsUsed,
      beforeCount - 1,
      'documentsUsed should decrease by 1 after delete'
    );
  });

  it('7. Upload response contract includes all required fields', async (t) => {
    if (guard(t)) return;
    const content = `Contract test ${Date.now()} ${crypto.randomBytes(8).toString('hex')}`;
    const res = await uploadTestDocument(cookie, { content });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);

    const requiredFields = ['hash', 'shareId', 'fileName', 'documentsUsed', 'documentsLimit'];
    for (const field of requiredFields) {
      assert.ok(field in res.json, `Upload response must include ${field}`);
    }
    assert.ok(/^[a-f0-9]{64}$/.test(res.json.hash), 'hash must be 64-char hex');
    assert.ok(typeof res.json.shareId === 'string' && res.json.shareId.length > 0, 'shareId must be non-empty');
    uploadedHashes.push(res.json.hash);
  });

  it('8. Multiple uploads of different content produce unique hashes', async (t) => {
    if (guard(t)) return;
    const hashes = new Set();
    for (let i = 0; i < 3; i++) {
      const content = `Uniqueness test ${i} ${Date.now()} ${crypto.randomBytes(16).toString('hex')}`;
      const res = await uploadTestDocument(cookie, { content });
      assert.equal(res.status, 200);
      hashes.add(res.json.hash);
      uploadedHashes.push(res.json.hash);
    }
    assert.equal(hashes.size, 3, 'All 3 uploads must produce unique hashes');
  });
});
