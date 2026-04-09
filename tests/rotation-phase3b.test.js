#!/usr/bin/env node
'use strict';

/**
 * Phase 3B — Rotation operational-infrastructure regression suite.
 *
 * Companion to tests/rotation-schema.test.js. Where that file guards the
 * Phase 3A DDL (columns, triggers, genesis log), this file guards the
 * Phase 3B runtime pieces that were added on top of it:
 *
 *   - Two-slot key-manager loading (_primary + _next from env vars).
 *   - getActivePrimary() resolving a DB state='active' row to the correct
 *     loaded slot, with graceful fallback to null on any mismatch.
 *   - setEd25519KeyState() surfacing trigger failures as the typed
 *     Ed25519ForbiddenTransitionError so the rotation command can tell
 *     "operator typo on the new state" from "DB connectivity failure".
 *   - setEd25519KeyState() surfacing a missing-key lookup as the typed
 *     Ed25519KeyNotFoundError.
 *   - The M5/M6 partial unique indexes enforcing "at most one active" and
 *     "at most one pending" row.
 *
 * What this file does NOT cover (scope boundary):
 *   - The actual rotation CLI subcommands (scripts/rotate-ed25519-key.js).
 *     Those are validated by operator smoke test, not by this suite —
 *     spawning a CLI and asserting on stdout makes the tests slow and
 *     brittle. The logic inside setEd25519KeyState + getActivePrimary is
 *     what the CLI composes; we test the pieces.
 *   - The Render-side env-var promotion flow. That is operator-procedural
 *     and cannot be tested in-process.
 *   - The identical-keyId-in-both-slots boot-fail path. Testing a
 *     process.exit(1) branch from inside the same Node process is not
 *     possible; this is manually-verified in a sandbox box before each
 *     release.
 *
 * Strategy (mirrors tests/rotation-schema.test.js):
 *   1. Skip on no DATABASE_URL.
 *   2. Fresh TEST_PREFIX for every run — targeted LIKE cleanup in after().
 *   3. Direct db.query() for the no-state-conflict scenarios; use
 *      withTransactionalActiveRow (copied from rotation-schema.test.js)
 *      only where we need to touch a state='active' row.
 *   4. NO db.close(), NO process.on('beforeExit'), force process.exit(0)
 *      in after(). Matches verify-public.test.js exactly.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Skip gate — same convention as sibling suites.
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  process.stderr.write('[rotation-phase3b] DATABASE_URL not set — skipping suite.\n');
  process.exit(0);
}

const dbPath = path.resolve(__dirname, '..', 'db.js');
const db = require(dbPath);
const keyManager = require('../services/key-manager');

// ---------------------------------------------------------------------------
// Test key id prefix. Phase 3B keys also need 16 hex chars (VARCHAR(16) and
// key-manager boot validation). We generate a 7-char prefix + 9 random hex
// chars so cleanup targets this suite's rows only.
// ---------------------------------------------------------------------------
const TEST_PREFIX = 't3b' + crypto.randomBytes(2).toString('hex'); // 3 + 4 = 7 chars
function makeTestKeyId() {
  return (TEST_PREFIX + crypto.randomBytes(5).toString('hex')).slice(0, 16);
}

function makeTestPubPem() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' });
}

// ---------------------------------------------------------------------------
// withTransactionalActiveRow — same helper as rotation-schema.test.js. Kept
// inline rather than extracted to a shared helper module because the two
// suites should stay fully self-contained (simpler diffs, less coupling if
// we ever want to run one suite without the other).
// ---------------------------------------------------------------------------
async function withTransactionalActiveRow(fn) {
  const client = await db._db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "DELETE FROM key_rotation_log WHERE new_key_id = '0f65ad1b92590c92' AND reason = 'initial-key'"
    );
    await client.query("DELETE FROM ed25519_keys WHERE id = '0f65ad1b92590c92'");
    await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted is fine */ }
    client.release();
  }
}

// ---------------------------------------------------------------------------
// before(): wait for schema bootstrap.
// ---------------------------------------------------------------------------
before(async () => {
  await db._ready;
});

// ---------------------------------------------------------------------------
// Keep a reference to the original getActivePrimary so we can restore it
// after any scenario that stubs it. Capturing before() is belt-and-suspenders
// — node:test runs each `it` in the order they appear, so capturing here is
// safe and avoids an extra before() hook.
// ---------------------------------------------------------------------------
const origGetActivePrimary = keyManager.getActivePrimary;

after(async () => {
  // Restore any stubs we applied (hygiene — process.exit below makes this moot
  // but kept for parity with the other test files' after() blocks).
  try {
    keyManager.getActivePrimary = origGetActivePrimary;
  } catch (_) { /* swallow */ }

  // Targeted cleanup — only touch this suite's rows.
  try {
    await db.query(
      `DELETE FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' LIKE $1`,
      [TEST_PREFIX + '%']
    );
    // retire-pending writes 'key_rotation_cancelled' rather than state_change,
    // but this suite does NOT exercise that path. Left here commented so a
    // future scenario that does exercise it has a pattern to copy.
    // await db.query("DELETE FROM audit_log WHERE event = 'key_rotation_cancelled' ...");
    await db.query('DELETE FROM ed25519_keys WHERE id LIKE $1', [TEST_PREFIX + '%']);
  } catch (_) { /* ignore cleanup errors */ }

  process.exit(0);
});

// ---------------------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------------------
describe('Phase 3B — rotation operational infrastructure', () => {

  // Scenario 1 — Two-slot key-manager loading.
  //
  // The pure boot path reads env vars and populates _primary + _next. We
  // can't re-initialize the module in-process cleanly (multiple callers
  // hold references to the current singleton, and _initialized is sticky),
  // so this test exercises getLoadedSlots() against the state the suite's
  // parent process already booted with. The assertion is shape-only: the
  // returned object MUST have primary and next keys, both of which are
  // either null or a 16-hex-char string. Verifying that slots actually
  // load from env vars is covered by tests/verify-ed25519.test.js (which
  // boots server.js with a real PEM set) and by production smoke.
  it('1. getLoadedSlots() returns { primary, next } with hex-or-null values', () => {
    const slots = keyManager.getLoadedSlots();
    assert.ok(slots && typeof slots === 'object', 'getLoadedSlots must return an object');
    assert.ok('primary' in slots, 'slots must have a primary key');
    assert.ok('next' in slots, 'slots must have a next key');
    for (const [name, value] of Object.entries(slots)) {
      assert.ok(
        value === null || /^[a-f0-9]{16}$/.test(value),
        `${name} slot must be null or a 16-char lowercase hex string, got ${JSON.stringify(value)}`
      );
    }
  });

  // Scenario 2 — DOCUMENTATION ONLY.
  //
  // "Identical keyId in both slots → boot fails (process.exit(1))" is the
  // misconfiguration defense in key-manager.js::initialize(). It cannot be
  // tested from inside this process because calling process.exit from a
  // test kills the runner. Manually verified before release by setting
  // ED25519_PRIMARY_KEY_ID and ED25519_NEXT_KEY_ID to the same value in a
  // disposable sandbox and observing the boot failure.
  it('2. (manual only) identical keyId in both slots fails boot', () => {
    // This is a placeholder `it` so the scenario shows up in the test list
    // and the manual-verification requirement is documented in code. The
    // assertion is trivially true.
    assert.equal(typeof keyManager.initialize, 'function', 'initialize must be exported');
  });

  // Scenario 3 — getActivePrimary returns the _primary slot when DB's
  // state='active' row matches the primary slot's keyId.
  //
  // Uses the TEST-ONLY _setSlotsForTesting hook (exported from key-manager
  // for exactly this purpose, with a production gate) to inject real
  // Ed25519 slot shapes. Critically, BOTH slots are populated so the test
  // proves getActivePrimary matches against _primary via the DB's keyId,
  // not just "whichever slot is truthy".
  //
  // We stub db.query for the state='active' SELECT rather than inserting a
  // real DB row. Reason: withTransactionalActiveRow's BEGIN/ROLLBACK runs on
  // a dedicated client, but getActivePrimary calls require('../db').query
  // which uses a separate pool connection — it cannot see the in-flight
  // transaction's INSERT. A stub on db.query is the only way to make the
  // real slot-match code path see our test keyId end-to-end without
  // committing rows to production data. The stub is scoped to the SELECT
  // that getActivePrimary issues and passes all other queries through.
  it('3. getActivePrimary returns _primary slot when DB active matches primary keyId', async () => {
    const fakePrimaryKeyId = makeTestKeyId();
    const fakeNextKeyId    = makeTestKeyId();
    // Real Ed25519 keypairs so the slot shapes match production.
    const { privateKey: pkA } = crypto.generateKeyPairSync('ed25519');
    const { privateKey: pkB } = crypto.generateKeyPairSync('ed25519');

    keyManager._setSlotsForTesting({
      primary: { keyId: fakePrimaryKeyId, privateKey: pkA },
      next:    { keyId: fakeNextKeyId,    privateKey: pkB }
    });

    try {
      const origDbQuery = db.query;
      db.query = async (sql, params) => {
        if (typeof sql === 'string' && /FROM ed25519_keys WHERE state = 'active'/.test(sql)) {
          return { rows: [{ id: fakePrimaryKeyId }] };
        }
        return origDbQuery.call(db, sql, params);
      };
      try {
        keyManager.invalidateActivePrimaryCache();
        const result = await keyManager.getActivePrimary();
        assert.ok(result, 'getActivePrimary must return a slot when DB active matches a loaded slot');
        assert.equal(result.keyId, fakePrimaryKeyId, 'should match primary slot, not next');
        // Verify it's the PRIMARY slot object, not next's.
        assert.equal(result.privateKey, pkA, 'returned slot must be the primary slot object');
      } finally {
        db.query = origDbQuery;
      }
    } finally {
      keyManager._setSlotsForTesting({ primary: null, next: null });
      keyManager.invalidateActivePrimaryCache();
    }
  });

  // Scenario 4 — getActivePrimary returns null when DB active matches NO
  // loaded slot (rotation-in-progress state).
  //
  // This is the critical Phase 3B safety: if the DB's state='active' row
  // points to a keyId that's in NEITHER the primary nor the next loaded
  // slot, getActivePrimary must return null so Phase 2E at the pipeline
  // layer can convert that into ED25519_REQUIRED_NO_SIGNATURE. Without
  // this, a partially-promoted rotation (DB flipped, env vars not yet
  // updated) would silently fall through and sign with the wrong key.
  it('4. getActivePrimary returns null when DB active matches NO loaded slot (rotation-in-progress)', async () => {
    const loadedKeyId   = makeTestKeyId();
    const dbActiveKeyId = makeTestKeyId(); // intentionally unrelated — does not match loaded slot
    const { privateKey: pk } = crypto.generateKeyPairSync('ed25519');

    keyManager._setSlotsForTesting({
      primary: { keyId: loadedKeyId, privateKey: pk },
      next: null
    });
    keyManager.invalidateActivePrimaryCache();

    try {
      // Stub db.query so getActivePrimary sees an active keyId that is
      // not in either loaded slot. This is exactly the "rotation in
      // progress, env vars not yet promoted" state we want to exercise.
      const origDbQuery = db.query;
      db.query = async (sql, params) => {
        if (typeof sql === 'string' && /FROM ed25519_keys WHERE state = 'active'/.test(sql)) {
          return { rows: [{ id: dbActiveKeyId }] };
        }
        return origDbQuery.call(db, sql, params);
      };
      try {
        const result = await keyManager.getActivePrimary();
        assert.equal(result, null, 'should return null when no loaded slot matches DB active key');
      } finally {
        db.query = origDbQuery;
      }
    } finally {
      keyManager._setSlotsForTesting({ primary: null, next: null });
      keyManager.invalidateActivePrimaryCache();
    }
  });

  // Scenario 4b — FIX 4 (Avi) JWKS pending-key leak regression test.
  //
  // Prior to this fix, db.listActiveEd25519Keys's WHERE clause was:
  //   `valid_until IS NULL OR valid_until > NOW()`
  // which matched state='pending' rows (their valid_until is NULL). As a
  // result, /.well-known/vertifile-jwks.json would publish the public keys
  // of pending (not-yet-activated) keys — before the operator ever ran
  // `activate`. This is an information leak: external verifiers would see
  // keys that the server was not signing with.
  //
  // The fix adds `state IN ('active', 'grace')` to the WHERE clause. This
  // test proves that (a) pending keys are NOT returned, and (b) grace keys
  // ARE still returned (grace keys need to stay published so existing
  // documents signed under them continue to verify).
  it('4b. listActiveEd25519Keys excludes pending but includes grace (Avi FIX 4)', async () => {
    const pendingKeyId = makeTestKeyId();
    const graceKeyId   = makeTestKeyId();

    // Clean up any leftover pending row from sibling suites to avoid the
    // M6 partial unique conflict. Targeted by prefix so we never touch
    // production data.
    await db.query("DELETE FROM ed25519_keys WHERE state = 'pending' AND id LIKE 't3a%'");
    await db.query("DELETE FROM ed25519_keys WHERE state = 'pending' AND id LIKE $1", [TEST_PREFIX + '%']);

    // Insert a fresh pending row and a fresh grace row. Neither collides
    // with the genesis (which is state='active'), so no transaction
    // wrapper is needed.
    await db.query(
      `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
       VALUES ($1, $2, NOW(), FALSE, 'pending')`,
      [pendingKeyId, makeTestPubPem()]
    );
    await db.query(
      `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
       VALUES ($1, $2, NOW(), FALSE, 'grace')`,
      [graceKeyId, makeTestPubPem()]
    );

    try {
      const rows = await db.listActiveEd25519Keys();
      const ids = rows.map(r => r.id);
      assert.ok(!ids.includes(pendingKeyId),
        `listActiveEd25519Keys must NOT include pending keys, got ids: ${JSON.stringify(ids)}`);
      assert.ok(ids.includes(graceKeyId),
        `listActiveEd25519Keys must include grace keys, got ids: ${JSON.stringify(ids)}`);
    } finally {
      // Cleanup our two rows explicitly so after() has nothing to do here.
      await db.query('DELETE FROM ed25519_keys WHERE id = $1', [pendingKeyId]);
      await db.query('DELETE FROM ed25519_keys WHERE id = $1', [graceKeyId]);
    }
  });

  // Scenario 5 — setEd25519KeyState throws Ed25519ForbiddenTransitionError
  // on grace -> active (THE ROLLBACK).
  //
  // This is the security invariant Zur locked in. The Phase 3A trigger
  // enforces it at the DB layer; setEd25519KeyState wraps the generic
  // SQL error in a typed error so the rotation command can emit a precise
  // message. We insert a fresh grace test key (no state='active' conflict,
  // no transaction needed), then call setEd25519KeyState inside a tiny
  // transaction and assert the error shape.
  it('5. setEd25519KeyState throws Ed25519ForbiddenTransitionError on grace -> active', async () => {
    const keyId = makeTestKeyId();
    // Insert a grace row directly — no active-state conflict, no M5 issue.
    await db.query(
      `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
       VALUES ($1, $2, NOW(), FALSE, 'grace')`,
      [keyId, makeTestPubPem()]
    );

    let caught = null;
    const client = await db._db.connect();
    try {
      await client.query('BEGIN');
      try {
        await db.setEd25519KeyState(client, keyId, 'active', { reason: 'test-grace-to-active' });
      } catch (e) {
        caught = e;
      }
    } finally {
      try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
      client.release();
    }

    assert.ok(caught, 'setEd25519KeyState must throw on grace -> active');
    assert.equal(
      caught.name,
      'Ed25519ForbiddenTransitionError',
      `expected Ed25519ForbiddenTransitionError, got ${caught.name}`
    );
    assert.equal(caught.fromState, 'grace', 'fromState must be "grace"');
    assert.equal(caught.toState, 'active', 'toState must be "active"');
    assert.equal(caught.keyId, keyId, 'keyId must be attached to the error');
    assert.match(caught.message, /forbidden state transition/i, 'message must surface the trigger reason');
    assert.match(caught.message, /grace -> active/, 'message must name the specific transition');
    // And the typed instanceof check, which is what the rotation command
    // uses to distinguish forbidden-transition from other DB errors.
    assert.ok(
      caught instanceof db.Ed25519ForbiddenTransitionError,
      'error must be an instance of Ed25519ForbiddenTransitionError'
    );
  });

  // Scenario 6 — setEd25519KeyState throws Ed25519KeyNotFoundError on missing key.
  //
  // Calling setEd25519KeyState with a keyId that does not exist in
  // ed25519_keys must throw Ed25519KeyNotFoundError, not a generic Error
  // or "no rows affected" silent success. This preserves the contract
  // that db.getEd25519KeyState already follows.
  it('6. setEd25519KeyState throws Ed25519KeyNotFoundError on missing key', async () => {
    const missingKeyId = makeTestKeyId(); // never inserted
    let caught = null;
    const client = await db._db.connect();
    try {
      await client.query('BEGIN');
      try {
        await db.setEd25519KeyState(client, missingKeyId, 'grace', { reason: 'test-missing-key' });
      } catch (e) {
        caught = e;
      }
    } finally {
      try { await client.query('ROLLBACK'); } catch (_) { /* ok */ }
      client.release();
    }

    assert.ok(caught, 'setEd25519KeyState must throw on missing key');
    assert.equal(
      caught.name,
      'Ed25519KeyNotFoundError',
      `expected Ed25519KeyNotFoundError, got ${caught.name}`
    );
    assert.equal(caught.keyId, missingKeyId, 'keyId must be attached to the error');
    assert.ok(
      caught instanceof db.Ed25519KeyNotFoundError,
      'error must be an instance of Ed25519KeyNotFoundError'
    );
  });

  // Scenario 7 — M5 partial unique index on state='active'.
  //
  // Inside a transaction that removes the genesis row, insert an active
  // row, then attempt a SECOND active insert. The second INSERT must fail
  // with a UNIQUE-violation error referencing idx_ed25519_keys_one_active.
  // Without the index, both inserts would succeed and getActivePrimary
  // would be ambiguous.
  it('7. M5 partial unique on state=active — second active insert fails', async () => {
    const keyIdA = makeTestKeyId();
    const keyIdB = makeTestKeyId();
    await withTransactionalActiveRow(async (client) => {
      // First active insert — should succeed (genesis is gone, no other
      // active row exists).
      await client.query(
        `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
         VALUES ($1, $2, NOW(), FALSE, 'active')`,
        [keyIdA, makeTestPubPem()]
      );
      // Second active insert — must collide with idx_ed25519_keys_one_active.
      let caught = null;
      try {
        await client.query(
          `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
           VALUES ($1, $2, NOW(), FALSE, 'active')`,
          [keyIdB, makeTestPubPem()]
        );
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, 'second active insert must throw');
      // Postgres UNIQUE violations surface the index name in the message.
      assert.match(
        caught.message,
        /idx_ed25519_keys_one_active|duplicate key/i,
        `expected UNIQUE violation on idx_ed25519_keys_one_active, got: ${caught.message}`
      );
    });
  });

  // Scenario 8 — M6 partial unique index on state='pending'.
  //
  // Insert a pending row, then attempt a second pending row — must collide
  // with idx_ed25519_keys_one_pending. This does NOT require the
  // withTransactionalActiveRow wrapper because 'pending' rows are not
  // constrained by the genesis row; we just need to make sure no OTHER
  // pending row exists at the start of the test.
  //
  // Subtle: tests/rotation-schema.test.js Scenario 9a's loop inserts
  // exactly ONE pending row (pending->grace iteration). That row stays
  // pending after the UPDATE fails and is cleaned up in that suite's
  // after() hook. If rotation-schema.test.js runs BEFORE this suite in
  // the test chain, its pending row may still exist when we arrive here.
  // To guarantee a clean slate, we delete any existing pending row that
  // matches the rotation-schema prefix pattern ('t3a...') before running
  // — belt-and-suspenders. If a non-test row is pending, this is a real
  // issue that should block the test (surfaced as a bare error).
  it('8. M6 partial unique on state=pending — second pending insert fails', async () => {
    // Clean up any leftover pending rows from the sibling suite. Targeted
    // by prefix so we never touch production data.
    await db.query("DELETE FROM ed25519_keys WHERE state = 'pending' AND id LIKE 't3a%'");

    const keyIdA = makeTestKeyId();
    const keyIdB = makeTestKeyId();

    // First pending insert — should succeed.
    await db.query(
      `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
       VALUES ($1, $2, NOW(), FALSE, 'pending')`,
      [keyIdA, makeTestPubPem()]
    );

    // Second pending insert — must collide.
    let caught = null;
    try {
      await db.query(
        `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
         VALUES ($1, $2, NOW(), FALSE, 'pending')`,
        [keyIdB, makeTestPubPem()]
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'second pending insert must throw');
    assert.match(
      caught.message,
      /idx_ed25519_keys_one_pending|duplicate key/i,
      `expected UNIQUE violation on idx_ed25519_keys_one_pending, got: ${caught.message}`
    );

    // Cleanup our first pending row so after() doesn't have to.
    await db.query('DELETE FROM ed25519_keys WHERE id = $1', [keyIdA]);
  });

  // Scenario 9 — setEd25519KeyState input validation.
  //
  // The public contract rejects non-string keyIds, invalid states, and
  // non-string reasons. These are local checks that run before any SQL,
  // so they work without a transaction or an existing row.
  it('9. setEd25519KeyState input validation', async () => {
    const client = await db._db.connect();
    try {
      await client.query('BEGIN');
      // Non-string keyId.
      await assert.rejects(
        () => db.setEd25519KeyState(client, 123, 'grace'),
        /keyId must be a non-empty string/
      );
      // Empty string keyId.
      await assert.rejects(
        () => db.setEd25519KeyState(client, '', 'grace'),
        /keyId must be a non-empty string/
      );
      // Invalid newState.
      await assert.rejects(
        () => db.setEd25519KeyState(client, 'any16charstring0', 'bogus'),
        /invalid newState/
      );
      // Non-string reason (when provided).
      await assert.rejects(
        () => db.setEd25519KeyState(client, 'any16charstring0', 'grace', { reason: 42 }),
        /reason must be a string/
      );
    } finally {
      try { await client.query('ROLLBACK'); } catch (_) { /* ok */ }
      client.release();
    }
  });
});
