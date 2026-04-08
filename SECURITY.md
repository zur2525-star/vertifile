# Vertifile Security Model

> **Last updated:** 2026-04-08
> **Document version:** 1.0 (Phase 2D)
> **Contact:** security@vertifile.com

Vertifile is a tamper-proof document protection platform. When we say "tamper-proof," we mean it in the narrow, falsifiable, cryptographic sense: every document Vertifile issues is bound to a pair of signatures that anyone on the internet can verify independently, using only a published public key and a short snippet of standard code.

This document describes how that works, the exact guarantees it provides, the key material you should trust, and three different ways you can verify a Vertifile document **without talking to our API**.

If anything in this document is unclear, wrong, or missing — email security@vertifile.com. Security is the entire product; we want to hear about it.

---

## 1. The guarantee, in one paragraph

Every PVF file issued by Vertifile contains two cryptographic signatures over the same canonical payload:

1. An **HMAC-SHA256** tag, verifiable by Vertifile's API.
2. An **Ed25519** signature, verifiable by **anyone** who fetches our published public key.

Changing a single byte of the document — the content, the recipient, the issuance timestamp, the organization — invalidates both signatures. Vertifile **cannot silently alter an already-issued document**, and neither can a forger. A third party with no relationship to Vertifile can fetch our public key, reconstruct the signed payload from the document's embedded metadata, and verify the Ed25519 signature in about ten lines of code.

This is the trust property we commit to.

---

## 2. The dual-signature model

### Why two signatures?

- **HMAC-SHA256** is a symmetric message authentication code. It is fast, has a tiny footprint, and is the signature our internal verification API has used since V1. It provides strong integrity against outside attackers but **cannot** be verified by a third party, because it uses a secret only Vertifile holds. Its value is backward compatibility and latency.

- **Ed25519** is an asymmetric digital signature. It uses a private key that only Vertifile holds and a public key that we publish openly. Anyone in the world can verify a signature using only the public key and the signed payload — no API call required, no secret involved. This is the signature that turns Vertifile from a closed system into a **verifiable cryptographic protocol**.

### What gets signed

Both signatures cover the exact same canonical payload, pipe-separated:

```
<hash>|<orgId>|<createdAt>|<recipientHash>|<codeIntegrity>
```

Where:
- `hash` — lowercase hex SHA-256 of the original document content (64 chars)
- `orgId` — the issuing organization identifier
- `createdAt` — ISO-8601 timestamp of issuance
- `recipientHash` — optional lowercase hex SHA-256 of the intended recipient identity, or empty string
- `codeIntegrity` — currently reserved, empty string

We chose explicit `|` separators instead of fixed-width concatenation because `|` is forbidden in every field above (hex has no `|`, ISO-8601 has no `|`, our `orgId` convention has no `|`), which eliminates an entire class of concatenation ambiguity attacks.

### Why Ed25519, specifically

Ed25519 is deterministic (no nonce reuse), produces 64-byte signatures (no document bloat), and is built into Node.js `crypto` and every modern TLS library. It is the same primitive used by OpenSSH, Signal, WireGuard, Tailscale, PASETO, and age. It is patent-free, battle-tested, and has a ~128-bit security level.

We deliberately did **not** choose RSA-PSS (5–8× larger signatures, slower keygen) or ECDSA P-256 (historically vulnerable to nonce-reuse footguns when implemented naively).

---

## 3. Key material — the trust anchor

The public key you need to verify any Vertifile document issued from **2026-04-07 onward** is:

### Key ID
```
0f65ad1b92590c92
```

### Full fingerprint (SHA-256 of the canonical public key PEM)
```
0f65ad1b92590c9255b3de67758c49c7fe5169fdd47abb187e795a2edf03a372
```

### Public key (PEM)
```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi8kkHR/bLOdgungBvjseefittXO6Pfc/r39yMxcEDUY=
-----END PUBLIC KEY-----
```

### Published locations

The same key material is published at three independent, cacheable URLs:

| URL | Format | Use |
|---|---|---|
| `https://vertifile.com/.well-known/vertifile-pubkey.pem` | PEM | Direct use with `openssl`, Node, Python `cryptography`, etc. |
| `https://vertifile.com/.well-known/vertifile-jwks.json` | JWKS (RFC 8037) | JOSE-compatible verifiers |
| `https://vertifile.com/api/verify-public?...` | JSON | Stateless verification endpoint |

All three endpoints send `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=3600`. You can embed them in client-side JavaScript, server-side jobs, offline scripts, or air-gapped auditors.

### Verifying the trust anchor itself

Before you trust any signature we produce, you should confirm that the public key published at those URLs matches the fingerprint above. The fingerprint is what you compare against. A one-liner:

```bash
curl -s https://vertifile.com/.well-known/vertifile-pubkey.pem | shasum -a 256
```

If the output does not begin with `0f65ad1b92590c92`, **stop** and contact security@vertifile.com. Either you are being man-in-the-middled, or the key has been rotated and this document is out of date.

### Key rotation policy

- Keys are rotated on a scheduled basis or immediately in response to a suspected compromise.
- During rotation, both the old and new keys are published simultaneously for a 30-day transition window, so documents signed under the previous key continue to verify.
- Every rotation is announced in this document with a new "Valid from" date and the previous key is retained in the published JWKS with a `valid_until` field.
- Rotation history is public — you can see every key we've ever published, along with its validity window, at `/.well-known/vertifile-jwks.json`.

---

## 4. Verify it yourself — three ways

### Method 1: `openssl` (no code, 3 commands)

You need three things from the Vertifile document:
1. The canonical payload string (format: `hash|orgId|createdAt|recipientHash|`)
2. The Ed25519 signature (base64url-encoded, 86 characters)
3. The key ID (`0f65ad1b92590c92`)

```bash
# 1. Fetch the published public key
curl -s https://vertifile.com/.well-known/vertifile-pubkey.pem > vf.pem

# 2. Decode the base64url signature into raw bytes
# (openssl wants raw binary; base64url → base64 via tr; then decode)
echo -n "UT-_7BZBJDOmqi1qAQHfEnIYMiGlHfTswWAYFcjsONHjK-58JLbAgnbduusx6TMBOHQmZnJmm2a08vJLdnOTBg" \
  | tr '_-' '/+' | base64 -d > vf.sig

# 3. Write the canonical payload and verify
printf '%s' "dcbfc9dcd0153d75c2aed0dc6d63f431ed4b2c0c0598868559d57093f315dfb5|user_2|2026-04-07T13:27:04.387Z||" > vf.payload

openssl pkeyutl -verify -pubin -inkey vf.pem -rawin -in vf.payload -sigfile vf.sig
```

Expected output: `Signature Verified Successfully`

If the signature is tampered with by one bit, openssl will print `Signature Verification Failure` and exit non-zero.

### Method 2: Node.js (10 lines)

```js
const https = require('https');
const crypto = require('crypto');

const PAYLOAD  = 'dcbfc9dcd0153d75c2aed0dc6d63f431ed4b2c0c0598868559d57093f315dfb5|user_2|2026-04-07T13:27:04.387Z||';
const SIG_B64U = 'UT-_7BZBJDOmqi1qAQHfEnIYMiGlHfTswWAYFcjsONHjK-58JLbAgnbduusx6TMBOHQmZnJmm2a08vJLdnOTBg';

https.get('https://vertifile.com/.well-known/vertifile-pubkey.pem', (res) => {
  let pem = '';
  res.on('data', (c) => pem += c);
  res.on('end', () => {
    const pubKey = crypto.createPublicKey(pem);
    const ok = crypto.verify(null, Buffer.from(PAYLOAD, 'utf8'), pubKey, Buffer.from(SIG_B64U, 'base64url'));
    console.log(ok ? 'VERIFIED' : 'FORGED');
  });
});
```

No Vertifile library. No API key. No trust in Vertifile beyond the public key fingerprint. If the document was ever altered, the output is `FORGED`.

### Method 3: Python (`cryptography` package)

```python
import base64, urllib.request
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.exceptions import InvalidSignature

PAYLOAD  = b"dcbfc9dcd0153d75c2aed0dc6d63f431ed4b2c0c0598868559d57093f315dfb5|user_2|2026-04-07T13:27:04.387Z||"
SIG_B64U = "UT-_7BZBJDOmqi1qAQHfEnIYMiGlHfTswWAYFcjsONHjK-58JLbAgnbduusx6TMBOHQmZnJmm2a08vJLdnOTBg"

pem = urllib.request.urlopen("https://vertifile.com/.well-known/vertifile-pubkey.pem").read()
pub = load_pem_public_key(pem)
sig = base64.urlsafe_b64decode(SIG_B64U + "==")

try:
    pub.verify(sig, PAYLOAD)
    print("VERIFIED")
except InvalidSignature:
    print("FORGED")
```

### Method 4: Stateless API (`GET /api/verify-public`)

For anyone who doesn't want to run crypto themselves, we expose an unauthenticated, rate-limited GET endpoint that performs the verification on our servers and returns the result — but uses the **same public key** anyone else can fetch independently.

```
GET https://vertifile.com/api/verify-public
  ?hash=<64-hex>
  &signature=<86-char base64url>
  &keyId=0f65ad1b92590c92
  &payload=<hash>|<orgId>|<createdAt>|<recipientHash>|<codeIntegrity>
```

Success response:
```json
{
  "valid": true,
  "keyId": "0f65ad1b92590c92",
  "fingerprint": "0f65ad1b92590c9255b3de67758c49c7fe5169fdd47abb187e795a2edf03a372",
  "algorithm": "Ed25519",
  "verifiedAt": "2026-04-08T14:30:00.000Z"
}
```

This endpoint **never** touches the `documents` table. It verifies the math against the published public key — nothing more. A caller can verify a signature for a document Vertifile has never seen.

**Why you should still prefer Methods 1–3:** the `/api/verify-public` endpoint is convenient, but it requires you to trust our server to run the math correctly. The published public key and a 10-line verifier let you cut us out of the trust chain entirely. That's the point.

---

## 5. What Vertifile promises — and what it does not

### Promises

- Every PVF file we issue from 2026-04-07 onward is signed with Ed25519 in addition to HMAC.
- The Ed25519 public key at the fingerprint above is the only key we use to sign production documents today.
- The private key is held in Vertifile's production secret store and is **never** written to disk, logs, version control, or any location accessible outside of the signing process.
- We will never issue a backdoored or retroactive signature for a document we did not originally sign.
- We will publish any key rotation, revocation, or compromise in this document within one hour of discovery.

### Limitations we are honest about

- **Private key compromise.** If the private key is ever stolen, a forger could produce signatures that pass the same math any honest verifier uses. Our defense is operational: HSM-backed secret storage, the key never leaves memory of the signing process, aggressive rotation, monitoring for anomalous signing activity. If a compromise occurs, we revoke via the published JWKS (`valid_until` set) and rotate to a new key.
- **Pre-Phase-2D documents.** Documents issued before 2026-04-07 are signed with HMAC only. They can still be verified via our API (`POST /api/verify`), but not via Ed25519. Look for `signedBy: "both"` in the API response to confirm a document has the full dual-signature.
- **Social engineering and endpoint compromise.** Cryptography binds the document; it doesn't protect the endpoint that shows you the verified result. A verifier running on a compromised laptop can be made to lie to its user. Run verification on a machine you trust.
- **This document is not legal advice.** It describes the cryptographic binding. Whether the cryptographic binding is legally admissible, compliant, or sufficient for your use case is a question for your legal team.

---

## 6. Disclosing a vulnerability

If you believe you have found a security vulnerability in Vertifile — a way to forge signatures, bypass verification, extract the private key, extract stored documents, or anything else that breaks the guarantees in section 5 — please email **security@vertifile.com** with:

- A technical description of the issue
- Reproduction steps
- The commit hash / deploy timestamp you tested against
- Your contact information (optional but appreciated)

We will acknowledge receipt within 24 hours. We do not currently run a paid bug bounty, but we credit reporters in this document and in our public CHANGELOG unless asked otherwise.

Please **do not** file security issues on GitHub or in public support channels.

---

## 7. Version history

| Date | Change |
|---|---|
| 2026-04-08 | v1.0 — Phase 2D — initial publication with dual-signature model, Ed25519 key ID `0f65ad1b92590c92`, and three independent verification methods. |
