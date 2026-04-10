# Regression Report -- Zero-Knowledge Encryption (commit 482438a)

**Date:** 2026-04-10
**QA Engineer:** Nir (Regression QA)
**Scope:** Verify existing features are unbroken after ZK encryption (10 files changed, ~2540 lines added)

---

## Summary

| Metric        | Value   |
|---------------|---------|
| Total checks  | 7       |
| PASS          | 7       |
| FAIL          | 0       |
| CONCERNS      | 1 (minor) |

**Verdict: ALL CLEAR -- no regressions detected.**

---

## Check 1: Old PVFs (v1.0) -- decryptAndDisplay() guard

**File:** `templates/pvf.js` line 700
**Status:** PASS

The `decryptAndDisplay()` function has the correct early-return guard on line 701:

```js
if (typeof ENCRYPTED === 'undefined' || !ENCRYPTED) return false; // v1.0 PVF -- skip
```

This uses `typeof` (not a bare reference), which prevents `ReferenceError` when the `ENCRYPTED` variable is absent in v1.0 PVFs. The function returns `false`, and the caller at line 810 proceeds with standard verification flow:

```js
var isEncrypted = await decryptAndDisplay();
if (isEncrypted && !__zkKey) return; // No key -- error already shown, don't continue
```

For v1.0 PVFs, `isEncrypted` is `false`, so the pipeline continues as before unchanged.

---

## Check 2: Existing API endpoints

**File:** `routes/api.js`
**Status:** PASS

All three existing endpoints are present and structurally unmodified:
- `POST /verify` -- line 203, with full HMAC + Ed25519 verification chain
- `GET /verify-public` -- line 500, stateless public Ed25519 verification
- `GET /health` -- line 641, simple service health check
- `GET /health/deep` -- line 651, deep health with DB stats + key lifecycle

No endpoint signatures, auth middleware, or response shapes were altered. The rate limiters (`verifyLimiter`, `signupLimiter`) remain untouched.

---

## Check 3: Ed25519 signing chain -- createPvf()

**File:** `services/pvf-pipeline.js` line 146
**Status:** PASS

The `createPvf()` function is intact. The ZK spec mandated "do NOT modify createPvf()" and this was respected. The function retains the same:
- Input validation (lines 146-187)
- orgId derivation, hashing, HMAC signing (lines 190-203)
- Token + timestamp generation (lines 208-210)
- Recipient binding (lines 215-221)
- Ed25519 dual-signature path (lines 224-245)

The new `createPvfEncrypted()` function (line 675) is a **separate** function, not a branch inside `createPvf()`. This is the correct architecture -- it avoids polluting the battle-tested v1.0 pipeline. Both functions share signing/obfuscation/persistence helpers but have independent control flow.

Module exports confirm both are exported separately (line 1041-1042):
```js
module.exports = { createPvf, createPvfEncrypted, ... }
```

---

## Check 4: Database migration safety

**File:** `db.js` lines 260-270
**Status:** PASS

Four new columns are added to the `documents` table. All use safe patterns:

| Column       | Type    | Default   | Safe? |
|-------------|---------|-----------|-------|
| `slug`       | TEXT    | NULL      | Yes -- `IF NOT EXISTS`, nullable, no NOT NULL constraint |
| `encrypted`  | BOOLEAN | `false`   | Yes -- `IF NOT EXISTS`, existing v1.0 rows get `false` |
| `iv`         | TEXT    | NULL      | Yes -- `IF NOT EXISTS`, nullable |
| `pvf_version`| TEXT    | `'1.0'`   | Yes -- `IF NOT EXISTS`, default matches v1.0 semantics |

The `mapDocRow()` function (line 279) handles missing columns with safe fallbacks:
```
slug: row.slug || null
encrypted: !!row.encrypted       // false for null/undefined
iv: row.iv || null
pvf_version: row.pvf_version || '1.0'
```

A unique partial index on `slug` (`WHERE slug IS NOT NULL`) ensures v1.0 rows with NULL slug don't collide. This is correct.

---

## Check 5: Obfuscator reserved names

**File:** `obfuscate.js` lines 29-46
**Status:** PASS

All original reserved identifiers are still present:
- **reservedNames:** HASH, SIG, API, RCPT, SHAREID, SIG_ED, KEY_ID, CREATED, ORGID, token, init, show, setOk, setFk, freezeStamp, triggerFlip, showLocal, activateWaves, startRefresh, __securityFrozen, __devToolsOpen, __screenCaptured, blankForCapture, screenCaptureGuard, isLocal, hashFingerprint, environmentCheck, pvfBridge, __TAURI__, postMessage, MutationObserver, querySelector, contentDocument, contentWindow

New additions for ZK: `ENCRYPTED` was added to reservedNames (critical -- prevents obfuscator from renaming the encryption flag variable that `decryptAndDisplay()` checks).

- **reservedStrings:** All originals preserved (Vertifile, pvf-verification, verified, failed, forged, big-x, lbl, stamp, pvf:hash, pvf:version, pvf:signature).

New additions for ZK: `pvf:encrypted`, `PVF:1.0`, `PVF:2.0`, `screen-capture`, `display-capture`, `encryptedDoc`, `encryptionMeta`, `encrypted-doc`, `encryption-meta`.

No original entries were removed or modified.

---

## Check 6: Route /d/:identifier with shareId fallback

**File:** `routes/pages.js` line 102
**Status:** PASS

The route changed from `/d/:shareId` to `/d/:identifier`. Lookup logic (lines 112-119):

```js
// Try slug first (PVF 2.0), then fall back to shareId (PVF 1.0)
let doc = await db.getDocumentBySlug(identifier);
if (!doc) {
  doc = await db.getDocumentByShareId(identifier);
}
```

This is a correct slug-first, shareId-fallback approach. Existing v1.0 shareId URLs will:
1. Miss on `getDocumentBySlug()` (returns null -- no slug for v1.0 docs)
2. Hit on `getDocumentByShareId()` (returns the existing doc)

Validation was widened from 6-20 chars to 3-80 chars (line 108) to accommodate slugs. This does NOT break existing shareId lookups since base64url shareIds (typically 8-12 chars) are well within range.

The `/d/:shareId/raw`, `/d/:shareId/download`, and `/d/:shareId/info` sub-routes remain on `:shareId` parameter naming -- these are unaffected and continue to work for v1.0 documents.

---

## Check 7: Crypto tests and syntax checks

**Status:** PASS

### Crypto test suite (`tests/crypto.test.js`):
```
21 tests, 10 suites, 21 pass, 0 fail
Duration: 18.94ms
```

All test categories pass:
- generateKey (2 tests)
- encrypt/decrypt roundtrip (3 tests)
- decrypt with wrong key (1 test)
- decrypt with wrong IV (1 test)
- hashContent (1 test)
- hashContent determinism (2 tests)
- exportKey/importKey roundtrip (2 tests)
- base64url encoding (3 tests)
- encryptFile (3 tests)
- decryptBlob (3 tests)

### Syntax checks (`node --check`):
All 7 modified files pass syntax validation with exit code 0:
- templates/pvf.js
- routes/api.js
- services/pvf-pipeline.js
- db.js
- obfuscate.js
- routes/pages.js
- tests/crypto.test.js (new file)

---

## Concerns

### MINOR: Route parameter naming inconsistency

The main `/d/:identifier` route was renamed, but sub-routes `/d/:shareId/raw`, `/d/:shareId/download`, and `/d/:shareId/info` still use `:shareId` naming. This works correctly because these sub-routes only serve v1.0 content. However, if PVF 2.0 encrypted documents need these endpoints in the future, they will need slug-aware lookup logic added. Not a regression -- just a forward-looking note.

---

## Conclusion

The Zero-Knowledge encryption implementation is clean. It follows the spec's directive to keep `createPvf()` untouched, introduces `createPvfEncrypted()` as a parallel pipeline, and all backward-compatibility paths (decryptAndDisplay guard, slug-to-shareId fallback, safe DB defaults) work correctly. No v1.0 functionality was broken.
