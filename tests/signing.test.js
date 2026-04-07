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
  const signing = require('../services/signing');

  it('signEd25519 returns null when no primary key loaded', () => {
    // Phase 2A: no ED25519_PRIVATE_KEY_PEM set → key-manager never loaded a primary
    const result = signing.signEd25519('test');
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

    const payload = 'hash|org|2026-01-01T00:00:00Z||codeIntegrity';
    const result = signing.signEd25519(payload);
    assert.ok(result, 'signEd25519 should return object');
    assert.equal(result.keyId, testKeyId);
    assert.match(result.signature, /^[A-Za-z0-9_-]+$/);

    const valid = await signing.verifyEd25519(payload, result.signature, testKeyId);
    assert.equal(valid, true, 'roundtrip verification should succeed');
  });

  it('verifyEd25519 rejects tampered signatures', async () => {
    const signing = require('../services/signing');
    const payload = 'test payload';
    const result = signing.signEd25519(payload);
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
    const result = signing.signEd25519('original');
    const valid = await signing.verifyEd25519('different', result.signature, testKeyId);
    assert.equal(valid, false);
  });

  it('signEd25519 is deterministic (Ed25519 spec)', () => {
    const signing = require('../services/signing');
    const a = signing.signEd25519('deterministic input');
    const b = signing.signEd25519('deterministic input');
    assert.equal(a.signature, b.signature, 'Ed25519 signing must be deterministic');
  });
});
