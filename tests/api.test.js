#!/usr/bin/env node
'use strict';

/**
 * Vertifile API Test Suite
 *
 * Uses Node.js built-in test runner (node:test) and assert (node:assert).
 * Starts the Express server on a random port, runs all tests, then shuts down.
 *
 * Usage: node tests/api.test.js   (or: npm test)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const HMAC_SECRET = 'test-secret-for-automated-tests';
const ADMIN_SECRET = 'test-admin-secret-for-tests';

// ---------------------------------------------------------------------------
// Shared test state (populated during test runs)
// ---------------------------------------------------------------------------
let BASE_URL = '';
let server = null;     // the http.Server instance
let apiKey = null;      // a valid API key (created via signup)
let createdHash = null;
let createdSig = null;
let createdShareId = null;
let createdShareUrl = null;

// ---------------------------------------------------------------------------
// Multipart helper -- build a multipart/form-data body in pure Node.js
// ---------------------------------------------------------------------------
function buildMultipart(fields) {
  const boundary = '----VFTest' + crypto.randomBytes(12).toString('hex');
  const parts = [];

  for (const field of fields) {
    let header = `--${boundary}\r\n`;
    if (field.filename) {
      header += `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`;
      header += `Content-Type: ${field.contentType || 'application/octet-stream'}\r\n\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
    }
    parts.push(Buffer.from(header, 'utf8'));
    parts.push(Buffer.isBuffer(field.value) ? field.value : Buffer.from(String(field.value), 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  return { body, contentType };
}

// ---------------------------------------------------------------------------
// Multipart helper for multiple files (gateway/batch uses field name "files")
// ---------------------------------------------------------------------------
function buildMultipartMultipleFiles(fieldName, files) {
  const fields = files.map(f => ({
    name: fieldName,
    filename: f.filename,
    contentType: f.contentType || 'text/html',
    value: f.buffer,
  }));
  return buildMultipart(fields);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve, reject) => {
    // Set env vars before requiring the app
    process.env.HMAC_SECRET = HMAC_SECRET;
    process.env.ADMIN_SECRET = ADMIN_SECRET;
    process.env.PORT = '0'; // let OS pick a port

    // Clear require cache so each run gets a fresh app instance
    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath = path.resolve(__dirname, '..', 'db.js');

    // The server.js exports the Express app when not require.main
    const app = require(appPath);
    const db = require(dbPath);

    // Wait for schema bootstrap before accepting requests
    db._ready.then(() => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
      server.on('error', reject);
    }).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------
before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
});

// ============================================================================
// 1. PVF Creation (Demo endpoint)
// ============================================================================
describe('PVF Creation (Demo endpoint)', () => {

  it('POST /api/demo/create-pvf with a text file returns PVF HTML', async () => {
    const fileContent = Buffer.from('Hello, this is a test text document for Vertifile. Timestamp: ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'test.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/demo/create-pvf`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.length > 100, 'Response should be substantial HTML');
  });

  it('Response contains magic bytes <!--PVF:1.0-->', async () => {
    const fileContent = Buffer.from('Magic bytes test document ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'magic.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/demo/create-pvf`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.startsWith('<!--PVF:1.0-->'), 'PVF should start with magic bytes <!--PVF:1.0-->');
  });

  it('Response contains PVF metadata tags (pvf:version, pvf:hash, pvf:signature)', async () => {
    const fileContent = Buffer.from('Metadata tags test document ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'meta.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/demo/create-pvf`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    const html = await res.text();
    assert.ok(html.includes('name="pvf:version"'), 'Should contain pvf:version meta tag');
    assert.ok(html.includes('name="pvf:hash"'), 'Should contain pvf:hash meta tag');
    assert.ok(html.includes('name="pvf:signature"'), 'Should contain pvf:signature meta tag');
  });

  it('Response has Content-Type application/vnd.vertifile.pvf', async () => {
    const fileContent = Buffer.from('Content-Type test document ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'ctype.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/demo/create-pvf`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct.includes('application/vnd.vertifile.pvf'), `Expected PVF content type, got: ${ct}`);
  });

  it('Should include shareUrl when ?format=json is used', async () => {
    const fileContent = Buffer.from('JSON format test document ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'json-test.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/demo/create-pvf?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.shareUrl, 'JSON response should include shareUrl');
    assert.ok(data.shareId, 'JSON response should include shareId');
    assert.ok(data.hash, 'JSON response should include hash');

    // Save for shareable link tests later
    createdShareId = data.shareId;
    createdShareUrl = data.shareUrl;
  });
});

// ============================================================================
// 2. Signup (must run before tests that need apiKey)
// ============================================================================
describe('Signup', () => {

  it('POST /api/signup with valid data returns API key', async () => {
    const res = await fetch(`${BASE_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgName: 'Test Organization',
        contactName: 'Test User',
        email: 'test@example.com',
        useCase: 'automated testing',
        plan: 'professional',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.apiKey, 'Should return an API key');
    assert.ok(data.apiKey.startsWith('vf_live_'), 'API key should start with vf_live_');
    assert.ok(data.orgId, 'Should return an org ID');
    assert.equal(data.plan, 'professional');

    // Save for use in authenticated tests
    apiKey = data.apiKey;
  });

  it('POST /api/signup with missing fields returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgName: 'Incomplete Org' }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('POST /api/signup with invalid email returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgName: 'Bad Email Org',
        contactName: 'User',
        email: 'not-an-email',
      }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.toLowerCase().includes('email'), 'Error should mention email');
  });

  it('Generated API key should work for authenticated endpoints', async () => {
    assert.ok(apiKey, 'apiKey must be set from previous signup test');

    const res = await fetch(`${BASE_URL}/api/org/stats`, {
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });
});

// ============================================================================
// 3. PVF Creation (Authenticated endpoint) -- needed for verify/gateway tests
// ============================================================================
describe('PVF Creation (Authenticated)', () => {

  it('POST /api/create-pvf with valid file and API key returns PVF', async () => {
    assert.ok(apiKey, 'apiKey must be set');

    const fileContent = Buffer.from('Authenticated PVF creation test ' + Date.now());
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'auth-test.txt', contentType: 'text/plain', value: fileContent },
    ]);

    const res = await fetch(`${BASE_URL}/api/create-pvf?format=json`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-API-Key': apiKey },
      body,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.hash, 'Should return hash');
    assert.ok(data.shareUrl, 'Should return shareUrl');
    assert.ok(data.shareId, 'Should return shareId');

    // Save hash for verification and gateway tests.
    // Use the hash from JSON response and compute the expected HMAC signature
    // ourselves (since the PVF HTML gets obfuscated making regex extraction unreliable).
    createdHash = data.hash;
    createdSig = crypto.createHmac('sha256', HMAC_SECRET).update(createdHash).digest('hex');
  });

  it('POST /api/create-pvf without file returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/create-pvf`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 400);
  });
});

// ============================================================================
// 4. PVF Verification
// ============================================================================
describe('PVF Verification', () => {

  it('POST /api/verify with valid hash+signature returns verified: true', async () => {
    assert.ok(createdHash, 'createdHash must be set from previous test');
    assert.ok(createdSig, 'createdSig must be set from previous test');

    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: createdHash, signature: createdSig }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, true);
    assert.ok(data.token, 'Should return a session token');
    assert.ok(data.timestamp, 'Should return a timestamp');
    assert.ok(data.orgName, 'Should return orgName');
  });

  it('POST /api/verify with invalid signature returns verified: false', async () => {
    assert.ok(createdHash, 'createdHash must be set');

    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: createdHash, signature: 'f'.repeat(64) }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, false);
    assert.equal(data.reason, 'invalid_signature');
  });

  it('POST /api/verify with non-existent hash returns not found', async () => {
    const fakeHash = crypto.createHash('sha256').update('nonexistent-' + Date.now()).digest('hex');

    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: fakeHash }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, false);
    assert.equal(data.hash, fakeHash);
  });

  it('POST /api/verify without hash returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.verified, false);
  });

  it('POST /api/verify with invalid hash format returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'not-a-valid-hash' }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.verified, false);
  });
});

// ============================================================================
// 5. Gateway Intake
// ============================================================================
describe('Gateway Intake', () => {

  it('POST /api/gateway/intake with valid .pvf file verifies and extracts document', async () => {
    assert.ok(apiKey, 'apiKey must be set');
    assert.ok(createdHash, 'createdHash must be set');
    assert.ok(createdSig, 'createdSig must be set');

    // Build a minimal but valid PVF-like HTML containing the hash and sig
    const pvfContent = `<!--PVF:1.0-->
<!DOCTYPE html>
<html>
<head>
<meta name="pvf:version" content="1.0">
<meta name="pvf:hash" content="${createdHash}">
<meta name="pvf:signature" content="${createdSig}">
</head>
<body>
<div class="text-doc">Test content for gateway</div>
<script>
var HASH="${createdHash}";
var SIG="${createdSig}";
var RCPT="";
</script>
</body>
</html>`;

    const pvfBuffer = Buffer.from(pvfContent, 'utf-8');
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'test.pvf', contentType: 'text/html', value: pvfBuffer },
    ]);

    const res = await fetch(`${BASE_URL}/api/gateway/intake`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-API-Key': apiKey },
      body,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.verified, true);
    assert.ok(data.document, 'Should return document metadata');
    assert.ok(data.document.hash, 'Document should have hash');
    assert.ok(data.document.originalName, 'Document should have originalName');
    assert.ok(data.verifiedAt, 'Should return verifiedAt timestamp');
  });

  it('POST /api/gateway/intake with invalid .pvf returns error', async () => {
    const invalidPvf = Buffer.from('<html><body>This is not a valid PVF file</body></html>');
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'invalid.pvf', contentType: 'text/html', value: invalidPvf },
    ]);

    const res = await fetch(`${BASE_URL}/api/gateway/intake`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-API-Key': apiKey },
      body,
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('POST /api/gateway/intake requires API key authentication', async () => {
    const pvfBuffer = Buffer.from('<html>some pvf</html>');
    const { body, contentType } = buildMultipart([
      { name: 'file', filename: 'test.pvf', contentType: 'text/html', value: pvfBuffer },
    ]);

    const res = await fetch(`${BASE_URL}/api/gateway/intake`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    assert.equal(res.status, 401);
  });

  it('POST /api/gateway/intake without file returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/gateway/intake`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 400);
  });
});

// ============================================================================
// 6. Gateway Batch
// ============================================================================
describe('Gateway Batch', () => {

  it('POST /api/gateway/batch with multiple .pvf files verifies all', async () => {
    assert.ok(apiKey, 'apiKey must be set');
    assert.ok(createdHash, 'createdHash must be set');
    assert.ok(createdSig, 'createdSig must be set');

    // Build two valid PVF files (using the same hash/sig for simplicity)
    const pvf1 = Buffer.from(`<!--PVF:1.0--><html><script>var HASH="${createdHash}";var SIG="${createdSig}";</script></html>`);
    const pvf2 = Buffer.from(`<!--PVF:1.0--><html><script>var HASH="${createdHash}";var SIG="${createdSig}";</script></html>`);

    // Also include an invalid PVF
    const pvf3 = Buffer.from('<html>not valid</html>');

    const { body, contentType } = buildMultipartMultipleFiles('files', [
      { filename: 'doc1.pvf', buffer: pvf1 },
      { filename: 'doc2.pvf', buffer: pvf2 },
      { filename: 'invalid.pvf', buffer: pvf3 },
    ]);

    const res = await fetch(`${BASE_URL}/api/gateway/batch`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'X-API-Key': apiKey },
      body,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.results), 'Should return results array');
    assert.equal(data.total, 3, 'Total should be 3');
    assert.equal(data.verified, 2, 'Two files should be verified');
    assert.equal(data.failed, 1, 'One file should fail');

    // Check individual results
    assert.equal(data.results[0].verified, true);
    assert.equal(data.results[1].verified, true);
    assert.equal(data.results[2].verified, false);
  });

  it('POST /api/gateway/batch without files returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/gateway/batch`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 400);
  });

  it('POST /api/gateway/batch requires API key', async () => {
    const res = await fetch(`${BASE_URL}/api/gateway/batch`, {
      method: 'POST',
    });

    assert.equal(res.status, 401);
  });
});

// ============================================================================
// 7. Webhooks
// ============================================================================
describe('Webhooks', () => {
  let webhookId = null;

  it('POST /api/webhooks/register registers a webhook', async () => {
    assert.ok(apiKey, 'apiKey must be set');

    const res = await fetch(`${BASE_URL}/api/webhooks/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        url: 'https://example.com/webhook-endpoint',
        events: ['verification.success', 'verification.failed'],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.webhookId, 'Should return webhookId');
    assert.ok(data.secret, 'Should return webhook secret');
    assert.ok(Array.isArray(data.events), 'Should return events array');
    assert.ok(data.events.includes('verification.success'));

    webhookId = data.webhookId;
  });

  it('POST /api/webhooks/register rejects invalid events', async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        url: 'https://example.com/hook',
        events: ['nonexistent.event'],
      }),
    });

    assert.equal(res.status, 400);
  });

  it('POST /api/webhooks/register rejects missing url', async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ events: ['verification.success'] }),
    });

    assert.equal(res.status, 400);
  });

  it('GET /api/webhooks lists registered webhooks', async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks`, {
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.webhooks), 'Should return webhooks array');
    assert.ok(data.webhooks.length > 0, 'Should have at least one webhook');
  });

  it('DELETE /api/webhooks/:id removes a webhook', async () => {
    assert.ok(webhookId, 'webhookId must be set from register test');

    const res = await fetch(`${BASE_URL}/api/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify it is gone
    const listRes = await fetch(`${BASE_URL}/api/webhooks`, {
      headers: { 'X-API-Key': apiKey },
    });
    const listData = await listRes.json();
    const found = listData.webhooks.find(w => w.id === webhookId);
    assert.equal(found, undefined, 'Deleted webhook should not appear in list');
  });

  it('DELETE /api/webhooks/:id with non-existent ID returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/999999`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 404);
  });

  it('Webhook endpoints require API key', async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks`);
    assert.equal(res.status, 401);

    const res2 = await fetch(`${BASE_URL}/api/webhooks/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x.com/hook', events: ['verification.success'] }),
    });
    assert.equal(res2.status, 401);
  });
});

// ============================================================================
// 8. Shareable Links
// ============================================================================
describe('Shareable Links', () => {

  it('GET /d/:shareId returns the PVF document', async () => {
    assert.ok(createdShareId, 'createdShareId must be set from demo create test');

    const res = await fetch(`${BASE_URL}/d/${createdShareId}`, {
      redirect: 'manual',
    });

    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct.includes('text/html'), `Should serve as HTML, got: ${ct}`);
    const html = await res.text();
    assert.ok(html.includes('PVF'), 'HTML should contain PVF content');
  });

  it('GET /d/:shareId/info returns document metadata', async () => {
    assert.ok(createdShareId, 'createdShareId must be set');

    const res = await fetch(`${BASE_URL}/d/${createdShareId}/info`);

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.document, 'Should return document object');
    assert.ok(data.document.originalName, 'Should include originalName');
    assert.ok(data.document.mimeType, 'Should include mimeType');
    assert.ok(data.document.issuedAt, 'Should include issuedAt');
    assert.ok(data.document.issuedBy, 'Should include issuedBy');
    assert.equal(data.document.verified, true);
  });

  it('GET /d/:shareId/download returns document for download', async () => {
    assert.ok(createdShareId, 'createdShareId must be set');

    const res = await fetch(`${BASE_URL}/d/${createdShareId}/download`);

    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct.includes('application/vnd.vertifile.pvf'), `Should have PVF content type, got: ${ct}`);
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition, 'Should have Content-Disposition header');
    assert.ok(disposition.includes('attachment'), 'Should be an attachment download');
    assert.ok(disposition.includes('.pvf'), 'Filename should end in .pvf');
  });

  it('GET /d/:shareId with invalid shareId returns 404', async () => {
    const res = await fetch(`${BASE_URL}/d/nonexistent_share_id_xyz`);
    assert.equal(res.status, 404);
  });

  it('GET /d/:shareId/info with invalid shareId returns 404', async () => {
    const res = await fetch(`${BASE_URL}/d/nonexistent123/info`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  it('GET /d/:shareId/download with invalid shareId returns 404', async () => {
    const res = await fetch(`${BASE_URL}/d/nonexistent123/download`);
    assert.equal(res.status, 404);
  });
});

// ============================================================================
// 9. API Key Authentication
// ============================================================================
describe('API Key Authentication', () => {

  it('Endpoints requiring API key reject requests without one', async () => {
    const endpoints = [
      { method: 'GET', path: '/api/org/stats' },
      { method: 'GET', path: '/api/org/documents' },
      { method: 'GET', path: '/api/webhooks' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${BASE_URL}${ep.path}`, { method: ep.method });
      assert.equal(res.status, 401, `${ep.method} ${ep.path} should require API key`);
    }
  });

  it('Endpoints requiring API key reject invalid API keys', async () => {
    const res = await fetch(`${BASE_URL}/api/org/stats`, {
      headers: { 'X-API-Key': 'vf_live_this_is_a_fake_invalid_key_abc123def456' },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error.toLowerCase().includes('invalid'), 'Error should indicate invalid key');
  });

  it('Public endpoints work without API key (verify, health)', async () => {
    // /api/verify is a public endpoint (no API key needed)
    const fakeHash = crypto.createHash('sha256').update('public-test-' + Date.now()).digest('hex');
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: fakeHash }),
    });

    assert.equal(res.status, 200, 'Verify endpoint should work without API key');

    // /api/health is also public
    const res2 = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res2.status, 200, 'Health endpoint should work without API key');

    // /api/demo/create-pvf is public (no API key) -- already tested in PVF Creation suite
  });

  it('Admin endpoints reject requests without admin secret', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`);
    assert.equal(res.status, 403);
  });

  it('Admin endpoints reject wrong admin secret', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { 'X-Admin-Secret': 'wrong-secret' },
    });
    assert.equal(res.status, 403);
  });

  it('Admin endpoints accept correct admin secret', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { 'X-Admin-Secret': ADMIN_SECRET },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });
});

// ============================================================================
// 10. Health & Docs endpoints
// ============================================================================
describe('Health & Docs', () => {

  it('GET /api/health returns online status', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'online');
    assert.equal(data.service, 'Vertifile');
    assert.ok(data.version, 'Should include version');
  });

  it('GET /api/docs returns API documentation', async () => {
    const res = await fetch(`${BASE_URL}/api/docs`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.endpoints, 'Should include endpoints documentation');
    assert.ok(data.security, 'Should include security documentation');
  });
});

// ============================================================================
// 11. Token Refresh
// ============================================================================
describe('Token Refresh', () => {

  it('POST /api/token/refresh with valid hash returns new token', async () => {
    assert.ok(createdHash, 'createdHash must be set');

    const res = await fetch(`${BASE_URL}/api/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: createdHash }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token, 'Should return a new token');
    assert.equal(data.expiresIn, 30, 'Token should expire in 30 seconds');
  });

  it('POST /api/token/refresh with invalid hash returns error', async () => {
    const res = await fetch(`${BASE_URL}/api/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'invalid' }),
    });

    assert.equal(res.status, 400);
  });

  it('POST /api/token/refresh with non-existent hash returns not found', async () => {
    const fakeHash = crypto.createHash('sha256').update('token-refresh-fake-' + Date.now()).digest('hex');

    const res = await fetch(`${BASE_URL}/api/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: fakeHash }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
  });
});

// ============================================================================
// 12. Organization Endpoints
// ============================================================================
describe('Organization Endpoints', () => {

  it('GET /api/org/stats returns org statistics', async () => {
    assert.ok(apiKey, 'apiKey must be set');

    const res = await fetch(`${BASE_URL}/api/org/stats`, {
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.orgId, 'Should return orgId');
    assert.ok(data.orgName, 'Should return orgName');
    assert.ok(typeof data.documentsCreated === 'number', 'Should return documentsCreated count');
  });

  it('GET /api/org/documents returns document list with pagination', async () => {
    assert.ok(apiKey, 'apiKey must be set');

    const res = await fetch(`${BASE_URL}/api/org/documents?limit=5&offset=0`, {
      headers: { 'X-API-Key': apiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.documents), 'Should return documents array');
    assert.ok(typeof data.total === 'number', 'Should return total count');
    assert.equal(data.limit, 5);
    assert.equal(data.offset, 0);
  });
});

// ============================================================================
// 13. Security Headers
// ============================================================================
describe('Security Headers', () => {

  it('API responses include security headers from Helmet', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const headers = Object.fromEntries(res.headers.entries());

    // Helmet sets x-content-type-options among others
    assert.ok(
      headers['x-content-type-options'] || headers['x-frame-options'] || headers['x-xss-protection'],
      'Should have at least one Helmet security header'
    );
  });

  it('Rate limit headers are present on API responses', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const headers = Object.fromEntries(res.headers.entries());

    assert.ok(
      headers['ratelimit-limit'] || headers['x-ratelimit-limit'] || headers['ratelimit-remaining'] !== undefined,
      'Should include rate limit headers'
    );
  });
});
