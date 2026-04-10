# Vertifile Zero-Knowledge Architecture Specification

**Author:** Avi (Architect/Lead)
**Date:** 2026-04-10
**Status:** APPROVED FOR IMPLEMENTATION
**Implementor:** Moshe (Backend)
**Timeline:** 2-3 weeks
**PVF Version:** 2.0

---

## 1. Overview

Vertifile zero-knowledge means the server is architecturally incapable of reading
document content. The client encrypts documents with AES-256-GCM before upload;
the encryption key never leaves the browser and never touches the server. The
server receives only an encrypted blob, a SHA-256 hash of the original content
(computed client-side), and an initialization vector. It signs the hash using the
existing HMAC + Ed25519 dual-signing chain, generates a PVF HTML wrapper around
the encrypted payload, and stores it. The AES key travels exclusively in the URL
fragment (`#key=...`), which per HTTP specification is never transmitted to the
server. A server compromise yields encrypted blobs, hashes, and signatures --
zero plaintext documents.

**The server CAN see:** encrypted blob, SHA-256 hash, IV, MIME type, filename,
file size, signatures, org metadata, timestamps.

**The server CANNOT see:** original document content, AES decryption key.

---

## 2. Cryptographic Primitives

All cryptography runs in the browser via the Web Crypto API. No external
libraries are introduced.

| Primitive | Algorithm | Parameters | Purpose |
|---|---|---|---|
| Document encryption | AES-256-GCM | 256-bit key, 96-bit IV | Encrypt document content client-side |
| Key generation | `crypto.getRandomValues` | `new Uint8Array(32)` -- 256 bits | One random AES key per document |
| IV generation | `crypto.getRandomValues` | `new Uint8Array(12)` -- 96 bits (GCM standard) | Unique IV per encryption operation |
| Document hash | SHA-256 | Full original content | Integrity fingerprint (computed BEFORE encryption) |
| HMAC signature | HMAC-SHA256 | Server-side HMAC_SECRET | Signs the hash (unchanged from v1) |
| Asymmetric signature | Ed25519 | Server-side keypair | Signs the hash (unchanged from Phase 2B+) |

**Key encoding for URL fragment:**
```
Raw 32 bytes -> base64url encode -> URL fragment
```
Base64url (RFC 4648 Section 5) is used instead of standard base64 to avoid `+`,
`/`, and `=` characters that cause issues in URL fragments.

**GCM authentication tag:** AES-256-GCM produces a 128-bit authentication tag
appended to the ciphertext by Web Crypto. This tag is included in the encrypted
blob automatically -- no separate handling needed. If the ciphertext or IV is
tampered with, `crypto.subtle.decrypt` throws `OperationError`.

---

## 3. Upload Flow (Client -> Server)

### Step-by-step sequence (app.html upload handler):

```
1.  User selects file in browser (drag-drop or file picker)
2.  Browser reads file as ArrayBuffer via FileReader.readAsArrayBuffer()
3.  Browser generates random AES-256 key:
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
      );
4.  Browser generates random 96-bit IV:
      const iv = crypto.getRandomValues(new Uint8Array(12));
5.  Browser computes SHA-256 hash of the ORIGINAL (unencrypted) content:
      const hashBuffer = await crypto.subtle.digest('SHA-256', originalArrayBuffer);
      const hash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
6.  Browser encrypts content with AES-256-GCM:
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, originalArrayBuffer
      );
7.  Browser exports AES key as raw bytes, then base64url-encodes:
      const rawKey = await crypto.subtle.exportKey('raw', key);
      const keyBase64url = base64urlEncode(new Uint8Array(rawKey));
8.  Browser sends to server via multipart POST /api/user/upload-encrypted:
      - encryptedBlob (binary)    // the ciphertext + GCM auth tag
      - hash          (hex, 64 chars)
      - iv            (base64 string)
      - mimeType      (string)
      - originalName  (string)
9.  Server DOES NOT receive: the AES key, the original content.
10. Server generates slug from originalName (see Section 5).
11. Server signs the hash:
      - HMAC-SHA256 (same signHash() as today)
      - Ed25519 via signing.signEd25519() (same Phase 2B+ flow)
      Hash source is now the CLIENT-provided hash, not server-computed.
12. Server generates PVF 2.0 HTML (see Section 6):
      - Embeds encrypted blob as base64
      - Embeds IV, hash, signatures, viewer code
      - Injects PDF.js bundle if mimeType is application/pdf
      - Obfuscates viewer script
      - Computes codeIntegrity
13. Server stores PVF in database (pvf_content column).
14. Server returns: { shareId, slug, shareUrl: '/d/{slug}' }
15. Client constructs full URL:
      https://vertifile.com/d/{slug}#key={keyBase64url}
16. Client displays the full URL to the user for copying/sharing.
```

### What the server receives vs. what it does NOT:

| Received | NOT Received |
|---|---|
| Encrypted blob (ciphertext + GCM tag) | Original document content |
| SHA-256 hash (of original, client-computed) | AES-256 key |
| IV (base64) | Decrypted content at any point |
| MIME type | |
| Original filename | |

---

## 4. Viewer Flow (Recipient Opens PVF)

### Step-by-step sequence (PVF viewer script):

```
1.  Recipient clicks URL: vertifile.com/d/patent-claims#key={base64url_aes_key}
2.  Server receives GET /d/patent-claims (fragment NOT sent to server).
    Server looks up document by slug, serves PVF 2.0 HTML.
3.  Browser loads HTML. Viewer JS runs:
4.  Extract key from fragment:
      const fragment = window.location.hash;
      const keyParam = fragment.split('key=')[1];
      if (!keyParam) { showError('DECRYPTION_KEY_MISSING'); return; }
5.  URL Masking -- remove fragment from address bar and history:
      history.replaceState(null, '', location.pathname);
    Address bar now shows: vertifile.com/d/patent-claims
6.  Decode the base64url key and import as CryptoKey:
      const keyBytes = base64urlDecode(keyParam);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
      );
7.  Read encrypted blob from embedded <script> tag:
      const encB64 = document.getElementById('encryptedDoc').textContent;
      const encBytes = Uint8Array.from(atob(encB64), c => c.charCodeAt(0));
8.  Read encryption metadata:
      const meta = JSON.parse(
        document.getElementById('encryptionMeta').textContent
      );
      const iv = Uint8Array.from(atob(meta.iv), c => c.charCodeAt(0));
9.  Decrypt:
      let decrypted;
      try {
        decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv }, cryptoKey, encBytes
        );
      } catch (e) {
        showError('DECRYPTION_FAILED'); // Wrong key or tampered ciphertext
        return;
      }
10. Verify integrity -- compute SHA-256 of decrypted content:
      const verifyHash = await computeSha256Hex(decrypted);
      if (verifyHash !== HASH) {
        showError('INTEGRITY_MISMATCH'); // Content was tampered
        return;
      }
11. Determine file type from embedded mimeType metadata.
12. Render content:
      - PDF:   pass decrypted ArrayBuffer to PDF.js (renderPdfInline)
      - Image: create blob URL, display as <img>
      - Text:  decode UTF-8, display in text-doc container
13. Stamp animation plays (existing coin-drop flow, unchanged).
14. POST /api/verify with hash + signatures (same as today).
    No content is sent -- only hash + signature data for verification.
```

### Error states:

| Condition | User sees |
|---|---|
| No `#key=` in URL | "Decryption key not found. Use the original shared link." |
| Wrong key (GCM auth fails) | "Decryption failed. The link may be incorrect or corrupted." |
| Hash mismatch after decrypt | "Document integrity check failed. Content may be tampered." |
| Network error on verify | Verification UI shows offline/retry state (existing behavior) |

---

## 5. URL Slug Mechanism

### Slug generation algorithm:

```javascript
function generateSlug(originalName) {
  // Remove file extension
  let slug = originalName.replace(/\.[^.]+$/, '');
  // Normalize unicode
  slug = slug.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  // Lowercase
  slug = slug.toLowerCase();
  // Replace non-alphanumeric with hyphens
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  // Collapse consecutive hyphens
  slug = slug.replace(/-+/g, '-');
  // Trim leading/trailing hyphens
  slug = slug.replace(/^-|-$/g, '');
  // Truncate to 64 chars
  slug = slug.substring(0, 64);
  // Fallback for empty result
  if (!slug) slug = 'document';
  return slug;
}
```

### Collision handling:

If `slug` already exists in the database, append a 4-character random suffix:
`patent-claims-final` -> `patent-claims-final-x7k2`

The suffix is generated from `crypto.randomBytes(2).toString('hex')` (4 hex
chars). Retry up to 3 times on collision. On 4th collision, fall back to
shareId as the slug.

### Database:

```sql
ALTER TABLE documents ADD COLUMN slug TEXT UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_slug ON documents(slug) WHERE slug IS NOT NULL;
```

### Route resolution (GET /d/:identifier):

```
1. Try lookup by slug:  SELECT ... FROM documents WHERE slug = $1
2. If no match, try lookup by share_id: SELECT ... FROM documents WHERE share_id = $1
3. If no match, return 404
```

This preserves backward compatibility -- all existing `/d/{shareId}` URLs
continue to work. New documents get both a slug and a shareId.

---

## 6. PVF HTML Structure (Version 2.0)

```html
<!--PVF:2.0-->
<!DOCTYPE html>
<html lang="en" dir="ltr" class="no-js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="pvf:version" content="2.0">
<meta name="pvf:hash" content="{sha256_of_original}">
<meta name="pvf:signature" content="{hmac_signature}">
<meta name="pvf:created" content="{iso_timestamp}">
<meta name="pvf:share-id" content="{share_id}">
<meta name="pvf:encrypted" content="true">
<meta name="pvf:original-name" content="{safe_original_name}">
<meta name="pvf:mime-type" content="{mime_type}">
<!-- NO meta tag for the AES key -- it NEVER appears in the HTML -->
<title>PVF -- {safe_original_name}</title>
<style>
  /* ... existing Vertifile viewer CSS (unchanged from v1.0) ... */
</style>
<!-- PDF.js bundle (injected if mimeType is application/pdf) -->
<script id="pdfjs-main" type="module" data-vf-bundle="pdfjs-main">...</script>
<script id="pdfjs-worker" type="text/plain" data-vf-bundle="pdfjs-worker">...</script>
</head>
<body>
  <!-- Vertifile viewer UI: toolbar, document container, stamp, waves -->
  <!-- (same structure as v1.0 -- CSS classes, SVG icons, all unchanged) -->

  <!-- === ENCRYPTED DOCUMENT PAYLOAD === -->
  <script type="application/octet-stream" id="encryptedDoc" data-vf-bundle="encrypted-doc">
    {base64_encoded_encrypted_blob}
  </script>
  <script type="application/json" id="encryptionMeta" data-vf-bundle="encryption-meta">
    {"iv":"{base64_iv}","mimeType":"{original_mime}","fileName":"{original_name}"}
  </script>

  <!-- === VIEWER SCRIPT (obfuscated) === -->
  <script>
    var HASH = "{sha256_hash}";
    var SIG = "{hmac_signature}";
    var SIG_ED = "{ed25519_signature}";
    var KEY_ID = "{ed25519_key_id}";
    var CREATED = "{iso_timestamp}";
    var ORGID = "{org_id}";
    var SHAREID = "{share_id}";
    var ENCRYPTED = true;

    // ... decryption logic (extract key from fragment, decrypt, verify hash)
    // ... existing viewer code (render, verify, stamp, environment detection)
  </script>
</body>
</html>
```

### Key differences from PVF 1.0:

| Aspect | PVF 1.0 | PVF 2.0 |
|---|---|---|
| Version comment | `<!--PVF:1.0-->` | `<!--PVF:2.0-->` |
| pvf:version meta | `1.0` | `2.0` |
| pvf:encrypted meta | absent | `true` |
| Document payload | `<div id="doc-content">` with plaintext/base64 | `<script id="encryptedDoc">` with encrypted base64 |
| Encryption metadata | absent | `<script id="encryptionMeta">` with IV + mimeType |
| `var ENCRYPTED` | absent | `true` |
| Viewer script | Renders content directly | Decrypts first, then renders |

### Version detection in viewer:

The viewer script checks `typeof ENCRYPTED !== 'undefined' && ENCRYPTED === true`
to branch between v1.0 (direct render) and v2.0 (decrypt-then-render). This
allows a single viewer codebase to handle both versions.

---

## 7. Server Pipeline Changes (services/pvf-pipeline.js)

### New function signature:

```javascript
// BEFORE (v1.0):
async function createPvf({ buffer, originalName, mimeType, owner, ... })

// AFTER (v2.0 -- new endpoint):
async function createPvfEncrypted({
  encryptedBlob,    // Buffer -- ciphertext + GCM auth tag
  hash,             // string -- hex SHA-256 of original content (client-computed)
  iv,               // string -- base64 encoded 96-bit IV
  mimeType,         // string -- original MIME type
  originalName,     // string -- original filename
  owner,            // object -- same shape as v1.0
  recipient,        // string|null
  branding,         // object|null
  apiKey,           // string|null
  req               // Express request|null
})
```

### Pipeline changes (numbered steps reference the module header):

```
Step 1:  INPUT VALIDATION
         - Validate encryptedBlob is a Buffer, non-empty
         - Validate hash is 64-char hex string: /^[a-f0-9]{64}$/
         - Validate iv is valid base64, decodes to exactly 12 bytes
         - Validate mimeType against ALLOWED_MIME_TYPES
         - Validate owner (same as v1.0)

Step 2:  DERIVE orgId (unchanged)

Step 3:  HASH -- SKIP server-side hashing. Use client-provided hash.
         const fileHash = hash;  // Trust the client hash

Step 4:  HMAC SIGNATURE -- signs client-provided hash (unchanged logic)
         const signature = signHash(fileHash);

Step 5:  SESSION TOKEN + TIMESTAMP (unchanged)

Step 6:  RECIPIENT BINDING (unchanged)

Step 6b: ED25519 DUAL-SIGNATURE (unchanged -- signs the hash)

Step 6c: PHASE 2E ENFORCEMENT (unchanged)

Step 7:  ENCODE FILE -- SKIP text/binary branching.
         The encrypted blob is always base64-encoded:
         const fileBase64 = encryptedBlob.toString('base64');

Step 8:  FETCH BRANDING (unchanged)

Step 9:  GENERATE shareId + slug (NEW: slug generation added here)
         const shareId = crypto.randomBytes(8).toString('base64url');
         const slug = await generateUniqueSlug(originalName, db);

Step 10: GENERATE PVF 2.0 HTML
         Call generatePvfHtmlV2() with encrypted payload, IV, hash,
         signatures, mimeType, originalName, viewer code.

Step 11-13: DB OPERATIONS (unchanged, but add slug to createDocument)

Step 14: INJECT PDF.JS BUNDLE (unchanged -- still conditional on mimeType)

Step 15: OBFUSCATE (unchanged)

Step 16: CODE INTEGRITY (unchanged)

Step 17: CHAIN TOKEN (unchanged)

Step 18: PERSIST (unchanged, plus save slug)
         Additional: await db.setSlug(fileHash, slug);

Step 19: SAVE PVF CONTENT (unchanged)

Step 20: PREVIEW-ONLY GATING (unchanged)

Step 21: BLOCKCHAIN (unchanged)

Step 22: RETURN -- add slug to result:
         return { success: true, shareId, slug, hash, ... }
```

### Critical invariant:

The server NEVER calls `hashBytes(buffer)` on the encrypted blob. The hash
originates from the client. The server cannot verify the hash against content
(it only has the encrypted blob) -- this is the core zero-knowledge property.
The hash is still signed by HMAC + Ed25519, binding it to the org and timestamp.

### The v1.0 createPvf() stays:

The existing `createPvf()` function is NOT modified. It continues to accept
plaintext buffers for backward compatibility (legacy API callers, potential
migration tooling). The new `createPvfEncrypted()` is a separate function.

---

## 8. Database Schema Changes

### Migration SQL (migrations/002_zero_knowledge.sql):

```sql
-- Zero-Knowledge Architecture -- PVF 2.0
-- Safe to re-run: all statements use IF NOT EXISTS or are idempotent.

-- Slug column for human-readable URLs
ALTER TABLE documents ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_slug
  ON documents(slug) WHERE slug IS NOT NULL;

-- Encryption flag (false for v1.0 docs, true for v2.0 docs)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT false;

-- Initialization vector (base64 string, null for v1.0 docs)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS iv TEXT;

-- PVF version tag for query filtering
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pvf_version TEXT DEFAULT '1.0';
```

### Column semantics:

| Column | Type | v1.0 docs | v2.0 docs |
|---|---|---|---|
| `slug` | TEXT UNIQUE | null (backfill optional) | generated from filename |
| `encrypted` | BOOLEAN | false | true |
| `iv` | TEXT | null | base64 of 12-byte IV |
| `pvf_version` | TEXT | '1.0' | '2.0' |
| `pvf_content` | TEXT | full HTML with plaintext content | full HTML with encrypted blob |

### What does NOT change:

- `hash` column: still SHA-256 hex of the original content (source changes
  from server-computed to client-provided, but the value is identical)
- `signature` column: still HMAC of the hash
- `share_id` column: still the random shareId
- `ed25519_signature`, `ed25519_key_id`: unchanged

---

## 9. API Changes

### NEW: POST /api/user/upload-encrypted

**Purpose:** Accept client-side encrypted document for PVF 2.0 creation.

**Authentication:** User session (requireLogin middleware) or API key.

**Request:** multipart/form-data

| Field | Type | Required | Validation |
|---|---|---|---|
| `encryptedBlob` | binary (file) | yes | Non-empty, max 50MB |
| `hash` | string | yes | 64-char lowercase hex (`/^[a-f0-9]{64}$/`) |
| `iv` | string | yes | Valid base64, decodes to exactly 12 bytes |
| `mimeType` | string | yes | Must be in ALLOWED_MIME_TYPES |
| `originalName` | string | yes | Non-empty, max 255 chars |

**Response (success):**
```json
{
  "success": true,
  "shareId": "aB3x_kLm",
  "slug": "patent-claims-final",
  "shareUrl": "/d/patent-claims-final",
  "hash": "a1b2c3...",
  "fileName": "patent-claims-final.pvf",
  "documentsUsed": 4,
  "documentsLimit": 50
}
```

**Response (preview -- free plan):**
```json
{
  "success": true,
  "preview": true,
  "previewUrl": "/d/patent-claims-final",
  "shareId": "aB3x_kLm",
  "slug": "patent-claims-final",
  "hash": "a1b2c3...",
  "fileName": "patent-claims-final.pvf",
  "message": "Document protected! Subscribe to download.",
  "upgradeUrl": "/pricing",
  "documentsUsed": 1,
  "documentsLimit": 1
}
```

**Error responses:** Same HTTP status codes and error shapes as existing
`POST /api/user/upload`.

### MODIFIED: GET /d/:identifier

The existing route handler is updated to resolve by slug OR shareId:

```javascript
router.get('/d/:identifier', async (req, res) => {
  const { identifier } = req.params;
  // Validation: allow slugs (lowercase, hyphens, digits) and shareIds (base64url)
  if (!identifier || identifier.length < 1 || identifier.length > 80 ||
      !/^[a-zA-Z0-9_-]+$/.test(identifier)) {
    return res.status(404).send(notFoundPage('Invalid document link'));
  }
  // Try slug first (new v2.0 docs), fall back to shareId (v1.0 compat)
  let doc = await db.getDocumentBySlug(identifier);
  if (!doc) {
    doc = await db.getDocumentByShareId(identifier);
  }
  if (!doc) {
    return res.status(404).send(notFoundPage('Document not found'));
  }
  // ... rest of handler unchanged
});
```

### DEPRECATED (soft): POST /api/user/upload

The existing plaintext upload endpoint stays for backward compatibility. It
continues to create v1.0 PVFs. It is NOT removed or modified. Future API
documentation will mark it as deprecated in favor of `/upload-encrypted`.

### UNCHANGED:

- `POST /api/verify` -- validates hash + signatures, no content involved
- `POST /api/verify-public` -- same
- `GET /.well-known/jwks.json` -- same
- `POST /api/create` -- legacy API endpoint (stays as v1.0)

---

## 10. What Stays The Same

These components are architecturally unchanged by zero-knowledge:

- **Ed25519 + HMAC dual signing** -- signs the hash; hash now comes from client
  instead of server computation, but the signing logic is identical
- **Key rotation (Phase 3A/3B)** -- keys sign hashes, not content; unchanged
- **codeIntegrity hash chain** -- hashes the obfuscated viewer script, not the
  document content; unchanged
- **`/api/verify` and `/api/verify-public`** -- validate hash + signatures with
  no content involved; unchanged
- **JWKS endpoint** -- serves Ed25519 public keys; unchanged
- **PDF.js inline rendering** -- receives decrypted bytes from viewer script
  instead of plaintext bytes from HTML; rendering logic is identical
- **Thumbnails sidebar** -- generated client-side from rendered content; unchanged
- **Stamp animation (coin-drop)** -- purely visual Layer 2; unchanged
- **Environment detection** -- checks for DevTools, screen capture, iframes;
  unchanged
- **Obfuscation** -- obfuscates the viewer script; unchanged
- **Stamp config injection (Layer 2)** -- injects at view time; unchanged
- **Rate limiting, auth middleware, session management** -- unchanged

---

## 11. What Does NOT Work Offline Anymore

### Fragment dependency:

Without the `#key=...` fragment in the URL, the encrypted document CANNOT be
decrypted. This creates the following behavior changes:

| Scenario | v1.0 Behavior | v2.0 Behavior |
|---|---|---|
| Open PVF from URL with fragment | N/A | Document decrypts and displays |
| Open PVF from URL without fragment | Document displays | Error: "Decryption key not found" |
| Save PVF HTML to disk, open locally | Document displays | Error: "Decryption key not found" |
| Refresh page after URL masking | Document displays | Error: "Decryption key not found" |
| Share cleaned URL (no fragment) | Document displays | Error: "Decryption key not found" |

### Refresh behavior (important UX consideration):

After URL masking removes the fragment, refreshing the page loses the key. The
viewer script detects this state and shows:

> "This document requires its original shared link to display.
> The decryption key was removed from the URL for security.
> Please use the original link that was shared with you."

### Mitigation for accidental refresh:

The viewer script stores the key in `sessionStorage` (keyed by the document
slug) after initial extraction. On page load:

```
1. Check window.location.hash for key
2. If found: use it, store in sessionStorage, mask URL
3. If not found: check sessionStorage for this slug
4. If in sessionStorage: use it (covers refresh case)
5. If nowhere: show "key not found" error
```

SessionStorage clears when the tab closes, so the key does not persist beyond
the browsing session. This is an acceptable trade-off: the key lives in browser
memory during the session regardless (it must, to decrypt), so sessionStorage
adds no new attack surface.

---

## 12. Security Analysis

### Threat model:

| Threat | Mitigation | Residual risk |
|---|---|---|
| **Server DB compromise** | Attacker gets encrypted blobs + hashes + signatures. Cannot decrypt any document. Zero-knowledge holds. | None -- this is the design goal. |
| **Server memory dump** | Server process never handles the AES key. Encrypted blob passes through as opaque bytes. | None for keys. Blob is briefly in memory during PVF generation. |
| **Man-in-the-middle (TLS)** | TLS protects upload transport. Key is in URL fragment (never sent to server, never in HTTP request). Even if TLS is broken, attacker gets encrypted blob without key. | If both TLS AND browser are compromised, game over (same as any E2E system). |
| **Browser compromise** | If the recipient's browser is compromised (malware, extension), attacker sees decrypted content in DOM. | Fundamental limit of any E2E encryption -- the endpoint is always vulnerable. |
| **Replay attack** | Hash + signatures are tied to timestamp + orgId. Replaying a signed hash does not grant access to content (no key). | No change from v1.0. |
| **Hash forgery** | Ed25519 signature prevents hash forgery. Attacker cannot produce a valid signature without the private key. | No change from v1.0. |
| **Brute-force key** | AES-256: 2^256 key space. Infeasible with current or foreseeable technology. | Effectively zero. |
| **IV reuse** | Each document gets a fresh random 96-bit IV. Collision probability for 2^48 documents is ~2^-48. | Negligible. |
| **URL fragment leak (browser history)** | `history.replaceState` removes fragment immediately after extraction. Fragment does not appear in browser history. | Referrer header: fragment is excluded per HTTP spec. Browser extensions: if malicious, all bets are off. |
| **Session storage leak** | sessionStorage is origin-scoped and tab-scoped. Clears on tab close. XSS on vertifile.com could read it -- but XSS on vertifile.com could also read the decrypted DOM. | CSP + obfuscation mitigate XSS. Not a new attack surface. |

### What zero-knowledge does NOT protect against:

- Malicious browser extensions with `<all_urls>` permission
- Physical access to the recipient's unlocked device
- Screen recording/screenshot during viewing
- Social engineering (user shares the URL with the key)
- Compromised client-side JavaScript (supply chain attack on vertifile.com)

These are fundamental limits of browser-based E2E encryption, shared by Signal
Web, ProtonMail, Bitwarden Web Vault, and every similar system.

---

## 13. Migration Plan

### Zero-migration strategy:

- **New PVFs** (created after deployment): zero-knowledge, PVF version 2.0
- **Old PVFs** (created before deployment): still work, still plaintext, still
  verified. No migration needed. No re-encryption.
- **The viewer detects version** from `pvf:encrypted` meta tag (or the
  `ENCRYPTED` JS variable) and branches:
  - `ENCRYPTED === true` -> decrypt-then-render (v2.0 path)
  - `ENCRYPTED` absent or false -> render directly (v1.0 path)
- **Old share URLs** (`/d/{shareId}`) still work via fallback lookup.
- **Database**: new columns default to v1.0 values (`encrypted=false`,
  `slug=null`, `iv=null`, `pvf_version='1.0'`). No backfill required.

### Feature flag:

The new encrypted upload endpoint is always available. The client-side code in
`app.html` controls which path is used. Feature flag `ZK_UPLOAD=1` (default ON
after deployment) switches the upload flow from plaintext to encrypted.
Setting `ZK_UPLOAD=0` reverts to v1.0 plaintext uploads for emergency rollback.

---

## 14. Implementation Phases (2-3 weeks)

### Week 1: Core Encryption (Days 1-5)

**Day 1-2: Client-side encryption in app.html**
- Add `encryptDocument()` function: generates key + IV, computes hash, encrypts
- Add `base64urlEncode()` / `base64urlDecode()` helpers
- Wire upload handler to call `encryptDocument()` before XHR
- Build encrypted FormData with encryptedBlob, hash, iv, mimeType, originalName
- Display share URL with `#key=...` fragment after successful upload
- Add copy-to-clipboard for the full URL

**Day 2-3: Server pipeline -- createPvfEncrypted()**
- New function in `services/pvf-pipeline.js`
- Input validation for encrypted fields (hash format, iv length, blob non-empty)
- Skip `hashBytes()` -- use client-provided hash
- Encode encrypted blob as base64 for HTML embedding
- All signing, integrity, blockchain, audit steps reused from createPvf()

**Day 3-4: PVF 2.0 HTML template**
- New `generatePvfHtmlV2()` in `templates/pvf.js`
- Encrypted payload in `<script type="application/octet-stream" id="encryptedDoc">`
- Encryption metadata in `<script type="application/json" id="encryptionMeta">`
- `var ENCRYPTED = true;` in viewer script
- Version comment `<!--PVF:2.0-->`

**Day 4-5: Viewer decryption**
- Extract key from `window.location.hash` on load
- Import key via `crypto.subtle.importKey('raw', ...)`
- Decrypt via `crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, blob)`
- Compute SHA-256 of decrypted content, compare with embedded HASH
- Branch rendering: PDF.js / img / text based on mimeType
- Error handling: no key, wrong key, hash mismatch

### Week 2: Integration + URL System (Days 6-10)

**Day 6-7: URL slug mechanism**
- `generateSlug()` function in `services/pvf-pipeline.js`
- `generateUniqueSlug()` with collision detection + random suffix
- DB migration: `slug`, `encrypted`, `iv`, `pvf_version` columns
- New `db.getDocumentBySlug()` function
- New `db.setSlug()` function

**Day 7-8: Route updates + URL masking**
- Modify `GET /d/:identifier` to try slug, then shareId
- `history.replaceState(null, '', location.pathname)` after key extraction
- sessionStorage fallback for refresh resilience
- New `POST /api/user/upload-encrypted` endpoint in `routes/user.js`

**Day 8-9: PDF.js integration with decrypted content**
- Ensure `renderPdfInline()` accepts ArrayBuffer from decryption
- Test PDF rendering with decrypted bytes (not base64 string)
- Verify thumbnails sidebar works with decrypted PDF pages

**Day 9-10: Print, download, share with decrypted content**
- Print: decrypted content is already in DOM -- print works as-is
- Download button: offers the PVF file (encrypted content inside)
- Share button: copies the ORIGINAL URL with `#key=...` fragment
  (must store the fragment before masking, or reconstruct from sessionStorage)

### Week 3: Hardening + QA (Days 11-14)

**Day 11-12: Error handling**
- No key in URL: clear error message with instructions
- Wrong key (GCM auth tag failure): "Decryption failed" message
- Corrupt or truncated blob: graceful degradation
- Browser without Web Crypto (very old browsers): feature detection message
- Mixed v1/v2 edge cases: viewer correctly branches on version

**Day 12-13: Testing**
- Unit tests: encryptDocument(), generateSlug(), createPvfEncrypted()
- Integration tests: upload encrypted -> serve PVF -> decrypt -> verify
- E2E tests: full flow from file picker to document display
- Regression tests: v1.0 PVFs still render correctly
- Cross-browser: Chrome, Firefox, Safari, Edge

**Day 13-14: QA rounds with Ori**
- Security review: verify server DB contains no plaintext
- URL masking: confirm fragment removed from history
- Refresh behavior: sessionStorage fallback works
- Old PVF compatibility: no regressions
- Performance: encryption adds negligible time (<100ms for 10MB file)

**Day 14: Ship to production**
- Deploy with `ZK_UPLOAD=1` (feature flag)
- Monitor error rates for 24 hours
- Verify new uploads are v2.0 in database

---

## 15. Files to Modify

| File | Change | Estimated LOC |
|---|---|---|
| `public/app.html` | Upload flow: add client-side encryption, hash computation, key display, URL construction, copy-to-clipboard for full URL with fragment | +180 |
| `services/pvf-pipeline.js` | New `createPvfEncrypted()` function accepting encrypted blob + client hash; `generateUniqueSlug()` helper; skip content hashing | +140 |
| `templates/pvf.js` | New `generatePvfHtmlV2()` template with encrypted payload, decryption logic, URL masking, sessionStorage fallback, version branching, error states | +220 |
| `routes/pages.js` | Modify `/d/:identifier` to resolve slug then shareId; same handler for both, backward compatible | +25 |
| `routes/user.js` | New `POST /api/user/upload-encrypted` endpoint calling `createPvfEncrypted()` | +65 |
| `db.js` | Schema migration (slug, encrypted, iv, pvf_version columns); `getDocumentBySlug()`; `setSlug()` | +40 |
| `server.js` | Register new route (minimal) | +3 |
| `obfuscate.js` | Add `ENCRYPTED` to reservedNames array | +1 |
| `migrations/002_zero_knowledge.sql` | Formal migration file for schema changes | +15 |

**Total estimated LOC change: ~690 lines added, ~30 lines modified**

---

## 16. Verification Checklist

Before shipping, every item must pass:

### Core encryption flow:
- [ ] Upload a PDF -> receive URL with `#key=...` in the response
- [ ] Open URL in browser -> document decrypts and displays correctly
- [ ] PDF pages render, thumbnails work, zoom works
- [ ] Upload an image (PNG/JPEG) -> decrypts and displays
- [ ] Upload a text file -> decrypts and displays

### URL behavior:
- [ ] After page load, address bar shows `/d/{slug}` without fragment
- [ ] Refreshing the page still works (sessionStorage fallback)
- [ ] Closing tab and reopening with clean URL -> "key not found" error
- [ ] Share button copies URL WITH the `#key=...` fragment
- [ ] Slug is human-readable, derived from filename

### Security:
- [ ] Server DB: pvf_content contains encrypted blob, NOT plaintext
- [ ] Server DB: no column contains the AES key
- [ ] Open URL with wrong key -> "Decryption failed" error
- [ ] Tamper with encrypted blob in DB -> GCM auth fails on decrypt
- [ ] `/api/verify` returns `verified: true` for v2.0 docs (hash + sigs work)
- [ ] Network tab: no request contains the AES key or URL fragment

### Backward compatibility:
- [ ] Old PVFs (v1.0, pre-ZK) still display correctly
- [ ] Old share URLs (`/d/{shareId}`) still work
- [ ] `/api/verify` works for both v1.0 and v2.0 docs
- [ ] Print works for both versions
- [ ] Download provides PVF file for both versions

### Edge cases:
- [ ] Upload with duplicate filename -> slug gets random suffix
- [ ] Upload file with unicode filename -> slug is ASCII-normalized
- [ ] 50MB file -> encrypts and uploads within reasonable time (<30s)
- [ ] Browser without Web Crypto -> shows feature detection error
- [ ] Open v2.0 PVF saved to disk without fragment -> shows clear error

---

## Appendix A: base64url Implementation

```javascript
// RFC 4648 Section 5 -- URL-safe base64 without padding
function base64urlEncode(bytes) {
  const binStr = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binStr = atob(b64);
  return new Uint8Array(Array.from(binStr, c => c.charCodeAt(0)));
}
```

---

## Appendix B: Zur's Locked-In Decisions (Verbatim)

1. **Hash source:** CLIENT computes SHA-256 in browser, sends hash alongside
   encrypted blob. Server signs the hash without seeing original content.

2. **URL format:** `vertifile.com/d/{slug}#key={base64url_aes_key}`
   - Fragment never sent to server (HTTP spec)
   - URL masking via `history.replaceState` removes fragment after extraction
   - Sharing requires the original URL with fragment

3. **No key recovery in v1:** Lost the link = document unrecoverable from
   Vertifile. Uploader must re-upload. No escrow, no backup, no password reset.
