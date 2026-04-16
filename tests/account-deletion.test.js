'use strict';

/**
 * Vertifile -- E2E Tests: Account Deletion
 * =========================================
 *
 * Tests the DELETE /api/user/account endpoint end-to-end:
 *   - Auth requirements
 *   - Successful deletion + response shape
 *   - Session invalidation after deletion
 *   - Login no longer possible after deletion
 *   - Documents cleaned up after deletion
 *   - Edge cases: double-delete, document share link after deletion
 *
 * Run:
 *   DATABASE_URL="..." node --test tests/account-deletion.test.js
 *
 * Prerequisites:
 *   - Server must be running (default: http://localhost:3002)
 *   - PostgreSQL database available and migrated
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  skipIfNoDatabase,
  uniqueEmail,
  STRONG_PASSWORD,
  makeRequest,
  createTestUser,
  uploadTestDocument,
} = require('./helpers');

skipIfNoDatabase();

// ---------------------------------------------------------------------------
// DELETE /api/user/account
// ---------------------------------------------------------------------------

describe('DELETE /api/user/account', () => {

  // -------------------------------------------------------------------------
  // 1. Returns 401 without authentication
  // -------------------------------------------------------------------------
  it('1. returns 401 when called without a session', async () => {
    const res = await makeRequest('DELETE', '/api/user/account', null, '');

    assert.equal(res.status, 401, `Expected 401, got ${res.status}: ${res.text}`);
    assert.equal(res.json.success, false);
  });

  // -------------------------------------------------------------------------
  // 2. Returns 200 with a valid session and the account is deleted
  // -------------------------------------------------------------------------
  it('2. returns 200 and { success: true } when authenticated', async () => {
    const session = await createTestUser(uniqueEmail('del-200'));
    if (!session) {
      // Rate-limited during test run -- cannot proceed without a fresh user
      console.log('[SKIP] test 2 -- user creation rate-limited (429)');
      return;
    }

    const res = await makeRequest('DELETE', '/api/user/account', null, session.cookie);

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${res.text}`);
    assert.equal(res.json.success, true);
  });

  // -------------------------------------------------------------------------
  // 3. After deletion, the session is invalidated (GET /api/user/me -> 401)
  // -------------------------------------------------------------------------
  it('3. session is invalidated after deletion -- /api/user/me returns 401', async () => {
    const session = await createTestUser(uniqueEmail('del-session'));
    if (!session) {
      console.log('[SKIP] test 3 -- user creation rate-limited (429)');
      return;
    }

    // Confirm the session is valid before deletion
    const beforeRes = await makeRequest('GET', '/api/user/me', null, session.cookie);
    assert.equal(beforeRes.status, 200, `Pre-delete /api/user/me should be 200, got ${beforeRes.status}`);
    assert.equal(beforeRes.json.success, true);

    // Delete the account
    const delRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(delRes.status, 200, `Deletion should return 200, got ${delRes.status}`);

    // The same cookie must no longer authenticate
    const afterRes = await makeRequest('GET', '/api/user/me', null, session.cookie);
    assert.equal(afterRes.status, 401, `After deletion /api/user/me should be 401, got ${afterRes.status}`);
    assert.equal(afterRes.json.success, false);
  });

  // -------------------------------------------------------------------------
  // 4. After deletion, cannot login with the same credentials
  // -------------------------------------------------------------------------
  it('4. cannot login with deleted credentials', async () => {
    const email    = uniqueEmail('del-login');
    const password = STRONG_PASSWORD;

    const session = await createTestUser(email, password);
    if (!session) {
      console.log('[SKIP] test 4 -- user creation rate-limited (429)');
      return;
    }

    // Delete the account
    const delRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(delRes.status, 200, `Deletion should return 200, got ${delRes.status}`);

    // Attempt to log back in with the same credentials
    const loginRes = await makeRequest('POST', '/auth/login', { email, password });
    assert.notEqual(loginRes.status, 200,
      `Login after deletion should not return 200, got ${loginRes.status}`);
    assert.equal(loginRes.json.success, false);
  });

  // -------------------------------------------------------------------------
  // 5. After deletion, GET /api/user/documents returns 401
  // -------------------------------------------------------------------------
  it('5. user documents endpoint returns 401 after deletion', async () => {
    const session = await createTestUser(uniqueEmail('del-docs'));
    if (!session) {
      console.log('[SKIP] test 5 -- user creation rate-limited (429)');
      return;
    }

    // Upload a document so the account is not empty
    const uploadRes = await uploadTestDocument(session.cookie);
    // Accept 200 (paid) or 200-with-preview (free/trial) — both mean the doc was created
    assert.equal(uploadRes.status, 200, `Upload should succeed, got ${uploadRes.status}: ${uploadRes.text}`);
    assert.equal(uploadRes.json.success, true);

    // Delete the account
    const delRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(delRes.status, 200, `Deletion should return 200, got ${delRes.status}`);

    // The documents endpoint must reject the (now-invalid) session
    const docsRes = await makeRequest('GET', '/api/user/documents', null, session.cookie);
    assert.equal(docsRes.status, 401,
      `GET /api/user/documents after deletion should be 401, got ${docsRes.status}`);
  });

});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('DELETE /api/user/account -- edge cases', () => {

  // -------------------------------------------------------------------------
  // 6. Double-delete: second attempt returns 401 (session already destroyed)
  // -------------------------------------------------------------------------
  it('6. double-delete -- second DELETE returns 401', async () => {
    const session = await createTestUser(uniqueEmail('del-double'));
    if (!session) {
      console.log('[SKIP] test 6 -- user creation rate-limited (429)');
      return;
    }

    // First deletion -- must succeed
    const firstRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(firstRes.status, 200, `First deletion should return 200, got ${firstRes.status}`);
    assert.equal(firstRes.json.success, true);

    // Second deletion using the same (now-invalid) cookie -- must be rejected
    const secondRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(secondRes.status, 401,
      `Second deletion should return 401 (session invalidated), got ${secondRes.status}`);
    assert.equal(secondRes.json.success, false);
  });

  // -------------------------------------------------------------------------
  // 7. Create user, upload document, delete account -- share link returns 404
  // -------------------------------------------------------------------------
  it('7. share link returns 404 after account deletion with document', async () => {
    const session = await createTestUser(uniqueEmail('del-sharelink'));
    if (!session) {
      console.log('[SKIP] test 7 -- user creation rate-limited (429)');
      return;
    }

    // Upload a document and capture the shareId
    const uploadRes = await uploadTestDocument(session.cookie, {
      content: `account-deletion e2e test ${Date.now()}`,
      filename: 'deletion-test.txt',
      mimeType: 'text/plain',
    });
    assert.equal(uploadRes.status, 200, `Upload should succeed, got ${uploadRes.status}: ${uploadRes.text}`);
    assert.equal(uploadRes.json.success, true);

    const shareId = uploadRes.json.shareId;
    assert.ok(shareId, 'Upload response must include a shareId');

    // Confirm the share link is accessible before deletion
    const beforeRes = await makeRequest('GET', `/d/${shareId}`, null, '');
    assert.equal(beforeRes.status, 200,
      `Share link should be 200 before deletion, got ${beforeRes.status}`);

    // Delete the account
    const delRes = await makeRequest('DELETE', '/api/user/account', null, session.cookie);
    assert.equal(delRes.status, 200, `Deletion should return 200, got ${delRes.status}`);

    // The share link must no longer resolve
    const afterRes = await makeRequest('GET', `/d/${shareId}`, null, '');
    assert.equal(afterRes.status, 404,
      `Share link should be 404 after account deletion, got ${afterRes.status}`);
  });

});
