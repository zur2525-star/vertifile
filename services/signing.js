/**
 * Cryptographic signing abstractions for Vertifile.
 *
 * Provides symmetric (HMAC-SHA256) and asymmetric (Ed25519) sign/verify
 * under a uniform interface. Used by the PVF pipeline (Phase 2B) and
 * the verify endpoint (Phase 2C).
 *
 * SECURITY:
 *   - Private keys are loaded from env vars ONCE at module load time
 *     and held as KeyObject in memory.
 *   - Keys are NEVER logged, NEVER serialized, NEVER passed as arguments
 *     except into the crypto primitives themselves.
 *   - signEd25519 is deterministic by spec (no nonce leakage).
 *   - All verification uses crypto.timingSafeEqual or crypto.verify
 *     (constant-time in Node's OpenSSL wrapper).
 *
 * Usage:
 *   const signing = require('./signing');
 *   const hmac = signing.signHMAC(payload);
 *   const ok = signing.verifyHMAC(payload, hmac);
 *
 *   // Ed25519 (only if key-manager has a primary key loaded)
 *   const result = signing.signEd25519(payload);
 *   // { signature: '...', keyId: '...' } or null if not configured
 *   if (result) {
 *     const valid = signing.verifyEd25519(payload, result.signature, result.keyId);
 *   }
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');
const keyManager = require('./key-manager');

// HMAC secret from pvf-generator (single source)
let _hmacSecret = null;
function getHmacSecret() {
  if (_hmacSecret === null) {
    // Lazy require to break potential cycles
    const pvfGen = require('./pvf-generator');
    _hmacSecret = pvfGen.HMAC_SECRET;
    if (!_hmacSecret) {
      throw new Error('HMAC_SECRET not available from pvf-generator');
    }
  }
  return _hmacSecret;
}

// ============================================================
// HMAC-SHA256 — symmetric MAC
// ============================================================

/**
 * Returns hex HMAC-SHA256 of the payload using the shared HMAC_SECRET.
 * @param {string|Buffer} payload
 * @returns {string} hex string
 */
function signHMAC(payload) {
  return crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
}

/**
 * Constant-time verification of an HMAC-SHA256 tag.
 * @param {string|Buffer} payload
 * @param {string} tagHex
 * @returns {boolean}
 */
function verifyHMAC(payload, tagHex) {
  if (typeof tagHex !== 'string' || !/^[a-f0-9]{64}$/i.test(tagHex)) return false;
  try {
    const expected = Buffer.from(signHMAC(payload), 'hex');
    const actual = Buffer.from(tagHex, 'hex');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

// ============================================================
// Ed25519 — asymmetric signature
// ============================================================

/**
 * Signs the payload with the currently-active Ed25519 signing key.
 * Returns null if no Ed25519 key is configured (feature not yet active).
 *
 * PHASE 3B: this function is now ASYNC. It consults keyManager.getActivePrimary()
 * which performs a (cached) DB lookup against ed25519_keys WHERE state='active'
 * to decide which of the two loaded slots (primary or next) should sign. This
 * decouples "which slot the env vars loaded" from "which slot is authoritative
 * for new signatures", which is what makes the atomic rotation flip work.
 *
 * At steady state (no rotation in progress) getActivePrimary() resolves to the
 * same slot as the old synchronous getPrimary() did, and the 30s cache means
 * the hot path is a pure in-memory lookup in the vast majority of calls.
 *
 * @param {string|Buffer} payload - the exact bytes to sign
 * @returns {Promise<{ signature: string, keyId: string } | null>}
 *   signature is base64url-encoded (86 chars for Ed25519)
 *   keyId is 16 hex chars identifying the key that signed
 */
async function signEd25519(payload) {
  const primary = await keyManager.getActivePrimary();
  if (!primary) return null;  // No active key — not an error in Phase 2A/2B
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const sig = crypto.sign(null, buf, primary.privateKey);
  return {
    signature: sig.toString('base64url'),
    keyId: primary.keyId
  };
}

/**
 * Verifies an Ed25519 signature against the payload using a specific keyId.
 * Looks up the public key via keyManager by keyId.
 *
 * @param {string|Buffer} payload
 * @param {string} signatureBase64url
 * @param {string} keyId
 * @returns {Promise<boolean>}
 */
async function verifyEd25519(payload, signatureBase64url, keyId) {
  if (typeof signatureBase64url !== 'string' || !signatureBase64url) return false;
  if (typeof keyId !== 'string' || !keyId) return false;
  try {
    const publicKey = await keyManager.getPublicKeyById(keyId);
    if (!publicKey) return false;
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const sigBuf = Buffer.from(signatureBase64url, 'base64url');
    if (sigBuf.length !== 64) return false;  // Ed25519 signatures are always 64 bytes
    return crypto.verify(null, buf, publicKey, sigBuf);
  } catch (e) {
    logger.warn({ err: e.message, keyId }, '[signing] verifyEd25519 error');
    return false;
  }
}

/**
 * Builds the canonical signing payload for a PVF document.
 * This is the EXACT string that will be signed by both HMAC and Ed25519.
 *
 * Format: hash|orgId|createdAt|recipientHash|codeIntegrity
 *
 * Explicit '|' separators prevent concatenation ambiguity — an attacker
 * cannot construct two different (hash, orgId, ...) tuples that produce
 * the same concatenation, because '|' is forbidden in hex (hash,
 * recipientHash, codeIntegrity), in the orgId convention (slash-dot-alnum),
 * and in ISO-8601 timestamps.
 *
 * @param {Object} fields
 * @param {string} fields.hash - hex sha256 of the document
 * @param {string} fields.orgId - the owning org identifier
 * @param {string} fields.createdAt - ISO 8601 timestamp
 * @param {string|null} fields.recipientHash - optional hex sha256 of recipient
 * @param {string|null} fields.codeIntegrity - hex sha256 of the inline script
 * @returns {string}
 */
function buildSigningPayload({ hash, orgId, createdAt, recipientHash, codeIntegrity }) {
  return [
    String(hash || ''),
    String(orgId || ''),
    String(createdAt || ''),
    String(recipientHash || ''),
    String(codeIntegrity || '')
  ].join('|');
}

module.exports = {
  signHMAC,
  verifyHMAC,
  signEd25519,
  verifyEd25519,
  buildSigningPayload
};
