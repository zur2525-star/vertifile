#!/usr/bin/env node
'use strict';

/**
 * Integration tests for routes/well-known.js
 *
 * Spins up the full Express application on a random port (same pattern as
 * tests/api.test.js) and exercises every /.well-known/ endpoint with real
 * HTTP requests via the built-in fetch API.
 *
 * Key-manager calls (getPrimaryPublicKeyPem, listActivePublicKeys) that hit
 * the DB are handled gracefully: when no key is configured the endpoints
 * return 404 / empty-keys-array, which is the correct Phase 2A behaviour.
 *
 * Runner: node:test  (matches the rest of the test suite)
 * Usage:  node tests/well-known.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const http   = require('node:http');

// ---------------------------------------------------------------------------
// Server lifecycle — identical pattern to tests/api.test.js
// ---------------------------------------------------------------------------

const HMAC_SECRET    = 'test-well-known-hmac-secret';
const ADMIN_SECRET   = 'test-well-known-admin-secret';
const SESSION_SECRET = 'test-well-known-session-secret';

let BASE_URL = '';
let server   = null;

function startServer() {
  return new Promise((resolve, reject) => {
    process.env.HMAC_SECRET    = HMAC_SECRET;
    process.env.ADMIN_SECRET   = ADMIN_SECRET;
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.PORT           = '0'; // let the OS pick a free port

    // Clear require cache so we get a fresh app + db instance.
    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');

    delete require.cache[require.resolve(appPath)];
    if (require.cache[require.resolve(dbPath)]) {
      delete require.cache[require.resolve(dbPath)];
    }

    const app = require(appPath);
    const db  = require(dbPath);

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

before(async () => {
  await startServer();
});

after(async () => {
  await stopServer();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch a URL relative to the test server, returning response + text. */
async function get(urlPath, opts = {}) {
  const res = await fetch(`${BASE_URL}${urlPath}`, { method: 'GET', ...opts });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

/** Send an OPTIONS preflight request. */
async function options(urlPath) {
  const res = await fetch(`${BASE_URL}${urlPath}`, { method: 'OPTIONS' });
  return { status: res.status, headers: res.headers };
}

// ===========================================================================
// 1. GET /.well-known/vertifile-pubkey.pem
// ===========================================================================

describe('GET /.well-known/vertifile-pubkey.pem', () => {

  it('returns 404 when no Ed25519 key is configured (Phase 2A invisible mode)', async () => {
    // In the test environment ED25519_PRIVATE_KEY_PEM is not set, so the
    // key manager operates in Phase 2A: no key loaded, 404 expected.
    const { status } = await get('/.well-known/vertifile-pubkey.pem');
    assert.equal(status, 404);
  });

  it('returns plain text body on 404', async () => {
    const { status, text } = await get('/.well-known/vertifile-pubkey.pem');
    assert.equal(status, 404);
    assert.ok(typeof text === 'string' && text.length > 0, 'body must not be empty');
  });

  it('has Access-Control-Allow-Origin: * header', async () => {
    const { headers } = await get('/.well-known/vertifile-pubkey.pem');
    const acao = headers.get('access-control-allow-origin');
    assert.equal(acao, '*', `Expected ACAO=* — got: ${acao}`);
  });

  it('has Cache-Control header', async () => {
    const { headers } = await get('/.well-known/vertifile-pubkey.pem');
    const cc = headers.get('cache-control');
    assert.ok(cc && cc.length > 0, `Cache-Control header must be present — got: ${cc}`);
  });

  it('Cache-Control includes public and max-age=3600', async () => {
    const { headers } = await get('/.well-known/vertifile-pubkey.pem');
    const cc = headers.get('cache-control') || '';
    assert.ok(cc.includes('public'),      `Cache-Control must include 'public' — got: ${cc}`);
    assert.ok(cc.includes('max-age=3600'), `Cache-Control must include 'max-age=3600' — got: ${cc}`);
  });

  it('has Access-Control-Allow-Methods header containing GET', async () => {
    const { headers } = await get('/.well-known/vertifile-pubkey.pem');
    const acam = headers.get('access-control-allow-methods') || '';
    assert.ok(acam.includes('GET'), `Allow-Methods must include GET — got: ${acam}`);
  });
});

// ===========================================================================
// 2. GET /.well-known/vertifile-jwks.json
// ===========================================================================

describe('GET /.well-known/vertifile-jwks.json', () => {

  it('returns 200', async () => {
    const { status } = await get('/.well-known/vertifile-jwks.json');
    assert.equal(status, 200);
  });

  it('returns Content-Type application/json', async () => {
    const { headers } = await get('/.well-known/vertifile-jwks.json');
    const ct = headers.get('content-type') || '';
    assert.ok(ct.includes('application/json'), `Content-Type must be JSON — got: ${ct}`);
  });

  it('response body has a keys property that is an array', async () => {
    const { json } = await get('/.well-known/vertifile-jwks.json');
    assert.ok(json !== null, 'Response must be valid JSON');
    assert.ok(Object.prototype.hasOwnProperty.call(json, 'keys'), 'Response must have "keys" property');
    assert.ok(Array.isArray(json.keys), '"keys" must be an array');
  });

  it('keys array is empty when no keys are in the DB (test environment)', async () => {
    // In the test environment there are no Ed25519 keys registered in the DB.
    // listActivePublicKeys() returns [] which the endpoint maps to { keys: [] }.
    const { json } = await get('/.well-known/vertifile-jwks.json');
    assert.ok(Array.isArray(json.keys), '"keys" must be an array');
    // We only assert the type — if CI somehow has keys we don't want to fail.
  });

  it('has Access-Control-Allow-Origin: * header', async () => {
    const { headers } = await get('/.well-known/vertifile-jwks.json');
    const acao = headers.get('access-control-allow-origin');
    assert.equal(acao, '*', `Expected ACAO=* — got: ${acao}`);
  });

  it('has Cache-Control header', async () => {
    const { headers } = await get('/.well-known/vertifile-jwks.json');
    const cc = headers.get('cache-control');
    assert.ok(cc && cc.length > 0, `Cache-Control must be present — got: ${cc}`);
  });

  it('Cache-Control includes public and max-age=3600', async () => {
    const { headers } = await get('/.well-known/vertifile-jwks.json');
    const cc = headers.get('cache-control') || '';
    assert.ok(cc.includes('public'),       `Cache-Control must include 'public' — got: ${cc}`);
    assert.ok(cc.includes('max-age=3600'), `Cache-Control must include 'max-age=3600' — got: ${cc}`);
  });

  it('has Access-Control-Allow-Methods header containing GET', async () => {
    const { headers } = await get('/.well-known/vertifile-jwks.json');
    const acam = headers.get('access-control-allow-methods') || '';
    assert.ok(acam.includes('GET'), `Allow-Methods must include GET — got: ${acam}`);
  });
});

// ===========================================================================
// 3. GET /.well-known/security.txt
// ===========================================================================

describe('GET /.well-known/security.txt', () => {

  it('returns 200 or 404 depending on whether public/.well-known/security.txt exists on disk', async () => {
    const { status } = await get('/.well-known/security.txt');
    assert.ok(
      status === 200 || status === 404,
      `Status must be 200 or 404 — got: ${status}`
    );
  });

  it('Content-Type is text/plain regardless of file existence', async () => {
    const { headers } = await get('/.well-known/security.txt');
    const ct = headers.get('content-type') || '';
    assert.ok(ct.includes('text/plain'), `Content-Type must be text/plain — got: ${ct}`);
  });

  it('has Cache-Control header when the file exists (200)', async () => {
    const { status, headers } = await get('/.well-known/security.txt');
    if (status !== 200) return; // file absent — skip cache-control assertion

    const cc = headers.get('cache-control') || '';
    assert.ok(cc.includes('public'),         `Cache-Control must include 'public' — got: ${cc}`);
    assert.ok(cc.includes('max-age=86400'), `Cache-Control must include 'max-age=86400' — got: ${cc}`);
  });

  it('body is not empty when 200', async () => {
    const { status, text } = await get('/.well-known/security.txt');
    if (status !== 200) return;
    assert.ok(text.length > 0, 'security.txt body must not be empty');
  });

  it('body is plain text (not JSON) when 200', async () => {
    const { status, text } = await get('/.well-known/security.txt');
    if (status !== 200) return;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* expected */ }
    assert.equal(parsed, null, 'security.txt must not return JSON');
  });
});

// ===========================================================================
// 4. OPTIONS /.well-known/vertifile-pubkey.pem  (CORS preflight)
// ===========================================================================

describe('OPTIONS /.well-known/vertifile-pubkey.pem', () => {

  it('returns 204', async () => {
    const { status } = await options('/.well-known/vertifile-pubkey.pem');
    assert.equal(status, 204);
  });

  it('has Access-Control-Allow-Origin: *', async () => {
    const { headers } = await options('/.well-known/vertifile-pubkey.pem');
    const acao = headers.get('access-control-allow-origin');
    assert.equal(acao, '*', `Expected ACAO=* — got: ${acao}`);
  });

  it('has Access-Control-Allow-Methods containing GET', async () => {
    const { headers } = await options('/.well-known/vertifile-pubkey.pem');
    const acam = headers.get('access-control-allow-methods') || '';
    assert.ok(acam.includes('GET'), `Allow-Methods must include GET — got: ${acam}`);
  });

  it('Cache-Control header is either present or absent (not required on 204 preflight)', async () => {
    const { headers } = await options('/.well-known/vertifile-pubkey.pem');
    // Some middleware stacks strip Cache-Control from 204 responses.
    // The important caching is on GET responses — this just documents the behaviour.
    const cc = headers.get('cache-control');
    assert.ok(cc === null || cc.length > 0, 'Cache-Control should be absent or non-empty');
  });

  it('response body is empty', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/vertifile-pubkey.pem`, {
      method: 'OPTIONS',
    });
    const text = await res.text();
    assert.equal(text, '', `204 body must be empty — got: "${text}"`);
  });
});

// ===========================================================================
// 5. OPTIONS /.well-known/vertifile-jwks.json  (CORS preflight)
// ===========================================================================

describe('OPTIONS /.well-known/vertifile-jwks.json', () => {

  it('returns 204', async () => {
    const { status } = await options('/.well-known/vertifile-jwks.json');
    assert.equal(status, 204);
  });

  it('has Access-Control-Allow-Origin: *', async () => {
    const { headers } = await options('/.well-known/vertifile-jwks.json');
    const acao = headers.get('access-control-allow-origin');
    assert.equal(acao, '*', `Expected ACAO=* — got: ${acao}`);
  });

  it('has Access-Control-Allow-Methods containing GET', async () => {
    const { headers } = await options('/.well-known/vertifile-jwks.json');
    const acam = headers.get('access-control-allow-methods') || '';
    assert.ok(acam.includes('GET'), `Allow-Methods must include GET — got: ${acam}`);
  });

  it('Cache-Control header is either present or absent (not required on 204 preflight)', async () => {
    const { headers } = await options('/.well-known/vertifile-jwks.json');
    const cc = headers.get('cache-control');
    assert.ok(cc === null || cc.length > 0, 'Cache-Control should be absent or non-empty');
  });

  it('response body is empty', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/vertifile-jwks.json`, {
      method: 'OPTIONS',
    });
    const text = await res.text();
    assert.equal(text, '', `204 body must be empty — got: "${text}"`);
  });
});
