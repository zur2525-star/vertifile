# Vertifile - PVF Project

## Overview
Tamper-proof document verification platform. Creates cryptographically signed .pvf files with BLIND processing (never reads document content). Live at **vertifile.com**.

## Domain & Hosting
- **Domain:** vertifile.com (Namecheap, registered March 2026)
- **Hosting:** Render (Frankfurt, free tier) — auto-deploys from GitHub
- **Database:** PostgreSQL on Neon (Frankfurt, free tier) — persistent
- **Email:** info@vertifile.com (Namecheap Private Email)
- **Repo:** github.com/zur2525-star/vertifile

## Tech Stack
- **Backend:** Express.js 5, PostgreSQL (pg), ethers.js (Polygon blockchain)
- **Frontend:** Vanilla HTML/JS in `/public/`, 10 languages (i18n)
- **Viewers:** Electron (`/viewer/`) and Tauri (`/viewer-tauri/`)
- **Port:** 3002

## Key Commands
- `npm install` — install dependencies
- `npm run dev` — start dev server
- `npm test` — run tests (65 test cases)
- `node server.js` — start production server

## Environment Variables (Render)
- `DATABASE_URL` — Neon PostgreSQL connection string
- `HMAC_SECRET` — document signing secret (persistent)
- `ADMIN_SECRET` — dashboard access token
- `POLYGON_PRIVATE_KEY` — blockchain wallet (optional)
- `POLYGON_CONTRACT` — smart contract address (optional)

## Important Paths
- `server.js` — main Express API (all endpoints)
- `db.js` — PostgreSQL database layer (async, uses pg Pool)
- `blockchain.js` — Polygon integration with timeout/retry
- `sdk.js` — CLI/SDK for .pvf conversion
- `obfuscate.js` — PVF JavaScript obfuscation
- `public/` — all frontend HTML pages (8 pages + privacy + terms + 404 + dashboard)
- `public/js/i18n.js` — shared i18n engine (10 languages)
- `public/locales/` — translation files (en, he, ar, fr, es, de, ru, zh, ja, pt)
- `viewer/` — Electron desktop app (PVF Viewer)
- `viewer-tauri/` — Tauri desktop app
- `contracts/VertifileRegistry.sol` — Polygon smart contract
- `spec/` — PVF format specification and IANA registration

## Pages
- `/` — homepage (landing)
- `/upload` — protect a document
- `/verify` — verify a document
- `/demo` — interactive demo (dark theme)
- `/open` — open PVF files online (dark theme)
- `/enterprise` — enterprise plans
- `/integration` — API documentation
- `/signup` — developer signup
- `/privacy` — privacy policy
- `/terms` — terms of service
- `/dashboard` — admin dashboard (requires ADMIN_SECRET)

## API Endpoints
- `POST /api/create-pvf` — create PVF (requires API key)
- `POST /api/verify` — verify document hash
- `POST /api/token/refresh` — refresh verification token
- `POST /api/signup` — developer signup (rate limited: 3/day per IP)
- `POST /api/demo/create-pvf` — demo PVF creation (5/hour limit)
- `GET /api/health` — server status
- `GET /api/docs` — API documentation redirect
- `GET /api/admin/*` — admin endpoints (requires ADMIN_SECRET)
- `GET /d/:shareId` — shareable document links

## Security
- HMAC-SHA256 document signatures with timing-safe comparison
- Helmet security headers (HSTS, X-Frame-Options, CSP, etc.)
- Rate limiting on all endpoints
- Input sanitization (escapeHtml) on user inputs
- PostgreSQL parameterized queries ($1, $2) — no SQL injection
- CORS restricted to allowed origins
- Cloudflare WAF protection via Render
- Admin secret with timing-safe comparison

## i18n
- Shared engine in `/public/js/i18n.js`
- All pages use `data-i18n` attributes
- RTL support for Hebrew and Arabic
- Language selector in navbar (all pages)
- Translation files in `/public/locales/*.json`

## Architecture Notes
- PVF files are self-contained HTML with embedded verification JS
- BLIND processing: server hashes file bytes, never reads content
- Offline fallback: PVF files can verify locally via embedded hash
- Online verification calls `/api/verify` on vertifile.com
- Token refresh every 30 seconds keeps verification alive
- Blockchain anchoring (optional) on Polygon for immutable proof
