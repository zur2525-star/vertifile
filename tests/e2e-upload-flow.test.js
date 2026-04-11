/**
 * Vertifile -- E2E Tests: Upload Flow
 * ====================================
 * QA: Rina  |  Regression: Nir
 *
 * Tests the complete upload -> PVF creation -> view -> verify -> delete flow.
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/e2e-upload-flow.test.js
 *
 * Prerequisites:
 *   - Server must be running (default: http://localhost:3002)
 *   - PostgreSQL database available and migrated
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
  USER_URL,
} = require('./helpers');

skipIfNoDatabase();

// Unique seed for the duplicate test
const RUN_ID_UPLOAD = crypto.randomBytes(4).toString('hex');

describe('E2E: Upload Flow', () => {
  let cookie;
  let userEmail;
  let uploadedDoc; // { hash, shareId, fileName }
  let setupOk = false;

  before(async () => {
    userEmail = uniqueEmail('upload');
    const session = await createTestUser(userEmail);
    if (!session) {
      console.log('[SKIP] Upload flow tests -- user creation rate-limited');
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

  it('1. POST /api/user/upload -- uploads a text file and returns hash + shareId', async (t) => {
    if (guard(t)) return;
    const content = `Vertifile E2E upload test ${Date.now()} ${crypto.randomBytes(16).toString('hex')}`;
    const res = await uploadTestDocument(cookie, {
      content,
      filename: 'e2e-upload-test.txt',
      mimeType: 'text/plain',
    });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.json.success, true, 'Upload should succeed');
    assert.ok(res.json.hash, 'Response must include hash');
    assert.ok(res.json.shareId, 'Response must include shareId');
    assert.ok(res.json.fileName, 'Response must include fileName');
    assert.ok(typeof res.json.documentsUsed === 'number', 'documentsUsed must be a number');
    assert.ok(typeof res.json.documentsLimit === 'number', 'documentsLimit must be a number');

    uploadedDoc = {
      hash: res.json.hash,
      shareId: res.json.shareId,
      fileName: res.json.fileName,
    };
  });

  it('2. GET /d/:shareId -- returns PVF HTML content', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', `/d/${uploadedDoc.shareId}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(res.headers.get('content-type')?.includes('text/html'), 'Content-Type must be text/html');
    assert.ok(res.text.length > 100, 'PVF HTML must have substantive content');
  });

  it('3. GET /d/:shareId/info -- returns document metadata', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', `/d/${uploadedDoc.shareId}/info`);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.document, 'Must return document object');
    assert.ok(res.json.document.originalName, 'Must include originalName');
    assert.ok(res.json.document.mimeType, 'Must include mimeType');
    assert.ok(res.json.document.issuedAt, 'Must include issuedAt timestamp');
  });

  it('4. GET /api/user/documents -- uploaded doc appears in list', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', '/api/user/documents', null, cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(Array.isArray(res.json.documents), 'documents must be an array');
    assert.ok(res.json.total >= 1, 'total must be >= 1');

    const found = res.json.documents.find(d => d.hash === uploadedDoc.hash);
    assert.ok(found, `Uploaded doc with hash ${uploadedDoc.hash} must be in the list`);
    assert.equal(found.shareId, uploadedDoc.shareId, 'shareId must match');
  });

  it('5. POST /api/user/upload -- returns 401 without auth', async () => {
    const res = await uploadTestDocument('');
    assert.ok([401, 403].includes(res.status), `Expected 401 or 403 without auth, got ${res.status}`);
  });

  it('6. POST /api/user/upload -- rejects unsupported MIME type', async (t) => {
    if (guard(t)) return;

    const blob = new Blob(['not a real exe'], { type: 'application/x-msdownload' });
    const form = new FormData();
    form.append('file', blob, 'malware.exe');

    const res = await fetch(`${USER_URL}/upload`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
      redirect: 'manual',
    });
    const json = await res.json().catch(() => null);
    assert.equal(res.status, 400, 'Unsupported type should return 400');
    assert.equal(json?.success, false);
    assert.ok(json?.error?.toLowerCase().includes('unsupported'), 'Error should mention unsupported');
  });

  it('7. POST /api/user/upload -- returns 400 when no file attached', async (t) => {
    if (guard(t)) return;

    const form = new FormData();
    const res = await fetch(`${USER_URL}/upload`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
      redirect: 'manual',
    });
    const json = await res.json().catch(() => null);
    assert.equal(res.status, 400);
    assert.equal(json?.success, false);
  });

  it('8. POST /api/user/documents/:hash/star -- toggle star', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const starRes = await makeRequest('POST', `/api/user/documents/${uploadedDoc.hash}/star`, { starred: true }, cookie);
    assert.equal(starRes.status, 200);
    assert.equal(starRes.json.success, true);

    const listRes = await makeRequest('GET', '/api/user/documents?starred=true', null, cookie);
    assert.equal(listRes.status, 200);
    const starred = listRes.json.documents.find(d => d.hash === uploadedDoc.hash);
    assert.ok(starred, 'Document should appear in starred filter');

    const unstarRes = await makeRequest('POST', `/api/user/documents/${uploadedDoc.hash}/star`, { starred: false }, cookie);
    assert.equal(unstarRes.status, 200);
  });

  it('9. GET /d/:shareId/download -- returns PVF file download', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', `/d/${uploadedDoc.shareId}/download`, null, cookie);
    if (res.status === 200) {
      const ct = res.headers.get('content-type') || '';
      assert.ok(ct.includes('vertifile.pvf') || ct.includes('text/html'), `Content-Type should be PVF. Got: ${ct}`);
      const cd = res.headers.get('content-disposition') || '';
      assert.ok(cd.includes('attachment'), 'Should have attachment disposition');
      assert.ok(cd.includes('.pvf'), 'Filename should end in .pvf');
    } else if (res.status === 403) {
      assert.equal(res.json?.success, false);
    } else {
      assert.fail(`Unexpected status ${res.status} from download endpoint`);
    }
  });

  it('10. DELETE /api/user/documents/:hash -- removes document', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('DELETE', `/api/user/documents/${uploadedDoc.hash}`, null, cookie);
    assert.equal(res.status, 200, `Delete should return 200, got ${res.status}`);
    assert.equal(res.json.success, true);
  });

  it('11. GET /api/user/documents -- deleted doc is gone', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', '/api/user/documents', null, cookie);
    assert.equal(res.status, 200);
    const found = res.json.documents.find(d => d.hash === uploadedDoc.hash);
    assert.ok(!found, 'Deleted document must not appear in list');
  });

  it('12. GET /d/:shareId -- returns 404 for deleted document', async (t) => {
    if (guard(t)) return;
    if (!uploadedDoc) return t.skip('Requires test 1');

    const res = await makeRequest('GET', `/d/${uploadedDoc.shareId}`);
    assert.equal(res.status, 404, 'Deleted document share link should 404');
  });

  it('13. DELETE /api/user/documents/:hash -- non-existent hash returns 404', async (t) => {
    if (guard(t)) return;
    const fakeHash = crypto.createHash('sha256').update('nonexistent-e2e').digest('hex');
    const res = await makeRequest('DELETE', `/api/user/documents/${fakeHash}`, null, cookie);
    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
  });

  it('14. DELETE /api/user/documents/:hash -- invalid hash format returns 400', async (t) => {
    if (guard(t)) return;
    const res = await makeRequest('DELETE', '/api/user/documents/not-a-valid-hash', null, cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.success, false);
  });

  it('15. POST /api/user/upload -- duplicate content is handled gracefully', async (t) => {
    if (guard(t)) return;
    const fixedContent = `Vertifile duplicate test ${RUN_ID_UPLOAD}`;

    const res1 = await uploadTestDocument(cookie, { content: fixedContent });
    assert.equal(res1.status, 200);
    const hash1 = res1.json.hash;

    const res2 = await uploadTestDocument(cookie, { content: fixedContent });
    if (res2.status === 200) {
      assert.equal(res2.json.hash, hash1, 'Deduplicated upload should return same hash');
    } else {
      assert.ok([400, 409, 500].includes(res2.status), `Duplicate: expected 400/409/500, got ${res2.status}`);
    }

    await makeRequest('DELETE', `/api/user/documents/${hash1}`, null, cookie);
  });
});
