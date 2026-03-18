# Vertifile - PVF Project

## Overview
Tamper-proof document verification platform. Creates cryptographically signed .pvf files.

## Domain
- **vertifile.com** (Namecheap, registered March 2026)
- Needs to be deployed and connected to this domain

## Tech Stack
- **Backend:** Express.js 5.2.1, SQLite (better-sqlite3), ethers.js (Polygon)
- **Frontend:** Vanilla HTML/JS in `/public/`
- **Viewers:** Electron (`/viewer/`) and Tauri (`/viewer-tauri/`)
- **Port:** 3002

## Key Commands
- `npm install` — install dependencies
- `npm run dev` — start dev server
- `npm test` — run tests

## Deployment
- Vercel config exists (`vercel.json`)
- Railway config exists (`railway.json`)
- Heroku Procfile exists

## Important Paths
- `server.js` — main Express API
- `blockchain.js` — Polygon integration
- `db.js` — SQLite layer
- `sdk.js` — CLI/SDK for .pvf conversion
- `public/` — all frontend HTML pages
- `viewer/` — Electron desktop app
- `contracts/VertifileRegistry.sol` — smart contract
