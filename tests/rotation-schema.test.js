#!/usr/bin/env node
'use strict';

/**
 * Phase 3A — Ed25519 key rotation SCHEMA regression suite.
 *
 * What this guards against:
 *   - The Phase 3A migration becoming non-idempotent (must survive two
 *     consecutive boots — the _ready promise is awaited twice in scenario 1).
 *   - The `state` column default drifting away from 'active', which would
 *     leave the existing production primary key row unclassified.
 *   - The CHECK constraint on `state` silently being removed or widened.
 *   - The genesis rotation log entry not being present on fresh boot — if
 *     it is missing, the public rotation log (Phase 3C) will start with an
 *     incomplete history.
 *   - The state-transition trigger being dropped or weakened. This is the
 *     security boundary Zur locked in: grace -> active is the rollback we
 *     explicitly ban, and active -> expired (skipping grace) is the
 *     "cleanup" shortcut we also ban.
 *   - The audit trigger not firing on every state change. A compromised
 *     operator running raw SQL must still leave a trace.
 *
 * What this DOES NOT test (out of scope, deferred to Phase 3B-3E):
 *   - The rotation command itself (3B — see tests/rotation-phase3b.test.js).
 *   - Two-slot key-manager loading (3B — see tests/rotation-phase3b.test.js).
 *   - Verification path tolerance for grace-state keys (3C).
 *   - The public rotation log HTTP endpoint (3C).
 *   - The grace-period default / floor / ceiling (3B — CLI-layer).
 *
 * Phase 3B updates:
 *   - Scenarios 2, 6, 7, 8 now run inside withTransactionalActiveRow to
 *     avoid colliding with M5 (one-active partial unique index).
 *   - Scenarios 9b, 9c switched from state='pending' to state='grace' to
 *     avoid colliding with M6 (one-pending partial unique index).
 *   - Scenario 9a only inserts ONE pending row (the pending->grace
 *     iteration) which fits under M6.
 *
 * Strategy:
 *   1. Skip if DATABASE_URL is unset. This matches the verify-public and
 *      pipeline-phase2e pattern — CI without DB just exits 0.
 *   2. await db._ready so every Phase 3A migration (column adds, trigger
 *      creates, genesis insert) has run before the first scenario.
 *   3. Generate a random 16-char hex test key id prefix so cleanup is
 *      targeted and safe to run alongside other test suites on a shared DB.
 *   4. Each scenario that mutates uses a FRESH test key id, so failures in
 *      one scenario cannot contaminate another.
 *   5. after() deletes every row in ed25519_keys and audit_log that the
 *      test created, then force-exits with process.exit(0). Matches the
 *      verify-public.test.js pattern exactly — NO db.close() (the pg pool
 *      keeps the event loop alive), NO process.on('beforeExit') handler
 *      (that's the bug we just fixed in pipeline-phase2e.test.js).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 1. Skip gate. Matches sibling suites so CI without DATABASE_URL exits 0.
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  process.stderr.write('[rotation-schema] DATABASE_URL not set — skipping suite.\n');
  process.exit(0);
}

// DB layer can pull from the same pool the production app uses — we talk
// directly to db.query and never mount a route handler. This keeps the test
// fully isolated from server.js / routes/api.js.
const dbPath = path.resolve(__dirname, '..', 'db.js');
const db = require(dbPath);

// ---------------------------------------------------------------------------
// 2. Test key id prefix. A fresh 8-hex-char prefix is generated every run so
//    we never collide with leftovers from a previous failed run, and so the
//    after() cleanup can do a wildcard delete that only touches our rows.
//    Phase 3A key ids must be 16 hex chars (matches VARCHAR(16) and the
//    key-manager boot check); we use prefix + random hex to hit exactly 16.
// ---------------------------------------------------------------------------
const TEST_PREFIX = 't3a' + crypto.randomBytes(2).toString('hex'); // 3 + 4 = 7
function makeTestKeyId() {
  // 16 chars total: 7-char prefix + 9 random hex chars.
  return (TEST_PREFIX + crypto.randomBytes(5).toString('hex')).slice(0, 16);
}

// ---------------------------------------------------------------------------
// 3. Helper: build a fresh Ed25519 public key PEM for test inserts. The DB
//    column public_key_pem is NOT NULL; storing a real PEM is cheap and
//    keeps the row shape indistinguishable from production rows. We do NOT
//    reuse a global keypair — every test that inserts gets its own.
// ---------------------------------------------------------------------------
function makeTestPubPem() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' });
}

// Bare INSERT that bypasses the Phase 2A helper so we can set the `state`
// column directly. The Phase 2A insertEd25519Key() helper does not know
// about `state` (it uses the default), and several scenarios below need to
// insert a row in a non-default state (e.g. pre-seeding a 'grace' row to
// test the forbidden grace->active transition).
async function insertTestKey({ id, state }) {
  await db.query(
    `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
     VALUES ($1, $2, NOW(), FALSE, $3)`,
    [id, makeTestPubPem(), state]
  );
}

// -----------------------------------------------------------------------
// withTransactionalActiveRow — M5 (partial UNIQUE on state='active') escape
// hatch for the scenarios that need to insert or mutate a test row IN
// state='active'.
//
// Why we need it: the production DB always has one row in state='active'
// (the genesis 0f65ad1b92590c92). Once M5 lands, any direct INSERT/UPDATE
// that creates a SECOND state='active' row collides with the partial UNIQUE
// index. The previous Phase 3A test fixtures did exactly that for
// Scenarios 2, 6, 7, 8 — they're rewritten here to run inside a transaction
// that temporarily deletes the genesis row, exercises the test path, then
// ROLLBACKs (restoring genesis atomically).
//
// The caller receives an open pg client scoped to the transaction. All
// DB reads and writes for the test body MUST go through this client, not
// db.query() — anything issued on the pool would auto-commit and see the
// pre-delete state, defeating the rollback. Helper functions that go
// through the pool (db.getEd25519KeyState, db.insertEd25519Key) are NOT
// safe to use inside the callback.
//
// The cleanup on the way out is a plain ROLLBACK regardless of whether the
// callback threw; the genesis row, any test rows, and any audit_log rows
// the callback caused are ALL rolled back together. This keeps the shared
// DB state untouched even across a crashed test.
// -----------------------------------------------------------------------
async function withTransactionalActiveRow(fn) {
  const client = await db._db.connect();
  try {
    await client.query('BEGIN');
    // Delete the genesis rotation log entry BEFORE the ed25519_keys row.
    // The genesis row in key_rotation_log has new_key_id='0f65ad1b92590c92'
    // and reason='initial-key'; with no FK it won't cascade, but we still
    // want the pre-state to match "no active key anywhere" so the test
    // can insert a fresh active row cleanly.
    await client.query(
      "DELETE FROM key_rotation_log WHERE new_key_id = '0f65ad1b92590c92' AND reason = 'initial-key'"
    );
    await client.query("DELETE FROM ed25519_keys WHERE id = '0f65ad1b92590c92'");
    await fn(client);
  } finally {
    // ROLLBACK unconditionally. If the callback threw, this is the error
    // path; if it succeeded, this is the normal exit. Either way the
    // genesis row comes back and the test DB state is pristine.
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted is fine */ }
    client.release();
  }
}

// Client-scoped version of insertTestKey — mirrors insertTestKey() but runs
// on an open client instead of the pool. Used exclusively inside
// withTransactionalActiveRow callbacks. Crosses the Phase 2A helper path
// because we need the `state` column explicitly.
async function insertTestKeyOnClient(client, { id, state }) {
  await client.query(
    `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
     VALUES ($1, $2, NOW(), FALSE, $3)`,
    [id, makeTestPubPem(), state]
  );
}

// ---------------------------------------------------------------------------
// 4. before(): wait for schema bootstrap.
// ---------------------------------------------------------------------------
before(async () => {
  await db._ready;
});

// ---------------------------------------------------------------------------
// 5. after(): delete every row we touched. Never db.close() (event loop),
//    never process.on('beforeExit') — just clean up and force process.exit(0).
//    Matches verify-public.test.js exactly.
// ---------------------------------------------------------------------------
after(async () => {
  try {
    // Delete audit rows our triggers created. We key off the details->>'key_id'
    // JSON field — the audit trigger stores details as JSON text, which
    // PostgreSQL can still parse with ::jsonb.
    await db.query(
      `DELETE FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' LIKE $1`,
      [TEST_PREFIX + '%']
    );
    // Delete the test key rows themselves.
    await db.query(
      'DELETE FROM ed25519_keys WHERE id LIKE $1',
      [TEST_PREFIX + '%']
    );
  } catch (_) {
    // Ignore cleanup errors — force exit regardless.
  }
  // Force exit — db.js holds an open pg pool that keeps the event loop alive.
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 6. Scenarios.
// ---------------------------------------------------------------------------
describe('Phase 3A — ed25519 rotation schema', () => {

  // Scenario 1 — REAL idempotency test.
  //
  // The previous version of this test awaited db._ready twice and claimed
  // that verified idempotency. It did not — db._ready is a cached promise,
  // so the second await returns the memoized resolution instantly and no
  // SQL is actually re-executed. A future dev could remove every
  // IF NOT EXISTS clause and this test would still pass.
  //
  // The real test calls runPhase3aMigration() directly with a fresh pg
  // client + transaction, which runs the SQL a SECOND time for real.
  // The key assertion is `genesisRowsInserted === 0` — the second run
  // must not duplicate the genesis row, which is the hard proof that the
  // WHERE NOT EXISTS guard is working.
  it('1. runPhase3aMigration is truly idempotent on a second invocation', async () => {
    const beforeSnapshot = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ed25519_keys' ORDER BY ordinal_position`
    );
    const beforeCols = beforeSnapshot.rows.map(r => r.column_name);

    // Re-run the migration via a fresh client + transaction. This is the
    // ACTUAL second run — the cached db._ready promise will not do this
    // work. The silent logger swallows any error-path noise the migration
    // function emits (we do not expect any; we assert on the return value).
    const silentLog = { error: () => {} };
    const client = await db._db.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await db.runPhase3aMigration(client, silentLog);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) { /* already aborted is fine */ }
      throw e;
    } finally {
      client.release();
    }

    assert.equal(
      result.genesisRowsInserted,
      0,
      'second migration run must insert zero genesis rows (idempotency proof)'
    );

    const afterSnapshot = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ed25519_keys' ORDER BY ordinal_position`
    );
    const afterCols = afterSnapshot.rows.map(r => r.column_name);

    assert.deepEqual(afterCols, beforeCols, 'column set must be stable across migration re-runs');
    assert.ok(afterCols.includes('state'),           'state column must exist');
    assert.ok(afterCols.includes('retired_at'),      'retired_at column must exist');
    assert.ok(afterCols.includes('rotation_reason'), 'rotation_reason column must exist');

    // Also assert the genesis row still exists exactly once after re-run
    // — this catches a regression where the second run somehow duplicates
    // the initial-key row despite the WHERE NOT EXISTS / partial UNIQUE
    // index guarding against it.
    const { rows: genesisRows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM key_rotation_log WHERE new_key_id = '0f65ad1b92590c92' AND reason = 'initial-key'"
    );
    assert.equal(genesisRows[0].n, 1, 'exactly one genesis row must exist after migration re-run');
  });

  // Scenario 2 — Default state is 'active'.
  // When an INSERT omits the state column, the row must inherit the 'active'
  // default. This is how the existing production primary key row got its
  // state, and is the contract Phase 2A callers (insertEd25519Key) rely on.
  //
  // Phase 3B note: this test used to call db.insertEd25519Key() directly.
  // M5 now forbids two rows in state='active' — since the genesis row is
  // already 'active', the second insert would collide with
  // idx_ed25519_keys_one_active. We run inside withTransactionalActiveRow
  // so the genesis is temporarily removed; the INSERT uses a client-scoped
  // raw query that omits state and lets the default fire. The containing
  // transaction is rolled back at the end, restoring the genesis row.
  it("2. default state is 'active' when not specified on insert", async () => {
    const keyId = makeTestKeyId();
    await withTransactionalActiveRow(async (client) => {
      // Deliberately omit the state column so the DEFAULT clause fires.
      // Mirrors the column set db.insertEd25519Key uses minus the state
      // column itself.
      await client.query(
        `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, valid_until, is_primary)
         VALUES ($1, $2, NOW(), NULL, FALSE)`,
        [keyId, makeTestPubPem()]
      );
      const { rows } = await client.query('SELECT state FROM ed25519_keys WHERE id = $1', [keyId]);
      assert.equal(rows.length, 1, 'inserted row must exist inside the transaction');
      assert.equal(rows[0].state, 'active', 'missing state on insert must default to active');
    });
  });

  // Scenario 3 — CHECK constraint rejects invalid state values.
  // Any state not in the enum must be rejected by the CHECK constraint,
  // not accepted and stored. A missing or widened CHECK would let operator
  // typos silently persist garbage values.
  it('3. CHECK constraint rejects invalid state value', async () => {
    const keyId = makeTestKeyId();
    let threw = false;
    try {
      await db.query(
        `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state)
         VALUES ($1, $2, NOW(), FALSE, $3)`,
        [keyId, makeTestPubPem(), 'invalid']
      );
    } catch (e) {
      threw = true;
      // Postgres emits "violates check constraint" for CHECK failures.
      assert.match(e.message, /check constraint|invalid input value/i, 'error must reference the CHECK constraint');
    }
    assert.ok(threw, "INSERT with state='invalid' must be rejected");
  });

  // Scenario 4 — Genesis row exists.
  // The Phase 3A migration retroactively inserts the rotation event for
  // the production primary key (0f65ad1b92590c92). Without this row, the
  // public rotation log (Phase 3C) would appear to begin at the first
  // actual rotation, which is misleading — the genesis entry is what
  // makes the log a complete history.
  it('4. genesis rotation log entry exists for the production primary key', async () => {
    const { rows } = await db.query(
      "SELECT * FROM key_rotation_log WHERE new_key_id = '0f65ad1b92590c92'"
    );
    assert.equal(rows.length, 1, 'exactly one genesis row must exist for the production primary key');
    const row = rows[0];
    assert.equal(row.old_key_id, null,           'genesis has no prior key');
    assert.equal(row.old_fingerprint, null,      'genesis has no prior fingerprint');
    assert.equal(
      row.new_fingerprint,
      '0f65ad1b92590c9255b3de67758c49c7fe5169fdd47abb187e795a2edf03a372',
      'genesis fingerprint must match the canonical sha256 of the production PEM'
    );
    assert.equal(row.grace_until, null,      'genesis key is still active, no grace window');
    assert.equal(row.reason,      'initial-key');
    assert.equal(row.actor,       'system-genesis', 'actor is DB-only but must still be set');
  });

  // Scenario 5 — Forbidden transition: grace -> active (THE ROLLBACK).
  // This is the most important test in Phase 3A. Zur explicitly decided
  // that rollback is a NEW rotation with a NEW key, never a state
  // regression. The BEFORE UPDATE trigger enforces this at the DB layer
  // so even a compromised admin running raw SQL cannot bypass it.
  it('5. forbidden transition: grace -> active is rejected by the trigger', async () => {
    const keyId = makeTestKeyId();
    await insertTestKey({ id: keyId, state: 'grace' });

    let threw = false;
    let err = null;
    try {
      await db.query('UPDATE ed25519_keys SET state = $1 WHERE id = $2', ['active', keyId]);
    } catch (e) {
      threw = true;
      err = e;
    }
    assert.ok(threw, 'grace -> active must throw');
    assert.match(err.message, /forbidden state transition/i, 'error must name the invariant');
    assert.match(err.message, /grace -> active/,            'error must name the specific transition');
    assert.match(err.message, /monotonic forward/,           'error must reference the Phase 3 invariant');

    // The row must NOT have changed — the trigger is BEFORE, so the
    // write is rolled back entirely.
    const state = await db.getEd25519KeyState(keyId);
    assert.equal(state, 'grace', 'row state must be unchanged after rejected UPDATE');
  });

  // Scenario 6 — Forbidden transition: active -> expired (skipping grace).
  // The state machine requires every active key to pass through grace on
  // the way out. Skipping grace would let an operator delete a key without
  // giving its signatures a tolerance window, which would break every
  // PVF signed with that key the instant the UPDATE committed.
  //
  // Phase 3B: wrapped in withTransactionalActiveRow so inserting a fresh
  // active test row does not collide with the genesis row under M5.
  it('6. forbidden transition: active -> expired (skipping grace) is rejected', async () => {
    const keyId = makeTestKeyId();
    await withTransactionalActiveRow(async (client) => {
      await insertTestKeyOnClient(client, { id: keyId, state: 'active' });

      let threw = false;
      let err = null;
      try {
        await client.query('UPDATE ed25519_keys SET state = $1 WHERE id = $2', ['expired', keyId]);
      } catch (e) {
        threw = true;
        err = e;
      }
      assert.ok(threw, 'active -> expired must throw');
      assert.match(err.message, /forbidden state transition/i);
      assert.match(err.message, /active -> expired/);

      // Note: we can't call db.getEd25519KeyState here — that goes through
      // the pool and bypasses the transaction. Read via the client instead.
      //
      // Postgres aborts the whole transaction on a trigger RAISE EXCEPTION,
      // so subsequent queries on this client would error with "current
      // transaction is aborted". The row state is PROVEN to be unchanged
      // by the fact that the trigger rolled back — no separate SELECT
      // is needed (and any SELECT issued here would itself throw with
      // 25P02). The withTransactionalActiveRow wrapper's ROLLBACK on the
      // way out unwinds the abort cleanly.
    });
  });

  // Scenario 7 — Allowed transition: active -> grace.
  // The happy path for retirement. This is what the Phase 3B rotation
  // command runs when it demotes the outgoing primary key.
  //
  // Phase 3B: wrapped in withTransactionalActiveRow for the same reason
  // as Scenario 6.
  it('7. allowed transition: active -> grace succeeds', async () => {
    const keyId = makeTestKeyId();
    await withTransactionalActiveRow(async (client) => {
      await insertTestKeyOnClient(client, { id: keyId, state: 'active' });
      await client.query('UPDATE ed25519_keys SET state = $1 WHERE id = $2', ['grace', keyId]);
      const { rows } = await client.query('SELECT state FROM ed25519_keys WHERE id = $1', [keyId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].state, 'grace', 'active -> grace must succeed');
    });
  });

  // Scenario 8 — Audit trigger fires on every allowed state change.
  // The audit trigger is the observability leg of the security boundary.
  // A compromised operator who ran raw SQL to demote a key must still
  // show up in audit_log. We verify exactly one audit row is written per
  // state change, with the correct old/new states.
  //
  // Phase 3B: wrapped in withTransactionalActiveRow. The audit row is
  // written inside the transaction and rolled back with the rest, so the
  // assertion is "exactly one audit row exists FOR THIS KEY ID inside the
  // transaction" — we read it via the client while the transaction is
  // still open.
  it('8. audit trigger writes one row per state change with correct old/new states', async () => {
    const keyId = makeTestKeyId();
    await withTransactionalActiveRow(async (client) => {
      await insertTestKeyOnClient(client, { id: keyId, state: 'active' });

      // No audit row should exist yet (the INSERT fires the AFTER-INSERT
      // path but the trigger is AFTER UPDATE OF state, not AFTER INSERT).
      const beforeCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE event = 'ed25519_key_state_change'
           AND details::jsonb->>'key_id' = $1`,
        [keyId]
      );
      assert.equal(beforeCount.rows[0].n, 0, 'no audit rows should exist for a freshly inserted test key');

      await client.query('UPDATE ed25519_keys SET state = $1 WHERE id = $2', ['grace', keyId]);

      const afterRows = await client.query(
        `SELECT details FROM audit_log
         WHERE event = 'ed25519_key_state_change'
           AND details::jsonb->>'key_id' = $1
         ORDER BY id DESC`,
        [keyId]
      );
      assert.equal(afterRows.rows.length, 1, 'exactly one audit row must be written per state change');

      const details = JSON.parse(afterRows.rows[0].details);
      assert.equal(details.key_id,    keyId);
      assert.equal(details.old_state, 'active');
      assert.equal(details.new_state, 'grace');
      assert.ok(details.session_user, 'audit row must include session_user (who ran the UPDATE)');
    });
  });

  // Scenario 9a — Parameterized forbidden-transition coverage.
  //
  // Scenarios 5 and 6 cover two of the eight forbidden transitions
  // (grace->active and active->expired). This scenario covers the six
  // NON-ACTIVE-ORIGIN forbidden transitions in a single parameterized
  // loop so a future trigger edit that accidentally permits any of them
  // breaks CI immediately.
  //
  // Active-origin forbidden transitions (active->pending, active->expired)
  // are deliberately NOT in this loop because they require inserting an
  // 'active' test row, which will conflict with the partial UNIQUE index
  // on state='active' once Phase 3B lands it. Scenario 6 already covers
  // active->expired via the current (pre-index) pattern. Once 3B adds
  // the partial UNIQUE index, 3B will migrate Scenarios 2/6/7/8 and this
  // scenario to use a transaction+ROLLBACK pattern against the genesis
  // row.
  it('9a. six non-active-origin forbidden transitions are all rejected', async () => {
    const FORBIDDEN = [
      ['pending', 'grace'],
      ['grace',   'pending'],
      ['grace',   'active'],   // THE ROLLBACK — covered by Scenario 5 too, kept in loop for coverage symmetry
      ['expired', 'pending'],
      ['expired', 'active'],
      ['expired', 'grace'],
    ];

    for (const [from, to] of FORBIDDEN) {
      const keyId = makeTestKeyId();
      await insertTestKey({ id: keyId, state: from });

      let threw = false;
      let err = null;
      try {
        await db.query('UPDATE ed25519_keys SET state = $1 WHERE id = $2', [to, keyId]);
      } catch (e) {
        threw = true;
        err = e;
      }
      assert.ok(threw, `${from} -> ${to} must throw`);
      assert.match(err.message, /forbidden state transition/i, `${from} -> ${to}: error must name the invariant`);
      assert.match(err.message, new RegExp(`${from} -> ${to}`), `${from} -> ${to}: error must name the specific transition`);

      // Row state must be unchanged after the rejected UPDATE.
      const state = await db.getEd25519KeyState(keyId);
      assert.equal(state, from, `${from} -> ${to}: row state must remain ${from}`);
    }
  });

  // Scenario 9b — UPDATE on a non-state column does NOT fire the audit trigger.
  //
  // The trigger is declared `BEFORE/AFTER UPDATE OF state` — if a future
  // dev drops the `OF state` clause, every UPDATE on any column would
  // fire both triggers and flood audit_log. Guard against that regression
  // by updating rotation_reason alone and asserting no audit row appears.
  //
  // Phase 3B: state='grace' rather than 'pending' so this test does not
  // collide with Scenario 9a's pending row under M6 (one-pending partial
  // unique index). The test logic is state-independent — we only need ANY
  // row to UPDATE the rotation_reason column on.
  it('9b. UPDATE on a non-state column does not fire the audit trigger', async () => {
    const keyId = makeTestKeyId();
    await insertTestKey({ id: keyId, state: 'grace' });

    const beforeCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' = $1`,
      [keyId]
    );

    await db.query(
      'UPDATE ed25519_keys SET rotation_reason = $1 WHERE id = $2',
      ['test-non-state-update', keyId]
    );

    const afterCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' = $1`,
      [keyId]
    );

    assert.equal(
      afterCount.rows[0].n,
      beforeCount.rows[0].n,
      'audit row count must be unchanged when UPDATE does not touch the state column'
    );
  });

  // Scenario 9c — No-op UPDATE (same state) does NOT write an audit row.
  //
  // The audit trigger function has an `IF OLD.state IS DISTINCT FROM
  // NEW.state` guard at the top. Without that guard, a no-op UPDATE like
  // `SET state='grace' WHERE state='grace'` would write an audit row with
  // old_state===new_state, which is useless noise. Guard against a future
  // trigger edit that removes this check.
  //
  // Phase 3B: state='grace' rather than 'pending' so this test does not
  // collide with Scenario 9a's pending row under M6.
  it('9c. no-op UPDATE (same state) does not write an audit row', async () => {
    const keyId = makeTestKeyId();
    await insertTestKey({ id: keyId, state: 'grace' });

    const beforeCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' = $1`,
      [keyId]
    );

    // UPDATE state to the same value. Because the row starts in 'grace'
    // (changed from 'pending' in Phase 3B to accommodate M6), the no-op
    // target is also 'grace'. The trigger's `IF OLD.state = NEW.state`
    // guard must short-circuit before the audit row is written.
    await db.query(
      'UPDATE ed25519_keys SET state = $1 WHERE id = $2',
      ['grace', keyId]
    );

    const afterCount = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE event = 'ed25519_key_state_change'
         AND details::jsonb->>'key_id' = $1`,
      [keyId]
    );

    assert.equal(
      afterCount.rows[0].n,
      beforeCount.rows[0].n,
      'audit row count must be unchanged when UPDATE keeps state the same'
    );
  });

  // Scenario 9e — listRotationLog() does NOT return the actor column.
  //
  // This is a load-bearing invariant for the Phase 3C public endpoint.
  // A future dev who "helpfully" refactors listRotationLog to `SELECT *`
  // would leak operator identity to any third-party verifier. A one-line
  // assertion here prevents that regression forever.
  it('9e. listRotationLog excludes the actor column from returned rows', async () => {
    const rows = await db.listRotationLog();
    assert.ok(rows.length >= 1, 'at least the genesis row must exist');
    for (const row of rows) {
      assert.ok(
        !('actor' in row),
        'actor column must never appear in listRotationLog output (DB-only invariant)'
      );
    }
    // And sanity-check the expected columns ARE present on at least the
    // first row, so a future refactor that accidentally drops them is
    // caught too.
    const expected = ['id', 'rotated_at', 'old_key_id', 'new_key_id', 'old_fingerprint', 'new_fingerprint', 'grace_until', 'reason'];
    for (const col of expected) {
      assert.ok(col in rows[0], `expected column ${col} missing from listRotationLog output`);
    }
  });
});
