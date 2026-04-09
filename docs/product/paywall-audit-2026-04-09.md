# Paywall Audit — 2026-04-09

**Author:** עמית (Product Manager)
**Trigger:** Liron's customer review flagged the homepage→dashboard pricing contradiction as a "bait-and-switch dealbreaker"
**Purpose:** Give Rotem (Finance) and Dana the exact map of every line in the codebase that gates behavior on plan tier, so the new pricing model can be planned cleanly tomorrow.

---

## 1. Executive Summary

- **The paywall fires from 12 places in the codebase** — 8 client-side (`public/app.html` + `public/upload.html`) and 4 server-side (`routes/user.js`, `routes/pages.js`, `services/pvf-pipeline.js`). One DB column (`documents.preview_only`) and one user column (`users.plan`) carry the entire model.
- **There is NO real billing backend.** No Stripe, no PayPal, no checkout, no payment provider in `package.json`. The "Upgrade to Pro — $29/mo" button on `pricing.html` links to `/app`. Nobody can actually pay. The paywall is theater.
- **The most embarrassing piece of code is the hardcoded admin email backdoor in three different files.** `public/app.html:2946`, `routes/user.js:268`, and `services/pvf-pipeline.js:474` all whitelist `zur2525@gmail.com` and `info@vertifile.com` directly in the source. Liron's CISO would flag this in 60 seconds, and the personal Gmail address is visible in the minified client bundle.

---

## 2. Every Paywall Trigger — File:Line Map

### Client-side (bypassable — but the server backstops most of them)

| File | Line | What it blocks | Server or client? | Bypassable? |
|---|---|---|---|---|
| `public/app.html` | 2241 | `downloadCurrentDoc()` — clicking Download in the doc preview pane | Client | Yes — but `routes/pages.js:254` re-checks |
| `public/app.html` | 2247 | `shareCurrentDoc()` — clicking Share in the doc preview pane | Client only | YES — share link can be copied without server check |
| `public/app.html` | 2255 | `downloadDoc(idx)` — Download button on the document row in the list view | Client | Yes — backstopped server-side |
| `public/app.html` | 2261 | `shareDoc(idx)` — Share button on the document row in the list view | Client only | YES — bypassable |
| `public/app.html` | 2961 | `async function downloadDoc()` — duplicate (legacy) download handler | Client | Yes — backstopped |
| `public/app.html` | 2970 | `function shareDoc()` — duplicate (legacy) share handler | Client only | YES |
| `public/app.html` | 3054 | Upload handler hard-blocks at `documents.length >= planLimit` (default limit = 1) | Client (server also enforces at `routes/user.js:110`) | No — server backstops |
| `public/upload.html` | 766-780 | After `/api/user/upload` returns `preview:true`, shows the paywall overlay and prevents the download path | Triggered by server response | No — server is the source of truth |

### Server-side (the real gate)

| File | Line | What it blocks | Server or client? | Bypassable? |
|---|---|---|---|---|
| `routes/user.js` | 110-112 | Hard `documents_used >= documents_limit` check on `/api/user/upload` (V2 path) | Server | No |
| `routes/user.js` | 191-193 | Same check on legacy upload path | Server | No |
| `routes/user.js` | 268-285 | Legacy upload: marks document `preview_only` if not `isPaidPlan`, returns `preview:true` to client | Server | No |
| `routes/pages.js` | 253-265 | `/d/:shareId/download` — returns 403 if `doc.preview_only` and the requesting user is not paid | Server | No |
| `services/pvf-pipeline.js` | 471-480 | V2 pipeline: marks new document `preview_only` if uploader is not `isPaidPlan` | Server | No |

### The "isFreePlan" function itself

| File | Line | Code | Note |
|---|---|---|---|
| `public/app.html` | 2943-2948 | `function isFreePlan() { ... currentUser.email === 'zur2525@gmail.com' ... }` | The single source of truth on the client. Hardcodes admin emails. |

### Paywall UI

| File | Line | What |
|---|---|---|
| `public/app.html` | 957-970 | CSS for `.paywall-overlay` / `.paywall-card` |
| `public/app.html` | 1517-1520 | "You've reached the free document limit. Contact us for more." inside the upload modal |
| `public/app.html` | 1529-1539 | The full paywall modal markup — title "Upgrade to Download & Share", CTA "Upgrade to Pro — $29/mo" linking to `/pricing` |
| `public/app.html` | 2950-2956 | `showPaywall()` / `closePaywall()` |
| `public/upload.html` | (paywall overlay) | Standalone copy of the paywall modal, shown after a free upload |

### Homepage FAQ — the contradiction

| File | Line | Text |
|---|---|---|
| `public/index.html` | 1166 | "Yes, Vertifile is free for individuals. Enterprise plans are available for organizations that need bulk processing, API access, and custom branding." |

This is the line Liron called the bait-and-switch. The dashboard delivers the opposite experience.

---

## 3. Data Model

The current code knows who is "free" vs "paid" through three things:

### A. Database — `users.plan` column

`db.js:113-125`:
```
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  ...
  documents_used INT DEFAULT 0,
  documents_limit INT DEFAULT 1,
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- Default plan: `'free'`
- Default document limit: `1` (originally 5 — migrated down at `db.js:174`)
- The plan column is read-only from the codebase: there is **no code path that updates `users.plan`** anywhere in the project. (`grep -rn "UPDATE users.*plan\|users.plan ="` returns zero hits in routes/services.) The only way to become "Pro" today is to manually `UPDATE users SET plan='pro'` in psql.

### B. Database — `documents.preview_only` column

`db.js:200`:
```
ALTER TABLE documents ADD COLUMN IF NOT EXISTS preview_only BOOLEAN DEFAULT FALSE;
```

`db.js:1494-1495`:
```
async function markDocumentPreviewOnly(hash, previewOnly) {
  await pool.query('UPDATE documents SET preview_only = $1 WHERE hash = $2', [previewOnly, hash]);
}
```

This column is set on upload (in both `routes/user.js:273` and `services/pvf-pipeline.js:477`) and is the actual gate the download endpoint checks. It is sticky per-document — even if a user later upgrades, their old documents stay flagged `preview_only=true` until something explicitly flips them back. Nothing currently does.

### C. Hardcoded admin email lists

Three files contain `zur2525@gmail.com` and `info@vertifile.com` as a literal whitelist:

| File | Line | Side |
|---|---|---|
| `public/app.html` | 2946 | Client (visible in browser source) |
| `routes/user.js` | 268 | Server (legacy upload only) |
| `services/pvf-pipeline.js` | 474 | Server (V2 pipeline — current path) |

In addition, `public/dashboard.html:1321` has a separate hardcoded check (`var match = v === 'zur2525@gmail.com';`) used to gate the **delete-account** confirmation flow. Not strictly paywall, but same code-smell, same file family — flag it for the same cleanup pass.

`public/app.html.backup:1874` also has the old paywall check. Stale backup file — should be deleted.

### D. Session/cookie state

None. There is no cookie or session field that says "this user is Pro." Plan state lives only in the `users.plan` DB column and is fetched via `/api/user/me` (read in `app.html:1579-1582`).

### E. API endpoints related to tier

| Endpoint | What it does |
|---|---|
| `GET /api/user/me` | Returns `currentUser` including `plan`, `documentsUsed`, `documentsLimit` (`routes/user.js:23-30`) |
| `POST /api/user/upload` | Enforces `documents_limit` and the paywall (`routes/user.js:100-176`) |
| `GET /d/:shareId/download` | Enforces `preview_only` (`routes/pages.js:242-281`) |

There is **no** `/api/user/upgrade`, `/api/user/subscribe`, `/api/billing`, `/api/checkout`, or anything similar. Confirmed by grepping the entire `routes/` directory.

---

## 4. Payment Integration

**Verdict: There is no real billing system. The paywall is a placeholder.**

Evidence:

- `package.json` contains zero payment-related dependencies. No `stripe`, no `@stripe/stripe-js`, no `paypal-rest-sdk`, no `@paddle/*`, nothing.
- `grep -rn "stripe\|paypal\|checkout.session" routes/ services/ server.js` returns only matches for the unrelated **verification webhooks** system in `routes/webhooks.js`. (Those webhooks fire when a third-party verifies a PVF — they have nothing to do with billing.)
- The "Pro" CTA buttons on `pricing.html` are dead-ends:

| `public/pricing.html:302` | `<a href="/app" class="plan-cta secondary">Start Pro</a>` |
| `public/pricing.html:319` | `<a href="/app" class="plan-cta primary">Start Pro+</a>` |
| `public/pricing.html:336` | `<a href="/contact" class="plan-cta secondary">Contact Sales</a>` (Enterprise) |

Clicking "Start Pro" sends the user to the dashboard. Nothing charges them. Nothing changes their plan. They will hit the same paywall they hit five seconds ago.

- The paywall modal CTA `public/app.html:1537` links to `/pricing` — which loops them back to the buttons that link to `/app`. Infinite loop.

- The only way `users.plan` can flip from `'free'` to `'pro'` today is by hand in the database. There is no code path that does it.

- `db.js:475-479` and `db.js:808-810` have `createApiKey` and `updateOrgPlan` functions for the API/organization track (which tracks plan in `api_keys.plan`), but those are an entirely separate flow (B2B API customers, not individual dashboard users) and are also called only by admin scripts, not by any user-facing endpoint.

---

## 5. The User Journey Today

What a real individual user experiences from sign-up onward:

1. **Sign up** → row inserted into `users` with `plan='free'`, `documents_limit=1`. Homepage FAQ at `public/index.html:1166` told them this product is "free for individuals."
2. **Upload document #1** → succeeds. Server marks the document `preview_only=true` (`services/pvf-pipeline.js:477`). Client receives `{preview: true}` and shows the paywall overlay (`public/upload.html:766-780`). User can SEE their document in the preview iframe, but the download link is replaced by a "Subscribe to download" CTA.
3. **Click Download in dashboard** → `isFreePlan()` returns true (because their plan is `'free'`), the paywall modal pops up: "Upgrade to Download & Share — $29/mo." (`app.html:2241, 2255, 2961`)
4. **Click Share in dashboard** → same paywall modal, but **server doesn't enforce this** — the share URL `/d/:shareId` (the public viewer page itself, not `/download`) is fully accessible to anyone with the link. A user who reads the source can call `copyToClipboard(window.location.origin + '/d/' + shareId)` themselves and bypass the share gate entirely.
5. **Click Verify** → free, no paywall. The verify endpoint at `routes/api.js:203` is rate-limited but has zero plan check.
6. **Click "Upgrade to Pro — $29/mo" in the paywall modal** → goes to `/pricing`. Clicks "Start Pro" on the Pro card. Lands back on `/app`. Same paywall. No payment ever happened. The user's plan stays `'free'` forever.
7. **Try to upload a second document** → blocked. `routes/user.js:110` returns 403 "Document limit reached. Upgrade your plan for more." (Same dead-end loop as step 6.)

Net experience: the user can sign up, protect exactly one document, view it, verify it, and... that's it. Anything that feels like "ownership of my own file" (downloading a copy, sharing the link cleanly) is locked behind a button that goes nowhere.

---

## 6. What Rotem + Dana Need to Know

### Files that need editing for the new pricing model

**MUST edit:**
- `public/app.html` — lines 2241, 2247, 2255, 2261, 2961, 2970 (the six `if (isFreePlan())` guards) and 2943-2948 (`isFreePlan` itself)
- `routes/user.js` — lines 267-285 (legacy upload paywall logic) and 110-112 (document_limit check)
- `services/pvf-pipeline.js` — lines 467-480 (V2 pipeline paywall logic)
- `routes/pages.js` — lines 253-265 (download endpoint preview_only check)
- `public/index.html:1166` — the FAQ promise (re-word once Rotem decides what "free" actually covers)
- `public/upload.html:766-780` — the post-upload preview/paywall fork
- `public/pricing.html:302, 319` — the "Start Pro" CTAs (right now they go to `/app` — wire to a real checkout once we have one)
- `db.js:122, 174` — `documents_limit INT DEFAULT 1` and the migration that lowered it from 5

**SHOULD edit:**
- `public/app.html:1517-1520` — "You've reached the free document limit" copy
- `public/app.html:1529-1539` — paywall modal copy (the title, subtitle, CTA can stay structurally if Dana wants to re-purpose it for a different gate)

### Code that should be DELETED entirely

1. **The hardcoded admin email backdoor** — three locations:
   - `public/app.html:2946` (CRITICAL — exposed to clients)
   - `routes/user.js:268`
   - `services/pvf-pipeline.js:474`
   - Replace with a proper `users.role='admin'` column or an env-var-driven allow-list, NOT email strings in source.
2. **`public/dashboard.html:1321`** — same `zur2525@gmail.com` literal in the delete-account flow. Same fix.
3. **`public/app.html.backup`** — stale backup file with the old paywall logic. Delete.
4. **The dead "Update free plan limit from 5 to 1" migration** at `db.js:173-174` — once we settle on the new free quota, this one-shot migration should be removed.

### Code that should be RE-PURPOSED

- The **paywall modal markup** (`public/app.html:1529-1539`) is a clean component. Once the new pricing model is decided, the same overlay can show "You've used your free verification this month" or whatever the new gate is. Don't throw the UI away — just rewrite the trigger conditions and the copy.
- The **`preview_only` column on `documents`** can stay if the new model still has any "view-only" tier. If it's pure free-for-individuals, this column becomes dead and should be dropped (with a migration).
- The **`documents_used` / `documents_limit` columns on `users`** are useful regardless — keep them, but reconsider the default limit.

### Order of operations

1. Rotem locks the new pricing model on paper (what's free, what's paid, what's gated).
2. Rip out the hardcoded admin emails (3 files) — this is a 5-minute fix and removes the most embarrassing leak. Do it FIRST so we don't ship the next pricing update with the same backdoor.
3. Update `public/index.html:1166` and `public/pricing.html:302/319` so the marketing surface matches the new model.
4. Update `routes/user.js`, `services/pvf-pipeline.js`, and `routes/pages.js` server-side gates.
5. Update `public/app.html` client-side gates (must match server, not lead it).
6. Decide on `documents_limit` default in `db.js:122` and the migration at `db.js:174`.
7. **Only THEN** wire up Stripe (or whatever provider) — there is currently nothing to wire. This is its own separate sub-project.

---

## 7. Risks

### A. Server-side gates outlive client-side rip-outs

Removing only the client-side `isFreePlan()` checks won't fix the experience. The server still:
- Marks every free user's document `preview_only=true` on upload (`services/pvf-pipeline.js:477`)
- Refuses `/d/:shareId/download` for `preview_only` documents (`routes/pages.js:254`)
- Blocks the second upload at `routes/user.js:110`

Any pricing rebuild MUST touch the server first, or users will see green buttons that still 403.

### B. Existing free users have stale `preview_only=true` documents

Every document uploaded by a free user since the paywall went live has `preview_only=true` in the database. If we change the model so individuals can download their own documents, we need a one-time migration:
```sql
UPDATE documents SET preview_only = false WHERE preview_only = true;
```
(or be more selective if some flavor of preview-only stays in the new model). Without this migration, even the new code will refuse to serve their old uploads.

### C. Are there paying customers in production right now?

Almost certainly **no**. There is no payment integration, no Stripe webhook handler, no `users.plan = 'pro'` setter anywhere in the codebase. The only way a user is currently `'pro'` is if Zur ran `UPDATE users SET plan='pro' WHERE email=...` by hand in psql. We should `SELECT email, plan FROM users WHERE plan != 'free'` in production tomorrow morning before anything ships, just to confirm — but the architectural answer is no, nobody can be paying because nothing accepts payment.

### D. The B2B API track (`api_keys.plan`) is unrelated and should not be touched

`db.js:475-479` and `db.js:808-810` have a separate `api_keys.plan` column with a real `updateOrgPlan` function. That powers Vertifile's organization/API tier (the enterprise line that contacts sales). It is **not** the same system as the individual paywall and Rotem's pricing rework should not touch it unless explicitly intended. Confirm scope with Dana.

### E. The share-link gate is a security hole, not a paywall

`shareDoc()` at `app.html:2261` calls the paywall on free users — but the actual share URL (`/d/:shareId` without `/download`) is publicly accessible. A free user who opens DevTools can `console.log(selectedDoc.share_id)` and copy the link manually. We're not actually gating sharing; we're just hiding the button. If "share" is meant to be a real Pro feature, the server needs to enforce it. If it's not, the gate should be removed entirely (no security through obscurity).

---

## Appendix — Quick Reference

**Hardcoded admin emails (the leak):**
```
public/app.html:2946       isFreePlan() — client
routes/user.js:268         isAdmin — server (legacy upload)
services/pvf-pipeline.js:474  isAdmin — server (V2 pipeline)
public/dashboard.html:1321 delete-account confirmation (separate but related)
```

**The actual gate keepers (server-side):**
```
routes/user.js:110             documents_limit hard cap
routes/user.js:191             documents_limit hard cap (legacy)
routes/pages.js:254            preview_only download block
services/pvf-pipeline.js:471   preview_only marking on upload
```

**The DB columns the whole thing rests on:**
```
users.plan             TEXT  DEFAULT 'free'   (db.js:123)
users.documents_limit  INT   DEFAULT 1        (db.js:122)
users.documents_used   INT   DEFAULT 0        (db.js:121)
documents.preview_only BOOL  DEFAULT FALSE    (db.js:200)
```

**What does NOT exist:**
- Any payment provider in `package.json`
- Any `/api/billing*`, `/api/checkout*`, `/api/subscribe*` route
- Any code path that updates `users.plan`
- Any webhook handler for payment events
- Any test of the paid upgrade flow (because there is no flow)
