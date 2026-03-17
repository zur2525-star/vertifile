#!/usr/bin/env node
'use strict';

/**
 * Vertifile API Test Suite
 * Zero-dependency — uses only Node.js built-in modules.
 * Starts server as child process, runs tests, reports results.
 * Usage: node tests/api.test.js
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');

const PORT = 13579;
const ADMIN_SECRET = 'vertifile-admin-2024';
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

// Colors
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// State
let serverProcess = null;
let apiKey = null;
let createdHash = null;
let createdSig = null;
let passed = 0, failed = 0, total = 0;
const results = [];

// ================================================================
// HTTP HELPERS
// ================================================================
function request(method, urlPath, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: PORT, path: urlPath, method, headers: { ...headers }, timeout: 10000 };
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      const json = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(json);
      var bodyStr = json;
    } else if (Buffer.isBuffer(body)) {
      opts.headers['Content-Length'] = body.length;
      var bodyStr = body;
    } else if (typeof body === 'string') {
      opts.headers['Content-Length'] = Buffer.byteLength(body);
      var bodyStr = body;
    }
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        let parsed;
        if (!raw) {
          try { parsed = JSON.parse(data.toString()); } catch { parsed = data.toString(); }
        } else {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function multipartUpload(urlPath, fieldName, filename, fileBuffer, mimeType, extraHeaders = {}) {
  const boundary = '----VFTest' + crypto.randomBytes(8).toString('hex');
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
  body += `Content-Type: ${mimeType}\r\n\r\n`;
  const prefix = Buffer.from(body, 'utf8');
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const fullBody = Buffer.concat([prefix, fileBuffer, suffix]);

  return request('POST', urlPath, {
    body: fullBody,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      ...extraHeaders
    },
    raw: true
  });
}

// ================================================================
// TEST HARNESS
// ================================================================
const suites = [];
let currentSuite = null;

function describe(name, fn) {
  currentSuite = { name, tests: [] };
  fn();
  suites.push(currentSuite);
  currentSuite = null;
}

function it(name, fn) {
  currentSuite.tests.push({ name, fn });
}

async function runTests() {
  console.log(`\n${B}${C}╔══════════════════════════════════════════╗${X}`);
  console.log(`${B}${C}║   Vertifile API Test Suite                ║${X}`);
  console.log(`${B}${C}╚══════════════════════════════════════════╝${X}\n`);

  for (const suite of suites) {
    console.log(`\n  ${B}${suite.name}${X}`);
    for (const test of suite.tests) {
      total++;
      try {
        await test.fn();
        passed++;
        console.log(`    ${G}✓${X} ${D}${test.name}${X}`);
        results.push({ suite: suite.name, test: test.name, pass: true });
      } catch (err) {
        failed++;
        console.log(`    ${R}✗ ${test.name}${X}`);
        console.log(`      ${R}${err.message}${X}`);
        results.push({ suite: suite.name, test: test.name, pass: false, error: err.message });
      }
    }
  }

  console.log(`\n${B}═══════════════════════════════════════════${X}`);
  console.log(`  ${G}${passed} passing${X}  ${failed > 0 ? R + failed + ' failing' + X : ''}`);
  console.log(`${B}═══════════════════════════════════════════${X}\n`);
}

// ================================================================
// SERVER LIFECYCLE
// ================================================================
function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [SERVER_PATH], {
      env: { ...process.env, PORT: String(PORT), ADMIN_SECRET },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    serverProcess.stdout.on('data', d => { output += d.toString(); });
    serverProcess.stderr.on('data', d => { output += d.toString(); });

    const checkReady = setInterval(() => {
      http.get(`http://127.0.0.1:${PORT}/api/health`, res => {
        if (res.statusCode === 200) {
          clearInterval(checkReady);
          clearTimeout(timeout);
          // Get API key from output
          const keyMatch = output.match(/vf_live_[a-f0-9]{40}/);
          if (keyMatch) apiKey = keyMatch[0];
          // If not found in output, fetch from admin endpoint
          if (!apiKey) {
            const keysReq = http.request(`http://127.0.0.1:${PORT}/api/admin/keys`, {
              headers: { 'X-Admin-Secret': ADMIN_SECRET }
            }, keysRes => {
              let body = '';
              keysRes.on('data', d => body += d);
              keysRes.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  const keys = data.keys || [];
                  if (keys.length > 0) {
                    const activeKey = keys.find(k => k.active || k.active === 1);
                    apiKey = activeKey ? (activeKey.apiKey || activeKey.api_key) : (keys[0].apiKey || keys[0].api_key);
                  }
                } catch (e) {}
                resolve();
              });
            });
            keysReq.end();
          } else {
            resolve();
          }
        }
      }).on('error', () => {});
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(checkReady);
      reject(new Error('Server startup timeout. Output:\n' + output));
    }, 15000);

    serverProcess.on('error', err => {
      clearInterval(checkReady);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ================================================================
// TEST DEFINITIONS
// ================================================================

// --- Health & Info ---
describe('Health & Info', () => {
  it('GET /api/health returns online status', async () => {
    const { status, body } = await request('GET', '/api/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'online');
    assert.ok(body.version);
    assert.ok(body.service === 'Vertifile');
  });

  it('GET /api/docs returns API documentation', async () => {
    const { status, body } = await request('GET', '/api/docs');
    assert.strictEqual(status, 200);
    assert.ok(body.service || body.version);
    assert.ok(body.endpoints || body.routes);
  });
});

// --- Authentication ---
describe('Authentication', () => {
  it('POST /api/create-pvf without API key returns 401', async () => {
    const { status } = await request('POST', '/api/create-pvf');
    assert.strictEqual(status, 401);
  });

  it('POST /api/create-pvf with invalid API key returns 401', async () => {
    const { status } = await request('POST', '/api/create-pvf', {
      headers: { 'X-API-Key': 'vf_live_invalid_key' }
    });
    assert.strictEqual(status, 401);
  });

  it('GET /api/org/stats without API key returns 401', async () => {
    const { status } = await request('GET', '/api/org/stats');
    assert.strictEqual(status, 401);
  });

  it('GET /api/admin/stats without admin secret returns 403', async () => {
    const { status } = await request('GET', '/api/admin/stats');
    assert.strictEqual(status, 403);
  });

  it('GET /api/admin/stats with wrong admin secret returns 403', async () => {
    const { status } = await request('GET', '/api/admin/stats', {
      headers: { 'X-Admin-Secret': 'wrong-secret' }
    });
    assert.strictEqual(status, 403);
  });
});

// --- Document Creation ---
describe('Document Creation', () => {
  it('POST /api/create-pvf with valid file returns PVF HTML', async () => {
    const testPdf = Buffer.from('%PDF-1.4 test document content for Vertifile testing ' + Date.now());
    const res = await multipartUpload('/api/create-pvf', 'file', 'test-doc.pdf', testPdf, 'application/pdf', {
      'X-API-Key': apiKey
    });
    assert.strictEqual(res.status, 200);
    const html = res.body.toString();
    assert.ok(html.includes('<!DOCTYPE html') || html.includes('PVF'), 'Response should be HTML');
    assert.ok(html.includes('var HASH=') || html.includes('HASH'), 'Should contain hash');
    // Extract hash and sig for later tests
    const hashM = html.match(/var\s+HASH\s*=\s*"([a-f0-9]{64})"/);
    const sigM = html.match(/var\s+SIG\s*=\s*"([a-f0-9]{64})"/);
    if (hashM) createdHash = hashM[1];
    if (sigM) createdSig = sigM[1];
  });

  it('POST /api/create-pvf with recipient binding', async () => {
    const testFile = Buffer.from('Test document with recipient ' + Date.now());
    const boundary = '----VFRcpt' + crypto.randomBytes(8).toString('hex');
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="recipient-test.pdf"\r\n`;
    body += `Content-Type: application/pdf\r\n\r\n`;
    const prefix = Buffer.from(body, 'utf8');
    body = '';
    body += `\r\n--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="recipient"\r\n\r\n`;
    body += `test@example.com`;
    body += `\r\n--${boundary}--\r\n`;
    const suffix = Buffer.from(body, 'utf8');
    const fullBody = Buffer.concat([prefix, testFile, suffix]);

    const res = await request('POST', '/api/create-pvf', {
      body: fullBody,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-API-Key': apiKey
      },
      raw: true
    });
    assert.strictEqual(res.status, 200);
    const html = res.body.toString();
    assert.ok(html.includes('RCPT') || html.includes('recipient'), 'Should contain recipient reference');
  });

  it('POST /api/create-pvf without file returns 400', async () => {
    const { status } = await request('POST', '/api/create-pvf', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 400);
  });
});

// --- Document Verification ---
describe('Document Verification', () => {
  it('POST /api/verify with valid hash+sig returns verified:true', async () => {
    if (!createdHash || !createdSig) return; // skip if creation failed
    const { status, body } = await request('POST', '/api/verify', {
      body: { hash: createdHash, signature: createdSig }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.verified, true);
  });

  it('POST /api/verify with invalid hash returns verified:false', async () => {
    const { status, body } = await request('POST', '/api/verify', {
      body: { hash: 'a'.repeat(64), signature: 'b'.repeat(64) }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.verified, false);
  });

  it('POST /api/verify without params returns 400', async () => {
    const { status } = await request('POST', '/api/verify', { body: {} });
    assert.strictEqual(status, 400);
  });

  it('POST /api/verify with correct hash but wrong sig returns verified:false', async () => {
    if (!createdHash) return;
    const { status, body } = await request('POST', '/api/verify', {
      body: { hash: createdHash, signature: 'c'.repeat(64) }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.verified, false);
  });
});

// --- Token Operations ---
describe('Token Operations', () => {
  it('POST /api/token/refresh with valid hash returns new token', async () => {
    if (!createdHash) return;
    const { status, body } = await request('POST', '/api/token/refresh', {
      body: { hash: createdHash }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.token, 'Should return token');
  });

  it('POST /api/token/verify with valid token returns valid:true', async () => {
    if (!createdHash) return;
    // First get a token
    const { body: refreshResult } = await request('POST', '/api/token/refresh', {
      body: { hash: createdHash }
    });
    if (!refreshResult.token) return;

    const { status, body } = await request('POST', '/api/token/verify', {
      body: { hash: createdHash, token: refreshResult.token }
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.valid, true);
  });
});

// --- Organization Endpoints ---
describe('Organization Endpoints', () => {
  it('GET /api/org/stats returns org statistics', async () => {
    const { status, body } = await request('GET', '/api/org/stats', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.success);
  });

  it('GET /api/org/documents returns document list', async () => {
    const { status, body } = await request('GET', '/api/org/documents', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.documents), 'Should return documents array');
  });

  it('GET /api/org/documents supports pagination', async () => {
    const { status, body } = await request('GET', '/api/org/documents?limit=5&offset=0', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.documents.length <= 5);
  });
});

// --- Admin Endpoints ---
describe('Admin Endpoints', () => {
  it('GET /api/admin/stats returns global statistics', async () => {
    const { status, body } = await request('GET', '/api/admin/stats', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.totalDocuments >= 0);
    assert.ok(body.totalOrganizations >= 0);
  });

  it('GET /api/admin/audit returns audit entries', async () => {
    const { status, body } = await request('GET', '/api/admin/audit?limit=10', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.entries));
  });

  it('GET /api/admin/audit supports event filter', async () => {
    const { status, body } = await request('GET', '/api/admin/audit?event=pvf_created&limit=5', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    body.entries.forEach(e => assert.strictEqual(e.event, 'pvf_created'));
  });

  it('GET /api/admin/keys returns API keys list', async () => {
    const { status, body } = await request('GET', '/api/admin/keys', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.keys));
    assert.ok(body.keys.length > 0, 'Should have at least one key');
  });

  it('POST /api/admin/keys creates new API key', async () => {
    const { status, body } = await request('POST', '/api/admin/keys', {
      body: { orgName: 'Test University', plan: 'professional' },
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.success);
    assert.ok(body.apiKey, 'Should return new API key');
    assert.ok(body.apiKey.startsWith('vf_live_'));
  });

  it('GET /api/admin/documents returns all documents', async () => {
    const { status, body } = await request('GET', '/api/admin/documents?limit=5', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.documents));
  });

  it('GET /api/admin/webhooks returns webhooks list', async () => {
    const { status, body } = await request('GET', '/api/admin/webhooks', {
      headers: { 'X-Admin-Secret': ADMIN_SECRET }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.webhooks));
  });
});

// --- Gateway ---
describe('Gateway', () => {
  it('POST /api/gateway/intake without file returns 400', async () => {
    const { status } = await request('POST', '/api/gateway/intake', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 400);
  });

  it('POST /api/gateway/intake with invalid PVF returns error', async () => {
    const fakePvf = Buffer.from('<html>not a real pvf</html>');
    const res = await multipartUpload('/api/gateway/intake', 'file', 'fake.pvf', fakePvf, 'text/html', {
      'X-API-Key': apiKey
    });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/gateway/batch without files returns 400', async () => {
    const { status } = await request('POST', '/api/gateway/batch', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 400);
  });
});

// --- Webhooks ---
describe('Webhooks', () => {
  let webhookId = null;

  it('POST /api/webhooks/register creates webhook', async () => {
    const { status, body } = await request('POST', '/api/webhooks/register', {
      body: { url: 'https://example.com/webhook', events: ['verification.success'] },
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.success);
    assert.ok(body.webhookId);
    assert.ok(body.secret);
    webhookId = body.webhookId;
  });

  it('GET /api/webhooks lists org webhooks', async () => {
    const { status, body } = await request('GET', '/api/webhooks', {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.webhooks));
    assert.ok(body.webhooks.length > 0);
  });

  it('POST /api/webhooks/register rejects invalid events', async () => {
    const { status, body } = await request('POST', '/api/webhooks/register', {
      body: { url: 'https://example.com/webhook', events: ['invalid.event'] },
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 400);
  });

  it('DELETE /api/webhooks/:id removes webhook', async () => {
    if (!webhookId) return;
    const { status, body } = await request('DELETE', `/api/webhooks/${webhookId}`, {
      headers: { 'X-API-Key': apiKey }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.success);
  });
});

// --- Security Headers ---
describe('Security', () => {
  it('Responses include security headers', async () => {
    const { headers } = await request('GET', '/api/health');
    // Helmet adds various security headers
    assert.ok(headers['x-content-type-options'] || headers['x-xss-protection'] || headers['content-security-policy'],
      'Should have security headers from Helmet');
  });

  it('Rate limit headers present on API responses', async () => {
    const { headers } = await request('GET', '/api/health');
    assert.ok(headers['ratelimit-limit'] || headers['x-ratelimit-limit'] || headers['ratelimit-remaining'] !== undefined,
      'Should include rate limit headers');
  });
});

// --- Static Pages ---
describe('Static Pages', () => {
  const pages = ['/', '/upload', '/verify', '/dashboard', '/enterprise', '/integration'];

  pages.forEach(page => {
    it(`GET ${page} returns 200`, async () => {
      const { status } = await request('GET', page);
      assert.strictEqual(status, 200);
    });
  });
});

// ================================================================
// MAIN
// ================================================================
(async () => {
  try {
    console.log(`${D}Starting server on port ${PORT}...${X}`);
    await startServer();
    console.log(`${G}Server started.${X} API Key: ${apiKey ? apiKey.substring(0, 16) + '...' : 'not found'}\n`);

    await runTests();

    stopServer();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`${R}Fatal error: ${err.message}${X}`);
    stopServer();
    process.exit(1);
  }
})();

// Cleanup on unexpected exit
process.on('SIGINT', () => { stopServer(); process.exit(1); });
process.on('SIGTERM', () => { stopServer(); process.exit(1); });
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); stopServer(); process.exit(1); });
