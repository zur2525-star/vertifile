# Prompt 2 — Claims (attach: 2_Vertifile_Claims_FULL.pdf)

Copy this entire block into a fresh Claude chat. Attach the original PDF as a file.

---

You are helping me update the Patent Claims document for Vertifile PVF (originally filed March 17, 2026). The original document is attached. The architecture has evolved — I need an UPDATED version with revised claims + 4 new claims for novel features.

## Changes to Existing Claims

### Claim 1 (Independent — Core System) — REVISE
Add sub-clauses:
- Dual cryptographic signing module (HMAC-SHA256 + Ed25519 on same canonical payload, both must validate)
- Code Integrity Hash Chain mechanism (sha256 of obfuscated viewer JS, validated server-side)

### Claim 2 (Independent — Verification Method) — REVISE
Replace single-hash verification with dual signature verification (HMAC + Ed25519). Soften blockchain to optional: "can verify against blockchain record if available, otherwise against Ed25519 public key via JWKS endpoint."

### Claim 3 (Animation Uniqueness) — SOFTEN
Animation is no longer sole indicator. Reword: "serves as primary visual indicator of successful verification."

### Claim 4 (Environment Detection) — ADD CLARIFIER
Add: "this mode can be enabled or disabled per issuing organization's policy."

### Claim 5 (License Control) — ADD
Add: API keys stored as bcrypt hashes in database.

### Claim 6 (Offline Protection) — REVISE SIGNIFICANTLY
Original says "offline = frozen = invalid". Reality: system has showLocal() fallback. New wording: "Online mode uses real-time Token verification. Offline mode relies on internal Ed25519 signature only, with appropriate UI status."

### Claim 7 (Standalone Viewer) — ADD PHASE NOTE
Note as Phase 5 future implementation.

### Claim 8 (Blockchain Permanence) — SOFTEN
Reword as forward-looking Phase 4 claim: "the system is designed for integration with a public blockchain."

### Claims 9-11 — KEEP AS-IS
(Recipient Binding, Code Obfuscation, Regulatory Framework)

## 4 New Claims to Add

### Claim 12 (Independent — Key Rotation State Machine)
A method for managing cryptographic signing keys comprising:
(a) Database schema with state column (pending/active/grace/expired)
(b) BEFORE UPDATE trigger enforcing monotonic forward transitions (no rollback)
(c) Two-slot key manager loading current active + pending/grace keys simultaneously for zero-downtime rotation
(d) 90-day grace period where previous key validates older documents
(e) CLI tool (rotate-ed25519-key) with generate/activate/retire subcommands and pre-flight health check
(f) Partial UNIQUE indexes ensuring at most one active key and one pending key
(g) JWKS endpoint publishing active + grace public keys
(h) 30-second cache TTL for cross-process invalidation

### Claim 13 (Dependent on 1 — Code Integrity Hash Chain)
(a) Server computes sha256 of obfuscated viewer JS at issuance
(b) Hash stored in canonical signing payload
(c) Client recomputes hash from loaded DOM at verification time
(d) Server compares; mismatch = 'code_tampered' = verification failure
(e) DOM selector excludes data-vf-bundle and data-vf-stamp-override scripts

### Claim 14 (Dependent on 1 — Conditional Inline PDF Rendering)
When document mime is application/pdf:
(a) PDF.js main library injected inline at issuance, worker served from same-origin static asset
(b) Bundle wrapped in script tags with data-vf-bundle attributes (excluded from codeIntegrity)
(c) Non-PDF documents get zero bloat
(d) Each page rendered to separate Canvas via getDocument().getPage().render()
(e) Thumbnails sidebar with page navigation via IntersectionObserver
(f) DPR capped by page count (2x/1.5x/1x) to bound memory
(g) Worker loaded from same-origin HTTPS, no CDN dependency

### Claim 15 (Dependent on 1 — Fail-Closed Signing)
(a) ED25519_REQUIRED flag, when set to '1', rejects any upload without a loaded Ed25519 key
(b) No document can be issued in HMAC-only mode in production
(c) Boot-time PEM/keyId consistency check

## Format
- Same bilingual Hebrew+English structure
- Patent formal language ("the system of Claim X, comprising...")
- 15 claims total (was 11)
- 4-5 pages (was 3)
- No emojis
- Footer: "Vertifile Ltd. | PVF Patent Application | Israel Patents Office | April 2026 | 2 of 3 — Claims"
