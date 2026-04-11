/**
 * Vertifile -- E2E Tests: Document Verification
 * ================================================
 * QA: Rina  |  Regression: Nir
 *
 * Tests the verification flow:
 *   - POST /api/verify   (full verification with DB lookup)
 *   - GET  /api/verify-public (stateless Ed25519 verification)
 *   - Tampered hash detection
 *   - Invalid signature detection
 *   - Missing/malformed input handling
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/e2e-verification.test.js
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

describe('E2E: Verification', () => {
  let cookie;
  let userEmail;
  let uploadedHash;
  let uploadedShareId;
  let setupOk = false;

  before(async () => {
    userEmail = uniqueEmail('verify');
    const session = await createTestUser(userEmail);
    if (!session) {
      console.log('[SKIP] Verification tests -- user creation rate-limited');
      return;
    }
    cookie = session.cookie;

    // Upload a test document to verify
    const content = `Verification test document ${Date.now()} ${crypto.randomBytes(16).toString('hex')}`;
    const res = await uploadTestDocument(cookie, { content });
    if (res.status !== 200) {
      console.log(`[SKIP] Verification tests -- upload failed: ${res.status}`);
      return;
    }
    uploadedHash = res.json.hash;
    uploadedShareId = res.json.shareId;
    setupOk = true;
  });

  after(async () => {
    if (uploadedHash && cookie) {
      await makeRequest('DELETE', `/api/user/documents/${uploadedHash}`, null, cookie).catch(() => {});
    }
    if (cookie) await cleanupTestUser(cookie);
  });

  function guard(t) {
    if (!setupOk) { t.skip('Setup rate-limited or upload failed'); return true; }
    return false;
  }

  // ===================================================================
  // POST /api/verify -- full verification
  // ===================================================================

  it('1. POST /api/verify -- correct hash returns verified', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/verify', { hash: uploadedHash });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.verified, true, 'Document should be verified');
    assert.ok(res.json.document, 'Must include document details');
    assert.ok(res.json.document.originalName, 'Must include originalName');
    assert.ok(res.json.document.timestamp, 'Must include timestamp');
    assert.ok(res.json.document.orgName, 'Must include orgName');
  });

  it('2. POST /api/verify -- tampered hash returns not verified', async (t) => {
    if (guard(t)) return;
    const tamperedHash = crypto.createHash('sha256')
      .update('tampered-content-' + Date.now())
      .digest('hex');
    const res = await makeRequest('POST', '/api/verify', { hash: tamperedHash });
    assert.equal(res.status, 200);
    assert.equal(res.json.verified, false, 'Tampered hash must not verify');
  });

  it('3. POST /api/verify -- correct hash + wrong signature = invalid', async (t) => {
    if (guard(t)) return;
    const fakeSignature = crypto.randomBytes(32).toString('hex');
    const res = await makeRequest('POST', '/api/verify', {
      hash: uploadedHash,
      signature: fakeSignature,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.verified, false, 'Wrong signature must not verify');
    assert.ok(
      res.json.reason?.includes('invalid_signature') || res.json.reason?.includes('signature'),
      `Reason should mention signature. Got: ${res.json.reason}`
    );
  });

  it('4. POST /api/verify -- missing hash returns 400', async () => {
    const res = await makeRequest('POST', '/api/verify', {});
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
    assert.equal(res.json.verified, false);
  });

  it('5. POST /api/verify -- invalid hash format returns 400', async () => {
    const res = await makeRequest('POST', '/api/verify', { hash: 'not-a-valid-hex-hash' });
    assert.equal(res.status, 400);
    assert.equal(res.json.verified, false);
  });

  it('6. POST /api/verify -- works without authentication', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/verify', { hash: uploadedHash });
    assert.equal(res.status, 200);
    assert.equal(res.json.verified, true, 'Verification should work without auth');
  });

  // ===================================================================
  // GET /api/verify-public -- stateless Ed25519 verification
  // ===================================================================

  it('7. GET /api/verify-public -- missing hash returns 400', async () => {
    const res = await makeRequest('GET', '/api/verify-public?signature=abc&keyId=1234567890abcdef&payload=test');
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.error, 'invalid_input');
    assert.equal(res.json.detail, 'hash');
  });

  it('7b. GET /api/verify-public -- missing signature returns 400', async () => {
    const fakeHash = crypto.createHash('sha256').update('test').digest('hex');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&keyId=1234567890abcdef&payload=${fakeHash}|orgid|time|rcpt|ci`);
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'signature');
  });

  it('7c. GET /api/verify-public -- missing keyId returns 400', async () => {
    const fakeHash = crypto.createHash('sha256').update('test').digest('hex');
    const fakeSig = crypto.randomBytes(64).toString('base64url');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=${fakeSig}&payload=${fakeHash}|orgid|time|rcpt|ci`);
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'keyId');
  });

  it('7d. GET /api/verify-public -- missing payload returns 400', async () => {
    const fakeHash = crypto.createHash('sha256').update('test').digest('hex');
    const fakeSig = crypto.randomBytes(64).toString('base64url');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=${fakeSig}&keyId=1234567890abcdef`);
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'payload');
  });

  it('8. GET /api/verify-public -- invalid hash format returns 400', async () => {
    const res = await makeRequest('GET', '/api/verify-public?hash=tooshort&signature=abc&keyId=1234567890abcdef&payload=tooshort|o|t|r|c');
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'hash');
  });

  it('9. GET /api/verify-public -- invalid signature format returns 400', async () => {
    const fakeHash = crypto.createHash('sha256').update('test').digest('hex');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=short&keyId=1234567890abcdef&payload=${fakeHash}|o|t|r|c`);
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'signature');
  });

  it('10. GET /api/verify-public -- payload/hash mismatch returns 400', async () => {
    const fakeHash = crypto.createHash('sha256').update('test1').digest('hex');
    const differentHash = crypto.createHash('sha256').update('test2').digest('hex');
    const fakeSig = crypto.randomBytes(64).toString('base64url');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=${fakeSig}&keyId=1234567890abcdef&payload=${differentHash}|org|time|rcpt|ci`);
    assert.equal(res.status, 400);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.detail, 'payload_hash_mismatch');
  });

  it('11. GET /api/verify-public -- unknown keyId returns unknown_key', async () => {
    const fakeHash = crypto.createHash('sha256').update('test').digest('hex');
    const fakeSig = crypto.randomBytes(64).toString('base64url');
    const fakeKeyId = 'deadbeef12345678';
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=${fakeSig}&keyId=${fakeKeyId}&payload=${fakeHash}|org|time|rcpt|ci`);
    assert.equal(res.status, 200);
    assert.equal(res.json.valid, false);
    assert.equal(res.json.error, 'unknown_key');
  });

  it('12. GET /api/verify-public -- has CORS Access-Control-Allow-Origin: *', async () => {
    const fakeHash = crypto.createHash('sha256').update('cors-test').digest('hex');
    const fakeSig = crypto.randomBytes(64).toString('base64url');
    const res = await makeRequest('GET', `/api/verify-public?hash=${fakeHash}&signature=${fakeSig}&keyId=1234567890abcdef&payload=${fakeHash}|org|time|rcpt|ci`);
    const acao = res.headers.get('access-control-allow-origin');
    assert.equal(acao, '*', 'verify-public must have CORS: *');
  });

  // ===================================================================
  // VERIFY ENDPOINT SECURITY
  // ===================================================================

  it('13. POST /api/verify -- does not leak stack traces', async () => {
    const res = await makeRequest('POST', '/api/verify', { hash: 'a'.repeat(1000) });
    assert.ok([400, 200, 500].includes(res.status));
    if (res.json?.error) {
      assert.ok(!res.json.error.includes('at '), 'Error should not contain stack trace');
    }
  });

  it('14. POST /api/verify -- legacy content object support', async () => {
    const content = { name: 'test', value: 'data' };
    const res = await makeRequest('POST', '/api/verify', { content });
    assert.equal(res.status, 200);
    assert.ok('verified' in res.json, 'Must include verified field');
  });

  it('15. POST /api/verify -- successful verify includes document metadata', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('POST', '/api/verify', { hash: uploadedHash });
    assert.equal(res.status, 200);
    assert.equal(res.json.verified, true);
    assert.ok(res.json.document, 'Successful verify must include document');
    assert.ok(res.json.document.hash, 'Document must include hash');
    assert.ok(res.json.document.timestamp, 'Document must include timestamp');
  });
});
