# Vertifile

**Tamper-proof document verification platform**

`Version 4.6.0` | `IANA Registered: application/vnd.vertifile.pvf (2026-04-15)`

---

## What is Vertifile?

Vertifile converts any document — PDF, image, or text file — into a cryptographically signed `.pvf` (Protected Verified File) container. The document is bound to a dual signature (HMAC-SHA256 plus Ed25519) at the moment of creation; any subsequent modification to the content, recipient binding, timestamp, or issuing organization immediately invalidates both signatures and causes the embedded holographic stamp to freeze red during viewing.

Verification is public by design: anyone with a `.pvf` file can confirm its authenticity on [vertifile.com/verify](https://vertifile.com/verify) or independently using the published Ed25519 public key — no account, no API key, no Vertifile infrastructure required. The server operates on a blind processing model: document content is hashed client-side, so the Vertifile backend never reads, stores, or processes the raw document.

---

## Key Features

- **Dual-signature cryptography** — every PVF carries an HMAC-SHA256 tag and an Ed25519 signature over an identical canonical payload; both must pass for the document to verify
- **Zero-knowledge encryption** — PVF 2.0 format; document content never leaves the client unencrypted
- **IANA registered MIME type** — `application/vnd.vertifile.pvf`, approved 2026-04-15 (RFC 6838 vendor tree)
- **10 languages** — full interface and document metadata in: English, Hebrew, Arabic, French, Spanish, German, Russian, Chinese, Japanese, Portuguese
- **Real-time webhook notifications** — register HTTP endpoints to receive events on document creation and verification
- **Public verification without an account** — any browser, no login, no API key
- **Blockchain anchoring** — optional Polygon on-chain anchor with batch queue (Ed25519 signatures remain the primary trust mechanism)
- **Ed25519 key rotation** — live key rotation with full backward compatibility; all previously issued documents remain verifiable

---

## Quick Start

### Install

```bash
npm install
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `HMAC_SECRET` | Yes | HMAC signing secret (auto-generated to `data/.hmac_secret` if absent) |
| `SESSION_SECRET` | Yes | Express session secret (auto-generated to `data/.session_secret` if absent) |
| `ADMIN_SECRET` | Yes | Admin dashboard access token |
| `POLYGON_PRIVATE_KEY` | No | Polygon wallet private key for blockchain anchoring |
| `POLYGON_CONTRACT` | No | Deployed smart contract address |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

### Run

```bash
# Development
npm run dev

# Production
node server.js
```

### Test

```bash
npm test
```

---

## API Overview

Interactive documentation is available at `/api/docs`. The OpenAPI 3.0 specification is served at `/api/openapi.json`.

**Authentication:** pass your API key in the `X-API-Key` header. Public verification endpoints require no authentication.

### Example requests

**Create a PVF document**

```bash
curl -X POST https://vertifile.com/api/create-pvf \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "documentHash": "<sha256-hex>",
    "recipient": "Jane Smith",
    "title": "Certificate of Completion",
    "orgId": "your-org-id"
  }'
```

**Verify a document (authenticated)**

```bash
curl -X POST https://vertifile.com/api/verify \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pvfToken": "<token-from-pvf-file>"}'
```

**Verify a document (public, no account needed)**

```bash
curl -X POST https://vertifile.com/api/verify-public \
  -H "Content-Type: application/json" \
  -d '{"pvfToken": "<token-from-pvf-file>"}'
```

---

## Architecture

| Layer | Detail |
|---|---|
| Framework | Express 5 |
| Database | PostgreSQL on Neon (Frankfurt) |
| Auth | Session-based (express-session + connect-pg-simple) plus API key |
| Cryptography | HMAC-SHA256 (symmetric) + Ed25519 (asymmetric, publicly verifiable) |
| Key management | Ed25519 key rotation with backward-compatible verification |
| Middleware stack | helmet, CSRF (csrf-sync), rate limiting, input sanitization, request logging, response envelope, timeout, memory guard, error alerter |
| Logging | pino (structured JSON) |
| Obfuscation | javascript-obfuscator in a dedicated worker thread (non-blocking) |
| Blockchain | ethers.js + Polygon, batch queue with graceful shutdown flush |

**Module layout:**

```
pvf-project/
├── server.js                       # Bootstrap only (165 lines)
├── db.js                           # PostgreSQL layer with retry backoff
├── blockchain.js                   # Polygon anchoring + batch queue
├── middleware/                     # auth, sanitize, timeout, request-logger, ...
├── services/pvf-generator.js       # Hash, sign, handleCreatePvf
├── templates/pvf.js                # PVF HTML template (~730 lines)
├── routes/                         # auth, user, api, admin, gateway, webhooks, pages
├── public/                         # Frontend (vanilla HTML/JS/CSS) + locales
├── viewer/                         # Electron desktop viewer (v1.1.0)
└── viewer-tauri/                   # Tauri viewer (in progress)
```

---

## Testing

The test suite uses Node's built-in `node:test` runner — zero additional test dependencies.

- **831 test cases** across **20 test suites**
- Coverage: signing pipeline, Ed25519 verification, public verify, ZK encryption, key rotation, webhook security, input sanitization, environment validation, password policy, CSRF, admin actions, account lifecycle, API key lifecycle, user branding

**Run all tests:**

```bash
npm test
```

**Run a single suite:**

```bash
npm run test:signing
npm run test:verify-ed25519
npm run test:webhook-security
# see package.json for the full list
```

---

## Security

Full model documented in [SECURITY.md](./SECURITY.md). Contact: security@vertifile.com.

**Controls in place:**

- HSTS enforced on all responses
- Content Security Policy with per-request nonces (via helmet)
- CSRF synchronizer tokens on all mutating requests (csrf-sync)
- Per-route rate limiting (express-rate-limit)
- Input sanitization: XSS escaping, null-byte rejection, 10 KB payload cap (middleware/sanitize.js)
- Session fixation protection — session ID regenerated on login
- Permissions-Policy, Referrer-Policy, DNS-Prefetch-Control headers
- CORS restricted to vertifile.com
- No secrets in codebase — auto-generated secrets stored outside the repository in `data/`
- Pre-commit hooks: syntax check, `npm audit`, test run, console.log scan, secrets pattern scan

**Independent verification (no Vertifile account required):**

```bash
# Fetch the public key
curl https://vertifile.com/.well-known/vertifile-pubkey.pem -o vertifile-pubkey.pem

# Verify an Ed25519 signature
openssl pkeyutl -verify -pubin -inkey vertifile-pubkey.pem \
  -sigfile signature.bin -in payload.bin
```

---

## Internationalization

The full interface — all pages, error messages, document metadata, and legal text — is available in 10 languages:

| Code | Language |
|---|---|
| en | English |
| he | Hebrew (RTL) |
| ar | Arabic (RTL) |
| fr | French |
| es | Spanish |
| de | German |
| ru | Russian |
| zh | Chinese (Simplified) |
| ja | Japanese |
| pt | Portuguese |

Locale files are in `public/locales/`. Every new string must be translated to all 10 languages before merging.

---

## License

ISC

---

## Links

- Website: [vertifile.com](https://vertifile.com)
- IANA registration: [iana.org/assignments/media-types/application/vnd.vertifile.pvf](https://www.iana.org/assignments/media-types/application/vnd.vertifile.pvf)
- API docs: [vertifile.com/api/docs](https://vertifile.com/api/docs)
- Security contact: security@vertifile.com
