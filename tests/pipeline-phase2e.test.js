#!/usr/bin/env node
'use strict';

/**
 * Phase 2E — pvf-pipeline fail-closed regression suite.
 *
 * Phase 2E hardens Phase 2B's "invisible-with-fallback" Ed25519 signing
 * into "dual-signed or nothing" for any environment where ED25519_REQUIRED=1
 * is set. This file guards the five scenarios that define the contract:
 *
 *   A. REQUIRED=1 + key loaded          → dual-signed doc produced.
 *   B. REQUIRED=1 + no primary key      → createPvf throws, no DB row.
 *   C. REQUIRED=1 + signEd25519 throws  → createPvf throws, no DB row.
 *   D. REQUIRED unset + no primary key  → backward compat, HMAC-only doc.
 *   E. REQUIRED='true' / 'yes'          → strict '1' equality, HMAC-only doc.
 *
 * What this guards against:
 *   - A future refactor that softens the fail-closed branch in pvf-pipeline.js.
 *   - A truthy check replacing the strict process.env.ED25519_REQUIRED === '1'
 *     comparison (an empty env var or any non-'1' value must NOT trigger).
 *   - A silent half-state where only one of ed25519Signature / ed25519KeyId
 *     is present — the enforcement block rejects both nulls AND half-state.
 *   - Phase 2B's invisible-fallback contract breaking for CI/dev runs that
 *     don't have a test keypair configured.
 *
 * Strategy (mirrors tests/verify-ed25519.test.js):
 *   1. Skip if DATABASE_URL is unset (graceful exit 0 — same as siblings).
 *   2. await db._ready before touching any table.
 *   3. Stub keyManager.getPrimary and/or signing.signEd25519 directly on
 *      the module singleton for each scenario. Restore in after().
 *   4. Call pipeline.createPvf(...) with a tiny in-memory buffer. This is
 *      the real pipeline — no HTTP, no server.js, no boot-time checks.
 *   5. Clean up every document row the test creates in after() so the
 *      suite is idempotent on re-runs.
 *
 * Why we do NOT require server.js:
 *   - keyManager.initialize() is called from server.js bootstrap. In Phase 2E
 *     a process where ED25519_REQUIRED=1 but no PEM is set would hit
 *     process.exit(1) on boot — we can't test that branch from the same
 *     Node process. The pipeline fail-closed branch is testable in isolation
 *     because it reads process.env at call time, not at module load time.
 *   - This is also why Scenario A does NOT require a real key to be loaded
 *     into keyManager — we stub getPrimary to return a test keypair.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1. Pre-require env setup — HMAC_SECRET is read by pvf-generator at module
//    load. Setting it here keeps us independent of whatever the host shell has.
// ---------------------------------------------------------------------------
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-pipeline-phase2e-hmac-secret';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-pipeline-phase2e-admin-secret';

// Skip gracefully when there's no DB to write to. Same convention as
// tests/verify-ed25519.test.js and tests/api.test.js.
if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  process.stderr.write('[pipeline-phase2e] DATABASE_URL not set — skipping suite.\n');
  process.exit(0);
}

// Capture the original ED25519_REQUIRED value so after() can restore it
// (the env var leaks across the whole process otherwise).
const ORIGINAL_ED25519_REQUIRED = process.env.ED25519_REQUIRED;
delete process.env.ED25519_REQUIRED;

// ---------------------------------------------------------------------------
// 2. Require app code. We deliberately do NOT require server.js — see the
//    module header. The pipeline is exercised directly.
// ---------------------------------------------------------------------------
const dbPath = path.resolve(__dirname, '..', 'db.js');
const db = require(dbPath);
const pipeline = require('../services/pvf-pipeline');
const signing = require('../services/signing');
const keyManager = require('../services/key-manager');

// Safety net: if the test process crashes (uncaught exception, SIGINT)
// BEFORE after() runs, these hooks still fire and clean up the org rows.
// Best-effort — ignore errors. Note: placed after `db` is required so the
// handlers can reference it; the DATABASE_URL guard above already skipped
// if no DB is available.
process.on('beforeExit', async () => {
  try {
    await db.query("DELETE FROM documents WHERE org_id = 'org_phase2e_test'", []).catch(()=>{});
  } catch (e) { /* swallow */ }
});
process.on('uncaughtException', async (err) => {
  console.error('[phase2e-test] uncaughtException:', err.message);
  try {
    await db.query("DELETE FROM documents WHERE org_id = 'org_phase2e_test'", []).catch(()=>{});
  } catch (e) { /* swallow */ }
  process.exit(1);
});

// ---------------------------------------------------------------------------
// 3. Test keypair for Scenario A. Generated once so every scenario that
//    needs a "real" key gets the same bytes.
// ---------------------------------------------------------------------------
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ed25519');
const TEST_PUB_PEM = TEST_PUB.export({ type: 'spki', format: 'pem' });
// Same keyId convention as scripts/generate-ed25519-keys.js + verify-ed25519.test.js:
// first 16 hex chars of sha256(public_key_pem). Key-manager enforces this format
// at boot — matching it here keeps the half-state defensive check honest.
const TEST_KEY_ID = crypto.createHash('sha256').update(TEST_PUB_PEM).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// 4. Stubbing hooks. Each scenario reassigns one or both; the originals are
//    captured in before() and restored in after().
// ---------------------------------------------------------------------------
let origGetPrimary = null;
let origSignEd25519 = null;

// Track every hash our tests insert so after() can clean them up. The
// pipeline writes via db.createDocument → queryWithRetry, so a simple
// DELETE by hash is enough.
const INSERTED_HASHES = new Set();

/**
 * Tiny in-memory "file" for the pipeline. The hash is byte-deterministic from
 * the buffer content, which is exactly the guarantee the INSERTED_HASHES set
 * relies on for cleanup. Each scenario mutates `tag` so doc hashes don't
 * collide across scenarios within one run.
 */
function makeFixture(tag) {
  const buffer = Buffer.from(`phase2e-test-${tag}-${Date.now()}-${Math.random()}`, 'utf8');
  return {
    buffer,
    originalName: `phase2e-${tag}.txt`,
    mimeType: 'text/plain',
    owner: {
      type: 'demo',
      id: 'org_phase2e_test',
      displayName: 'Phase 2E Test Org'
    }
  };
}

/**
 * Call pipeline.createPvf, capture the resulting hash if it succeeds, and
 * forward any thrown error to the caller. We always record hashes for
 * cleanup even if a later assertion fails — otherwise a broken run would
 * pollute the documents table.
 */
async function createAndTrack(fixture) {
  const res = await pipeline.createPvf(fixture);
  if (res && res.hash) INSERTED_HASHES.add(res.hash);
  return res;
}

before(async () => {
  // Wait for schema bootstrap. db._ready resolves after all ALTER TABLE
  // migrations complete — without it Scenario A can race the ed25519_* column
  // creation on a fresh DB.
  await db._ready;

  // Capture originals before any scenario mutates them.
  origGetPrimary = keyManager.getPrimary;
  origSignEd25519 = signing.signEd25519;
});

after(async () => {
  // Wrap restores in try/catch so they ALWAYS run even if cleanup throws.
  try {
    // Restore env vars first so nothing leaks into sibling test files if the
    // parent shell chains them with &&.
    if (ORIGINAL_ED25519_REQUIRED === undefined) {
      delete process.env.ED25519_REQUIRED;
    } else {
      process.env.ED25519_REQUIRED = ORIGINAL_ED25519_REQUIRED;
    }
  } catch (e) { /* swallow */ }

  try {
    // Restore stubs on the real module singletons.
    if (origGetPrimary) keyManager.getPrimary = origGetPrimary;
    if (origSignEd25519) signing.signEd25519 = origSignEd25519;
  } catch (e) { /* swallow */ }

  // Defensive bulk cleanup: any rows from previous crashed runs under the
  // test org_id are nuked regardless of whether they're in INSERTED_HASHES.
  // This makes the suite self-healing across interrupted runs.
  try {
    await db.query("DELETE FROM documents WHERE org_id = 'org_phase2e_test'", []);
    // Ori Recommended #4: audit_log rows accumulate forever without this.
    // The details column is JSON; extract orgId and match. If the query fails
    // (e.g., jsonb cast unsupported on old Postgres), swallow — it's cleanup.
    await db.query(
      "DELETE FROM audit_log WHERE details::jsonb->>'orgId' = 'org_phase2e_test'",
      []
    ).catch(() => { /* swallow — cleanup is best-effort */ });
  } catch (e) { /* swallow */ }

  // Existing per-hash cleanup (belt-and-suspenders, preserve for backward compat).
  // Clean up every document this suite inserted. Raw query via db.query
  // because db.deleteDocument requires a user_id we never set.
  for (const hash of INSERTED_HASHES) {
    await db.query('DELETE FROM documents WHERE hash = $1', [hash]).catch(() => {});
  }

  // Close the pool so the Node process can exit cleanly. Mirrors the pattern
  // in verify-ed25519.test.js after-hook.
  await db.close().catch(() => {});
});

// ---------------------------------------------------------------------------
// 5. The scenarios.
// ---------------------------------------------------------------------------
describe('pipeline.createPvf — Phase 2E fail-closed contract', () => {

  it('Scenario A: ED25519_REQUIRED=1 + primary key loaded → dual-signed doc created', async () => {
    // Real-world failure mode this guards:
    //   A correctly-provisioned production box with ED25519_REQUIRED=1, a
    //   valid PEM, and a healthy crypto.sign() path must produce a dual-signed
    //   document. If this scenario breaks, the whole platform stops issuing
    //   new PVFs — this is the "does Phase 2E boot at all" smoke test.
    process.env.ED25519_REQUIRED = '1';
    keyManager.getPrimary = () => ({ keyId: TEST_KEY_ID, privateKey: TEST_PRIV });
    signing.signEd25519 = origSignEd25519;  // use the real path

    const fixture = makeFixture('scenarioA');
    const res = await createAndTrack(fixture);

    assert.ok(res, 'createPvf must return a result object');
    assert.equal(res.success, true, 'success flag must be true');
    assert.ok(res.ed25519Signature, 'Ed25519 signature must be present');
    assert.ok(res.ed25519KeyId, 'Ed25519 keyId must be present');
    assert.equal(res.ed25519KeyId, TEST_KEY_ID, 'keyId must match the stubbed primary');
    // Ed25519 signatures are exactly 64 bytes → 86 chars base64url.
    assert.equal(res.ed25519Signature.length, 86, 'base64url Ed25519 sig is 86 chars');
  });

  it('Scenario B: ED25519_REQUIRED=1 + NO primary key → createPvf throws, no doc row', async () => {
    // Real-world failure mode this guards:
    //   A production box where the env vars got rotated mid-flight and the
    //   primary key was dropped (e.g. an operator mis-edited Render secrets).
    //   Silent HMAC-only degradation would issue unverifiable docs — Phase 2E
    //   must instead abort loudly so monitoring catches the regression.
    process.env.ED25519_REQUIRED = '1';
    keyManager.getPrimary = () => null;
    signing.signEd25519 = origSignEd25519;  // real path, which will see null primary and return null

    const fixture = makeFixture('scenarioB');

    // Count docs by orgId BEFORE. If the enforcement block fires correctly,
    // createPvf must throw BEFORE db.createDocument is reached — so the count
    // stays identical.
    const { rows: before } = await db.query(
      'SELECT COUNT(*) as count FROM documents WHERE org_id = $1',
      [fixture.owner.id]
    );
    const beforeCount = Number(before[0].count);

    await assert.rejects(
      () => createAndTrack(fixture),
      (err) => {
        assert.equal(err.message, 'ED25519_REQUIRED_NO_SIGNATURE',
          `expected exact error 'ED25519_REQUIRED_NO_SIGNATURE', got '${err.message}'`);
        return true;
      }
    );

    const { rows: after } = await db.query(
      'SELECT COUNT(*) as count FROM documents WHERE org_id = $1',
      [fixture.owner.id]
    );
    assert.equal(Number(after[0].count), beforeCount, 'no document row may be created when fail-closed fires');
  });

  it('Scenario C: ED25519_REQUIRED=1 + signEd25519 throws → createPvf throws, no doc row', async () => {
    // Real-world failure mode this guards:
    //   OpenSSL hiccup, corrupted KeyObject, hardware RNG failure — any
    //   runtime crash inside crypto.sign(). Phase 2B's inner try/catch swallows
    //   the throw and sets ed25519Result to null; the Phase 2E outer check
    //   must then see both ed25519Signature and ed25519KeyId as null and
    //   abort. This scenario proves the two layers compose correctly.
    process.env.ED25519_REQUIRED = '1';
    keyManager.getPrimary = () => ({ keyId: TEST_KEY_ID, privateKey: TEST_PRIV });
    signing.signEd25519 = () => { throw new Error('simulated crypto failure'); };

    const fixture = makeFixture('scenarioC');

    const { rows: before } = await db.query(
      'SELECT COUNT(*) as count FROM documents WHERE org_id = $1',
      [fixture.owner.id]
    );
    const beforeCount = Number(before[0].count);

    await assert.rejects(
      () => createAndTrack(fixture),
      (err) => {
        assert.equal(err.message, 'ED25519_REQUIRED_NO_SIGNATURE',
          `expected exact error 'ED25519_REQUIRED_NO_SIGNATURE', got '${err.message}'`);
        return true;
      }
    );

    const { rows: after } = await db.query(
      'SELECT COUNT(*) as count FROM documents WHERE org_id = $1',
      [fixture.owner.id]
    );
    assert.equal(Number(after[0].count), beforeCount, 'no document row may be created when sign throws under REQUIRED=1');
  });

  it('Scenario D: ED25519_REQUIRED unset → backward compat, HMAC-only doc succeeds', async () => {
    // Real-world failure mode this guards:
    //   Phase 2E must be OPT-IN. Local dev, CI without a test keypair, and
    //   any environment that hasn't flipped the switch yet must continue to
    //   behave exactly like Phase 2B. Breaking this scenario would force
    //   every downstream consumer (CI, contributor laptops) to provision
    //   Ed25519 keys just to run the pipeline — a huge dev-ex regression.
    delete process.env.ED25519_REQUIRED;
    keyManager.getPrimary = () => null;
    signing.signEd25519 = origSignEd25519;

    const fixture = makeFixture('scenarioD');
    const res = await createAndTrack(fixture);

    assert.ok(res, 'createPvf must return a result object');
    assert.equal(res.success, true, 'success flag must be true in backward-compat mode');
    assert.equal(res.ed25519Signature, null, 'ed25519Signature must be null when no key is loaded');
    assert.equal(res.ed25519KeyId, null, 'ed25519KeyId must be null when no key is loaded');
  });

  it('Scenario E: strict "1" equality — "true", "yes", "0", "" all treated as unset', async () => {
    // Real-world failure mode this guards:
    //   A future refactor that "helpfully" accepts 'true', 'yes', or any
    //   truthy value for ED25519_REQUIRED. That's a silent-change trap: an
    //   operator who types '0' or 'false' would still trigger the hard
    //   requirement under a truthy check. Strict string equality on '1' is
    //   the ONLY acceptable gate — this scenario enforces that contract.
    //
    // CRITICAL: the '0' case is the single most important regression guard.
    // .env.example:17 ships ED25519_REQUIRED=0 — a future dev who replaces
    // the strict check with !!process.env.ED25519_REQUIRED or similar would
    // silently turn on Phase 2E for every operator who copied the example.
    // This test locks the string '0' as "not activated."
    const scenarios = [
      { val: 'true', label: 'truthy string' },
      { val: 'yes',  label: 'yes string' },
      { val: '0',    label: 'zero string (CRITICAL — .env.example ships ED25519_REQUIRED=0)' },
      { val: '',     label: 'empty string' }
    ];

    for (const s of scenarios) {
      process.env.ED25519_REQUIRED = s.val;
      // Stub getPrimary → null to force the null-result path
      keyManager.getPrimary = () => null;
      signing.signEd25519 = origSignEd25519;

      // Expect: createPvf succeeds with HMAC-only (no throw), because the strict
      // === '1' check does NOT match any of these values.
      const fixture = makeFixture('scenarioE-' + (s.val || 'empty'));
      const result = await createAndTrack(fixture);
      assert.equal(result.success, true, `${s.label}: createPvf should succeed`);
      assert.equal(result.ed25519Signature, null, `${s.label}: should be HMAC-only`);
      assert.equal(result.ed25519KeyId, null, `${s.label}: should be HMAC-only`);
    }
  });
});
