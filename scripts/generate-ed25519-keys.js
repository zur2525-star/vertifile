#!/usr/bin/env node
/**
 * One-time Ed25519 keypair generator for Vertifile.
 *
 * Usage:
 *   node scripts/generate-ed25519-keys.js
 *
 * The script prints both keys to stdout in PEM format plus the key ID.
 * The operator then:
 *   1. Copies the PRIVATE KEY PEM to the Render env var ED25519_PRIVATE_KEY_PEM
 *   2. Copies the PUBLIC KEY PEM into a DB insert on ed25519_keys table
 *   3. Copies the KEY ID into the env var ED25519_PRIMARY_KEY_ID
 *
 * NEVER commit the private key to git.
 * NEVER write the private key to disk.
 * The script deliberately does NOT write anything — it only prints.
 */

'use strict';

const crypto = require('crypto');

function main() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // Key ID = sha256(pubPem)[0..16]
  const keyId = crypto.createHash('sha256').update(pubPem).digest('hex').slice(0, 16);

  // Fingerprint (different from keyId — used for SECURITY.md publication)
  const fingerprint = crypto.createHash('sha256').update(pubPem).digest('hex');

  // Output formatting — BIG WARNING first
  process.stdout.write('\n');
  process.stdout.write('============================================================\n');
  process.stdout.write('  Vertifile Ed25519 Keypair Generator\n');
  process.stdout.write('  DO NOT COMMIT THE PRIVATE KEY TO GIT.\n');
  process.stdout.write('  DO NOT WRITE THE PRIVATE KEY TO DISK.\n');
  process.stdout.write('============================================================\n\n');

  process.stdout.write('KEY ID (16 hex chars, goes into ED25519_PRIMARY_KEY_ID env var):\n');
  process.stdout.write(keyId + '\n\n');

  process.stdout.write('FINGERPRINT (full sha256, for SECURITY.md publication):\n');
  process.stdout.write(fingerprint + '\n\n');

  process.stdout.write('PUBLIC KEY PEM (commit to DB ed25519_keys table + /.well-known endpoint):\n');
  process.stdout.write(pubPem);
  process.stdout.write('\n');

  process.stdout.write('PRIVATE KEY PEM (set as ED25519_PRIVATE_KEY_PEM env var in Render):\n');
  process.stdout.write(privPem);
  process.stdout.write('\n');

  process.stdout.write('SQL to insert the public key into the database:\n');
  process.stdout.write('INSERT INTO ed25519_keys (id, public_key_pem, valid_from, is_primary)\n');
  process.stdout.write("VALUES ('" + keyId + "',\n");
  process.stdout.write("  $pem$" + pubPem.trim() + "$pem$,\n");
  process.stdout.write("  NOW(), TRUE);\n\n");

  process.stdout.write('Env vars to set in Render:\n');
  process.stdout.write('  ED25519_PRIMARY_KEY_ID=' + keyId + '\n');
  process.stdout.write('  ED25519_PRIVATE_KEY_PEM=<paste the private key pem above, including BEGIN/END lines>\n\n');

  process.stdout.write('============================================================\n');
  process.stdout.write('Done. Keep this output private. The private key is displayed once.\n');
  process.stdout.write('============================================================\n');
}

main();
