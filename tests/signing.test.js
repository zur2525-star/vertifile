#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Set test HMAC secret before requiring modules
process.env.HMAC_SECRET = 'test-signing-hmac-secret';

// We need to stub out the pvf-generator require since it has side effects
// (loading HMAC secret file). For the test, we'll directly test the exports.

describe('signing.signHMAC / verifyHMAC', () => {
  // Require AFTER env is set
  const signing = require('../services/signing');

  it('signHMAC returns 64-char hex', () => {
    const tag = signing.signHMAC('test payload');
    assert.match(tag, /^[a-f0-9]{64}$/);
  });

  it('signHMAC is deterministic — same input → same output', () => {
    const a = signing.signHMAC('deterministic');
    const b = signing.signHMAC('deterministic');
    assert.equal(a, b);
  });

  it('signHMAC differs for different inputs', () => {
    const a = signing.signHMAC('input1');
    const b = signing.signHMAC('input2');
    assert.notEqual(a, b);
  });

  it('verifyHMAC accepts valid tags', () => {
    const payload = 'some data';
    const tag = signing.signHMAC(payload);
    assert.equal(signing.verifyHMAC(payload, tag), true);
  });

  it('verifyHMAC rejects tampered tags', () => {
    const payload = 'some data';
    const tag = signing.signHMAC(payload);
    const tampered = tag.substring(0, 63) + (tag[63] === '0' ? '1' : '0');
    assert.equal(signing.verifyHMAC(payload, tampered), false);
  });

  it('verifyHMAC rejects wrong payload', () => {
    const tag = signing.signHMAC('original');
    assert.equal(signing.verifyHMAC('different', tag), false);
  });

  it('verifyHMAC rejects non-hex tag', () => {
    assert.equal(signing.verifyHMAC('data', 'not-a-hex-tag'), false);
    assert.equal(signing.verifyHMAC('data', ''), false);
    assert.equal(signing.verifyHMAC('data', null), false);
  });
});

describe('signing.buildSigningPayload', () => {
  const signing = require('../services/signing');

  it('builds canonical pipe-separated payload', () => {
    const p = signing.buildSigningPayload({
      hash: 'h', orgId: 'o', createdAt: 't', recipientHash: 'r', codeIntegrity: 'c'
    });
    assert.equal(p, 'h|o|t|r|c');
  });

  it('coalesces null/undefined fields to empty strings', () => {
    const p = signing.buildSigningPayload({
      hash: 'h', orgId: 'o', createdAt: 't', recipientHash: null, codeIntegrity: undefined
    });
    assert.equal(p, 'h|o|t||');
  });

  it('is deterministic for same input', () => {
    const fields = { hash: 'a', orgId: 'b', createdAt: 'c', recipientHash: 'd', codeIntegrity: 'e' };
    assert.equal(signing.buildSigningPayload(fields), signing.buildSigningPayload(fields));
  });
});

describe('signing.signEd25519 / verifyEd25519 (no key configured)', () => {
  // Phase 3B: signEd25519 is async and consults keyManager.getActivePrimary()
  // which queries the DB. Stub getActivePrimary so this test can run in a
  // DB-less CI environment (the previous sync path never touched the DB).
  const keyManager = require('../services/key-manager');
  const signing = require('../services/signing');
  keyManager.getActivePrimary = async () => null;

  it('signEd25519 returns null when no primary key loaded', async () => {
    // Phase 2A: no ED25519_PRIVATE_KEY_PEM set → key-manager never loaded a primary
    const result = await signing.signEd25519('test');
    assert.equal(result, null);
  });

  it('verifyEd25519 returns false for missing keyId', async () => {
    const ok = await signing.verifyEd25519('test', 'fakeSignature', 'nonexistent_key_id');
    assert.equal(ok, false);
  });
});

describe('signing.signEd25519 / verifyEd25519 (with key configured)', () => {
  // Generate a temporary keypair for this test suite
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const testKeyId = crypto.createHash('sha256').update(pubPem).digest('hex').slice(0, 16);

  it('roundtrip: sign then verify succeeds', async () => {
    // Set the env vars and re-initialize key-manager
    process.env.ED25519_PRIVATE_KEY_PEM = privPem;
    process.env.ED25519_PRIMARY_KEY_ID = testKeyId;

    // Clear module cache and reinitialize
    delete require.cache[require.resolve('../services/key-manager')];
    delete require.cache[require.resolve('../services/signing')];
    const keyManager = require('../services/key-manager');
    const signing = require('../services/signing');
    keyManager.initialize();

    // Mock getPublicKeyById to return our test public key
    keyManager.getPublicKeyById = async (keyId) => {
      if (keyId === testKeyId) return publicKey;
      return null;
    };

    // Phase 3B: signEd25519 now reads keyManager.getActivePrimary() (DB-backed)
    // instead of the sync getPrimary(). Stub it to return the freshly loaded
    // primary slot so the roundtrip works without a live DB.
    const privateKeyObj = crypto.createPrivateKey({ key: privPem, format: 'pem' });
    keyManager.getActivePrimary = async () => ({ keyId: testKeyId, privateKey: privateKeyObj });

    const payload = 'hash|org|2026-01-01T00:00:00Z||codeIntegrity';
    const result = await signing.signEd25519(payload);
    assert.ok(result, 'signEd25519 should return object');
    assert.equal(result.keyId, testKeyId);
    assert.match(result.signature, /^[A-Za-z0-9_-]+$/);

    const valid = await signing.verifyEd25519(payload, result.signature, testKeyId);
    assert.equal(valid, true, 'roundtrip verification should succeed');
  });

  it('verifyEd25519 rejects tampered signatures', async () => {
    const signing = require('../services/signing');
    const payload = 'test payload';
    const result = await signing.signEd25519(payload);
    assert.ok(result);
    // Tamper a middle character — middle chars encode full 6 bits each, so
    // any replacement guarantees a different signature (avoids the 1/256
    // flake on the last 2 chars where 'AA' decodes to 0x00 and could match
    // a signature whose 64th byte was already 0x00).
    const mid = Math.floor(result.signature.length / 2);
    const origChar = result.signature[mid];
    const newChar = origChar === 'A' ? 'B' : 'A';
    const tampered = result.signature.substring(0, mid) + newChar + result.signature.substring(mid + 1);
    const valid = await signing.verifyEd25519(payload, tampered, testKeyId);
    assert.equal(valid, false);
  });

  it('verifyEd25519 rejects wrong payload', async () => {
    const signing = require('../services/signing');
    const result = await signing.signEd25519('original');
    const valid = await signing.verifyEd25519('different', result.signature, testKeyId);
    assert.equal(valid, false);
  });

  it('signEd25519 is deterministic (Ed25519 spec)', async () => {
    const signing = require('../services/signing');
    const a = await signing.signEd25519('deterministic input');
    const b = await signing.signEd25519('deterministic input');
    assert.equal(a.signature, b.signature, 'Ed25519 signing must be deterministic');
  });
});

// ===========================================================================
// Phase 2D — PEM canonicalization invariant (regression test)
//
// Guards against the /api/verify-public fingerprint drift bug found during
// Phase 2D wet verification. The Vertifile keyId convention is:
//
//   keyId = sha256(pubPem).slice(0, 16)
//
// where pubPem is the EXACT byte string `crypto.KeyObject.export(...)`
// returns. If a PEM ever ends up in the DB with a different byte shape
// (e.g., a manual SQL INSERT stripped the trailing '\n'), then hashing the
// raw DB bytes produces a fingerprint that does NOT start with the keyId,
// breaking the fingerprint→keyId contract that SECURITY.md and
// /api/verify-public expose to third parties.
//
// The fix lives in key-manager.js::_loadPublicKeyEntry — it re-exports the
// parsed KeyObject to produce the canonical form. This test proves the
// underlying crypto invariant: parsing a PEM that lost its trailing
// newline and re-exporting it yields the SAME bytes as the original
// canonical form, regardless of how battered the input was.
// ===========================================================================
describe('PEM canonicalization invariant (Phase 2D regression)', () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  const canonicalPem = kp.publicKey.export({ type: 'spki', format: 'pem' });
  const canonicalHash = crypto.createHash('sha256').update(canonicalPem).digest('hex');
  const canonicalKeyId = canonicalHash.slice(0, 16);

  it('canonical PEM from KeyObject.export ends with a single newline', () => {
    assert.equal(canonicalPem.endsWith('\n'), true, 'canonical form must end in \\n');
    assert.equal(canonicalPem.endsWith('\n\n'), false, 'canonical form must NOT end in double \\n');
  });

  it('fingerprint (sha256 of canonical PEM) starts with keyId', () => {
    assert.equal(canonicalHash.slice(0, 16), canonicalKeyId, 'fingerprint[0..16] === keyId');
  });

  it('stripping the trailing newline breaks the raw fingerprint but not the parsed form', () => {
    const strippedPem = canonicalPem.replace(/\n$/, '');
    assert.notEqual(
      crypto.createHash('sha256').update(strippedPem).digest('hex'),
      canonicalHash,
      'raw hash of stripped PEM MUST differ — proves the bug class exists'
    );

    // The fix: re-parse and re-export the battered PEM to recover the
    // canonical form. This is exactly what _loadPublicKeyEntry does.
    const reParsed = crypto.createPublicKey({ key: strippedPem, format: 'pem' });
    const reExported = reParsed.export({ type: 'spki', format: 'pem' });
    assert.equal(reExported, canonicalPem, 're-export must reproduce canonical PEM byte-for-byte');

    const reHash = crypto.createHash('sha256').update(reExported).digest('hex');
    assert.equal(reHash, canonicalHash, 'sha256 of re-exported PEM must match canonical fingerprint');
    assert.equal(reHash.slice(0, 16), canonicalKeyId, 'fingerprint[0..16] still equals keyId after canonicalization');
  });

  it('PEM with extra whitespace round-trips to the same canonical form', () => {
    // Simulate a pastebin / console UI that adds trailing spaces or extra
    // blank lines. Node's parser is tolerant; the canonicalization must
    // still emit the stable byte-form.
    const mangledPem = '  \n' + canonicalPem.trim() + '\n  \n';
    const reParsed = crypto.createPublicKey({ key: mangledPem, format: 'pem' });
    const reExported = reParsed.export({ type: 'spki', format: 'pem' });
    assert.equal(reExported, canonicalPem, 'canonicalization must absorb surrounding whitespace');
  });
});
