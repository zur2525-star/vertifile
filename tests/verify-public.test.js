#!/usr/bin/env node
'use strict';

/**
 * Phase 2D — Stateless public verification regression suite.
 *
 * What this guards against:
 *   - GET /api/verify-public silently starts touching the documents table
 *     (it must be a pure crypto endpoint).
 *   - Input validation drift — every malformed shape must reject before any
 *     crypto work happens.
 *   - The fingerprint contract: sha256(public_key_pem) hex, with the keyId
 *     equal to the first 16 chars (by Vertifile convention).
 *   - The payload-hash consistency check stops catching mismatched inputs.
 *   - A tampered signature accidentally passes verification.
 *
 * Strategy:
 *   1. Generate a fresh in-memory Ed25519 keypair.
 *   2. Set HMAC_SECRET / ADMIN_SECRET / DATABASE_URL pre-require so the
 *      app can boot.
 *   3. Bootstrap a minimal Express app that mounts /api → routes/api.js.
 *      This deliberately does NOT use server.js — we want to avoid
 *      keyManager.initialize() pulling a real ED25519_PRIVATE_KEY_PEM out
 *      of the environment, since this endpoint only needs the verifier
 *      side (public-key lookups).
 *   4. Monkey-patch keyManager.getPublicKeyById AND
 *      keyManager.getPublicKeyPemById so the test never hits the
 *      ed25519_keys table.
 *   5. Sign a known payload with the test private key, then exercise the
 *      five scenarios via http.request.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1. Pre-require env. DATABASE_URL must already be set (matches verify-ed25519
//    pattern). The endpoint itself does not query documents — but db.js is
//    required transitively by routes/api.js and tries to bootstrap a schema
//    at import time, so we need a working DB just to load the route.
// ---------------------------------------------------------------------------
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-verify-public-hmac-secret';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-verify-public-admin-secret';
process.env.PORT = '0';

if (!process.env.DATABASE_URL) {
  console.error('[verify-public] DATABASE_URL not set — skipping suite. Set it to run.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Generate a test keypair. The PEM is the canonical form the fingerprint
//    is computed over, and the keyId is the first 16 hex chars of
//    sha256(pem) — same convention as scripts/generate-ed25519-keys.js.
// ---------------------------------------------------------------------------
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ed25519');
const TEST_PUB_PEM = TEST_PUB.export({ type: 'spki', format: 'pem' });
const TEST_PUB_FINGERPRINT = crypto.createHash('sha256').update(TEST_PUB_PEM).digest('hex');
const TEST_KEY_ID = TEST_PUB_FINGERPRINT.slice(0, 16);

// ---------------------------------------------------------------------------
// 3. Bootstrap the test server. Manual express + apiRoutes (not server.js)
//    so we don't need ED25519_PRIVATE_KEY_PEM in the env.
// ---------------------------------------------------------------------------
const express = require('express');
const dbPath = path.resolve(__dirname, '..', 'db.js');
const apiRoutesPath = path.resolve(__dirname, '..', 'routes', 'api.js');
const db = require(dbPath);
const apiRoutes = require(apiRoutesPath);
const keyManager = require('../services/key-manager');
const signing = require('../services/signing');

let server = null;
let port = 0;

// Phase 2D M7 invariant: GET /api/verify-public must NOT touch the documents
// table. Wrap db.getDocument so any call increments a counter we can assert on
// at the end of the suite. Restored in the after hook for hygiene.
let docTouchCount = 0;
let origGetDocument = null;

// ---------------------------------------------------------------------------
// 4. Build the canonical signed payload. Format mirrors Phase 2B's
//    buildSigningPayload: hash|orgId|createdAt|recipientHash|codeIntegrity.
// ---------------------------------------------------------------------------
const TEST_HASH = crypto.randomBytes(32).toString('hex');
const TEST_ORG_ID = 'org_verify_public_test';
const TEST_CREATED_AT = new Date().toISOString();
const TEST_PAYLOAD = signing.buildSigningPayload({
  hash: TEST_HASH,
  orgId: TEST_ORG_ID,
  createdAt: TEST_CREATED_AT,
  recipientHash: '',
  codeIntegrity: ''
});

// Sign with the raw test private key — we deliberately do NOT route through
// signing.signEd25519, because that reads keyManager.getPrimary() which
// requires ED25519_PRIVATE_KEY_PEM in the env. Direct crypto.sign is the
// same primitive Phase 2B uses internally.
const TEST_SIG_BUF = crypto.sign(null, Buffer.from(TEST_PAYLOAD, 'utf8'), TEST_PRIV);
const TEST_SIGNATURE = TEST_SIG_BUF.toString('base64url');

// ---------------------------------------------------------------------------
// http.request helper — returns { status, body (parsed JSON) }.
// ---------------------------------------------------------------------------
function httpGet(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: pathAndQuery
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch (e) { body = { _raw: text }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, v);
  }
  return '/api/verify-public?' + usp.toString();
}

// ---------------------------------------------------------------------------
// 5. Test setup: monkey-patch the key-manager lookups so the test doesn't
//    touch the ed25519_keys table, then start the server.
// ---------------------------------------------------------------------------
before(async () => {
  await db._ready;

  // Mock both lookups. The route only calls getPublicKeyPemById — getPublicKeyById
  // is invoked indirectly by signing.verifyEd25519 — so both must be patched.
  const origGetPub = keyManager.getPublicKeyById;
  const origGetPem = keyManager.getPublicKeyPemById;
  keyManager.getPublicKeyById = async (kid) => {
    if (kid === TEST_KEY_ID) return TEST_PUB;
    return origGetPub.call(keyManager, kid);
  };
  keyManager.getPublicKeyPemById = async (kid) => {
    if (kid === TEST_KEY_ID) return TEST_PUB_PEM;
    return origGetPem.call(keyManager, kid);
  };

  // Phase 2D M7 invariant: GET /api/verify-public must NOT touch the documents
  // table. Wrap db.getDocument so any call increments a counter we can assert
  // on after all scenarios run.
  origGetDocument = db.getDocument;
  db.getDocument = async function(...args) {
    docTouchCount++;
    return origGetDocument.apply(db, args);
  };

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.set('db', db);
  app.use('/api', apiRoutes);

  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  // Restore db.getDocument — hygiene, even though process.exit makes it moot.
  if (origGetDocument) {
    db.getDocument = origGetDocument;
  }
  if (server) {
    await new Promise((r) => server.close(() => r()));
  }
  // Force exit — db.js holds an open pg pool that can keep the event loop alive.
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 6. The five scenarios.
// ---------------------------------------------------------------------------
describe('GET /api/verify-public — Phase 2D stateless verification', () => {

  it('A: valid signature + valid keyId + valid payload → valid:true with fingerprint', async () => {
    const { status, body } = await httpGet(buildQuery({
      hash: TEST_HASH,
      signature: TEST_SIGNATURE,
      keyId: TEST_KEY_ID,
      payload: TEST_PAYLOAD
    }));

    assert.equal(status, 200);
    assert.equal(body.valid, true, 'good signature must verify');
    assert.equal(body.keyId, TEST_KEY_ID);
    assert.equal(body.fingerprint, TEST_PUB_FINGERPRINT, 'fingerprint must equal sha256(pem) hex');
    assert.equal(body.algorithm, 'Ed25519');
    assert.ok(body.verifiedAt, 'should include verifiedAt timestamp');
    // The fingerprint's first 16 chars equal the keyId by convention.
    assert.equal(body.fingerprint.slice(0, 16), TEST_KEY_ID);
  });

  it('B: tampered signature (1 byte changed) → valid:false, invalid_signature', async () => {
    // Flip a middle character so the bytes definitely change but the format
    // stays valid base64url. Picks a non-equal substitute to guarantee a diff.
    const mid = Math.floor(TEST_SIGNATURE.length / 2);
    const ch = TEST_SIGNATURE[mid];
    const replacement = (ch === 'A') ? 'B' : 'A';
    const tampered = TEST_SIGNATURE.substring(0, mid) + replacement + TEST_SIGNATURE.substring(mid + 1);

    const { status, body } = await httpGet(buildQuery({
      hash: TEST_HASH,
      signature: tampered,
      keyId: TEST_KEY_ID,
      payload: TEST_PAYLOAD
    }));

    assert.equal(status, 200);
    assert.equal(body.valid, false);
    assert.equal(body.error, 'invalid_signature');
    assert.equal(body.keyId, TEST_KEY_ID);
    // Phase 2D M3: fingerprint must NOT be present on invalid_signature — it
    // would create a keyId enumeration oracle (valid keyId + bad sig reveals
    // the fingerprint, wrong keyId doesn't). Both failure branches are now
    // shape-consistent and leak nothing.
    assert.equal(body.fingerprint, undefined);
    assert.equal(body.algorithm, 'Ed25519');
  });

  it('C: wrong keyId (not in mock map) → valid:false, unknown_key', async () => {
    const wrongKeyId = '1234567890abcdef'; // 16 hex chars but not the test key
    const { status, body } = await httpGet(buildQuery({
      hash: TEST_HASH,
      signature: TEST_SIGNATURE,
      keyId: wrongKeyId,
      payload: TEST_PAYLOAD
    }));

    assert.equal(status, 200);
    assert.equal(body.valid, false);
    assert.equal(body.error, 'unknown_key');
    assert.equal(body.keyId, wrongKeyId);
    // unknown_key responses must NOT leak a fingerprint we don't have.
    assert.equal(body.fingerprint, undefined);
  });

  it('D: malformed hash (not 64 hex) → 400 invalid_input, detail=hash', async () => {
    const { status, body } = await httpGet(buildQuery({
      hash: 'not-a-real-hash',
      signature: TEST_SIGNATURE,
      keyId: TEST_KEY_ID,
      payload: TEST_PAYLOAD
    }));

    assert.equal(status, 400);
    assert.equal(body.valid, false);
    assert.equal(body.error, 'invalid_input');
    assert.equal(body.detail, 'hash');
  });

  it('E: payload first component != hash → 400 invalid_input, detail=payload_hash_mismatch', async () => {
    // Build a perfectly-formed payload that signs cleanly but starts with
    // the WRONG hash. The signature math would actually pass — the soft
    // consistency check is what stops the request, before any crypto runs.
    const otherHash = crypto.randomBytes(32).toString('hex');
    const mismatchedPayload = signing.buildSigningPayload({
      hash: otherHash,
      orgId: TEST_ORG_ID,
      createdAt: TEST_CREATED_AT,
      recipientHash: '',
      codeIntegrity: ''
    });
    const sig = crypto.sign(null, Buffer.from(mismatchedPayload, 'utf8'), TEST_PRIV).toString('base64url');

    const { status, body } = await httpGet(buildQuery({
      hash: TEST_HASH,           // does NOT match the payload's first component
      signature: sig,
      keyId: TEST_KEY_ID,
      payload: mismatchedPayload
    }));

    assert.equal(status, 400);
    assert.equal(body.valid, false);
    assert.equal(body.error, 'invalid_input');
    assert.equal(body.detail, 'payload_hash_mismatch');
  });

  it('F: invalid_input exhaustive — each malformed field returns its own detail', async () => {
    const validBase = {
      hash: TEST_HASH,
      signature: TEST_SIGNATURE,
      keyId: TEST_KEY_ID,
      payload: TEST_PAYLOAD
    };
    const scenarios = [
      { name: 'signature wrong charset (spaces)',  override: { signature: '   ' + TEST_SIGNATURE.slice(3) }, detail: 'signature' },
      { name: 'signature wrong length (87)',       override: { signature: TEST_SIGNATURE + 'A' },               detail: 'signature' },
      { name: 'signature with = padding',          override: { signature: TEST_SIGNATURE.slice(0, 85) + '=' }, detail: 'signature' },
      { name: 'keyId uppercase (non-canonical)',   override: { keyId: TEST_KEY_ID.toUpperCase() },             detail: 'keyId' },
      { name: 'keyId wrong length',                override: { keyId: 'abc' },                                  detail: 'keyId' },
      { name: 'payload too large',                 override: { payload: TEST_HASH + '|' + 'x'.repeat(600) },   detail: 'payload' },
      { name: 'hash missing',                      override: { hash: '' },                                      detail: 'hash' },
      { name: 'signature missing',                 override: { signature: '' },                                 detail: 'signature' },
      { name: 'keyId missing',                     override: { keyId: '' },                                     detail: 'keyId' },
      { name: 'payload missing',                   override: { payload: '' },                                   detail: 'payload' }
    ];

    for (const scenario of scenarios) {
      const query = { ...validBase, ...scenario.override };
      const { status, body } = await httpGet(buildQuery(query));
      assert.equal(status, 400, `${scenario.name}: expected 400, got ${status}`);
      assert.equal(body.valid, false, `${scenario.name}: expected valid:false`);
      assert.equal(body.error, 'invalid_input', `${scenario.name}: expected error=invalid_input`);
      assert.equal(body.detail, scenario.detail, `${scenario.name}: expected detail=${scenario.detail}, got ${body.detail}`);
    }
  });

  it('invariant: /api/verify-public never touches the documents table', () => {
    assert.equal(docTouchCount, 0, '/api/verify-public must not call db.getDocument — it is a pure crypto endpoint');
  });
});
