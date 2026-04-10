#!/usr/bin/env node
'use strict';

/**
 * Zero-Knowledge Encryption (PVF 2.0) End-to-End Test Suite
 * ==========================================================================
 *
 * Tests the full ZK encryption pipeline: client-side crypto module, the
 * createPvfEncrypted() pipeline function, PVF template output, slug
 * generation, database persistence, and backward compatibility with v1.0.
 *
 * Split into two sections:
 *   Section A (1-5):  Pure crypto + slug tests — no database needed.
 *   Section B (6-12): Pipeline + DB tests — require DATABASE_URL.
 *
 * Section B gracefully skips when DATABASE_URL is not set, matching the
 * pattern used by pipeline-pvf-roundtrip.test.js.
 *
 * Cleanup: targeted DELETE on TEST_ORG_ID. Force process.exit(0) at the
 * end so the pg pool does not hold the process open.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Pre-require env setup (HMAC_SECRET must exist before pipeline import)
// ---------------------------------------------------------------------------
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test-zk-encryption-hmac';
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'test-zk-encryption-admin';
process.env.PORT = '0';

// ---------------------------------------------------------------------------
// Section A: Pure tests (no DB)
// ---------------------------------------------------------------------------
const C = require('../public/js/crypto');

// generateSlug is a pure function but lives inside pvf-pipeline.js which
// requires db.js at the top level. db.js calls process.exit(1) when
// DATABASE_URL is missing, so we cannot import it without a DB connection.
// Re-implement the algorithm here for DB-free testing; the DB-dependent
// Section B imports the real module and cross-checks behavior.
function generateSlugLocal(filename) {
  let slug = (filename || 'document').replace(/\.[^.]+$/, '');
  slug = slug.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  slug = slug.toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-|-$/g, '');
  slug = slug.substring(0, 64);
  if (!slug) slug = 'document';
  return slug;
}

// Helper: create a Blob with .arrayBuffer() (File-like for encryptFile)
function makeFile(content, name, type) {
  const blob = new Blob([content], { type: type || 'text/plain' });
  blob.name = name || 'test.txt';
  return blob;
}

// Helper: convert Blob to standard base64 (simulates server storage)
async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// =========================================================================
// 1. Crypto module roundtrip: encrypt -> decrypt -> original bytes match
// =========================================================================
describe('ZK 1: Crypto module full roundtrip', () => {
  it('encryptFile -> server base64 -> decryptBlob -> original text', async () => {
    const originalText = 'Vertifile Zero-Knowledge encryption roundtrip test. Content MUST match exactly.';
    const file = makeFile(originalText, 'roundtrip.txt', 'text/plain');

    // Client-side encrypt
    const enc = await C.encryptFile(file);
    assert.ok(enc.encryptedBlob instanceof Blob, 'encryptedBlob must be a Blob');
    assert.equal(typeof enc.hash, 'string');
    assert.match(enc.hash, /^[a-f0-9]{64}$/, 'hash must be 64-char hex');
    assert.equal(typeof enc.iv, 'string', 'iv must be a string');
    assert.equal(typeof enc.keyBase64url, 'string', 'keyBase64url must be a string');

    // Simulate server: store ciphertext as standard base64
    const encBase64 = await blobToBase64(enc.encryptedBlob);

    // Viewer-side decrypt
    const decrypted = await C.decryptBlob(encBase64, enc.iv, enc.keyBase64url);
    const decryptedText = new TextDecoder().decode(decrypted);
    assert.equal(decryptedText, originalText, 'decrypted text must match original');
  });

  it('roundtrip works with binary content (all 256 byte values)', async () => {
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;
    const file = new Blob([binaryData], { type: 'application/octet-stream' });

    const enc = await C.encryptFile(file);
    const encBase64 = await blobToBase64(enc.encryptedBlob);

    const decrypted = await C.decryptBlob(encBase64, enc.iv, enc.keyBase64url);
    assert.deepEqual(new Uint8Array(decrypted), binaryData, 'binary content must survive roundtrip');
  });

  it('hash matches independently computed SHA-256 of plaintext', async () => {
    const content = 'hash integrity verification data';
    const file = makeFile(content);
    const enc = await C.encryptFile(file);

    const manualHash = await C.hashContent(new TextEncoder().encode(content).buffer);
    assert.equal(enc.hash, manualHash, 'encryptFile hash must match manual SHA-256');
  });
});

// =========================================================================
// 7. Slug generation: URL-safe, derived from filename
// =========================================================================
describe('ZK 7: Slug generation', () => {
  it('produces a lowercase, hyphen-separated, URL-safe slug', () => {
    const slug = generateSlugLocal('My Document File.pdf');
    assert.match(slug, /^[a-z0-9-]+$/, 'slug must be URL-safe: lowercase alphanum and hyphens only');
    assert.ok(!slug.includes('--'), 'slug must not have consecutive hyphens');
    assert.ok(!slug.startsWith('-'), 'slug must not start with a hyphen');
    assert.ok(!slug.endsWith('-'), 'slug must not end with a hyphen');
  });

  it('strips file extension', () => {
    const slug = generateSlugLocal('report-final.pdf');
    assert.ok(!slug.includes('pdf'), 'slug must not contain the file extension');
    assert.equal(slug, 'report-final');
  });

  it('handles unicode filenames (normalization + strip combining marks)', () => {
    const slug = generateSlugLocal('resume.pdf');
    assert.match(slug, /^[a-z0-9-]+$/, 'unicode filename must produce URL-safe slug');
    assert.equal(slug, 'resume');
  });

  it('truncates to 64 chars max', () => {
    const longName = 'a'.repeat(100) + '.txt';
    const slug = generateSlugLocal(longName);
    assert.ok(slug.length <= 64, 'slug must be 64 chars or fewer');
  });

  it('falls back to "document" for empty/whitespace-only filenames', () => {
    assert.equal(generateSlugLocal(''), 'document');
    assert.equal(generateSlugLocal('.pdf'), 'document');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    const slug = generateSlugLocal('My File (Draft #2) [v3].docx');
    assert.match(slug, /^[a-z0-9-]+$/, 'special characters must become hyphens');
    assert.ok(!slug.includes('--'), 'consecutive hyphens must be collapsed');
  });

  it('different filenames produce different slugs', () => {
    const s1 = generateSlugLocal('patent-claims-final.pdf');
    const s2 = generateSlugLocal('insurance-policy.pdf');
    assert.notEqual(s1, s2, 'different filenames must produce different slugs');
  });
});

// =========================================================================
// Section B: Pipeline + Database tests
// Gracefully skip when DATABASE_URL is not set.
// =========================================================================
const HAS_DB = !!process.env.DATABASE_URL;

if (!HAS_DB) {
  process.stderr.write('[zk-encryption] DATABASE_URL not set -- skipping pipeline/DB tests (Section B).\n');
}

// Only require DB-dependent modules when DATABASE_URL is available.
// db.js calls process.exit(1) if DATABASE_URL is missing, so we guard.
let db, pipeline, keyManager, signing, generateSlug;
if (HAS_DB) {
  db = require(path.resolve(__dirname, '..', 'db.js'));
  pipeline = require('../services/pvf-pipeline');
  signing = require('../services/signing');
  keyManager = require('../services/key-manager');
  generateSlug = pipeline.generateSlug;
}

const TEST_PREFIX = 'zktest' + crypto.randomBytes(2).toString('hex');
const TEST_ORG_ID = 'org_' + TEST_PREFIX;
const INSERTED_HASHES = new Set();

// Test Ed25519 keypair
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ed25519');
const TEST_PUB_PEM = TEST_PUB.export({ type: 'spki', format: 'pem' });
const TEST_KEY_ID = crypto.createHash('sha256').update(TEST_PUB_PEM).digest('hex').slice(0, 16);

let origGetActivePrimary = null;
let origGetPublicKeyById = null;
const ORIGINAL_ED25519_REQUIRED = process.env.ED25519_REQUIRED;

// Helper: produce an encrypted fixture using the client-side crypto module.
async function makeEncryptedFixture(tag, mimeType) {
  const content = 'zk-encryption-test-' + tag + '-' + Date.now() + '-' + Math.random();
  const file = makeFile(content, 'zk-' + tag + '.txt', 'text/plain');
  const enc = await C.encryptFile(file);
  const encBuffer = Buffer.from(await enc.encryptedBlob.arrayBuffer());

  // IV: encryptFile returns base64url; pipeline expects base64 (12 bytes).
  // Convert base64url -> standard base64 for the server side.
  const ivBase64 = enc.iv.replace(/-/g, '+').replace(/_/g, '/');
  const ivPadded = ivBase64 + '='.repeat((4 - ivBase64.length % 4) % 4);

  return {
    encryptedBlob: encBuffer,
    hash: enc.hash,
    iv: ivPadded,
    mimeType: mimeType || 'text/plain',
    originalName: 'zk-' + tag + '.txt',
    owner: {
      type: 'demo',
      id: TEST_ORG_ID,
      displayName: 'ZK Encryption Test'
    },
    _plaintext: content,
    _keyBase64url: enc.keyBase64url
  };
}

async function createEncryptedAndTrack(fixture) {
  const res = await pipeline.createPvfEncrypted(fixture);
  if (res && res.hash) INSERTED_HASHES.add(res.hash);
  return res;
}

async function createV1AndTrack(tag) {
  const buffer = Buffer.from('zk-v1-compat-' + tag + '-' + Date.now(), 'utf8');
  const fixture = {
    buffer,
    originalName: 'v1-' + tag + '.txt',
    mimeType: 'text/plain',
    owner: {
      type: 'demo',
      id: TEST_ORG_ID,
      displayName: 'ZK Encryption Test v1'
    }
  };
  const res = await pipeline.createPvf(fixture);
  if (res && res.hash) INSERTED_HASHES.add(res.hash);
  return res;
}

if (HAS_DB) {
  delete process.env.ED25519_REQUIRED;

  before(async () => {
    await db._ready;
    keyManager.initialize();

    origGetActivePrimary = keyManager.getActivePrimary;
    origGetPublicKeyById = keyManager.getPublicKeyById;

    // Stub Ed25519 to use test keypair
    keyManager.getActivePrimary = async () => ({ keyId: TEST_KEY_ID, privateKey: TEST_PRIV });
    keyManager.getPublicKeyById = async (keyId) => {
      if (keyId === TEST_KEY_ID) return TEST_PUB;
      return origGetPublicKeyById.call(keyManager, keyId);
    };
  });

  after(async () => {
    // Restore env
    try {
      if (ORIGINAL_ED25519_REQUIRED === undefined) {
        delete process.env.ED25519_REQUIRED;
      } else {
        process.env.ED25519_REQUIRED = ORIGINAL_ED25519_REQUIRED;
      }
    } catch (_) {}

    // Restore stubs
    try {
      if (origGetActivePrimary) keyManager.getActivePrimary = origGetActivePrimary;
      if (origGetPublicKeyById) keyManager.getPublicKeyById = origGetPublicKeyById;
    } catch (_) {}

    // Cleanup inserted rows
    try {
      await db.query('DELETE FROM documents WHERE org_id = $1', [TEST_ORG_ID]);
    } catch (_) {}
    for (const hash of INSERTED_HASHES) {
      await db.query('DELETE FROM documents WHERE hash = $1', [hash]).catch(() => {});
    }

    // Force exit -- pg pool holds process open
    process.exit(0);
  });

  // =========================================================================
  // Cross-check: verify the local slug implementation matches the real one
  // =========================================================================
  describe('ZK slug cross-check: local impl matches pipeline.generateSlug', () => {
    it('generateSlugLocal matches pipeline.generateSlug for representative inputs', () => {
      const inputs = [
        'My Document File.pdf',
        'report-final.pdf',
        'resume.pdf',
        'a'.repeat(100) + '.txt',
        '',
        '.pdf',
        'My File (Draft #2) [v3].docx',
        'patent-claims-final.pdf'
      ];
      for (const input of inputs) {
        assert.equal(
          generateSlugLocal(input),
          generateSlug(input),
          'slug mismatch for input: ' + JSON.stringify(input)
        );
      }
    });
  });

  // =========================================================================
  // 2. createPvfEncrypted: creates PVF with encrypted=true, correct slug, IV
  // =========================================================================
  describe('ZK 2: createPvfEncrypted pipeline output', () => {
    it('returns success=true with slug, shareId, hash, encrypted=true', async () => {
      const fixture = await makeEncryptedFixture('pipeline');
      const res = await createEncryptedAndTrack(fixture);

      assert.ok(res, 'createPvfEncrypted must return a result');
      assert.equal(res.success, true, 'success must be true');
      assert.equal(res.encrypted, true, 'encrypted must be true');
      assert.equal(typeof res.slug, 'string', 'slug must be a string');
      assert.ok(res.slug.length > 0, 'slug must not be empty');
      assert.match(res.slug, /^[a-z0-9-]+$/, 'slug must be URL-safe');
      assert.equal(typeof res.shareId, 'string', 'shareId must be a string');
      assert.equal(res.hash, fixture.hash, 'returned hash must match the client-provided hash');
      assert.equal(typeof res.timestamp, 'string', 'timestamp must be a string');
      assert.ok(res.pvfHtml, 'pvfHtml must be present');
    });
  });

  // =========================================================================
  // 3. PVF version: generated PVF contains <!--PVF:2.0--> and pvf:encrypted
  // =========================================================================
  describe('ZK 3: PVF version markers in generated HTML', () => {
    it('contains <!--PVF:2.0--> comment and pvf:encrypted meta tag', async () => {
      const fixture = await makeEncryptedFixture('version');
      const res = await createEncryptedAndTrack(fixture);
      const pvf = res.pvfHtml;

      assert.ok(pvf.includes('<!--PVF:2.0-->'), 'PVF must start with <!--PVF:2.0--> version comment');
      assert.ok(
        pvf.includes('<meta name="pvf:encrypted" content="true">'),
        'PVF must contain <meta name="pvf:encrypted" content="true">'
      );
      assert.ok(
        pvf.includes('<meta name="pvf:version" content="2.0">'),
        'PVF must contain <meta name="pvf:version" content="2.0">'
      );
    });
  });

  // =========================================================================
  // 4. Encrypted payload: PVF contains <script id="encryptedDoc"> with base64
  // =========================================================================
  describe('ZK 4: Encrypted payload in PVF HTML', () => {
    it('contains <script id="encryptedDoc"> with data-vf-bundle attribute', async () => {
      const fixture = await makeEncryptedFixture('payload');
      const res = await createEncryptedAndTrack(fixture);
      const pvf = res.pvfHtml;

      assert.ok(
        pvf.includes('id="encryptedDoc"'),
        'PVF must contain script tag with id="encryptedDoc"'
      );
      assert.ok(
        pvf.includes('data-vf-bundle="encrypted-doc"'),
        'encryptedDoc script must have data-vf-bundle="encrypted-doc"'
      );
      assert.ok(
        pvf.includes('id="encryptionMeta"'),
        'PVF must contain script tag with id="encryptionMeta"'
      );
      assert.ok(
        pvf.includes('data-vf-bundle="encryption-meta"'),
        'encryptionMeta script must have data-vf-bundle="encryption-meta"'
      );

      // Verify encryptionMeta contains IV and mimeType as JSON
      const metaMatch = pvf.match(/id="encryptionMeta"[^>]*>([\s\S]*?)<\/script>/);
      assert.ok(metaMatch, 'encryptionMeta script must have content');
      const meta = JSON.parse(metaMatch[1]);
      assert.equal(meta.iv, fixture.iv, 'encryptionMeta must contain the IV');
      assert.equal(meta.mimeType, fixture.mimeType, 'encryptionMeta must contain the mimeType');
    });
  });

  // =========================================================================
  // 5. No plaintext leakage: PVF does NOT contain original document text
  // =========================================================================
  describe('ZK 5: No plaintext leakage in encrypted PVF', () => {
    it('original document content must NOT appear in PVF HTML', async () => {
      const fixture = await makeEncryptedFixture('leakcheck');
      const res = await createEncryptedAndTrack(fixture);
      const pvf = res.pvfHtml;
      const plaintext = fixture._plaintext;

      // The plaintext should never appear in the PVF
      assert.ok(
        !pvf.includes(plaintext),
        'PVF must NOT contain the original plaintext content -- zero-knowledge violation'
      );

      // Also check for the unique test tag substring
      const uniquePart = 'zk-encryption-test-leakcheck';
      assert.ok(
        !pvf.includes(uniquePart),
        'PVF must NOT contain any substring of the original content'
      );
    });
  });

  // =========================================================================
  // 6. Hash matches: client-computed hash stored in documents row
  // =========================================================================
  describe('ZK 6: Client-computed hash stored in DB', () => {
    it('db.getDocument returns the exact client-provided SHA-256 hash', async () => {
      const fixture = await makeEncryptedFixture('hashcheck');
      const res = await createEncryptedAndTrack(fixture);

      const dbRow = await db.getDocument(res.hash);
      assert.ok(dbRow, 'document row must exist in DB');
      assert.equal(dbRow.hash, fixture.hash, 'DB hash must match client-provided hash');
      assert.match(dbRow.hash, /^[a-f0-9]{64}$/, 'hash must be 64-char lowercase hex');
    });
  });

  // =========================================================================
  // 8. Slug lookup: /d/:slug resolves to the correct document
  // =========================================================================
  describe('ZK 8: Slug lookup resolves correctly', () => {
    it('db.getDocumentBySlug returns the correct document', async () => {
      const fixture = await makeEncryptedFixture('sluglookup');
      const res = await createEncryptedAndTrack(fixture);

      const bySlug = await db.getDocumentBySlug(res.slug);
      assert.ok(bySlug, 'getDocumentBySlug must find the document');
      assert.equal(bySlug.hash, res.hash, 'slug-resolved doc hash must match');
      assert.equal(bySlug.slug, res.slug, 'slug must match');
    });

    it('db.getPvfContentBySlug returns the PVF HTML', async () => {
      const fixture = await makeEncryptedFixture('slugcontent');
      const res = await createEncryptedAndTrack(fixture);

      const pvfContent = await db.getPvfContentBySlug(res.slug);
      assert.ok(pvfContent, 'getPvfContentBySlug must return content');
      assert.ok(pvfContent.includes('<!--PVF:2.0-->'), 'slug-resolved PVF content must be v2.0');
    });
  });

  // =========================================================================
  // 9. ShareId fallback: /d/:shareId still works for the same document
  // =========================================================================
  describe('ZK 9: ShareId fallback for encrypted documents', () => {
    it('db.getDocument by hash still returns shareId alongside slug', async () => {
      const fixture = await makeEncryptedFixture('shareidfallback');
      const res = await createEncryptedAndTrack(fixture);

      const doc = await db.getDocument(res.hash);
      assert.ok(doc, 'document must exist');
      assert.equal(doc.shareId, res.shareId, 'shareId must be present on encrypted docs');
      assert.equal(doc.slug, res.slug, 'slug must be present on encrypted docs');
      // Both identifiers resolve to the same document
      assert.ok(doc.shareId, 'shareId must not be empty');
      assert.ok(doc.slug, 'slug must not be empty');
    });

    it('db.getPvfContent by shareId returns the same content as by slug', async () => {
      const fixture = await makeEncryptedFixture('fallbackcontent');
      const res = await createEncryptedAndTrack(fixture);

      const byShareId = await db.getPvfContent(res.shareId);
      const bySlug = await db.getPvfContentBySlug(res.slug);
      assert.ok(byShareId, 'PVF content must be retrievable by shareId');
      assert.ok(bySlug, 'PVF content must be retrievable by slug');
      assert.equal(byShareId, bySlug, 'both lookups must return identical PVF content');
    });
  });

  // =========================================================================
  // 10. Database columns: encrypted=true, iv NOT null, pvf_version='2.0'
  // =========================================================================
  describe('ZK 10: Database columns for encrypted documents', () => {
    it('document row has encrypted=true, non-null iv, pvf_version=2.0', async () => {
      const fixture = await makeEncryptedFixture('dbcols');
      const res = await createEncryptedAndTrack(fixture);

      const doc = await db.getDocument(res.hash);
      assert.ok(doc, 'document row must exist');
      assert.equal(doc.encrypted, true, 'encrypted column must be true');
      assert.ok(doc.iv !== null && doc.iv !== undefined, 'iv column must not be null');
      assert.equal(typeof doc.iv, 'string', 'iv must be a string');
      assert.equal(doc.pvf_version, '2.0', 'pvf_version must be "2.0"');
    });

    it('IV stored in DB decodes to exactly 12 bytes', async () => {
      const fixture = await makeEncryptedFixture('ivlength');
      const res = await createEncryptedAndTrack(fixture);

      const doc = await db.getDocument(res.hash);
      const ivBytes = Buffer.from(doc.iv, 'base64');
      assert.equal(ivBytes.length, 12, 'IV must decode to exactly 12 bytes (96-bit AES-GCM IV)');
    });
  });

  // =========================================================================
  // 11. Backward compat: createPvf (v1.0) still works, encrypted=false
  // =========================================================================
  describe('ZK 11: Backward compatibility with v1.0 createPvf', () => {
    it('createPvf returns success with encrypted absent and pvf_version 1.0 in DB', async () => {
      const res = await createV1AndTrack('compat');

      assert.ok(res, 'createPvf must return a result');
      assert.equal(res.success, true, 'v1.0 creation must succeed');
      // v1.0 result does NOT have encrypted flag
      assert.ok(res.encrypted === undefined || res.encrypted === false,
        'v1.0 result must not have encrypted=true');

      const doc = await db.getDocument(res.hash);
      assert.ok(doc, 'v1.0 document row must exist');
      assert.equal(doc.encrypted, false, 'v1.0 doc must have encrypted=false');
      assert.equal(doc.iv, null, 'v1.0 doc must have null iv');
      assert.equal(doc.pvf_version, '1.0', 'v1.0 doc must have pvf_version=1.0');
      assert.equal(doc.slug, null, 'v1.0 doc must have null slug');
    });

    it('v1.0 PVF contains <!--PVF:1.0--> and does NOT contain pvf:encrypted', async () => {
      const res = await createV1AndTrack('compathtml');
      const pvf = res.pvfHtml;

      assert.ok(pvf.includes('<!--PVF:1.0-->'), 'v1.0 PVF must have <!--PVF:1.0--> version comment');
      assert.ok(
        !pvf.includes('<meta name="pvf:encrypted"'),
        'v1.0 PVF must NOT contain pvf:encrypted meta tag'
      );
      assert.ok(
        pvf.includes('<meta name="pvf:version" content="1.0">'),
        'v1.0 PVF must have version meta 1.0'
      );
    });
  });

  // =========================================================================
  // 12. codeIntegrity: encrypted payload tags excluded from hash
  //     (data-vf-bundle check)
  // =========================================================================
  describe('ZK 12: codeIntegrity excludes data-vf-bundle scripts', () => {
    it('encrypted payload scripts have data-vf-bundle attribute (excluded from integrity)', async () => {
      const fixture = await makeEncryptedFixture('integrity');
      const res = await createEncryptedAndTrack(fixture);
      const pvf = res.pvfHtml;

      // The encryptedDoc and encryptionMeta scripts MUST have data-vf-bundle
      // so they are excluded from the code integrity hash (matching the
      // client-side selector: script:not([data-vf-bundle]))
      const encDocMatch = pvf.match(/<script[^>]*id="encryptedDoc"[^>]*>/);
      assert.ok(encDocMatch, 'encryptedDoc script tag must exist');
      assert.ok(
        encDocMatch[0].includes('data-vf-bundle'),
        'encryptedDoc must have data-vf-bundle attribute to be excluded from integrity hash'
      );

      const encMetaMatch = pvf.match(/<script[^>]*id="encryptionMeta"[^>]*>/);
      assert.ok(encMetaMatch, 'encryptionMeta script tag must exist');
      assert.ok(
        encMetaMatch[0].includes('data-vf-bundle'),
        'encryptionMeta must have data-vf-bundle attribute to be excluded from integrity hash'
      );
    });

    it('server-side codeIntegrity matches hash of main <script> only (excludes bundles)', async () => {
      const fixture = await makeEncryptedFixture('integritycompute');
      const res = await createEncryptedAndTrack(fixture);
      const pvf = res.pvfHtml;

      // The server computes codeIntegrity by matching /<script>(content)<\/script>/
      // which matches ONLY the plain <script> tag (no attributes). Scripts with
      // id="encryptedDoc" or data-vf-bundle are excluded by this regex.
      const scriptMatch = pvf.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(scriptMatch, 'PVF must contain a plain <script> block (main code)');

      const expectedHash = crypto.createHash('sha256').update(scriptMatch[1]).digest('hex');
      assert.equal(
        res.codeIntegrity,
        expectedHash,
        'pipeline codeIntegrity must match SHA-256 of only the main <script> content'
      );
    });

    it('the client-side computeCodeIntegrity selector excludes data-vf-bundle scripts', () => {
      // Static canary: verify templates/pvf.js contains the exclusion selector
      const fs = require('fs');
      const templatePath = path.resolve(__dirname, '..', 'templates', 'pvf.js');
      const src = fs.readFileSync(templatePath, 'utf8');

      assert.ok(
        src.includes(':not([data-vf-bundle])'),
        'templates/pvf.js computeCodeIntegrity must exclude [data-vf-bundle] scripts'
      );
    });
  });

} // end if (HAS_DB)
