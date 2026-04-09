#!/usr/bin/env node
'use strict';

/**
 * Phase 2C — Verify endpoint Ed25519 dual-signature regression suite.
 *
 * What this guards against:
 *   - The /api/verify route silently drops Ed25519 enforcement on dual-signed
 *     docs (no-downgrade attack).
 *   - The forge-by-claim defense (client claims an Ed25519 sig exists for a
 *     legacy doc) starts accepting again.
 *   - The Phase-2B signing payload contract drifts: Phase 2C reconstructs
 *     `hash|orgId|createdAt|recipientHash|''` from the DB row, and a
 *     one-byte change anywhere in either side breaks crypto.verify().
 *   - Existing HMAC-only docs stop verifying after Phase 2C lands.
 *
 * Why this is its own file (not appended to api.test.js):
 *   key-manager.initialize() reads ED25519_PRIVATE_KEY_PEM at module load.
 *   We need a process where the env vars are set BEFORE any require() of
 *   server.js — so the loaded singleton has a real key. api.test.js runs
 *   without a key and tests the legacy path; this file owns the dual-signed
 *   path. They are not allowed to share a process.
 *
 * Strategy:
 *   1. Generate a fresh Ed25519 keypair in-memory.
 *   2. Set ED25519_PRIVATE_KEY_PEM + ED25519_PRIMARY_KEY_ID + HMAC_SECRET +
 *      DATABASE_URL pre-require so key-manager picks them up at boot.
 *   3. Require server.js (which calls keyManager.initialize()) and db.js.
 *   4. Insert the public key into ed25519_keys so getPublicKeyById() finds it.
 *   5. Insert TWO docs straight into the documents table:
 *        - dualHash: dual-signed (real Ed25519 sig over a real payload)
 *        - hmacHash: legacy HMAC-only (NULL ed25519 columns)
 *   6. Hit /api/verify with every relevant input combination and assert.
 *
 * The signature for the dual doc is computed by Phase 2B's actual signEd25519
 * over the actual buildSigningPayload — so a regression in EITHER side will
 * break the test (the test deliberately doesn't reimplement the contract).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1. Generate keypair + set env vars BEFORE any require of app code.
// ---------------------------------------------------------------------------
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ed25519');
const TEST_PRIV_PEM = TEST_PRIV.export({ type: 'pkcs8', format: 'pem' });
const TEST_PUB_PEM = TEST_PUB.export({ type: 'spki', format: 'pem' });
// keyId convention (matches scripts/generate-ed25519-keys.js): first 16 hex
// chars of sha256(public_key_pem). Always exactly 16 lowercase hex chars,
// which key-manager validates at boot.
const TEST_KEY_ID = crypto.createHash('sha256').update(TEST_PUB_PEM).digest('hex').slice(0, 16);

process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-verify-ed25519-hmac-secret';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-verify-ed25519-admin-secret';
process.env.ED25519_PRIVATE_KEY_PEM = TEST_PRIV_PEM;
process.env.ED25519_PRIMARY_KEY_ID = TEST_KEY_ID;
process.env.PORT = '0';
// DATABASE_URL must already be in the environment — same convention as
// tests/api.test.js (CI provides it; locally `export DATABASE_URL=...`).
if (!process.env.DATABASE_URL) {
  console.error('[verify-ed25519] DATABASE_URL not set — skipping suite. Set it to run.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 2. Now require app code. server.js will call keyManager.initialize() and
//    pick up the env vars set above.
// ---------------------------------------------------------------------------
const appPath = path.resolve(__dirname, '..', 'server.js');
const dbPath = path.resolve(__dirname, '..', 'db.js');
const app = require(appPath);
const db = require(dbPath);
const signing = require('../services/signing');
const keyManager = require('../services/key-manager');

// ---------------------------------------------------------------------------
// 3. Test fixtures: dual-signed doc + legacy HMAC-only doc.
// ---------------------------------------------------------------------------
let server = null;
let BASE_URL = '';

const DUAL_HASH = crypto.randomBytes(32).toString('hex');
const HMAC_HASH = crypto.randomBytes(32).toString('hex');
const ORG_ID = 'org_test_verify_ed25519';
const ORG_NAME = 'Verify Ed25519 Test Org';
const CREATED_AT = new Date().toISOString();
// HMAC signature over the document hash (matches signHash in pvf-generator).
const DUAL_HMAC_SIG = crypto.createHmac('sha256', process.env.HMAC_SECRET).update(DUAL_HASH).digest('hex');
const HMAC_HMAC_SIG = crypto.createHmac('sha256', process.env.HMAC_SECRET).update(HMAC_HASH).digest('hex');

// The Ed25519 signature is computed over the EXACT payload Phase 2B builds —
// so a regression in either signing.buildSigningPayload OR the verify route's
// reconstruction will break this test.
const DUAL_PAYLOAD = signing.buildSigningPayload({
  hash: DUAL_HASH,
  orgId: ORG_ID,
  createdAt: CREATED_AT,
  recipientHash: '',
  codeIntegrity: ''
});
let DUAL_ED25519_SIG = null;

before(async () => {
  // Wait for schema bootstrap.
  await db._ready;

  // server.js calls keyManager.initialize() inside its own db._ready.then()
  // continuation, which may or may not have run by the time our await above
  // resolves (depends on microtask ordering between two separate .then()s).
  // initialize() is idempotent — explicit call eliminates the race.
  keyManager.initialize();

  // Monkey-patch key-manager.getPublicKeyById to return the test public key
  // for the test keyId. We deliberately do NOT insert into the ed25519_keys
  // table: the unique-primary index would conflict on repeat runs (each run
  // generates a fresh keyId, and only one row may have is_primary=TRUE), and
  // the verifier doesn't need the row when the cache returns a hit first.
  // signing.test.js uses the same monkey-patch trick.
  const origGet = keyManager.getPublicKeyById;
  keyManager.getPublicKeyById = async (keyId) => {
    if (keyId === TEST_KEY_ID) return TEST_PUB;
    return origGet.call(keyManager, keyId);
  };

  // Phase 3B: signEd25519 now consults keyManager.getActivePrimary() which
  // reads ed25519_keys WHERE state='active'. The test's TEST_KEY_ID is NOT
  // in the DB (see comment above — deliberately not inserted), so the DB
  // lookup would resolve to the production genesis keyId, not TEST_KEY_ID.
  // Stub getActivePrimary to return the in-memory test key directly.
  const testPrivateKeyObj = crypto.createPrivateKey({ key: TEST_PRIV_PEM, format: 'pem' });
  keyManager.getActivePrimary = async () => ({ keyId: TEST_KEY_ID, privateKey: testPrivateKeyObj });

  // Sign the dual payload with the real Phase-2B path. signEd25519 reads
  // the active signing slot the same way the production pipeline does.
  const ed = await signing.signEd25519(DUAL_PAYLOAD);
  assert.ok(ed, 'signEd25519 should return a signature once key is loaded');
  assert.equal(ed.keyId, TEST_KEY_ID, 'signing keyId must match the test key');
  DUAL_ED25519_SIG = ed.signature;

  // Insert the dual-signed doc.
  await db.createDocument({
    hash: DUAL_HASH,
    signature: DUAL_HMAC_SIG,
    originalName: 'dual.txt',
    mimeType: 'text/plain',
    fileSize: 4,
    createdAt: CREATED_AT,
    orgId: ORG_ID,
    orgName: ORG_NAME,
    token: null,
    tokenCreatedAt: null,
    recipient: null,
    recipientHash: null,
    ed25519_signature: DUAL_ED25519_SIG,
    ed25519_key_id: TEST_KEY_ID
  });

  // Insert the legacy HMAC-only doc (NULL ed25519 columns).
  await db.createDocument({
    hash: HMAC_HASH,
    signature: HMAC_HMAC_SIG,
    originalName: 'legacy.txt',
    mimeType: 'text/plain',
    fileSize: 4,
    createdAt: CREATED_AT,
    orgId: ORG_ID,
    orgName: ORG_NAME,
    token: null,
    tokenCreatedAt: null,
    recipient: null,
    recipientHash: null,
    ed25519_signature: null,
    ed25519_key_id: null
  });

  // Start the server.
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      BASE_URL = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  // The two doc hashes are random per run, so re-runs don't collide and we
  // don't need to delete them. db.deleteDocument(hash, userId) requires a
  // user_id which we never set, so a clean delete would need raw SQL — not
  // worth the surface area. Test rows accumulate at a few bytes per run.
  if (server) {
    await new Promise((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// 4. The actual scenarios.
// ---------------------------------------------------------------------------
describe('POST /api/verify — Phase 2C dual-signature path', () => {

  it('Scenario C: dual-signed doc + matching Ed25519 sig → verified, signedBy=both', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: DUAL_HASH,
        signature: DUAL_HMAC_SIG,
        ed25519Signature: DUAL_ED25519_SIG,
        ed25519KeyId: TEST_KEY_ID
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, true, 'dual-signed doc with valid sig must verify');
    assert.equal(data.signedBy, 'both', 'signedBy must be "both" when both checks pass');
    assert.ok(data.token, 'should issue a session token');
  });

  it('Scenario D: dual-signed doc + missing Ed25519 sig → REJECT (no-downgrade)', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: DUAL_HASH,
        signature: DUAL_HMAC_SIG
        // No ed25519Signature / ed25519KeyId — the no-downgrade attack.
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, false, 'dual-signed doc must NOT downgrade to HMAC-only');
    assert.equal(data.reason, 'ed25519_required');
  });

  it('Dual-signed doc + tampered Ed25519 sig → REJECT', async () => {
    // Flip a middle character of the signature so the bytes definitely change.
    const mid = Math.floor(DUAL_ED25519_SIG.length / 2);
    const ch = DUAL_ED25519_SIG[mid];
    const tampered = DUAL_ED25519_SIG.substring(0, mid) + (ch === 'A' ? 'B' : 'A') + DUAL_ED25519_SIG.substring(mid + 1);

    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: DUAL_HASH,
        signature: DUAL_HMAC_SIG,
        ed25519Signature: tampered,
        ed25519KeyId: TEST_KEY_ID
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, false);
    assert.equal(data.reason, 'ed25519_invalid');
  });

  it('Scenario A: legacy HMAC-only doc + no Ed25519 fields → verified, signedBy=hmac (backward compat)', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: HMAC_HASH,
        signature: HMAC_HMAC_SIG
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, true, 'legacy HMAC-only doc must still verify after Phase 2C');
    assert.equal(data.signedBy, 'hmac', 'signedBy must be "hmac" for legacy docs');
  });

  it('Forge-by-claim defense: legacy doc + client-supplied Ed25519 sig → REJECT', async () => {
    const res = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: HMAC_HASH,
        signature: HMAC_HMAC_SIG,
        // Attacker claims an Ed25519 sig exists for a doc that was never dual-signed.
        ed25519Signature: DUAL_ED25519_SIG,
        ed25519KeyId: TEST_KEY_ID
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.verified, false, 'must not accept Ed25519 sig for non-dual-signed doc');
    assert.equal(data.reason, 'ed25519_unexpected');
  });

  it('Scenario E: keyId mismatch (Avi defense-in-depth)', async () => {
    // Same dual-signed doc, but client sends a DIFFERENT keyId (wrong key but valid format)
    const wrongKeyId = '1234567890abcdef';  // 16 hex chars but not the test key
    const r = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: DUAL_HASH,
        signature: DUAL_HMAC_SIG,
        ed25519Signature: DUAL_ED25519_SIG,
        ed25519KeyId: wrongKeyId
      })
    });
    const data = await r.json();
    assert.equal(data.verified, false);
    assert.equal(data.reason, 'ed25519_key_mismatch');
  });

  it('Scenario F: half-dual-signed row (Ori inconsistency check)', async () => {
    // Insert a corrupt doc with only ed25519_signature but no ed25519_key_id
    const corruptHash = crypto.randomBytes(32).toString('hex');
    const corruptHmacSig = crypto.createHmac('sha256', process.env.HMAC_SECRET).update(corruptHash).digest('hex');
    await db.createDocument({
      hash: corruptHash,
      signature: corruptHmacSig,
      originalName: 'corrupt.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      createdAt: new Date().toISOString(),
      orgId: ORG_ID,
      orgName: ORG_NAME,
      token: null,
      tokenCreatedAt: null,
      recipient: null,
      recipientHash: null,
      ed25519_signature: 'fakesignaturefakesignaturefakesignaturefakesignaturefakesignaturefakesignaturefakes',  // 86 chars
      ed25519_key_id: null  // CORRUPT — only one of two columns set
    });

    const r = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hash: corruptHash,
        signature: corruptHmacSig
      })
    });
    const data = await r.json();
    assert.equal(data.verified, false);
    assert.equal(data.reason, 'ed25519_inconsistent');
  });
});
