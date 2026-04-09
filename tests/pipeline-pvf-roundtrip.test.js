#!/usr/bin/env node
'use strict';

/**
 * Phase 2D+ — End-to-end PVF pipeline round-trip CI guardrail.
 *
 * GUARDS AGAINST the class of bug that hit VP6mXapK9bU: a template change
 * that leaves the stored pvf_content's init() function out of sync with
 * what /api/verify expects. Specifically, if the fetch body that init()
 * sends ever drifts from the fields /api/verify is checking, the stored
 * doc silently stops verifying even though nothing in the pipeline looks
 * broken — there is no runtime error, no build warning, nothing. The
 * first visible symptom is customer-reported "this verified doc now
 * shows as forged."
 *
 * HOW THIS TEST WORKS
 *
 *   1. Create a test doc end-to-end through services/pvf-pipeline.createPvf()
 *      with a test Ed25519 keypair injected via keyManager.getActivePrimary
 *      stub (so the test never depends on the real production key).
 *   2. Retrieve the stored pvf_content from the DB (this is byte-identical
 *      to what a real browser would receive when opening /d/<shareId>).
 *   3. Assert the embedded <script> contains the literal substrings
 *      `ed25519Signature` and `ed25519KeyId` — the exact grep that would
 *      have caught VP6mXapK9bU if it had existed in April.
 *   4. POST the doc's hash/signature/ed25519 fields to an in-process
 *      /api/verify endpoint and assert {verified: true, signedBy: 'both'}.
 *      This is the dynamic contract: the server must accept the fields
 *      the stored script forwards.
 *   5. As an HMAC-only sanity check, create a second doc with
 *      getActivePrimary stubbed to return null (backward-compat Phase 2B
 *      invisible mode, ED25519_REQUIRED unset), and assert /api/verify
 *      returns signedBy='hmac' for it.
 *
 * WHY THIS LAYER
 *
 *   We do NOT run the obfuscated script in a browser — jsdom does not
 *   tolerate javascript-obfuscator's output well and the harness would
 *   be fragile. Instead we guard the STATIC contract (the fetch body
 *   substrings) and the DYNAMIC contract (the /api/verify POST round-
 *   trip). VP6mXapK9bU was a failure at exactly this layer: the pvf_content
 *   stored in the DB did not contain ed25519Signature in its fetch body,
 *   so any static substring check would have caught it.
 *
 * CLEANUP
 *
 *   Matches tests/verify-public.test.js and tests/pipeline-phase2e.test.js:
 *     - NO db.close()
 *     - NO process.on('beforeExit')
 *     - force process.exit(0) at the end of after()
 *     - targeted DELETE on the test org_id for any inserted documents
 *       (plus per-hash cleanup as belt-and-suspenders)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Pre-require env setup. HMAC_SECRET is read by pvf-generator at module load,
// so set it before any require() chain that pulls in pipeline code.
// ---------------------------------------------------------------------------
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-pipeline-roundtrip-hmac';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-pipeline-roundtrip-admin';
process.env.PORT = '0';

if (!process.env.DATABASE_URL) {
  process.stderr.write('[pipeline-pvf-roundtrip] DATABASE_URL not set — skipping suite.\n');
  process.exit(0);
}

// The suite toggles ED25519_REQUIRED per-scenario. Capture the original so
// after() can restore it — the env var leaks across the whole process
// otherwise and may affect sibling tests chained with `&&`.
const ORIGINAL_ED25519_REQUIRED = process.env.ED25519_REQUIRED;
// Delete it for the duration of the suite so we start from a clean slate.
delete process.env.ED25519_REQUIRED;

// ---------------------------------------------------------------------------
// Require app code. We use a direct Express mount rather than server.js so
// the test is immune to any boot-time Ed25519 requirements that might be
// added in future phases.
// ---------------------------------------------------------------------------
const express = require('express');
const dbPath = path.resolve(__dirname, '..', 'db.js');
const db = require(dbPath);
const pipeline = require('../services/pvf-pipeline');
const signing = require('../services/signing');
const keyManager = require('../services/key-manager');
const apiRoutes = require(path.resolve(__dirname, '..', 'routes', 'api.js'));
// The blockchain singleton is exposed on app.get('chain') by server.js —
// we stub it with a disconnected shape here so /api/verify can run without
// a real Polygon connection.
const chainStub = {
  isConnected: () => false,
  register: async () => ({ success: false }),
  verify: async () => ({ ok: false })
};

// Test key id prefix for targeted cleanup.
const TEST_PREFIX = 'troundt' + crypto.randomBytes(2).toString('hex'); // 9 chars total
const TEST_ORG_ID = 'org_' + TEST_PREFIX;

// Track inserted hashes so after() can clean them up even on partial failure.
const INSERTED_HASHES = new Set();

// Generate a single test keypair for the whole suite. Scenario 1 uses it;
// Scenario 2 stubs getActivePrimary to return null and doesn't need it.
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ed25519');
const TEST_PUB_PEM = TEST_PUB.export({ type: 'spki', format: 'pem' });
const TEST_KEY_ID = crypto.createHash('sha256').update(TEST_PUB_PEM).digest('hex').slice(0, 16);

// Stub hooks.
let origGetActivePrimary = null;
let origGetPublicKeyById = null;

let server = null;
let port = 0;

// http.request helper — POST JSON, return parsed JSON body.
function httpPostJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = { _raw: text }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// Helper: produce a tiny in-memory file fixture for the pipeline.
function makeFixture(tag) {
  const buffer = Buffer.from('pipeline-roundtrip-' + tag + '-' + Date.now() + '-' + Math.random(), 'utf8');
  return {
    buffer,
    originalName: 'roundtrip-' + tag + '.txt',
    mimeType: 'text/plain',
    owner: {
      type: 'demo',
      id: TEST_ORG_ID,
      displayName: 'Pipeline Roundtrip Test'
    }
  };
}

async function createAndTrack(fixture) {
  const res = await pipeline.createPvf(fixture);
  if (res && res.hash) INSERTED_HASHES.add(res.hash);
  return res;
}

before(async () => {
  await db._ready;

  // Phase 3B Ori M2 — Initialize key-manager so subsequent scenarios that
  // exercise the real DB-lookup → slot-match path see consistent state.
  // Existing scenarios that stub getActivePrimary directly are unaffected.
  // initialize() is idempotent (guarded by _initialized) so this is always
  // safe. If ED25519_PRIVATE_KEY_PEM / ED25519_PRIMARY_KEY_ID are not set in
  // the test process, initialize() simply logs "Phase 2A invisible mode"
  // and returns — _primary stays null, which is what the test expects
  // (it stubs getActivePrimary directly).
  keyManager.initialize();

  origGetActivePrimary = keyManager.getActivePrimary;
  origGetPublicKeyById = keyManager.getPublicKeyById;

  // Mock getPublicKeyById so /api/verify can resolve TEST_KEY_ID to the
  // test public key without hitting the ed25519_keys table.
  keyManager.getPublicKeyById = async (keyId) => {
    if (keyId === TEST_KEY_ID) return TEST_PUB;
    return origGetPublicKeyById.call(keyManager, keyId);
  };

  // Mount /api on an in-process express app. We set the chain stub on
  // app.set('chain', ...) because routes/api.js reads it from there.
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.set('db', db);
  app.set('chain', chainStub);
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
  // Restore env vars first.
  try {
    if (ORIGINAL_ED25519_REQUIRED === undefined) {
      delete process.env.ED25519_REQUIRED;
    } else {
      process.env.ED25519_REQUIRED = ORIGINAL_ED25519_REQUIRED;
    }
  } catch (_) { /* swallow */ }

  // Restore key-manager stubs.
  try {
    if (origGetActivePrimary) keyManager.getActivePrimary = origGetActivePrimary;
    if (origGetPublicKeyById) keyManager.getPublicKeyById = origGetPublicKeyById;
  } catch (_) { /* swallow */ }

  // Shut down the listener.
  try {
    if (server) await new Promise((r) => server.close(() => r()));
  } catch (_) { /* swallow */ }

  // Bulk cleanup by orgId (catches partial-failure runs).
  try {
    await db.query('DELETE FROM documents WHERE org_id = $1', [TEST_ORG_ID]);
  } catch (_) { /* swallow */ }
  // Per-hash cleanup (belt-and-suspenders).
  for (const hash of INSERTED_HASHES) {
    await db.query('DELETE FROM documents WHERE hash = $1', [hash]).catch(() => {});
  }

  // Force exit — db.js holds an open pg pool.
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------------------
describe('PVF pipeline end-to-end round-trip (VP6mXapK9bU guardrail)', () => {

  it('1. Happy path — dual-signed doc: stored pvf_content contains ed25519 fields and /api/verify returns signedBy=both', async () => {
    // Stub the active-primary slot to our test key. This bypasses both the
    // DB state='active' lookup and the in-memory slot match so the pipeline
    // signs with TEST_PRIV regardless of what the production DB says.
    keyManager.getActivePrimary = async () => ({ keyId: TEST_KEY_ID, privateKey: TEST_PRIV });

    const fixture = makeFixture('dual');
    const res = await createAndTrack(fixture);

    assert.ok(res, 'createPvf must return a result');
    assert.equal(res.success, true);
    assert.ok(res.ed25519Signature, 'result must include ed25519Signature');
    assert.equal(res.ed25519KeyId, TEST_KEY_ID, 'result keyId must match the stubbed primary');

    // Pull the stored pvf_content — this is what a browser would receive
    // when opening /d/<shareId>. We fetch via savePvfContent's companion
    // getter so the test exercises the same code path routes/public.js
    // uses. db.getPvfContent takes a shareId (see db.js:680).
    const stored = await db.getPvfContent(res.shareId);
    assert.ok(stored && typeof stored === 'string', 'pvf_content must exist as a string');

    // STATIC CONTRACT: the embedded <script> MUST contain the literal
    // substrings ed25519Signature and ed25519KeyId in the fetch body.
    // This is exactly the grep that would have caught VP6mXapK9bU in
    // April — the frozen pvf_content for that doc omitted both. A string
    // search is intentionally simpler than a regex because the
    // obfuscator may rewrite property names in strings slightly; the
    // property NAMES in the fetch body object literal survive
    // obfuscation in the current config (see obfuscate.js).
    assert.ok(
      stored.includes('ed25519Signature'),
      'stored pvf_content MUST contain the ed25519Signature literal — this is the VP6mXapK9bU guardrail'
    );
    assert.ok(
      stored.includes('ed25519KeyId'),
      'stored pvf_content MUST contain the ed25519KeyId literal — this is the VP6mXapK9bU guardrail'
    );

    // DYNAMIC CONTRACT: POST to /api/verify with the fields a browser
    // would forward. The server must reconstruct the Ed25519 payload from
    // the DB row and verify against the supplied signature.
    const verifyBody = {
      hash: res.hash,
      signature: res.signature,
      recipientHash: res.recipientHash || undefined,
      created: res.timestamp,
      orgId: res.orgId,
      codeIntegrity: res.codeIntegrity,
      ed25519Signature: res.ed25519Signature,
      ed25519KeyId: res.ed25519KeyId
    };
    const { status, body } = await httpPostJson('/api/verify', verifyBody);

    assert.equal(status, 200, `/api/verify status: expected 200, got ${status}`);
    assert.equal(body.verified, true, `/api/verify must verify the roundtripped doc (response: ${JSON.stringify(body)})`);
    assert.equal(body.signedBy, 'both', 'signedBy must be "both" for a dual-signed doc');
  });

  it('2. HMAC-only path — getActivePrimary returns null: doc verifies as signedBy=hmac', async () => {
    // Make sure ED25519_REQUIRED is NOT set for this scenario — otherwise
    // the Phase 2E fail-closed branch would throw instead of degrading to
    // HMAC-only. We explicitly delete for defense-in-depth.
    delete process.env.ED25519_REQUIRED;

    // Stub getActivePrimary to return null (Phase 2B invisible-mode).
    keyManager.getActivePrimary = async () => null;

    const fixture = makeFixture('hmac');
    const res = await createAndTrack(fixture);

    assert.ok(res && res.success, 'createPvf must succeed without an ed25519 key under Phase 2B invisible mode');
    assert.equal(res.ed25519Signature, null, 'ed25519Signature must be null');
    assert.equal(res.ed25519KeyId, null, 'ed25519KeyId must be null');

    // Verify the /api/verify round-trip — submit with NO ed25519 fields.
    const { status, body } = await httpPostJson('/api/verify', {
      hash: res.hash,
      signature: res.signature,
      created: res.timestamp,
      orgId: res.orgId,
      codeIntegrity: res.codeIntegrity
      // ed25519Signature and ed25519KeyId deliberately omitted
    });

    assert.equal(status, 200);
    assert.equal(body.verified, true, `/api/verify must verify the HMAC-only doc (response: ${JSON.stringify(body)})`);
    assert.equal(body.signedBy, 'hmac', 'signedBy must be "hmac" for an HMAC-only doc');
  });

  it('3. Source-file canary — templates/pvf.js init() still forwards ed25519 fields', () => {
    // Paranoid static check: read templates/pvf.js directly and verify the
    // init() fetch body references the ed25519 property NAMES. This is the
    // canary that fires if a future dev deletes `ed25519Signature:sigEd` or
    // `ed25519KeyId:keyId` from the template without touching the pipeline.
    //
    // Why this is a separate scenario from #1: #1 tests the CURRENT pipeline
    // output, but if someone commits a template change AND the tests are
    // run in a DB-less CI lane that skips #1 and #2, the drift could still
    // ship. #3 runs regardless of DATABASE_URL (but the whole suite already
    // skips on no-DB, so that gap is narrower than it sounds). This canary
    // is ALSO cheap — one file read, two string matches.
    const fs = require('fs');
    const templatePath = path.resolve(__dirname, '..', 'templates', 'pvf.js');
    const src = fs.readFileSync(templatePath, 'utf8');

    // Must contain the property name literals somewhere in the source.
    assert.ok(
      src.includes('ed25519Signature'),
      'templates/pvf.js must contain the "ed25519Signature" property name (VP6mXapK9bU canary)'
    );
    assert.ok(
      src.includes('ed25519KeyId'),
      'templates/pvf.js must contain the "ed25519KeyId" property name (VP6mXapK9bU canary)'
    );

    // Stronger: the init() function's fetch body must have both as PROPERTY
    // keys (colon-delimited), not just referenced in comments. Match the
    // shape `ed25519Signature:<anything>` and `ed25519KeyId:<anything>`
    // anywhere in the source — this survives whitespace changes but would
    // break if someone deleted the key entirely.
    assert.match(
      src,
      /ed25519Signature\s*:/,
      'templates/pvf.js must use ed25519Signature as a property key (e.g. "ed25519Signature:sigEd")'
    );
    assert.match(
      src,
      /ed25519KeyId\s*:/,
      'templates/pvf.js must use ed25519KeyId as a property key (e.g. "ed25519KeyId:keyId")'
    );
  });

  it('4. Stored pvf_content contains createdAt matching the DB row (Phase 2C byte-identity)', async () => {
    // Phase 2C's most fragile invariant: doc.timestamp is a string, and
    // the value baked into the stored HTML must be byte-identical to the
    // value stored in the documents.created_at column. Any divergence
    // breaks Ed25519 verification because the payload is reconstructed
    // from the DB row.
    //
    // Reuse the dual-signed fixture from scenario 1 is tempting for
    // speed, but node:test does not guarantee execution order between
    // it() blocks (it does in practice, but we don't want to rely on it
    // for correctness). Create a fresh doc.
    keyManager.getActivePrimary = async () => ({ keyId: TEST_KEY_ID, privateKey: TEST_PRIV });

    const fixture = makeFixture('bytecheck');
    const res = await createAndTrack(fixture);

    const stored = await db.getPvfContent(res.shareId);
    assert.ok(stored, 'pvf_content must exist');

    // Read the documents row directly to get the DB's view of created_at.
    // db.getDocument returns mapDocRow output, which exposes .timestamp
    // as the string-typed created_at value.
    const dbRow = await db.getDocument(res.hash);
    assert.ok(dbRow, 'db.getDocument must find the inserted row');
    assert.equal(typeof dbRow.timestamp, 'string', 'doc.timestamp must be a string (Phase 2C invariant)');
    assert.equal(
      dbRow.timestamp,
      res.timestamp,
      'db timestamp must byte-equal the pipeline result timestamp'
    );

    // The stored HTML bakes the created_at into `var CREATED="<iso>";`.
    // Assert the exact value appears as a CREATED literal.
    const createdLiteral = 'var CREATED="' + dbRow.timestamp + '"';
    assert.ok(
      stored.includes(createdLiteral),
      'stored pvf_content must contain the exact createdAt literal from the DB row — Phase 2C byte-identity'
    );
  });
});
