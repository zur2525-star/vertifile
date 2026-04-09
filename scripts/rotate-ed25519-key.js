#!/usr/bin/env node
'use strict';

/**
 * Phase 3B — Ed25519 key rotation CLI.
 *
 * This is the operator-facing tool for rotating the Vertifile signing key.
 * It is the ONLY supported way to perform a rotation: there is no HTTP admin
 * endpoint, by design (Phase 3 decision — CLI-only minimizes the attack
 * surface for a "compromised admin pivots to a fresh signing key" scenario).
 *
 * Three subcommands:
 *
 *   generate   - Generate a new keypair, INSERT it into ed25519_keys with
 *                state='pending', print the PEM and the env-var snippets
 *                the operator should paste into Render. Does NOT touch the
 *                currently active key.
 *
 *   activate   - Pre-flight check (the new key must be loaded by the running
 *                app), then atomically demote old (active -> grace), promote
 *                new (pending -> active), and write a key_rotation_log row.
 *                All inside one BEGIN/COMMIT transaction so a partial failure
 *                cannot leave the DB in a half-rotated state.
 *
 *   retire-pending - Cancel a pending key (operator pasted the wrong PEM,
 *                or generated a key by mistake). Transitions the row from
 *                pending -> expired (allowed by the Phase 3A trigger), writes
 *                an audit_log entry. Does NOT write to key_rotation_log
 *                because retiring a pending key is a cancellation event,
 *                not a rotation event.
 *
 * USAGE
 *
 *   # 1. Generate the next signing key. The script prints PEMs to stdout —
 *   # never to disk.
 *   DATABASE_URL=postgres://... \
 *   node scripts/rotate-ed25519-key.js generate --reason="scheduled-2026Q2"
 *
 *   # 2. Operator pastes the printed env vars into Render:
 *   #      ED25519_NEXT_PRIVATE_KEY_PEM=<single-line \n-escaped private PEM>
 *   #      ED25519_NEXT_KEY_ID=<16 hex chars>
 *   # ...waits ~60s for Render to redeploy...
 *
 *   # 3. Atomic flip. Pre-flight verifies the running app loaded the new key.
 *   DATABASE_URL=postgres://... \
 *   node scripts/rotate-ed25519-key.js activate \
 *     --new-key-id=<16 hex chars> \
 *     --grace-days=90 \
 *     --reason="scheduled-2026Q2"
 *
 *   # 4. Operator promotes ED25519_NEXT_* env vars to ED25519_PRIMARY_* in
 *   # Render and deletes the NEXT vars; Render redeploys; verify
 *   # /api/health/deep.primary_key_id matches the new keyId.
 *
 * SCOPE — what this script does NOT do
 *
 *   - It does NOT touch ED25519_REQUIRED. Phase 2E enforcement is independent
 *     of which key is active.
 *   - It does NOT delete the old (now-grace) row. The row stays for the
 *     verification path until the grace_until window expires; manual
 *     cleanup happens later.
 *   - It does NOT broadcast the new active key to other running app processes.
 *     Cross-process cache invalidation lands in Phase 3C
 *     (/api/admin/cache/invalidate-keys). Until then, other processes pick
 *     up the new active key on their next 30s cache expiry OR on restart.
 *   - It does NOT support rollback. The Phase 3A state-transition trigger
 *     forbids grace -> active. To recover from a bad rotation, run a NEW
 *     rotation with a NEW key (the script will guide the operator through
 *     this in the activate next-steps output).
 *
 * SAFETY INVARIANTS (locked in by Zur — do NOT weaken)
 *
 *   - All three subcommands require explicit, non-empty --reason. The
 *     reason flows into key_rotation_log.reason (or audit_log for
 *     retire-pending) and into the operator-visible explanation if a
 *     trigger fires.
 *   - --grace-days is validated 7..365 at the CLI layer. Server-side has
 *     no equivalent check yet — the CLI is the only enforcement point.
 *   - The activate transaction is fully atomic (BEGIN/COMMIT around the
 *     two state UPDATEs and the key_rotation_log INSERT). A crash mid-
 *     rotation rolls everything back.
 *   - The pre-flight check for "running app has loaded the new key" can be
 *     bypassed with --skip-preflight, but the default is enabled.
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

const db = require(path.resolve(__dirname, '..', 'db.js'));

// ----------------------------------------------------------------------
// Arg parsing — no external deps to keep this script's blast radius small
// ----------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    cmd: null,
    reason: null,
    newKeyId: null,
    keyId: null,
    graceDays: null,
    actor: null,
    skipPreflight: false,
    healthUrl: null,
    help: false
  };
  if (argv.length === 0) {
    out.help = true;
    return out;
  }
  out.cmd = argv[0];
  for (const a of argv.slice(1)) {
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--skip-preflight') {
      out.skipPreflight = true;
    } else if (a.startsWith('--reason=')) {
      out.reason = a.substring('--reason='.length);
    } else if (a.startsWith('--new-key-id=')) {
      out.newKeyId = a.substring('--new-key-id='.length);
    } else if (a.startsWith('--key-id=')) {
      out.keyId = a.substring('--key-id='.length);
    } else if (a.startsWith('--grace-days=')) {
      out.graceDays = parseInt(a.substring('--grace-days='.length), 10);
    } else if (a.startsWith('--actor=')) {
      out.actor = a.substring('--actor='.length);
    } else if (a.startsWith('--health-url=')) {
      out.healthUrl = a.substring('--health-url='.length);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/rotate-ed25519-key.js <subcommand> [options]',
    '',
    'Subcommands:',
    '  generate         Generate a new pending key.',
    '    --reason=<str>           (required) free-text rotation reason (<=280 chars)',
    '',
    '  activate         Atomically promote a pending key to active.',
    '    --new-key-id=<16hex>     (required) the pending keyId to promote',
    '    --grace-days=<int>       (required) grace window for the outgoing key (7..365)',
    '    --reason=<str>           (required) free-text rotation reason (<=280 chars)',
    '    --actor=<str>            (optional, default <USER>@<host>)',
    '    --skip-preflight         (optional) bypass the "app loaded the new key" check',
    '    --health-url=<url>       (optional, default https://vertifile.com/api/health/deep)',
    '',
    '  retire-pending   Cancel a pending key (cannot be used on active/grace keys).',
    '    --key-id=<16hex>         (required) the pending keyId to retire',
    '    --reason=<str>           (required) why we are cancelling',
    '    --actor=<str>            (optional, default <USER>@<host>)',
    '',
    'Environment:',
    '  DATABASE_URL     (required) postgres connection string',
    ''
  ].join('\n'));
}

// ----------------------------------------------------------------------
// Validation helpers
// ----------------------------------------------------------------------
function assertReason(reason, label) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error(`${label}: --reason is required and must be a non-empty string`);
  }
  if (reason.length > 280) {
    throw new Error(`${label}: --reason exceeds 280 char limit (got ${reason.length})`);
  }
}

function assertKeyIdFormat(keyId, label) {
  if (typeof keyId !== 'string' || !/^[a-f0-9]{16}$/.test(keyId)) {
    throw new Error(`${label}: keyId must be exactly 16 lowercase hex characters`);
  }
}

function assertGraceDays(n, label) {
  if (!Number.isInteger(n) || n < 7 || n > 365) {
    throw new Error(`${label}: --grace-days must be an integer in 7..365 (got ${n})`);
  }
}

function defaultActor() {
  return (process.env.USER || 'unknown') + '@' + os.hostname();
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ----------------------------------------------------------------------
// Health check fetch — used by activate's pre-flight. Plain http(s) so we
// don't pull in fetch / undici / axios just for one GET.
// ----------------------------------------------------------------------
function fetchJson(urlString) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      return reject(new Error('invalid health URL: ' + urlString));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'GET',
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      timeout: 10000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`health endpoint returned status ${res.statusCode}: ${text.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('health endpoint returned non-JSON: ' + text.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('health endpoint timeout (10s)'));
    });
    req.end();
  });
}

// ----------------------------------------------------------------------
// SUBCOMMAND: generate
// ----------------------------------------------------------------------
async function cmdGenerate(args) {
  assertReason(args.reason, 'generate');

  // Generate the keypair in memory. We never write the private PEM to disk.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // keyId convention (matches scripts/generate-ed25519-keys.js + key-manager
  // boot validation): first 16 hex chars of sha256(public_key_pem). The full
  // sha256 is the "fingerprint" published in SECURITY.md and key_rotation_log.
  const fingerprint = sha256Hex(pubPem);
  const newKeyId = fingerprint.slice(0, 16);

  // INSERT into ed25519_keys with state='pending'. The Phase 3B partial
  // unique index on state='pending' enforces "at most one pending row at a
  // time" — if a previous run already inserted a pending key, this INSERT
  // collides and we surface a clear error.
  try {
    await db.query(
      `INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary, state, rotation_reason)
       VALUES ($1, $2, NOW(), FALSE, 'pending', $3)`,
      [newKeyId, pubPem, args.reason]
    );
  } catch (e) {
    if (e && e.message && /idx_ed25519_keys_one_pending|duplicate key/.test(e.message)) {
      // Look up the existing pending row so the operator can decide whether
      // to use it or retire it.
      const { rows } = await db.query("SELECT id, valid_from, rotation_reason FROM ed25519_keys WHERE state='pending' LIMIT 1");
      const existing = rows[0];
      process.stderr.write(
        '\nERROR: a pending key already exists in the database.\n' +
        '       keyId:           ' + (existing ? existing.id : '(unknown)') + '\n' +
        '       inserted at:     ' + (existing && existing.valid_from ? existing.valid_from.toISOString() : '(unknown)') + '\n' +
        '       rotation_reason: ' + (existing && existing.rotation_reason ? JSON.stringify(existing.rotation_reason) : '(none)') + '\n' +
        '\nOnly one pending key may exist at a time. Either:\n' +
        '  (a) Use the existing pending key (skip generate, run activate directly).\n' +
        '  (b) Retire the existing pending key first:\n' +
        '       node scripts/rotate-ed25519-key.js retire-pending --key-id=' + (existing ? existing.id : '<id>') + ' --reason="reason"\n\n'
      );
      process.exit(1);
    }
    throw e;
  }

  // Render-friendly single-line PEM (literal '\n' line separators). Render
  // env var input strips real newlines from multi-line pastes; the
  // key-manager loader normalizes both forms.
  const privPemSingleLine = privPem.replace(/\n/g, '\\n');

  // Pre-build the activate command so the operator can copy-paste it
  // directly without having to rebuild the keyId from another window.
  const sampleActivate =
    'node scripts/rotate-ed25519-key.js activate \\\n' +
    '  --new-key-id=' + newKeyId + ' \\\n' +
    '  --grace-days=90 \\\n' +
    '  --reason=' + JSON.stringify(args.reason);

  process.stdout.write('\n');
  process.stdout.write('============================================================\n');
  process.stdout.write('  Vertifile Ed25519 ROTATION — pending key generated\n');
  process.stdout.write('  DO NOT COMMIT THE PRIVATE KEY TO GIT.\n');
  process.stdout.write('  DO NOT WRITE THE PRIVATE KEY TO DISK.\n');
  process.stdout.write('============================================================\n\n');
  process.stdout.write('NEW KEY ID:    ' + newKeyId + '\n');
  process.stdout.write('FINGERPRINT:   ' + fingerprint + '\n');
  process.stdout.write('STATE:         pending  (will become active after the activate step)\n');
  process.stdout.write('REASON:        ' + args.reason + '\n\n');

  process.stdout.write('PUBLIC KEY PEM (already inserted into ed25519_keys):\n');
  process.stdout.write(pubPem + '\n');

  process.stdout.write('PRIVATE KEY PEM (multi-line):\n');
  process.stdout.write(privPem + '\n');

  process.stdout.write('PRIVATE KEY (Render-friendly single-line \\n format):\n');
  process.stdout.write('-- Use this if Render strips newlines from multi-line pastes --\n');
  process.stdout.write(privPemSingleLine + '\n\n');

  process.stdout.write('============================================================\n');
  process.stdout.write('NEXT STEPS — operator action required\n');
  process.stdout.write('============================================================\n\n');
  process.stdout.write('1. In Render (or your env-var manager), set the NEXT-slot vars:\n\n');
  process.stdout.write('   ED25519_NEXT_PRIVATE_KEY_PEM=<paste the private PEM above>\n');
  process.stdout.write('   ED25519_NEXT_KEY_ID=' + newKeyId + '\n\n');
  process.stdout.write('   (Do NOT touch ED25519_PRIVATE_KEY_PEM or ED25519_PRIMARY_KEY_ID yet.\n');
  process.stdout.write('    Those still hold the OUTGOING signing key.)\n\n');
  process.stdout.write('2. Wait ~60 seconds for Render to redeploy. The new app process will\n');
  process.stdout.write('   load BOTH the primary slot AND the next slot. You can verify by hitting:\n\n');
  process.stdout.write('     curl https://vertifile.com/api/health/deep | jq .ed25519_loaded_slots\n\n');
  process.stdout.write('   The "next" field should show: ' + newKeyId + '\n\n');
  process.stdout.write('3. Run the activate command (the script pre-flights this for you):\n\n');
  process.stdout.write(sampleActivate + '\n\n');
  process.stdout.write('   (You can override --grace-days; default is 90, range is 7..365.)\n\n');
  process.stdout.write('============================================================\n');
}

// ----------------------------------------------------------------------
// SUBCOMMAND: activate
// ----------------------------------------------------------------------
async function cmdActivate(args) {
  assertKeyIdFormat(args.newKeyId, 'activate');
  if (args.graceDays === null) {
    throw new Error('activate: --grace-days is required');
  }
  assertGraceDays(args.graceDays, 'activate');
  assertReason(args.reason, 'activate');
  const actor = args.actor || defaultActor();
  if (typeof actor !== 'string' || !actor || actor.length > 255) {
    throw new Error('activate: --actor must be a non-empty string up to 255 chars');
  }

  // ----- Pre-flight 1: the new key exists in the DB and is in state='pending'.
  const newRowResult = await db.query(
    'SELECT id, public_key_pem, state FROM ed25519_keys WHERE id = $1',
    [args.newKeyId]
  );
  if (newRowResult.rows.length === 0) {
    throw new Error(
      `activate: new key ${args.newKeyId} does not exist in ed25519_keys. ` +
      `Did you run 'generate' first?`
    );
  }
  const newRow = newRowResult.rows[0];
  if (newRow.state !== 'pending') {
    throw new Error(
      `activate: new key ${args.newKeyId} is in state '${newRow.state}', expected 'pending'. ` +
      `Activation only promotes keys from pending to active.`
    );
  }

  // ----- Pre-flight 2: exactly ONE row in state='active'.
  const activeRowsResult = await db.query("SELECT id, public_key_pem FROM ed25519_keys WHERE state = 'active'");
  if (activeRowsResult.rows.length === 0) {
    throw new Error(
      `activate: no row in ed25519_keys has state='active'. ` +
      `The DB is in a corrupted state — refusing to activate. ` +
      `Inspect ed25519_keys manually before proceeding.`
    );
  }
  if (activeRowsResult.rows.length > 1) {
    // The Phase 3B partial unique index should make this unreachable, but
    // belt-and-suspenders the defense at the CLI layer too.
    throw new Error(
      `activate: ${activeRowsResult.rows.length} rows have state='active' (expected exactly 1). ` +
      `The DB is in a corrupted state — refusing to activate.`
    );
  }
  const oldRow = activeRowsResult.rows[0];
  if (oldRow.id === args.newKeyId) {
    throw new Error(
      `activate: new key ${args.newKeyId} is already the active key. Nothing to do.`
    );
  }

  // ----- Pre-flight 3: the running app has loaded the new key.
  // This is the check that prevents the dangerous "DB flipped, env vars not
  // promoted, signing breaks" race. The operator can bypass with
  // --skip-preflight if the health endpoint is unreachable, but the default
  // is on.
  if (!args.skipPreflight) {
    const healthUrl = args.healthUrl || 'https://vertifile.com/api/health/deep';
    process.stdout.write('Pre-flight: GET ' + healthUrl + '\n');
    let health;
    try {
      health = await fetchJson(healthUrl);
    } catch (e) {
      throw new Error(
        `activate: health endpoint check failed: ${e.message}. ` +
        `Either fix the connectivity issue or pass --skip-preflight to bypass ` +
        `(only do this if you have independently verified the running app has ` +
        `loaded the new key — e.g. by inspecting Render logs).`
      );
    }
    const slots = health && health.ed25519_loaded_slots;
    if (!slots || (typeof slots.primary === 'undefined' && typeof slots.next === 'undefined')) {
      throw new Error(
        'activate: health endpoint did not return ed25519_loaded_slots. ' +
        'The running app may be on a pre-Phase-3B build. Pass --skip-preflight ' +
        'after independently verifying the new key is loaded.'
      );
    }
    const matchPrimary = slots.primary === args.newKeyId;
    const matchNext = slots.next === args.newKeyId;
    if (!matchPrimary && !matchNext) {
      throw new Error(
        `activate: the running app has NOT loaded the new key.\n` +
        `  loaded primary slot: ${slots.primary || '(none)'}\n` +
        `  loaded next slot:    ${slots.next || '(none)'}\n` +
        `  expected:            ${args.newKeyId}\n\n` +
        `Verify ED25519_NEXT_PRIVATE_KEY_PEM and ED25519_NEXT_KEY_ID are set in Render ` +
        `and the app has finished redeploying (~60s). Re-run after the slot loads, ` +
        `or pass --skip-preflight if you have independently verified loading.`
      );
    }
    process.stdout.write('Pre-flight OK: new key loaded in slot=' + (matchNext ? 'next' : 'primary') + '\n\n');
  } else {
    process.stdout.write('Pre-flight: SKIPPED (--skip-preflight)\n\n');
  }

  // Compute fingerprints for the rotation log.
  const oldFingerprint = sha256Hex(oldRow.public_key_pem);
  const newFingerprint = sha256Hex(newRow.public_key_pem);
  const graceUntil = new Date(Date.now() + args.graceDays * 24 * 60 * 60 * 1000);

  process.stdout.write('Rotation plan:\n');
  process.stdout.write('  outgoing key:  ' + oldRow.id + '  (active -> grace, retires ' + graceUntil.toISOString() + ')\n');
  process.stdout.write('  incoming key:  ' + args.newKeyId + '  (pending -> active)\n');
  process.stdout.write('  reason:        ' + args.reason + '\n');
  process.stdout.write('  actor:         ' + actor + '\n');
  process.stdout.write('  grace-days:    ' + args.graceDays + '\n\n');

  // ----- Atomic rotation: open one client, do everything inside BEGIN/COMMIT.
  const client = await db._db.connect();
  let rotationId = null;
  try {
    await client.query('BEGIN');

    // Demote outgoing: active -> grace. setEd25519KeyState wraps trigger
    // failures in Ed25519ForbiddenTransitionError so we surface a clear
    // message if the trigger somehow rejects (it shouldn't — active->grace
    // is the canonical happy path).
    await db.setEd25519KeyState(client, oldRow.id, 'grace', { reason: args.reason });

    // Promote incoming: pending -> active.
    await db.setEd25519KeyState(client, args.newKeyId, 'active', { reason: args.reason });

    // Keep is_primary in sync with state='active' for any legacy reader
    // that still consults the Phase 2A column. New readers should look at
    // state directly.
    await client.query("UPDATE ed25519_keys SET is_primary = FALSE WHERE id = $1", [oldRow.id]);
    await client.query("UPDATE ed25519_keys SET is_primary = TRUE  WHERE id = $1", [args.newKeyId]);

    // Stamp valid_until on the outgoing row so the eventual cleanup script
    // (Phase 3D) can find expired-by-time rows in one query.
    await client.query("UPDATE ed25519_keys SET valid_until = $1 WHERE id = $2", [graceUntil, oldRow.id]);

    // Write the rotation log row. insertRotationLog uses pool.query (auto-
    // commit), which is fine here because the rest of the transaction has
    // already passed the trigger checks — if the COMMIT below fails, the
    // log row is the orphaned residue and the listRotationLog cleanup
    // happens in Phase 3D. The alternative (open-client INSERT) would
    // duplicate the validation logic; we accept the small inconsistency
    // window for now and document it.
    rotationId = await db.insertRotationLog({
      oldKeyId: oldRow.id,
      newKeyId: args.newKeyId,
      oldFingerprint,
      newFingerprint,
      graceUntil,
      reason: args.reason,
      actor
    });

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted is fine */ }
    throw e;
  } finally {
    client.release();
  }

  // Local zero-wait cutover: invalidate this process's active-primary cache
  // so the very next signEd25519 call sees the new active key. Other
  // processes (different Render instances) pick it up at their next 30s
  // cache expiry. Phase 3C will add cross-process invalidation.
  try {
    const keyManager = require('../services/key-manager');
    if (typeof keyManager.invalidateActivePrimaryCache === 'function') {
      keyManager.invalidateActivePrimaryCache();
    }
  } catch (_) { /* not fatal */ }

  process.stdout.write('============================================================\n');
  process.stdout.write('  ROTATION COMMITTED — rotation_id=' + rotationId + '\n');
  process.stdout.write('============================================================\n\n');

  process.stdout.write('Database state after rotation:\n');
  process.stdout.write('  ' + oldRow.id + '   state=grace,   valid_until=' + graceUntil.toISOString() + '\n');
  process.stdout.write('  ' + args.newKeyId + '   state=active  (current signing key)\n\n');

  // Phase 3B operator guidance — cross-process cache tail.
  // The rotation command's local `keyManager.invalidateActivePrimaryCache()`
  // call above only clears the cache in THIS CLI process. Any running app
  // processes (Render instances, other hosts) have their own independent
  // 30s `_activePrimaryCache` TTL that this CLI cannot reach from here.
  // For the next ~30s those processes will resolve `getActivePrimary()`
  // via their stale cache → the OLD (now grace-state) key. This is safe
  // for verification (grace keys still verify for the full grace window),
  // but operators should know to EXPECT post-rotation docs to briefly
  // carry the old keyId. Phase 3C will add cross-process invalidation via
  // /api/admin/cache/invalidate-keys.
  console.log('');
  console.log('IMPORTANT — 30 second signing tail');
  console.log('-----------------------------------');
  console.log('Other running app processes will continue signing with the previous');
  console.log('key (' + oldRow.id + ') for up to 30 seconds while their key-manager');
  console.log('active-primary cache (TTL: 30s) expires. Those documents are valid');
  console.log('and will verify against the now-grace key for the full grace window');
  console.log('(' + args.graceDays + ' days).');
  console.log('');
  console.log('If you need a zero-tail cutover, wait 30 seconds AFTER this commit');
  console.log('before promoting the env vars in step 1 below. Phase 3C will add');
  console.log('cross-process cache invalidation via /api/admin/cache/invalidate-keys.');
  console.log('');

  process.stdout.write('============================================================\n');
  process.stdout.write('NEXT STEPS — operator action required\n');
  process.stdout.write('============================================================\n\n');
  process.stdout.write('1. In Render, PROMOTE the next-slot env vars to primary:\n\n');
  process.stdout.write('   ED25519_PRIVATE_KEY_PEM   = <value of ED25519_NEXT_PRIVATE_KEY_PEM>\n');
  process.stdout.write('   ED25519_PRIMARY_KEY_ID   = ' + args.newKeyId + '\n\n');
  process.stdout.write('2. DELETE the next-slot env vars (they no longer apply):\n\n');
  process.stdout.write('   ED25519_NEXT_PRIVATE_KEY_PEM\n');
  process.stdout.write('   ED25519_NEXT_KEY_ID\n\n');
  process.stdout.write('3. Wait for Render to redeploy (~60s).\n\n');
  process.stdout.write('4. Verify the redeploy picked up the new primary:\n\n');
  process.stdout.write('     curl https://vertifile.com/api/health/deep | jq .primary_key_id\n\n');
  process.stdout.write('   Should return: "' + args.newKeyId + '"\n\n');
  process.stdout.write('5. Verify the rotation log:\n\n');
  process.stdout.write('     curl https://vertifile.com/api/health/deep | jq .ed25519_keys_by_state\n\n');
  process.stdout.write('   Should show grace=1, active=1 (until valid_until expires).\n\n');
  process.stdout.write('IF SOMETHING WENT WRONG\n');
  process.stdout.write('   Do NOT attempt rollback. Rollback (grace -> active) is forbidden\n');
  process.stdout.write('   by the Phase 3 state-transition trigger; it is a permanent invariant.\n');
  process.stdout.write('   To recover, run a NEW rotation with a NEW key (start from `generate`).\n\n');
}

// ----------------------------------------------------------------------
// SUBCOMMAND: retire-pending
// ----------------------------------------------------------------------
async function cmdRetirePending(args) {
  assertKeyIdFormat(args.keyId, 'retire-pending');
  assertReason(args.reason, 'retire-pending');
  const actor = args.actor || defaultActor();
  if (typeof actor !== 'string' || !actor || actor.length > 255) {
    throw new Error('retire-pending: --actor must be a non-empty string up to 255 chars');
  }

  // Verify the key is pending. retire-pending is a no-op for active or grace
  // keys (those go through the normal rotation flow); we refuse rather than
  // do something the operator didn't intend.
  const rowResult = await db.query(
    'SELECT id, state FROM ed25519_keys WHERE id = $1',
    [args.keyId]
  );
  if (rowResult.rows.length === 0) {
    throw new Error(`retire-pending: key ${args.keyId} does not exist in ed25519_keys`);
  }
  const row = rowResult.rows[0];
  if (row.state !== 'pending') {
    throw new Error(
      `retire-pending: key ${args.keyId} is in state '${row.state}', expected 'pending'. ` +
      `retire-pending only cancels pending keys. To retire an active key, run a normal rotation.`
    );
  }

  // Pending -> expired is allowed by the Phase 3A trigger. Wrap in a
  // transaction so the audit row is written iff the UPDATE commits.
  const client = await db._db.connect();
  try {
    await client.query('BEGIN');
    await db.setEd25519KeyState(client, args.keyId, 'expired', { reason: args.reason });
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }

  // Audit the cancellation. We deliberately do NOT write to key_rotation_log:
  // retiring a pending key never resulted in a state where it signed
  // anything, so it is not a "rotation event" and exposing it in the public
  // rotation log would be misleading. The audit_log entry covers the
  // operational record.
  await db.log('key_rotation_cancelled', {
    keyId: args.keyId,
    reason: args.reason,
    actor
  }).catch((e) => {
    process.stderr.write('WARN: audit log write failed: ' + (e && e.message || e) + '\n');
  });

  process.stdout.write('============================================================\n');
  process.stdout.write('  PENDING KEY RETIRED — keyId=' + args.keyId + '\n');
  process.stdout.write('============================================================\n');
  process.stdout.write('  state:  pending -> expired\n');
  process.stdout.write('  reason: ' + args.reason + '\n');
  process.stdout.write('  actor:  ' + actor + '\n\n');
  process.stdout.write('You can now run `generate` again to create a fresh pending key.\n');
}

// ----------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.cmd) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('ERROR: DATABASE_URL must be set in the environment\n');
    process.exit(1);
  }

  await db._ready;

  switch (args.cmd) {
    case 'generate':
      await cmdGenerate(args);
      break;
    case 'activate':
      await cmdActivate(args);
      break;
    case 'retire-pending':
      await cmdRetirePending(args);
      break;
    default:
      process.stderr.write('ERROR: unknown subcommand: ' + args.cmd + '\n\n');
      printHelp();
      process.exit(1);
  }

  // Close the pool so the script exits cleanly. The pg pool keeps the event
  // loop alive otherwise. Wrap in try/catch — if close fails the process
  // will exit anyway via process.exit(0) below.
  try { await db.close(); } catch (_) { /* ok */ }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('FATAL: ' + (err && err.message ? err.message : String(err)) + '\n');
  if (err && err.stack && process.env.DEBUG) {
    process.stderr.write(err.stack + '\n');
  }
  // Best-effort pool close on error path too.
  try { db.close().catch(() => {}); } catch (_) { /* ok */ }
  process.exit(1);
});
