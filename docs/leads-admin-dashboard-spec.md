# Spec — Leads Capture + Admin Dashboard

**Author:** Ori (orchestrator) · **Date:** 2026-06-05 · **Branch:** `feature/leads-admin-dashboard`

## Goal
Give the owner ONE place to see who is interested, who wants a callback, and who registered — and stop losing inbound leads.

## Problem found
1. `/api/contact` requires `organization`, but `contact.html` never sends it → **every contact submission returns 400 and is lost** (`routes/api.js:1319`, `public/contact.html:549`).
2. Contact data only lands in `audit_log` (no clean leads list). No phone, no "request a callback".
3. No admin UI — `/api/admin/*` endpoints exist but gated by `X-Admin-Secret` header only; `/api/admin/users` does not exist.

## THE CONTRACT (authoritative — do NOT deviate; if you think it's wrong, STOP and report)

### A. `leads` table (new migration)
```sql
CREATE TABLE IF NOT EXISTS leads (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  organization   TEXT,
  subject        TEXT,
  message        TEXT,
  wants_callback BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'new',      -- new | contacted | closed
  source         TEXT NOT NULL DEFAULT 'contact_form',
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
```
Follow the existing migration mechanism in `db.js` / `migrations/` (match how `users`/`onboarding_state` are created). Use TIMESTAMPTZ to match existing convention.

### B. `POST /api/contact` (public) — request JSON
```
name           string  REQUIRED
email          string  REQUIRED (valid email)
subject        string  optional, one of: general|support|enterprise|partnership  (default 'general')
phone          string  optional
message        string  optional
wantsCallback  boolean optional (default false)
organization   string  optional   ← keep accepting it, but it is NO LONGER required
```
- Validate: require `name` + valid `email` ONLY. Drop the `organization` requirement.
- Cap lengths (name ≤120, email ≤160, phone ≤40, subject ≤40, message ≤5000). Trim.
- Action: `db.createLead({...})` → ALSO `db.log('contact_form', {...})` (keep audit trail) → email `ADMIN_EMAILS[0]` with all fields incl. phone + "Wants callback: yes/no" (escapeHtml, existing pattern) → existing confirmation email to submitter (best-effort).
- Response: `{ success:true }`; `400 {success:false,error}` on validation; `500` on error. Keep rate limit 3/hr/IP.

### C. Admin auth (extend, don't replace)
- `POST /api/admin/login` (public, rate-limited 5/15min): body `{ password }`. Compare **timing-safe** (`crypto.timingSafeEqual`) against `process.env.ADMIN_PASSWORD` (if unset, fall back to the same secret the existing `X-Admin-Secret` check uses — inspect `server.js` `authenticateAdmin`). On success set admin session: reuse existing session middleware if present (`req.session.isAdmin = true`); else set signed cookie `vf_admin` (httpOnly, secure, sameSite=strict, ~12h). Generic `401 {success:false}` on failure.
- `POST /api/admin/logout`: clear admin session.
- `GET /api/admin/session`: `{ isAdmin: boolean }` (no auth needed; reads session).
- Extend `authenticateAdmin` in `server.js` to PASS if EITHER valid `X-Admin-Secret` header (existing) OR admin session set. This makes all existing `/api/admin/*` work from the logged-in dashboard.

### D. Admin data endpoints (behind `authenticateAdmin`)
- `GET /api/admin/leads?status=&limit=&offset=` →
  `{ success, leads:[{id,name,email,phone,organization,subject,message,wants_callback,status,source,created_at}], counts:{new,contacted,closed,total,pendingCallbacks}, limit, offset }`
  newest first; `pendingCallbacks` = wants_callback=true AND status!='closed'. limit default 50 max 500.
- `PATCH /api/admin/leads/:id` → body `{ status }` ∈ {new,contacted,closed}; updates status + updated_at; `{success, lead}`. 400 on bad status, 404 if missing.
- `GET /api/admin/users?limit=&offset=&search=` →
  `{ success, users:[{id,email,name,plan,email_verified,created_at,last_login_at,documents_used,documents_limit}], total, newLast7d, limit, offset }`
  **NEVER** return `password_hash`. `search` matches email/name (parameterized LIKE).

### E. Admin dashboard page `public/admin.html` + serve at `/admin`
- Hebrew, `dir="rtl"`, matches Vertifile visual style (dark/light vars). **SVG icons only — NO emojis.**
- Not logged in (`GET /api/admin/session` → false): login screen, password field → `POST /api/admin/login` → on success load dashboard.
- Summary cards: לידים חדשים (`counts.new`) · ממתינים לחזרה טלפונית (`counts.pendingCallbacks`) · נרשמים (`users.total`) · נרשמים חדשים 7 ימים (`users.newLast7d`).
- Tabs: **לידים** | **נרשמים**.
  - Leads: status filter (הכל/חדש/יצרתי קשר/סגור); columns שם · אימייל · טלפון · נושא · חזרה טלפונית (badge) · סטטוס (dropdown → `PATCH`) · תאריך · הודעה (expand). Render all values with `textContent` (no innerHTML) to prevent stored XSS.
  - Users: search box; columns שם · אימייל · חבילה · מאומת · נרשם · התחבר לאחרונה · מסמכים.
- Logout button. Wire `/admin` route in `server.js` to serve the page.

### F. Contact form changes `public/contact.html`
- JS must send the exact Contract-B fields: `{name,email,subject,phone,message,wantsCallback}`.
- Add **Phone** input (`id="contactPhone"`, optional) and a **"Request a callback"** checkbox (`id="contactCallback"`). When checked, visually hint that phone helps. Keep existing success/error blocks.
- New labels via `data-i18n` with English defaults (Tal backfills the other 9 languages later — English fallback acceptable for this PR).

## Out of scope (do NOT build)
Analytics graphs, CSV import, multi-admin users, lead assignment/pipeline beyond new/contacted/closed, newsletter/waitlist. Keep it minimal.

## Security checklist (Avi gate)
timing-safe password compare · login rate-limited · admin cookie httpOnly+secure+sameSite=strict · output via textContent (no XSS) · users endpoint never leaks password_hash · inputs length-capped + email validated · email body escapeHtml.
