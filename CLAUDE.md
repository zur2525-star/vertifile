# Vertifile PVF — Master Architecture & Work Plan

## Overview
Tamper-proof document verification platform. Creates cryptographically signed .pvf files with BLIND processing (never reads document content). Live at **vertifile.com**.
Patent filed in Israel (March 2026). IANA MIME type pending: application/vnd.vertifile.pvf (#1446680).

## Domain & Hosting
- **Domain:** vertifile.com (Namecheap)
- **Hosting:** Render (Frankfurt, free tier) — auto-deploys from GitHub
- **Database:** PostgreSQL on Neon (Frankfurt, free tier, 0.5GB limit)
- **Email:** info@vertifile.com, privacy@vertifile.com
- **Repo:** github.com/zur2525-star/vertifile

## Tech Stack
- **Backend:** Node.js + Express, PostgreSQL (pg), ethers.js (Polygon blockchain)
- **Frontend:** Vanilla HTML/JS/CSS in `/public/`, 10 languages (i18n)
- **Viewers:** Electron (`/viewer/`), Tauri (`/viewer-tauri/`)
- **Port:** 3002

## Key Commands
- `npm install` — install dependencies
- `npm run dev` — start dev server
- `node server.js` — start production server
- `cd viewer && npm run build` — build Electron DMG

## Environment Variables (Render)
- `DATABASE_URL` — Neon PostgreSQL connection string
- `HMAC_SECRET` — persistent (auto-generated to data/.hmac_secret)
- `SESSION_SECRET` — persistent (auto-generated to data/.session_secret)
- `ADMIN_SECRET` — dashboard access token
- `POLYGON_PRIVATE_KEY` — blockchain wallet (optional)
- `POLYGON_CONTRACT` — smart contract address (optional)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth

---

## File Structure (After Split)

```
pvf-project/
├── server.js              ← 165 lines — bootstrap only
├── db.js                  ← PostgreSQL layer
├── blockchain.js          ← Polygon + batch queue
├── obfuscate.js           ← Obfuscation config
├── middleware/auth.js      ← authenticateApiKey, requireLogin, rate limiters
├── services/pvf-generator.js ← HMAC secret, hash, sign, handleCreatePvf
├── templates/pvf.js        ← generatePvfHtml (~730 lines)
├── workers/obfuscate-worker.js ← Worker thread for non-blocking obfuscation
├── routes/
│   ├── auth.js            ← register, login, logout, Google OAuth
│   ├── user.js            ← documents, branding, settings, upload
│   ├── api.js             ← create-pvf, verify, health, signup, org/*
│   ├── admin.js           ← dashboard, audit, keys management
│   ├── gateway.js         ← intake, batch (enterprise)
│   ├── webhooks.js        ← register, list, delete, fireWebhooks
│   └── pages.js           ← static pages, /d/:shareId, 404
├── public/
│   ├── index.html, pricing.html, verify.html, upload.html
│   ├── app.html, dashboard.html, enterprise.html, integration.html
│   ├── demo.html, signup.html, about.html, contact.html
│   ├── privacy.html, terms.html, 404.html
│   ├── js/i18n.js, js/nav-user.js
│   ├── locales/ (en, he, ar, fr, es, de, ru, zh, ja, pt)
│   ├── images/
│   └── api/openapi.json
├── viewer/                ← Electron v1.1.0
│   ├── main.js, preload.js, viewer.html, package.json
└── viewer-tauri/          ← Tauri (less mature)
```

---

## 9 Security Layers

```
1. SHA-256 Hash          — unique fingerprint per file
2. HMAC Signature        — server secret signing
3. Token Refresh (5min)  — session token rotation
4. Code Integrity        — SHA-256 of JS after obfuscation
5. Chained Token         — HMAC(hash + sig + orgId + codeIntegrity)
6. Anti-DevTools         — F12 detection, right-click block
7. Obfuscation           — JavaScript obfuscated in worker thread
8. Holographic Stamp     — animated coin + waves, freezes if tampered
9. Blockchain (Polygon)  — optional on-chain anchor with batch queue
```

---

## משפך השליטה — כל שינוי עובר את זה

```
/brainstorming → Serena scan → /tdd → build (sub-agents) → /reviewer → /commit → health-check → customer-simulator
```

**חוק ברזל: אסור לאשר שינוי שלא עבר את כל השלבים.**

## /reviewer — חובה אחרי כל פיצ'ר (8 נקודות)

```
1. האם הקוד עוקב אחרי הארכיטקטורה? (routes/, services/, templates/)
2. האם יש error handling לכל מקרה קצה?
3. האם יש tests?
4. האם אין secrets בקוד?
5. האם ה-endpoint מאובטח (auth + rate limit + validation)?
6. האם ה-UI תואם את שאר המערכת (צבעים, פונטים, RTL)?
7. האם יש תרגום לכל 10 שפות לכל string חדש?
8. האם ה-commit message ברור?
אם אחד נכשל → עצור. תקן. ואז /reviewer מחדש.
```

---

## CLAUDE.md — יומן שינויים אוטומטי

בכל commit ו-push — תוסיף שורה לסוף הקובץ הזה:

```
[תאריך שעה] | [פעולה] | [קובץ/מערכת] | [מה השתנה] | [סטטוס: ✓ / ✗]
```

---

## Sub-Agents

### QA (5 במקביל)
- **agent-security-audit** — SQL injection, XSS, rate limiting, CSP
- **agent-html-checker** — 16 דפים: SEO, נגישות, לינקים שבורים
- **agent-i18n-validator** — 10 שפות, מפתחות חסרים, RTL
- **agent-api-tester** — כל endpoint: health, verify, create-pvf, share
- **agent-document-flow** — upload → PVF → verify → share end-to-end

### לקוחות (4 במקביל)
- **agent-hr-manager** — מאיה, HR, בודקת אימות תעודות
- **agent-university** — ד"ר שרה, רשמת, בודקת integration
- **agent-developer** — אלכס, backend dev, בודק API docs
- **agent-lawyer** — עו"ד דוד, בודק privacy/terms/קבילות

### בנייה (3 במקביל)
- **agent-build-feature** — /brainstorming → Serena → /tdd → build → /reviewer
- **agent-translate-all** — תרגום מפתחות חדשים ל-10 שפות
- **agent-fix-bugs** — תיקון באגים מרובים במקביל

---

## Scheduled Tasks

- `health-monitor` (כל שעה) — GET /api/health + /api/health/deep
- `daily-security-scan` (08:00) — npm audit, secrets check
- `weekly-db-check` (ראשון 09:00) — DB size, document count

---

## Skills

- `/pptx` — pitch deck למכללות/משקיעים
- `/docx` — one-pager, DPA, case study, הצעת מחיר
- `/pdf` — מסמכי דמו (דיפלומה, חשבונית, תעודה רפואית)
- `/xlsx` — tracking לקוחות, עלויות, הכנסות
- `/commit` — commit + push
- `/brainstorming` — חשיבה מובנית לפני בנייה
- `/tdd` — test → fail → implement → pass → refactor
- `/debug` — reproduce → investigate → fix → verify

---

## Plugins

- **Serena** — semantic code navigation (find_symbol, find_referencing_symbols)
- **Superpowers** — /brainstorming, /tdd, /debug, /execute-plan
- **Claude Preview** — UI preview and inspection
- **Claude in Chrome** — browser automation
- **Scheduled Tasks** — automated recurring tasks

---

## Current Status

| Area | % | Status |
|------|---|--------|
| Code + Security | 90% | ✅ 9 layers, split into modules |
| Design + UX | 80% | ✅ All pages, responsive, animations |
| i18n | 95% | ✅ 10 languages, ~800 keys each |
| PVF Viewer | 90% | ✅ Mac app, menus, print, properties |
| Infrastructure | 60% | ⚠️ Render free = sleeps |
| Marketing | 30% | ⚠️ No video, blog, case study |
| Legal | 25% | ⚠️ No SOC2, DPO, PCT |
| Customers | 0% | 🔴 No paying customer |

## Priorities

### CRITICAL — before first customer
- [ ] Upgrade Render to $7/month
- [ ] About page with real name + photo
- [ ] Document flow works end-to-end without errors

### HIGH — before sales
- [ ] Demo video (60 seconds)
- [ ] Alert system (forgery → email)
- [ ] Auto-update in Electron Viewer
- [ ] Demo PDFs (diploma, medical cert, invoice)

### MEDIUM — before scale
- [ ] Windows build + Code Signing
- [ ] Blog post
- [ ] Client SDK (NPM package)
- [ ] Stripe integration

### LOW — later
- [ ] SOC2 compliance
- [ ] Polygon Mainnet
- [ ] HSM hardware

---

## Pre-Commit / Pre-Push Rules

**כל commit חייב לעבור את הצעדים הבאים לפני push:**

```
── pre-commit ──
1. node --check [כל קובץ JS שהשתנה] → syntax error = עצור
2. npm audit → CRITICAL/HIGH = עצור, תקן
3. npm test → test נכשל = עצור, תקן
4. grep -r "console.log" routes/ services/ middleware/ → הסר
5. grep secrets (sk_, hardcoded password/SECRET) → עצור מיד

── commit format ──
type: תיאור קצר

  fix:      תיקון באג
  feat:     פיצ'ר חדש
  security: תיקון אבטחה
  refactor: שיפור קוד
  test:     טסטים
  chore:    תחזוקה

── pre-push ──
npm audit --audit-level=high → נכשל = חסום push

── אחרי commit ──
רשום ל-CLAUDE.md:
[תאריך] | COMMIT | [קבצים] | [הודעה] | npm audit ✓ | tests ✓ | ✓
```

---

## Change Log
2026-03-22 02:30 | SAVE | CLAUDE.md | Updated to master architecture prompt with full workflow | ✓

2026-03-22 08:15 | SCAN | Serena onboarding | 624 files, 28606 lines, 55 endpoints, 2 warnings fixed | ✓
2026-03-22 08:16 | FIX | admin.js + server.js | Unified authenticateAdmin to middleware/auth.js, removed duplication | ✓
2026-03-22 08:16 | FIX | .gitignore | Added data/pvf/ to prevent repo bloat | ✓

2026-03-22 08:30 | FIX | admin.js | keys-legacy now uses authenticateAdmin middleware | ✓
2026-03-22 08:30 | FIX | api.js | Added rate limit to 5 org endpoints | ✓

2026-03-22 09:00 | REFACTOR | services/logger.js + 6 files | pino logger, 16 console.log replaced, pre-commit blocks console.log | ✓

2026-03-22 09:30 | FEAT | db.js + admin.js | Monitoring system: health_checks table, logHealthCheck, getUptimeStats, /admin/monitoring, /admin/uptime, /admin/self-check | ✓

2026-03-22 10:00 | FIX | admin.js | Added missing getClientIP import (CRITICAL — would crash on key creation) | ✓
2026-03-22 10:00 | REFACTOR | blockchain.js, server.js, db.js, obfuscate.js | Replaced all console.* with pino logger | ✓
2026-03-22 10:00 | FIX | server.js | gracefulShutdown now awaits flushQueue before exit | ✓

2026-03-22 10:30 | FIX | admin.js | Added try/catch to 10 handlers, auth on self-check, no e.message leak | ✓
2026-03-22 10:30 | FIX | webhooks.js | Added try/catch to list + delete handlers | ✓
2026-03-22 10:30 | FIX | locales/*.json | Added verify.ctaText + ctaLink to all 10 locales | ✓

2026-03-22 11:00 | SECURITY | server.js | CORS tightened to vertifile.com only | ✓
2026-03-22 11:00 | SECURITY | server.js | Added Permissions-Policy, DNS-Prefetch, Referrer headers | ✓
2026-03-22 11:00 | SECURITY | middleware/sanitize.js | Input sanitization — XSS escape, null bytes, 10K limit | ✓
2026-03-22 11:00 | FEAT | middleware/timeout.js | Request timeout 30s | ✓
2026-03-22 11:00 | FEAT | db.js | DB retry with exponential backoff (3 attempts) | ✓
2026-03-22 11:00 | FEAT | server.js | Memory guard — warns at 90% heap usage | ✓
2026-03-22 11:00 | FEAT | middleware/request-logger.js | Request logging with pino (skips health) | ✓
2026-03-22 11:00 | FEAT | middleware/response-envelope.js | API responses with requestId + timestamp | ✓
