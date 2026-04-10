#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Node.js 18+ exposes crypto.subtle on globalThis.crypto
const C = require('../public/js/crypto');

// ---------------------------------------------------------------------------
// Helper: create a fake File-like object (Blob with arrayBuffer method)
// Node.js Blob gained arrayBuffer() in v15.7 — safe for 18+.
// ---------------------------------------------------------------------------
function makeFile(content, name, type) {
  const blob = new Blob([content], { type: type || 'text/plain' });
  blob.name = name || 'test.txt';
  return blob;
}

// ---------------------------------------------------------------------------
// 1. generateKey
// ---------------------------------------------------------------------------
describe('generateKey', () => {
  it('returns a CryptoKey with correct algorithm', async () => {
    const key = await C.generateKey();
    assert.equal(key.type, 'secret');
    assert.equal(key.algorithm.name, 'AES-GCM');
    assert.equal(key.algorithm.length, 256);
    assert.equal(key.extractable, true);
    assert.ok(key.usages.includes('encrypt'));
    assert.ok(key.usages.includes('decrypt'));
  });

  it('generates distinct keys on each call', async () => {
    const k1 = await C.generateKey();
    const k2 = await C.generateKey();
    const raw1 = await crypto.subtle.exportKey('raw', k1);
    const raw2 = await crypto.subtle.exportKey('raw', k2);
    assert.notDeepEqual(new Uint8Array(raw1), new Uint8Array(raw2));
  });
});

// ---------------------------------------------------------------------------
// 2. encrypt -> decrypt roundtrip
// ---------------------------------------------------------------------------
describe('encrypt / decrypt roundtrip', () => {
  it('decrypted bytes match original plaintext', async () => {
    const key = await C.generateKey();
    const original = new TextEncoder().encode('Vertifile zero-knowledge test').buffer;
    const { ciphertext, iv } = await C.encrypt(key, original);

    assert.ok(ciphertext instanceof ArrayBuffer);
    assert.ok(iv instanceof Uint8Array);
    assert.equal(iv.length, 12);

    const decrypted = await C.decrypt(key, ciphertext, iv);
    assert.deepEqual(new Uint8Array(decrypted), new Uint8Array(original));
  });

  it('ciphertext differs from plaintext', async () => {
    const key = await C.generateKey();
    const original = new TextEncoder().encode('sensitive document content').buffer;
    const { ciphertext } = await C.encrypt(key, original);

    // Ciphertext should be at least as long (GCM adds 16-byte auth tag)
    assert.ok(ciphertext.byteLength >= original.byteLength);
    assert.notDeepEqual(new Uint8Array(ciphertext).slice(0, original.byteLength),
                        new Uint8Array(original));
  });

  it('each encryption produces a different IV (and thus different ciphertext)', async () => {
    const key = await C.generateKey();
    const data = new TextEncoder().encode('same data').buffer;
    const r1 = await C.encrypt(key, data);
    const r2 = await C.encrypt(key, data);
    assert.notDeepEqual(r1.iv, r2.iv);
    assert.notDeepEqual(new Uint8Array(r1.ciphertext), new Uint8Array(r2.ciphertext));
  });
});

// ---------------------------------------------------------------------------
// 3. decrypt with wrong key throws
// ---------------------------------------------------------------------------
describe('decrypt with wrong key', () => {
  it('throws when decrypting with a different key', async () => {
    const key1 = await C.generateKey();
    const key2 = await C.generateKey();
    const data = new TextEncoder().encode('secret').buffer;
    const { ciphertext, iv } = await C.encrypt(key1, data);

    await assert.rejects(
      () => C.decrypt(key2, ciphertext, iv),
      (err) => {
        assert.ok(err.message.includes('decrypt failed'));
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 4. decrypt with wrong IV throws
// ---------------------------------------------------------------------------
describe('decrypt with wrong IV', () => {
  it('throws when decrypting with a different IV', async () => {
    const key = await C.generateKey();
    const data = new TextEncoder().encode('secret').buffer;
    const { ciphertext } = await C.encrypt(key, data);
    const wrongIV = crypto.getRandomValues(new Uint8Array(12));

    await assert.rejects(
      () => C.decrypt(key, ciphertext, wrongIV),
      (err) => {
        assert.ok(err.message.includes('decrypt failed'));
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 5. hashContent returns 64-char hex
// ---------------------------------------------------------------------------
describe('hashContent', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const data = new TextEncoder().encode('hash me').buffer;
    const hash = await C.hashContent(data);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 6. hashContent is deterministic
// ---------------------------------------------------------------------------
describe('hashContent determinism', () => {
  it('same input produces identical hash', async () => {
    const data = new TextEncoder().encode('deterministic input').buffer;
    const h1 = await C.hashContent(data);
    const h2 = await C.hashContent(data);
    assert.equal(h1, h2);
  });

  it('different input produces different hash', async () => {
    const d1 = new TextEncoder().encode('input A').buffer;
    const d2 = new TextEncoder().encode('input B').buffer;
    const h1 = await C.hashContent(d1);
    const h2 = await C.hashContent(d2);
    assert.notEqual(h1, h2);
  });
});

// ---------------------------------------------------------------------------
// 7. exportKey -> importKey roundtrip
// ---------------------------------------------------------------------------
describe('exportKey / importKey roundtrip', () => {
  it('imported key encrypts and decrypts the same as the original', async () => {
    const original = await C.generateKey();
    const exported = await C.exportKey(original);
    const imported = await C.importKey(exported);

    const data = new TextEncoder().encode('roundtrip via key export').buffer;

    // Encrypt with original, decrypt with imported
    const { ciphertext, iv } = await C.encrypt(original, data);
    const decrypted = await C.decrypt(imported, ciphertext, iv);
    assert.deepEqual(new Uint8Array(decrypted), new Uint8Array(data));

    // Encrypt with imported, decrypt with original
    const { ciphertext: ct2, iv: iv2 } = await C.encrypt(imported, data);
    const decrypted2 = await C.decrypt(original, ct2, iv2);
    assert.deepEqual(new Uint8Array(decrypted2), new Uint8Array(data));
  });

  it('exported key raw bytes match original', async () => {
    const key = await C.generateKey();
    const exported = await C.exportKey(key);
    const imported = await C.importKey(exported);
    const reExported = await C.exportKey(imported);
    assert.equal(exported, reExported);
  });
});

// ---------------------------------------------------------------------------
// 8. base64url encoding is URL-safe
// ---------------------------------------------------------------------------
describe('base64url encoding', () => {
  it('output contains no +, /, or = characters', async () => {
    const key = await C.generateKey();
    const exported = await C.exportKey(key);

    assert.ok(!exported.includes('+'), 'must not contain +');
    assert.ok(!exported.includes('/'), 'must not contain /');
    assert.ok(!exported.includes('='), 'must not contain =');
  });

  it('arrayBufferToBase64url roundtrips correctly', () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 253, 128, 64, 32, 16, 8, 4]).buffer;
    const encoded = C.arrayBufferToBase64url(original);

    assert.ok(!encoded.includes('+'));
    assert.ok(!encoded.includes('/'));
    assert.ok(!encoded.includes('='));

    const decoded = C.base64urlToArrayBuffer(encoded);
    assert.deepEqual(new Uint8Array(decoded), new Uint8Array(original));
  });

  it('handles edge case: buffer of all 0xFF bytes', () => {
    const original = new Uint8Array(32).fill(0xFF).buffer;
    const encoded = C.arrayBufferToBase64url(original);
    assert.ok(!encoded.includes('+'));
    assert.ok(!encoded.includes('/'));
    assert.ok(!encoded.includes('='));
    const decoded = C.base64urlToArrayBuffer(encoded);
    assert.deepEqual(new Uint8Array(decoded), new Uint8Array(original));
  });
});

// ---------------------------------------------------------------------------
// 9. encryptFile high-level
// ---------------------------------------------------------------------------
describe('encryptFile', () => {
  it('returns all expected fields with correct types', async () => {
    const file = makeFile('Hello Vertifile', 'doc.txt', 'text/plain');
    const result = await C.encryptFile(file);

    assert.ok(result.encryptedBlob instanceof Blob);
    assert.equal(result.encryptedBlob.type, 'application/octet-stream');
    assert.equal(typeof result.hash, 'string');
    assert.equal(result.hash.length, 64);
    assert.match(result.hash, /^[a-f0-9]{64}$/);
    assert.equal(typeof result.iv, 'string');
    assert.ok(!result.iv.includes('+'));
    assert.ok(!result.iv.includes('/'));
    assert.ok(!result.iv.includes('='));
    assert.equal(typeof result.keyBase64url, 'string');
    assert.ok(!result.keyBase64url.includes('+'));
    assert.ok(!result.keyBase64url.includes('/'));
    assert.ok(!result.keyBase64url.includes('='));
  });

  it('encrypted blob is larger than plaintext (GCM auth tag)', async () => {
    const content = 'A'.repeat(1000);
    const file = makeFile(content, 'big.txt');
    const result = await C.encryptFile(file);
    // GCM adds a 16-byte authentication tag
    assert.ok(result.encryptedBlob.size >= 1000 + 16);
  });

  it('hash matches independently computed SHA-256', async () => {
    const content = 'integrity check data';
    const file = makeFile(content);
    const result = await C.encryptFile(file);

    const manualHash = await C.hashContent(new TextEncoder().encode(content).buffer);
    assert.equal(result.hash, manualHash);
  });
});

// ---------------------------------------------------------------------------
// 10. decryptBlob high-level
// ---------------------------------------------------------------------------
describe('decryptBlob', () => {
  it('returns original file content after full encrypt-decrypt cycle', async () => {
    const content = 'Full roundtrip: file upload to viewer decryption';
    const file = makeFile(content);

    // Simulate upload: encryptFile
    const enc = await C.encryptFile(file);

    // Simulate server storage: convert encrypted blob to standard base64
    const encArrayBuffer = await enc.encryptedBlob.arrayBuffer();
    const encBytes = new Uint8Array(encArrayBuffer);
    let binary = '';
    for (let i = 0; i < encBytes.length; i++) {
      binary += String.fromCharCode(encBytes[i]);
    }
    const encBase64 = btoa(binary);

    // Simulate viewer: decryptBlob
    const decrypted = await C.decryptBlob(encBase64, enc.iv, enc.keyBase64url);
    const decryptedText = new TextDecoder().decode(decrypted);
    assert.equal(decryptedText, content);
  });

  it('fails with wrong key', async () => {
    const file = makeFile('secret content');
    const enc = await C.encryptFile(file);

    const encArrayBuffer = await enc.encryptedBlob.arrayBuffer();
    const encBytes = new Uint8Array(encArrayBuffer);
    let binary = '';
    for (let i = 0; i < encBytes.length; i++) {
      binary += String.fromCharCode(encBytes[i]);
    }
    const encBase64 = btoa(binary);

    // Generate a different key
    const wrongKey = await C.generateKey();
    const wrongKeyBase64url = await C.exportKey(wrongKey);

    await assert.rejects(
      () => C.decryptBlob(encBase64, enc.iv, wrongKeyBase64url),
      (err) => {
        assert.ok(err.message.includes('decryptBlob failed'));
        return true;
      }
    );
  });

  it('handles binary content (not just text)', async () => {
    // Create a blob with raw binary bytes
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;
    const file = new Blob([binaryData], { type: 'application/octet-stream' });

    const enc = await C.encryptFile(file);

    const encArrayBuffer = await enc.encryptedBlob.arrayBuffer();
    const encBytes = new Uint8Array(encArrayBuffer);
    let binary = '';
    for (let i = 0; i < encBytes.length; i++) {
      binary += String.fromCharCode(encBytes[i]);
    }
    const encBase64 = btoa(binary);

    const decrypted = await C.decryptBlob(encBase64, enc.iv, enc.keyBase64url);
    assert.deepEqual(new Uint8Array(decrypted), binaryData);
  });
});
