# Prompt 3 — Drawings (attach: 3_Vertifile_Drawings_FULL.pdf)

Copy this entire block into a fresh Claude chat. Attach the original PDF as a file.

---

You are helping me update the Drawings document for Vertifile PVF (originally filed March 17, 2026). The original has 6 figures. I need updated figures + 3 new ones for novel mechanisms. Total: 9 figures.

## Updates to Existing Figures

### Figure 1 (Authentication Flow) — REPLACE
New 12-step flow:
1. Issuer uploads document via authenticated API
2. Server computes SHA-256 hash
3. Server signs canonical payload (hash|orgId|createdAt|recipientHash|codeIntegrity) with HMAC-SHA256
4. Server signs SAME payload with Ed25519 (fail-closed: required)
5. Both signatures + ed25519_key_id stored in documents row
6. PVF HTML generated with embedded document + both signatures
7. If PDF: PDF.js main library injected inline, worker served via static asset
8. Obfuscator runs on main viewer script (NOT the PDF.js bundle — it has data-vf-bundle attribute)
9. Final PVF emitted with /d/{shareId} URL
10. Recipient opens URL, POST /api/verify with hash + both signatures + codeIntegrity
11. Server validates: hash matches, HMAC valid, Ed25519 valid, codeIntegrity matches
12. VALID = green stamp (1.2s coin flip) | INVALID = red FORGED banner

### Figure 2 (File Structure) — REPLACE with new 8-layer structure
Layer 1: Original document (base64-embedded)
Layer 2: HMAC-SHA256 signature
Layer 3: Ed25519 signature
Layer 4: Cryptographic stamp animation (1.2s coin flip)
Layer 5: Conditional PDF.js bundle (PDF only)
Layer 6: Code Integrity hash chain
Layer 7: Environment Detection
Layer 8: Obfuscated JavaScript

### Figure 3 (Verification Flow) — REPLACE with actual dual-signature decision tree
Steps: Open PVF -> Extract signatures -> POST /api/verify -> Server checks: hash exists? -> codeIntegrity matches? -> HMAC valid? -> Ed25519 valid? -> All pass = VERIFIED (green) / Any fail = specific error reason (FORGED red)

### Figure 4 (License Control) — UPDATE
Add "API keys stored as bcrypt hashes" node. Add "Audit log" node.

### Figure 5 (Security Layers) — REPLACE with current 8 layers
1. Dual signing (HMAC + Ed25519, fail-closed)
2. Key rotation state machine (Phase 3A/3B)
3. JWKS public key endpoint
4. Code Integrity hash chain
5. TLS 1.3
6. Environment Detection (under review)
7. License Control (bcrypt, IP whitelist)
8. Immutable Audit Log

### Figure 6 (Roadmap) — REPLACE
Phase 1 (DONE): .pvf format, HMAC signing
Phase 2A-E (DONE): Ed25519 dual-signing, fail-closed
Phase 3A-B (DONE): Key rotation, two-slot manager, CLI
Phase 3C-E (PLANNED): Rotation log, runbook, wet drill
Phase 4 (PLANNED): Polygon blockchain, IANA MIME, SOC 2
Phase 5 (PLANNED): Electron viewer, eIDAS, HIPAA
Use solid bars for DONE, dashed for PLANNED. Current date marker at April 2026.

## 3 New Figures

### Figure 7 — Key Rotation State Machine (NEW)
State diagram: pending -> active -> grace -> expired
Allowed transitions only. Red X on reverse transitions (active->pending, grace->active, expired->anything).
Caption: "BEFORE UPDATE trigger enforces monotonic transitions"

### Figure 8 — Code Integrity Hash Chain (NEW)
Two columns: Issuance (left) vs Verification (right)
Issuance: generate obfuscated JS -> sha256 -> store in documents row -> include in canonical payload
Verification: client recomputes sha256 from DOM -> POST to /api/verify -> server compares -> match=verified / mismatch=code_tampered
Callout: "selector excludes data-vf-bundle tags"

### Figure 9 — Inline PDF.js Pipeline (NEW)
Two swim lanes: Upload Pipeline / Runtime Viewer
Upload: detect PDF mime -> inject pdf.min.mjs inline -> obfuscator skips bundle tags (regex match) -> emit PVF
Runtime: browser loads inline pdfjsLib -> set workerSrc to same-origin static URL -> decode base64 -> getDocument -> render Canvas per page -> IntersectionObserver lazy render -> thumbnails sidebar
18 numbered steps total.

## Format
- Same bilingual Hebrew+English captions
- Same clean flowchart/diagram style
- 9 figures total (was 6)
- 6-7 pages (was 4)
- "NEW APRIL 2026" badge on figures 7-9
- No emojis
- Footer: "Vertifile Ltd. | PVF Patent Application | Israel Patents Office | April 2026 | 3 of 3 — Drawings"
