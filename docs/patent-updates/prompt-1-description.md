# Prompt 1 — Description (attach: 1_Vertifile_Description_FULL.pdf)

Copy this entire block into a fresh Claude chat. Attach the original PDF as a file.

---

You are helping me update a patent application document from March 17, 2026 for Vertifile PVF. The original document is attached. Three weeks of intensive engineering have passed and the cryptographic architecture has evolved significantly. Generate an UPDATED version of the Description document that reflects the current state, while preserving the exact patent application format, bilingual Hebrew+English structure, section numbering, and tone.

## Who I Am
Zur Halfon, founder of Vertifile Ltd. Israeli entrepreneur. Patent filed in Israel March 2026 — this is a refresh to reflect implementation reality.

## What Vertifile Is Today (April 10, 2026)
Tamper-proof document protection platform. Users upload any document (PDF, image, DOCX, TXT) and Vertifile generates a self-verifying PVF (Protected Verified File). The PVF is an HTML container with the original document embedded plus cryptographic signatures, an inline live verification stamp, and (for PDFs) inline PDF.js rendering with a thumbnails sidebar. Recipients open the PVF in any browser and see "Verified" with a visible cryptographic stamp, all without login.

## Changes to Apply

### Section 4.1 — Core Principle
Update from "live animation as sole indicator" to "live cryptographic stamp animation as primary visual indicator, backed by dual cryptographic signature verification". The animation runs ONCE on page load (1.2 seconds coin flip, not looping). The animation is decorative; the SECURITY is the dual signature.

### Section 4.2 — File Structure (replace the 7-layer structure)
New 8-layer structure:
- Layer 1: Original document content (base64-embedded inside HTML — NOT AES-256 app-layer encryption; database-at-rest TDE via Neon Postgres)
- Layer 2: HMAC-SHA256 signature (canonical payload: hash|orgId|createdAt|recipientHash|codeIntegrity)
- Layer 3: Ed25519 digital signature (same canonical payload, separate key)
- Layer 4: Cryptographic stamp animation (CSS/SVG, runs once on load)
- Layer 5: Conditional inline PDF.js bundle (~344 KB, injected ONLY for PDF documents, served via same-origin static asset for the worker)
- Layer 6: Code Integrity hash chain — sha256 of the obfuscated viewer script, validated server-side at every /api/verify call
- Layer 7: Environment Detection (DevTools / IDE / text editor — under review per UX feedback)
- Layer 8: Obfuscated JavaScript (javascript-obfuscator with controlFlowFlattening, stringArray, hex identifiers)

### Section 4.4 — Eight Security Layers (replace entirely)
- Layer 1: Dual cryptographic signing — HMAC-SHA256 + Ed25519. Phase 2E (ED25519_REQUIRED=1) makes Ed25519 mandatory and fail-closed
- Layer 2: Key rotation state machine — Phase 3A schema with monotonic forward transitions (pending/active/grace/expired). BEFORE UPDATE trigger. Phase 3B two-slot key-manager. Zero-downtime rotation.
- Layer 3: Public Key Verification — JWKS endpoint at /.well-known/vertifile-jwks.json publishes active and grace public keys for independent third-party verification
- Layer 4: Code Integrity Hash Chain — server validates sha256 of the obfuscated viewer script on every /api/verify call. Tampering with the viewer is detected immediately.
- Layer 5: TLS 1.3 + Certificate Pinning (Render infrastructure)
- Layer 6: Environment Detection — DevTools/IDE detection (NOTE: under review, may become opt-in per organization)
- Layer 7: License Control — per-organization API keys with IP whitelist; immediate cascading revocation; bcrypt-hashed storage
- Layer 8: Immutable Audit Log — every issuance and verification logged with identity, timestamp, IP

### Section 4.6 — Blockchain Integration
SOFTEN to future tense: "Phase 4 — Blockchain Permanence". Polygon integration is architecturally planned but NOT yet live. Current /api/health/deep reports "blockchain":"off-chain". Do NOT remove section (the claim is valid as planned feature) but make clear it's Phase 4.

### Section 4.7 — Standalone Desktop Viewer
SOFTEN to "Phase 5 — Standalone Desktop Viewer". Architecture reservations exist (__pvfDesktopViewer flag) but no Electron build yet.

### ADD Section 4.9 — Inline PDF Rendering with Conditional Bundling
New feature (April 2026): when document is PDF, pdf.min.mjs (~344 KB) is injected inline into PVF at upload time. Worker loaded from same-origin static asset. Each page rendered to Canvas via PDF.js. Right-side thumbnails sidebar (macOS Preview-style) with page navigation. DPR cap by page count (2x at 10 pages, 1.5x at 25, 1x at 26+). Works fully offline for the inline main library; worker requires vertifile.com to be reachable. Non-PDF PVFs remain byte-identical (zero bloat).

### ADD Section 4.10 — Code Integrity Hash Chain
New mechanism: every PVF embeds sha256 of its obfuscated viewer script. Server stores in documents.code_integrity. Client recomputes and submits on every /api/verify. Mismatch = "code_tampered" = FORGED. Selector excludes data-vf-bundle attributes so PDF.js bundle is not part of the hash.

### Section 5 — Comparison Table
Add columns: "Tamper Detection at Viewer Level" and "Inline PDF Rendering Without Plugin". Both "Yes" for Vertifile.

### Section 7 — Development Roadmap (replace entirely)
- Phase 1 (DONE, March 2026): .pvf format, server, viewer template, basic HMAC signing
- Phase 2A-E (DONE, March-April 2026): Ed25519 dual-signing, fail-closed
- Phase 3A-B (DONE, April 2026): Key rotation state machine, two-slot manager, CLI
- Phase 3C-E (PLANNED): Public rotation log, runbook, wet drill
- Phase 4 (PLANNED, Q2-Q3 2026): Polygon blockchain, IANA MIME finalized, SOC 2
- Phase 5 (PLANNED, Q3-Q4 2026): Electron viewer, eIDAS Europe, HIPAA US

### Section 8 — Registration
Update IANA MIME line: "application/pvf is PENDING review under tracking number #1446680."

## Important Constraints
- Use PRESENT TENSE for implemented features, FUTURE TENSE for planned
- Do NOT claim HSM key storage (current: environment variables on Render)
- Do NOT claim eID/Ramzor integration (current: Google OAuth + email/password)
- Do NOT claim live Polygon blockchain (current: off-chain)
- DO emphasize key rotation state machine as novel claim
- DO emphasize inline PDF.js conditional bundling as novel claim
- Bilingual: every section in BOTH Hebrew and English
- No emojis
- Same format, fonts, purple branding as original
- Footer: "Vertifile Ltd. | PVF Patent Application | Israel Patents Office | April 2026 | 1 of 3 — Description"
