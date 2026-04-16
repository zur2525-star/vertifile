# Vertifile — System Architecture

**Version:** 4.6.0
**IANA MIME type:** `application/vnd.vertifile.pvf` (registered 2026-04-15)
**Last updated:** 2026-04-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [System Components](#3-system-components)
4. [PVF File Format](#4-pvf-file-format)
5. [Dual-Signature Model](#5-dual-signature-model)
6. [Key Rotation (Phase 3)](#6-key-rotation-phase-3)
7. [Request Flow Diagrams](#7-request-flow-diagrams)
8. [Authentication Flows](#8-authentication-flows)
9. [Security Layers](#9-security-layers)
10. [Database Schema](#10-database-schema)
11. [File Layout](#11-file-layout)
12. [Deployment](#12-deployment)
13. [Testing](#13-testing)
14. [Observability](#14-observability)

---

## 1. Overview

Vertifile is a tamper-proof document verification platform. It converts any document — PDF, image, or text file — into a cryptographically signed `.pvf` (Protected Verified File) container.

The core architecture has two design axioms:

**Blind processing.** The Vertifile backend never reads, stores, or processes raw document content. The SHA-256 hash of the document is computed client-side; only the hash crosses the network. This is the zero-knowledge posture from which all other security properties follow.

**Independently verifiable.** Verification of any PVF does not require a Vertifile account, API key, or any runtime dependency on Vertifile infrastructure. Any party with a browser and an internet connection can verify a PVF at `vertifile.com/verify`. Any party with `openssl` can verify the Ed25519 signature offline using the published public key at `/.well-known/vertifile-pubkey.pem`. This trust-minimization property is the commercial differentiator and the subject of a pending Israeli patent.

The server is a Node.js Express 5 application backed by PostgreSQL on Neon. All cryptographic work happens in the signing pipeline (`services/pvf-pipeline.js`, `services/pvf-generator.js`, `services/signing.js`). The frontend is vanilla HTML/JS/CSS with no build step. The desktop viewer is packaged as both an Electron app and a Tauri app (in progress).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Database | PostgreSQL on Neon (Frankfurt region) |
| ORM / query layer | Raw SQL via `pg.Pool` (no ORM) |
| Session store | `connect-pg-simple` (sessions stored in the `sessions` table) |
| Authentication | `passport` with `passport-local` + `passport-google-oauth20` |
| Password hashing | `bcrypt` (rounds: production default) |
| Symmetric signing | HMAC-SHA256 via Node.js `crypto` |
| Asymmetric signing | Ed25519 via Node.js `crypto.generateKeyPairSync` |
| HTTP security | `helmet` v8 (HSTS, CSP, Referrer-Policy, Permissions-Policy) |
| CSRF | `csrf-sync` (synchronizer token pattern) |
| Rate limiting | `express-rate-limit` (per-endpoint tiers) |
| Compression | `compression` (gzip, threshold 1 KB, PVF excluded) |
| File upload | `multer` (memory storage, 50 MB cap) |
| Logging | `pino` (structured JSON) |
| Obfuscation | `javascript-obfuscator` in a dedicated worker thread |
| Blockchain | `ethers.js` + Polygon (optional, batch queue) |
| PDF rendering | `pdfjs-dist` 4.0.379 (vendor-bundled, injected into PVF at creation time) |
| Desktop viewer | Electron v1.1.0 + Tauri (in progress) |
| Test runner | Node.js built-in `node:test` |

---

## 3. System Components

### 3.1 HTTP Layer

Entry point: `server.js` (165 lines, bootstrap only).

The application is initialized in a strict order:

1. `validateEnv()` runs before any middleware. Missing required environment variables cause a hard boot-time exit rather than a silent runtime failure.
2. PDF.js vendor files are verified on disk at boot. Missing files are logged loudly but do not abort the process — non-PDF PVFs continue to work.
3. The Express `app` instance is created. `trust proxy` is set to `1` for correct IP detection behind Render's reverse proxy.
4. A per-request CSP nonce is generated and stored on `res.locals.cspNonce` before the `helmet` middleware runs, so the nonce is available to the CSP `scriptSrc` directive.
5. The 10-layer middleware stack is registered (see [Section 9](#9-security-layers)).
6. Route modules are mounted. The key-manager is initialized, which loads Ed25519 key slots from environment variables into memory.

### 3.2 Auth Layer

Two authentication modes coexist:

**Session-based** — used by the web dashboard. Passport local strategy handles email/password login; Passport Google OAuth 2.0 handles social login. Sessions are stored in PostgreSQL via `connect-pg-simple`. Session IDs are regenerated on every login (session fixation protection). Sessions have a 30-day absolute expiry and a 7-day sliding window.

**API key-based** — used by organizations integrating programmatically. The API key is passed in the `X-API-Key` header. No session, no CSRF token required. The `createAuthenticateApiKey` middleware in `middleware/auth.js` validates the key against the `api_keys` table and attaches the org context to `req`.

Admin endpoints use a separate `X-Admin-Secret` header validated by `createAuthenticateAdmin`.

### 3.3 Business Logic — PVF Pipeline

The unified PVF creation pipeline lives entirely in `services/pvf-pipeline.js`. Both the dashboard upload path (`routes/user.js POST /upload`) and the API path (`routes/api.js POST /api/create-pvf`) call `createPvf()` here. This single entry point was introduced in Phase 1B to eliminate chronic drift between the two previously separate code paths.

The pipeline executes 21 ordered steps (see the module's header comment for the full sequence). The security-critical ordering is:

```
1.  Validate input (MIME allowlist, non-empty buffer)
2.  Hash raw bytes (SHA-256, blind — content never read by server)
3.  HMAC-SHA256 sign the canonical payload
4.  Generate session token + recipient binding
5.  Encode file (text -> HTML escape, binary -> base64)
6.  Fetch org branding
7.  Generate shareId BEFORE HTML generation (fixes SHAREID post-obfuscation patch bug)
8.  Generate PVF HTML (shareId baked in before obfuscation)
9.  Insert document row in DB
10. Set user/document linkage (dashboard path only)
11. Increment API key document count (API path only)
12. Obfuscate PVF HTML (worker thread, non-blocking)
13. Extract code integrity hash from obfuscated output
14. Compute chainedToken (sha256(hash + signature + orgId + codeIntegrity))
15. Save code integrity + chained token to DB
16. Set shareId on document row
17. Save full obfuscated PVF HTML to DB
18. Mark preview-only if plan is unpaid (dashboard path only)
19. Fire-and-forget blockchain registration (optional)
20. Write audit log entry
21. Return structured result to caller
```

Ed25519 signing happens inside the pipeline via `services/signing.js`, which consults `services/key-manager.js` to determine the active signing key.

### 3.4 Data Layer

`db.js` is the single database import point. It initializes a `pg.Pool` with:

- Maximum 20 connections
- Idle timeout: 30 seconds
- Connection timeout: 10 seconds
- SSL enforced in production (the `db-config.js` service rejects a production boot against a local DB URL)

All queries go through `queryWithRetry()`, which retries up to 3 times with linear backoff (500 ms, 1 000 ms, 1 500 ms) before propagating the error.

Domain-specific repository modules live in `repos/`:

| Module | Responsibility |
|---|---|
| `repos/auth-repo.js` | User creation, login, session management, password reset |
| `repos/document-repo.js` | Document CRUD, shareId lookup, pvf_content storage |
| `repos/admin-repo.js` | Admin queries (user list, audit log, overage) |
| `repos/gateway-repo.js` | Gateway/API key lookups |

Each repo is initialized with the `pool` and `queryWithRetry` references at boot. `db.js` re-exports everything for backward-compatible import by route and service modules.

---

## 4. PVF File Format

A `.pvf` file is an HTML document — a self-contained, browser-openable file. It contains:

- The original document content (encoded inline: text as HTML-escaped, binary as base64)
- Embedded signed metadata: `hash`, `signature` (HMAC-SHA256), `ed25519Signature`, `ed25519KeyId`, `orgId`, `createdAt`, `recipient`, `recipientHash`, `shareId`, `pvfVersion`
- The holographic stamp animation (SVG + CSS, no external resources)
- The embedded verification logic (runs in the browser, offline-capable)
- PDF.js vendor files inlined for PDF documents

The MIME type is `application/vnd.vertifile.pvf`, IANA-registered under the vendor tree (RFC 6838, approved 2026-04-15).

After creation the HTML is run through `javascript-obfuscator` in a worker thread. The obfuscated output is what gets saved to disk/DB and delivered to the user. The code integrity hash is computed from the obfuscated output and stored alongside the document row, forming the `chainedToken`.

**PVF 2.0 (zero-knowledge variant):** document content is encrypted client-side before hashing. The `encrypted` flag is set to `true` on the DB row and the IV is stored. The server receives only the encrypted blob — it never had access to the plaintext.

---

## 5. Dual-Signature Model

Every PVF carries two independent signatures over the same canonical payload. This is the Phase 2C architecture, stable as of 2026-04-08.

### Canonical Payload

```
<hash>|<orgId>|<createdAt>|<recipientHash>|<codeIntegrity>
```

Fields:
- `hash` — lowercase hex SHA-256 of the original document content (64 chars)
- `orgId` — issuing organization identifier
- `createdAt` — ISO-8601 timestamp stored as `TEXT` in PostgreSQL (CRITICAL: must remain `TEXT` — migrating to `TIMESTAMPTZ` would produce a different string representation and silently break every existing Ed25519 verification)
- `recipientHash` — lowercase hex SHA-256 of the recipient identity string, or empty string
- `codeIntegrity` — SHA-256 of the obfuscated PVF HTML, or empty string

The `|` separator is used because it cannot appear in any of the field values (hex, ISO-8601, and the orgId convention all exclude `|`). This eliminates a class of concatenation ambiguity attacks.

### HMAC-SHA256

- Symmetric — uses a secret only Vertifile holds (`HMAC_SECRET`)
- Fast, minimal footprint
- Verifiable only via the Vertifile API (`/api/verify`)
- Purpose: backward compatibility and low-latency internal verification

### Ed25519

- Asymmetric — private key held only by Vertifile, public key published at `/.well-known/vertifile-pubkey.pem`
- 64-byte signature, deterministic (no nonce reuse risk)
- Verifiable by anyone with the public key — no API call, no account, no SDK
- Purpose: the trust-minimization property; turns Vertifile from a closed system into an open cryptographic protocol

### Verification Rule

Both signatures must pass. A document that passes HMAC but fails Ed25519, or vice versa, is treated as invalid.

### Independent Verification (no Vertifile account)

```bash
# Fetch the public key
curl https://vertifile.com/.well-known/vertifile-pubkey.pem -o vertifile-pubkey.pem

# Verify an Ed25519 signature
openssl pkeyutl -verify -pubin -inkey vertifile-pubkey.pem \
  -sigfile signature.bin -in payload.bin
```

Current production key ID: `0f65ad1b92590c92`
Current production key fingerprint (SHA-256 of canonical PEM):
`0f65ad1b92590c9255b3de67758c49c7fe5169fdd47abb187e795a2edf03a372`

---

## 6. Key Rotation (Phase 3)

Ed25519 key rotation uses a strict forward-only state machine. The implementation spans `services/key-manager.js`, `db.js` (Phase 3A migration), and `routes/well-known.js`.

### State Machine

```
pending  -->  active  -->  grace  -->  expired
                 ^
                 |
         (only one active key at any time)
```

State transitions are strictly monotonic forward. The transition `grace -> active` is explicitly forbidden and enforced at the database layer by a `BEFORE UPDATE` trigger. Rolling back to a previous key requires initiating a new rotation with a new key — it is never done by reversing state.

### Key Slots (Phase 3B)

The key manager loads up to two private key slots at boot:

| Slot | Environment Variable | Description |
|---|---|---|
| `_primary` | `ED25519_PRIVATE_KEY_PEM` + `ED25519_PRIMARY_KEY_ID` | Always expected in production |
| `_next` | `ED25519_NEXT_PRIVATE_KEY_PEM` + `ED25519_NEXT_KEY_ID` | Present only during a rotation window |

Identical key IDs in both slots abort the boot (misconfiguration guard). Private key PEM strings are dropped after conversion to `crypto.KeyObject` — only the KeyObject is retained in memory. No exported function returns a private key except `getPrimary()` and `getActivePrimary()`, which are used exclusively by the signing path.

`getActivePrimary()` is async because it queries the `ed25519_keys` table to find the `state='active'` row. The result is cached for 30 seconds. The cache can be invalidated via an admin endpoint (surfaced in `/api/health/deep` as `cacheLastInvalidatedAt`).

### Grace Period

When a new key is rotated in:

1. The old key enters the `grace` state.
2. Documents signed under the old key remain verifiable — `getPublicKeyById(keyId)` looks up any key by ID from the `ed25519_keys` table (with an in-memory cache). This means the old public key is always available for verification, regardless of whether it is the current signing key.
3. After 90 days the old key transitions to `expired`.
4. The PVF file itself embeds the `ed25519KeyId` that was used to sign it, so the verifier always knows which public key to fetch.

### Public Rotation Log

Every key rotation event is written to the `key_rotation_log` table (no foreign keys to `ed25519_keys` — intentional, so that deleting a key row cannot cascade-orphan rotation history).

The log is published at:

```
GET /.well-known/vertifile-rotation-log.json
```

This endpoint is public and returns the rotation history without the `actor` field (the actor is stored in the DB for internal auditing but is deliberately omitted from the public response).

The current production key is also published as a PEM at:

```
GET /.well-known/vertifile-pubkey.pem
```

And as a JWKS at:

```
GET /.well-known/vertifile-jwks.json
```

Both are served with `Access-Control-Allow-Origin: *` and no credentials (public CORS, Phase 2D).

---

## 7. Request Flow Diagrams

### 7.1 Creating a PVF

```
Client (browser or API caller)
  |
  |  POST /api/create-pvf
  |  Headers: X-API-Key: <key>
  |  Body: { documentHash, recipient, title, orgId }
  |
  v
middleware/auth.js  ->  validateApiKey()
  |
  v
middleware/sanitize.js  ->  input sanitization, null-byte rejection
  |
  v
routes/api.js  ->  createLimiter (rate limit check)
  |
  v
services/pvf-pipeline.js  ->  createPvf()
  |
  |-- 1. Validate MIME and buffer
  |-- 2. SHA-256 hash (content never seen by server in API path)
  |-- 3. HMAC-SHA256(canonical payload)
  |-- 4. Ed25519 sign via signing.js -> key-manager.js (active key)
  |-- 5. generatePvfHtml() -> templates/pvf.js
  |-- 6. obfuscatePvf() -> obfuscate.js (worker thread)
  |-- 7. db: INSERT INTO documents (hash, signature, ed25519_signature, ...)
  |-- 8. db: savePvfContent(), setShareId(), saveCodeIntegrity()
  |-- 9. blockchain.js -> fire-and-forget Polygon anchor (if configured)
  |-- 10. db: INSERT INTO audit_log
  |
  v
Response: { success: true, shareId, pvfContent, token }
```

### 7.2 Verifying a PVF (public endpoint)

```
Any party (no account required)
  |
  |  POST /api/verify-public
  |  Headers: none required
  |  Body: { pvfToken }
  |
  v
CORS: Access-Control-Allow-Origin: *  (public CORS, no credentials)
  |
  v
routes/api.js  ->  verifyPublicLimiter (rate limit check)
  |
  v
services/pvf-generator.js  ->  verifySignature()
  |
  |-- 1. Decode pvfToken, extract canonical fields
  |-- 2. Recompute HMAC-SHA256 over payload, compare
  |-- 3. Look up ed25519KeyId -> key-manager.js getPublicKeyById()
  |       (cache hit or DB lookup in ed25519_keys table)
  |-- 4. Verify Ed25519 signature
  |-- 5. Both signatures must pass
  |
  v
Response: { valid: true|false, details }
```

The public verify endpoint is stateless: it does not write to the database. It returns the same result regardless of whether Vertifile's database is under load, and it works for documents signed under any previously active key (backward-compatible via the key ID lookup).

### 7.3 Key Rotation

```
Admin operator
  |
  |  POST /api/admin/rotate-key
  |  Headers: X-Admin-Secret: <secret>
  |  Body: { newKeyId, actor, reason }
  |
  v
middleware: createAuthenticateAdmin()
  |
  v
routes/admin.js  ->  rotation command
  |
  |-- 1. Validate new key slot is loaded in key-manager (_next slot)
  |-- 2. DB transaction:
  |       - UPDATE ed25519_keys SET state='grace' WHERE state='active'
  |       - UPDATE ed25519_keys SET state='active' WHERE id=newKeyId
  |       - INSERT INTO key_rotation_log (old_key_id, new_key_id, grace_until, actor)
  |       - DB trigger fires: logs state change to audit_log
  |-- 3. Invalidate getActivePrimary() cache
  |
  v
New key is now active. Old key is in grace (verifiable for 90 days).
/.well-known/vertifile-rotation-log.json reflects the new entry.
```

---

## 8. Authentication Flows

### 8.1 Session-Based (Web Dashboard)

```
POST /auth/login
  Body: { email, password }
  |
  v
Passport LocalStrategy
  |-- Look up user by email (auth-repo)
  |-- Check failed_login_attempts + locked_until (lockout guard)
  |-- bcrypt.compare(password, password_hash)
  |-- On success: req.session.regenerate() (session fixation protection)
  |               req.logIn(user) -> session stored in sessions table
  |-- On failure: increment failed_login_attempts, insert login_attempts row
  |
  v
Session cookie set (httpOnly, sameSite: lax, secure in production)
  |
  v
Subsequent requests
  |
  |-- express-session reads sid from cookie
  |-- connect-pg-simple fetches sess JSON from sessions table
  |-- passport.session() deserializes user from sess.passport.user
  |-- requireAuth middleware checks req.isAuthenticated()
  |
  v
CSRF protection
  |-- All mutating requests (POST/PUT/DELETE) require X-CSRF-Token header
  |-- Token issued at GET /api/csrf-token
  |-- csrf-sync validates token against session-bound store
  |-- API-key-authenticated requests bypass CSRF (stateless path)
```

Session limits:
- Absolute expiry: 30 days from login
- Sliding window: 7 days of inactivity causes expiry
- Multiple sessions per user are supported (each device gets its own `sid`)

### 8.2 API Key-Based

```
POST /api/create-pvf (or any /api/* endpoint)
  Headers: X-API-Key: vf_<key>
  |
  v
middleware/auth.js  ->  createAuthenticateApiKey()
  |-- SELECT * FROM api_keys WHERE api_key = $1 AND active = 1
  |-- Check allowed_ips if set
  |-- Attach { orgId, orgName, plan, rateLimit } to req
  |
  v
No session involved. No CSRF token required.
Rate limiting applied per API key (express-rate-limit, per-route tiers).
```

API key issuance and revocation are handled by admin endpoints. Keys are stored hashed in the `api_keys` table.

---

## 9. Security Layers

The middleware stack is applied in this order in `server.js`:

| Order | Layer | Implementation | Purpose |
|---|---|---|---|
| 1 | CSP nonce generation | Inline middleware | Per-request nonce on `res.locals.cspNonce` before helmet reads it |
| 2 | helmet | `helmet` v8 | HSTS (2-year, includeSubDomains, preload), CSP with nonce, Referrer-Policy, DNS-Prefetch-Control, frame-ancestors: none |
| 3 | Permissions-Policy | Inline middleware | Manual header (helmet v8 dropped permissionsPolicy support): camera=(), microphone=(), geolocation=(), payment=(), usb=() |
| 4 | CORS | `cors` | Public CORS (`*`, no credentials) for `/.well-known/*` and `/api/verify-public`; restrictive CORS (vertifile.com allowlist) for all other routes |
| 5 | JSON body parsing | `express.json` | 1 MB limit; invalid JSON returns 400 immediately |
| 6 | Input sanitization | `middleware/sanitize.js` | XSS escaping, null-byte (`\x00`) rejection, 10 KB payload cap on string fields |
| 7 | Compression | `compression` | gzip, threshold 1 KB; PVF responses and binary formats excluded |
| 8 | Request logger | `middleware/request-logger.js` | Pino-based structured request log; PII fields scrubbed before writing |
| 9 | Session | `express-session` + `connect-pg-simple` | PostgreSQL-backed sessions, cookie: httpOnly, sameSite: lax, secure in production |
| 10 | Passport | `passport` | Deserializes user from session on every request |
| 11 | CSRF | `middleware/csrf.js` (`csrf-sync`) | Synchronizer token on all mutating requests; skipped for API-key-authenticated requests |
| 12 | Rate limiting | `express-rate-limit` | Per-route tiers (see table below) |
| 13 | Response envelope | `middleware/response-envelope.js` | Wraps all JSON responses in `{ success, data, error }` shape |
| 14 | Request timeout | `middleware/timeout.js` | Hard timeout per request type; avoids hung connections |
| 15 | Error alerter | `middleware/error-alerter.js` | Captures unhandled errors for alerting |
| 16 | Error handler | `middleware/error-handler.js` | Production: masks internal error details; development: full stack trace |

### Rate Limit Tiers

| Endpoint | Window | Limit |
|---|---|---|
| `POST /api/create-pvf` | 1 hour | Configured per API key (`rate_limit` column, default 100) |
| `POST /api/verify-public` | Shorter window | Public tier (stricter) |
| `POST /auth/signup` | Per IP | Signup limiter (brute-force protection) |
| `POST /auth/login` | Per IP | Login limiter (separate from signup) |

### Pre-Commit Security Hooks

The repository enforces the following checks before every commit:

- Syntax check
- `npm audit`
- Full test run
- `console.log` scan (no debug output in production code)
- Secrets pattern scan (no secrets committed to the repository)

---

## 10. Database Schema

All tables are created in `db.js` via `SCHEMA_SQL` and a series of idempotent migrations. The database is PostgreSQL on Neon.

| Table | Purpose |
|---|---|
| `users` | User accounts. Columns: id, email, name, password_hash, provider, provider_id, avatar_url, documents_used, documents_limit, plan, email_verified, last_login_at, failed_login_attempts, locked_until, stamp_config (JSONB), stamp_updated_at |
| `sessions` | Express session store (`connect-pg-simple`). Columns: sid (PK), sess (JSON), expire. Indexed on `expire`. |
| `documents` | One row per issued PVF. Columns: hash (PK), signature, original_name, mime_type, file_size, created_at (TEXT — must remain TEXT, see Section 5), token, org_id, recipient, recipient_hash, share_id, user_id, starred, pvf_content, code_integrity, chained_token, ed25519_signature, ed25519_key_id, preview_only, slug, encrypted, iv, pvf_version |
| `api_keys` | Organization API keys. Columns: api_key (PK), org_id (UNIQUE), org_name, plan, created_at, documents_created, active, rate_limit, allowed_ips, custom_icon, brand_color, wave_color |
| `ed25519_keys` | Ed25519 public key registry. Columns: id (VARCHAR(16) PK), public_key_pem, valid_from, valid_until, is_primary, created_at. Partial unique index on `is_primary = TRUE` ensures at most one primary key. |
| `key_rotation_log` | Append-only rotation history. Columns: id, rotated_at, old_key_id, new_key_id, old_fingerprint, new_fingerprint, grace_until, reason, actor. No foreign keys to `ed25519_keys` (intentional — rotation history must survive key deletion). |
| `audit_log` | General platform audit trail. Columns: id, timestamp (TEXT), event, details (TEXT/JSON). JSONB expression index on `details->>'orgId'` for org-scoped queries. |
| `webhooks` | Org webhook registrations. Columns: id, org_id, url, events, secret, active, created_at |
| `password_resets` | Password reset tokens. Columns: id, user_id, token (UNIQUE), expires_at, created_at |
| `verification_codes` | Email verification codes (onboarding). Columns: id, email, code, type, attempts, created_at, expires_at, used |
| `login_attempts` | Rolling-window login failure records (per-email lockout). Columns: id, email, ip, attempted_at. Composite index on (email, attempted_at DESC). |
| `user_profiles` | Extended profile data, keyed to users(id) with ON DELETE CASCADE. Columns: id, user_id (UNIQUE), created_at |
| `health_checks` | Automated health check results. Columns: id, checked_at, status, response_ms, details (JSONB) |
| `overage_log` | Monthly per-user overage billing tracker. Columns: id, user_id, month (VARCHAR(7)), documents_used, documents_limit, overage_count, overage_rate, overage_charge, updated_at. UNIQUE on (user_id, month). |

### Key Indexes

```sql
-- Documents
CREATE INDEX idx_docs_org        ON documents(org_id);
CREATE INDEX idx_docs_created    ON documents(created_at);
CREATE INDEX idx_docs_user_id    ON documents(user_id);
CREATE INDEX idx_docs_user_created ON documents(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_docs_share ON documents(share_id) WHERE share_id IS NOT NULL;
CREATE UNIQUE INDEX idx_docs_slug  ON documents(slug)     WHERE slug     IS NOT NULL;
CREATE INDEX idx_docs_ed25519_key  ON documents(ed25519_key_id) WHERE ed25519_key_id IS NOT NULL;

-- Sessions
CREATE INDEX idx_sessions_expire ON sessions(expire);
-- JSONB expression index for user session cleanup on logout:
CREATE INDEX idx_sessions_user ON sessions ((sess::jsonb->'passport'->>'user'));

-- Audit log
CREATE INDEX idx_audit_event ON audit_log(event);
CREATE INDEX idx_audit_time  ON audit_log(timestamp);
CREATE INDEX idx_audit_org   ON audit_log ((details::jsonb->>'orgId'));

-- Key rotation
CREATE INDEX idx_key_rotation_log_rotated_at ON key_rotation_log(rotated_at DESC);

-- Health
CREATE INDEX idx_health_status_time ON health_checks(checked_at, status);
```

---

## 11. File Layout

```
pvf-project/
|
|-- server.js                        # Bootstrap: middleware stack, route mounting, startup guards
|-- db.js                            # PostgreSQL pool, schema migrations, repo initialization
|-- blockchain.js                    # Polygon anchoring + graceful-shutdown batch queue flush
|-- obfuscate.js                     # javascript-obfuscator wrapper (called from pvf-pipeline.js)
|-- sdk.js                           # Public-facing Vertifile SDK (importable by integrators)
|
|-- middleware/
|   |-- auth.js                      # createAuthenticateApiKey, createAuthenticateAdmin, signupLimiter
|   |-- csrf.js                      # csrf-sync synchronizer token middleware + token endpoint
|   |-- error-alerter.js             # Captures unhandled errors for alerting
|   |-- error-handler.js             # Production error masking, development stack traces
|   |-- request-logger.js            # Pino request log with PII scrubbing
|   |-- requireAuth.js               # Session auth guard for dashboard routes
|   |-- requireSubscription.js       # Plan/subscription gate for paid features
|   |-- response-envelope.js         # Wraps responses in { success, data, error }
|   |-- sanitize.js                  # XSS escape, null-byte rejection, 10 KB cap
|   `-- timeout.js                   # Hard request timeout per route type
|
|-- services/
|   |-- pvf-pipeline.js              # Unified PVF creation pipeline (single entry point)
|   |-- pvf-generator.js             # signHash(), handleCreatePvf(), verifySignature(), HMAC_SECRET
|   |-- signing.js                   # Ed25519 sign + verify helpers
|   |-- key-manager.js               # Ed25519 key slot loading, getActivePrimary(), getPublicKeyById()
|   |-- logger.js                    # Pino logger singleton
|   |-- db-config.js                 # Pool SSL config, production/local guard, safe host logging
|   |-- env-validator.js             # Boot-time required env var check (exits on missing vars)
|   |-- email.js                     # Transactional email sending
|   |-- email-templates.js           # Email HTML templates
|   |-- onboarding-emails.js         # Scheduled onboarding email sequences
|   |-- password-validator.js        # Password policy enforcement
|   |-- pdfjs-inline.js              # PDF.js vendor file injection into PVF HTML
|   `-- stamp-override.js            # Holographic stamp override script builder
|
|-- routes/
|   |-- api.js                       # /api/* — PVF create, verify, metrics, health, OpenAPI spec
|   |-- auth.js                      # /auth/* — login, signup, logout, Google OAuth, password reset
|   |-- user.js                      # /user/* — dashboard upload, document list, stamp config
|   |-- admin.js                     # /admin/* — key rotation, user management, audit log
|   |-- gateway.js                   # /gateway/* — API gateway for org-level document access
|   |-- webhooks.js                  # /webhooks/* — webhook registration and delivery
|   |-- onboarding.js                # /onboarding/* — post-signup questionnaire flow
|   |-- pages.js                     # Static page serving (/verify, /d/:shareId, etc.)
|   `-- well-known.js                # /.well-known/* — pubkey PEM, JWKS, rotation log
|
|-- templates/
|   `-- pvf.js                       # generatePvfHtml() — PVF HTML template (~730 lines)
|
|-- repos/
|   |-- auth-repo.js                 # User/session/password-reset DB queries
|   |-- document-repo.js             # Document CRUD, pvf_content, shareId, code integrity
|   |-- admin-repo.js                # Admin queries (users, audit log, overage)
|   `-- gateway-repo.js              # API key/org gateway DB queries
|
|-- public/
|   |-- locales/                     # i18n JSON files for 10 languages (en, he, ar, fr, es, de, ru, zh, ja, pt)
|   |-- api/openapi.json             # OpenAPI 3.0 specification
|   `-- (static HTML/JS/CSS)        # Dashboard, verify page, landing page — vanilla, no build step
|
|-- vendor/
|   `-- pdfjs/
|       |-- pdf.min.mjs              # PDF.js main bundle (pdfjs-dist 4.0.379)
|       `-- pdf.worker.min.mjs       # PDF.js worker bundle
|
|-- tests/                           # Test suites (node:test runner)
|-- scripts/                         # Utility scripts (key generation, migrations, etc.)
|-- migrations/                      # Standalone DB migration scripts
|-- docs/                            # Internal specifications and ADRs
|-- contracts/                       # Solidity smart contract (Polygon anchoring)
|-- workers/                         # Worker threads (obfuscation)
|-- viewer/                          # Electron desktop viewer v1.1.0
|-- viewer-tauri/                    # Tauri desktop viewer (in progress)
|-- data/                            # Local secrets storage (gitignored): .hmac_secret, .session_secret
`-- output/                          # Generated PVF output (local dev only)
```

---

## 12. Deployment

### Hosting

Production is deployed on **Render** (web service). The `Procfile` defines the start command. `nixpacks.toml` configures the Nixpacks build. A `Dockerfile` and `docker-compose.yml` are also provided for containerized local development.

### Database

**Neon PostgreSQL** (Frankfurt region). The connection string is provided via `DATABASE_URL`. Neon provides serverless connection pooling; the application uses its own `pg.Pool` with 20 connections.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string (must be SSL in production) |
| `HMAC_SECRET` | Yes | HMAC signing secret. Auto-generated to `data/.hmac_secret` in development if absent. |
| `SESSION_SECRET` | Yes | Express session secret. Must be set as an env var on Render — missing in production causes an ephemeral secret (sessions lost on restart). |
| `ADMIN_SECRET` | Yes | Admin dashboard access token (`X-Admin-Secret` header) |
| `ED25519_PRIVATE_KEY_PEM` | Yes (production) | Primary Ed25519 signing key (PEM format). Absence in production logs a warning; signing.signEd25519() returns null. |
| `ED25519_PRIMARY_KEY_ID` | Yes (with above) | 16-character key ID for the primary Ed25519 slot |
| `ED25519_NEXT_PRIVATE_KEY_PEM` | Rotation only | Next Ed25519 key slot (present only during a rotation window) |
| `ED25519_NEXT_KEY_ID` | Rotation only | Key ID for the next slot |
| `POLYGON_PRIVATE_KEY` | No | Polygon wallet private key for blockchain anchoring |
| `POLYGON_CONTRACT` | No | Deployed smart contract address |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

`env-validator.js` runs at boot and exits immediately with a clear error message if any required variable is absent when `NODE_ENV=production` or `RENDER` is set.

### Generating Secrets

```bash
# SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# HMAC_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Ed25519 key pair
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
"
```

---

## 13. Testing

The test suite uses Node's built-in `node:test` runner exclusively — zero additional test framework dependencies.

**Current count:** 1 046 test cases across 20+ test suites.

### Running Tests

```bash
# Full suite
npm test

# Individual suites
npm run test:signing
npm run test:verify-ed25519
npm run test:webhook-security
# See package.json for the complete list
```

### Test Coverage by Domain

| Domain | What is tested |
|---|---|
| Signing pipeline | HMAC-SHA256 generation, canonical payload construction, payload separators |
| Ed25519 verification | Signature generation, backward-compatible key lookup, key ID embedding |
| Public verify | Stateless endpoint behavior, missing fields, tampered payloads |
| Zero-knowledge encryption | PVF 2.0 encrypted flag, IV handling |
| Key rotation | State machine transitions, genesis row idempotency, grace period |
| Webhook security | HMAC-signed delivery, secret rotation, retry logic |
| Input sanitization | XSS patterns, null bytes, oversized payloads |
| Environment validation | Missing required vars, production vs. development guards |
| Password policy | Strength rules, history enforcement |
| CSRF | Token generation, token validation, bypass for API-key paths |
| Admin actions | Key rotation command, audit log, user management |
| Account lifecycle | Signup, login, lockout, password reset, session expiry |
| API key lifecycle | Issuance, revocation, rate limit enforcement |
| User branding | Stamp config, custom icon, brand color |

### Unit vs. E2E

Most suites are unit tests that import service modules directly and test against a test database or in-memory fixtures. E2E tests (`tests/e2e/`) spin up the full Express application and make real HTTP requests — they require a `DATABASE_URL` pointing to a test Neon branch or a local PostgreSQL instance.

---

## 14. Observability

### Health Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health` | None | Shallow health check: process uptime, memory usage, Node version. Always returns 200 if the process is running. |
| `GET /api/health/deep` | Admin | Deep health check: DB connectivity, Ed25519 key slot status, active key ID, cache last-invalidated timestamp, Polygon connection (if configured). Returns 200 or 503. |

Results from deep health checks are written to the `health_checks` table for trending.

### Metrics

```
GET /api/metrics
```

Returns a Prometheus-compatible text exposition. Tracked metrics include:

- HTTP request count and duration (per route, per status code)
- PVF documents created (total and per org)
- Ed25519 signing successes and failures
- Database query latency
- Blockchain anchor queue depth

### Logging

All structured logging uses **Pino** (`services/logger.js`). Logs are written as newline-delimited JSON to stdout, which Render captures and streams to its log dashboard.

Log levels: `error`, `warn`, `info`, `debug`. Production defaults to `info`.

PII scrubbing is applied in `middleware/request-logger.js` before any request fields are written to the log — email addresses, IP addresses, and authorization headers are either removed or hashed before logging.

Pino's child logger pattern is used in individual modules:

```js
const logger = require('./services/logger');
logger.info({ event: 'pvf_created', orgId, shareId }, 'PVF created');
```

Security-relevant events (login success/failure, key rotation, admin actions, PVF creation) are written to both the Pino log stream and the `audit_log` database table for durable, queryable audit trails.
