/**
 * Vertifile Client-Side Encryption Module
 *
 * AES-256-GCM encryption/decryption using the Web Crypto API.
 * Zero external dependencies. Works in both browser and Node.js.
 *
 * Exposed as window.VertifileCrypto in browsers,
 * or module.exports in Node.js / CommonJS environments.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal: environment-agnostic reference to the SubtleCrypto API
  // ---------------------------------------------------------------------------
  var subtle = (typeof crypto !== 'undefined' && crypto.subtle)
    ? crypto.subtle
    : (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
      ? globalThis.crypto.subtle
      : null;

  var getRandomValues = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? function (buf) { return crypto.getRandomValues(buf); }
    : (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues)
      ? function (buf) { return globalThis.crypto.getRandomValues(buf); }
      : null;

  // ---------------------------------------------------------------------------
  // Base64url utilities (URL-safe, no padding)
  // ---------------------------------------------------------------------------

  /**
   * Convert an ArrayBuffer to a base64url-encoded string.
   * The output contains only characters safe for URL fragments: A-Z a-z 0-9 - _
   *
   * @param {ArrayBuffer} buffer - Raw bytes to encode.
   * @returns {string} Base64url string (no padding).
   */
  function arrayBufferToBase64url(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Convert a base64url-encoded string back to an ArrayBuffer.
   *
   * @param {string} base64url - Base64url string (no padding).
   * @returns {ArrayBuffer} Decoded bytes.
   */
  function base64urlToArrayBuffer(base64url) {
    var base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    var padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Convert a standard base64-encoded string to an ArrayBuffer.
   * Used when the server stores encrypted data as regular (non-URL-safe) base64.
   *
   * @param {string} base64 - Standard base64 string.
   * @returns {ArrayBuffer} Decoded bytes.
   */
  function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ---------------------------------------------------------------------------
  // Core cryptographic primitives
  // ---------------------------------------------------------------------------

  /**
   * Generate a random AES-256-GCM CryptoKey.
   *
   * The key is extractable so it can be exported for inclusion in URL fragments.
   *
   * @returns {Promise<CryptoKey>} A new AES-256-GCM key.
   * @throws {Error} If the Web Crypto API is unavailable.
   */
  async function generateKey() {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    try {
      return await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      throw new Error('VertifileCrypto.generateKey failed: ' + err.message);
    }
  }

  /**
   * Generate a cryptographically random 96-bit initialization vector.
   * 96 bits (12 bytes) is the recommended IV length for AES-GCM.
   *
   * @returns {Uint8Array} 12 random bytes.
   */
  function generateIV() {
    if (!getRandomValues) {
      throw new Error('VertifileCrypto: crypto.getRandomValues is not available');
    }
    return getRandomValues(new Uint8Array(12));
  }

  /**
   * Encrypt an ArrayBuffer with AES-256-GCM.
   *
   * A fresh random IV is generated for every call. Never reuse an IV with the
   * same key.
   *
   * @param {CryptoKey} key  - AES-256-GCM key from generateKey() or importKey().
   * @param {ArrayBuffer} plaintext - Data to encrypt.
   * @returns {Promise<{ciphertext: ArrayBuffer, iv: Uint8Array}>}
   * @throws {Error} If encryption fails.
   */
  async function encrypt(key, plaintext) {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    var iv = generateIV();
    try {
      var ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        plaintext
      );
      return { ciphertext: ciphertext, iv: iv };
    } catch (err) {
      throw new Error('VertifileCrypto.encrypt failed: ' + err.message);
    }
  }

  /**
   * Decrypt an AES-256-GCM ciphertext back to an ArrayBuffer.
   *
   * @param {CryptoKey} key        - The same key used for encryption.
   * @param {ArrayBuffer} ciphertext - Encrypted data (includes GCM auth tag).
   * @param {Uint8Array}  iv         - The IV that was used during encryption.
   * @returns {Promise<ArrayBuffer>} Decrypted plaintext.
   * @throws {Error} If decryption fails (wrong key, wrong IV, or tampered data).
   */
  async function decrypt(key, ciphertext, iv) {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    try {
      return await subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );
    } catch (err) {
      throw new Error('VertifileCrypto.decrypt failed: ' + err.message);
    }
  }

  /**
   * Compute the SHA-256 hash of an ArrayBuffer.
   *
   * @param {ArrayBuffer} data - Input data to hash.
   * @returns {Promise<string>} Lowercase hex-encoded SHA-256 digest (64 chars).
   * @throws {Error} If hashing fails.
   */
  async function hashContent(data) {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    try {
      var hashBuffer = await subtle.digest('SHA-256', data);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    } catch (err) {
      throw new Error('VertifileCrypto.hashContent failed: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Key import / export (for URL fragment transport)
  // ---------------------------------------------------------------------------

  /**
   * Export a CryptoKey to a base64url-encoded string.
   *
   * The string is safe for inclusion in a URL fragment (#key=...).
   *
   * @param {CryptoKey} key - An extractable AES-256-GCM key.
   * @returns {Promise<string>} Base64url representation of the raw key bytes.
   * @throws {Error} If the key is not extractable or export fails.
   */
  async function exportKey(key) {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    try {
      var raw = await subtle.exportKey('raw', key);
      return arrayBufferToBase64url(raw);
    } catch (err) {
      throw new Error('VertifileCrypto.exportKey failed: ' + err.message);
    }
  }

  /**
   * Import a CryptoKey from a base64url-encoded string.
   *
   * @param {string} base64url - Base64url key material (from exportKey or URL fragment).
   * @returns {Promise<CryptoKey>} Reconstructed AES-256-GCM CryptoKey.
   * @throws {Error} If the key material is invalid or import fails.
   */
  async function importKey(base64url) {
    if (!subtle) {
      throw new Error('VertifileCrypto: Web Crypto API is not available in this environment');
    }
    try {
      var raw = base64urlToArrayBuffer(base64url);
      return await subtle.importKey(
        'raw',
        raw,
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (err) {
      throw new Error('VertifileCrypto.importKey failed: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // High-level convenience functions
  // ---------------------------------------------------------------------------

  /**
   * Encrypt a File (or Blob) for upload.
   *
   * Generates a fresh key, encrypts the file contents, and returns everything
   * needed to store the ciphertext on the server and reconstruct the decryption
   * key via URL fragment.
   *
   * @param {File|Blob} file - The file to encrypt.
   * @returns {Promise<{encryptedBlob: Blob, hash: string, iv: string, keyBase64url: string}>}
   *   - encryptedBlob:  Blob of the ciphertext (application/octet-stream).
   *   - hash:           SHA-256 hex digest of the PLAINTEXT (for integrity check).
   *   - iv:             Base64url-encoded 12-byte IV.
   *   - keyBase64url:   Base64url-encoded 256-bit key (goes in URL fragment).
   * @throws {Error} If encryption or hashing fails.
   */
  async function encryptFile(file) {
    try {
      var plaintext = await file.arrayBuffer();
      var hash = await hashContent(plaintext);
      var key = await generateKey();
      var result = await encrypt(key, plaintext);
      var keyBase64url = await exportKey(key);
      return {
        encryptedBlob: new Blob([result.ciphertext], { type: 'application/octet-stream' }),
        hash: hash,
        iv: arrayBufferToBase64url(result.iv),
        keyBase64url: keyBase64url
      };
    } catch (err) {
      throw new Error('VertifileCrypto.encryptFile failed: ' + err.message);
    }
  }

  /**
   * Decrypt encrypted data retrieved from the server.
   *
   * Accepts the three components that travel separately:
   *   - encryptedBase64:  standard base64 from the server (JSON payload)
   *   - ivBase64url:      base64url IV (stored alongside the ciphertext)
   *   - keyBase64url:     base64url key (from URL fragment, never hits server)
   *
   * @param {string} encryptedBase64 - Standard base64-encoded ciphertext.
   * @param {string} ivBase64url     - Base64url-encoded IV.
   * @param {string} keyBase64url    - Base64url-encoded decryption key.
   * @returns {Promise<ArrayBuffer>} Decrypted plaintext bytes.
   * @throws {Error} If decryption fails (wrong key, wrong IV, tampered data).
   */
  async function decryptBlob(encryptedBase64, ivBase64url, keyBase64url) {
    try {
      var key = await importKey(keyBase64url);
      var iv = new Uint8Array(base64urlToArrayBuffer(ivBase64url));
      var encryptedBuffer = base64ToArrayBuffer(encryptedBase64);
      return await decrypt(key, encryptedBuffer, iv);
    } catch (err) {
      throw new Error('VertifileCrypto.decryptBlob failed: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var api = {
    // Core primitives
    generateKey: generateKey,
    generateIV: generateIV,
    encrypt: encrypt,
    decrypt: decrypt,
    hashContent: hashContent,

    // Key transport
    exportKey: exportKey,
    importKey: importKey,

    // High-level
    encryptFile: encryptFile,
    decryptBlob: decryptBlob,

    // Encoding utilities (exposed for tests and edge cases)
    arrayBufferToBase64url: arrayBufferToBase64url,
    base64urlToArrayBuffer: base64urlToArrayBuffer,
    base64ToArrayBuffer: base64ToArrayBuffer
  };

  // ---------------------------------------------------------------------------
  // Environment-aware export
  // ---------------------------------------------------------------------------
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof root !== 'undefined') {
    root.VertifileCrypto = api;
  }

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
