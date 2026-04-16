# Vertifile — Production Deployment Runbook

> **Audience:** Whoever is deploying Vertifile to production. Every command is copy-pasteable.
> **Last updated:** 2026-04-16
> **Platform:** Render (web service) + Neon Postgres (database)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Required Environment Variables](#2-required-environment-variables)
3. [Generating Secrets](#3-generating-secrets)
4. [First-Time Deployment](#4-first-time-deployment)
5. [Post-Deployment Verification](#5-post-deployment-verification)
6. [Rotating Secrets](#6-rotating-secrets)
7. [Monitoring and Alerts](#7-monitoring-and-alerts)
8. [Common Issues](#8-common-issues)
9. [Rollback](#9-rollback)
10. [Pre-Deployment Checklist](#10-pre-deployment-checklist)

---

## 1. Overview

Vertifile runs as a single Node.js web service on **Render**, backed by **Neon Postgres** as the primary database.

Deployment is fully automated:

- Pushes to the `main` branch on GitHub trigger an auto-deploy on Render.
- Database migrations run automatically at boot time. No manual migration step is needed under normal circumstances.
- The application validates all required environment variables at startup (`services/env-validator.js`). A missing required variable in production causes an immediate fatal exit with a clear error in the Render log — the service will not start silently broken.

**Infrastructure at a glance:**

| Component       | Platform        | Notes                                   |
|-----------------|-----------------|-----------------------------------------|
| Web service     | Render          | Auto-deploy from GitHub `main`          |
| Database        | Neon Postgres   | Serverless, connection pooling via pool |
| Email delivery  | Resend          | Optional — app degrades gracefully      |
| OAuth (Google)  | Google Cloud    | Optional — app degrades gracefully      |
| Ed25519 signing | Env var (PEM)   | Optional unless `ED25519_REQUIRED=1`    |

---

## 2. Required Environment Variables

Set all variables in the Render dashboard under:
**Dashboard → Your Service → Environment → Add Environment Variable**

### 2.1 Required in Production

The application will **fatal-exit at boot** if any of these are missing when `NODE_ENV=production` or the `RENDER` environment variable is set.

| Variable         | Required | Description                                                   | Example value                                      |
|------------------|----------|---------------------------------------------------------------|----------------------------------------------------|
| `DATABASE_URL`   | Required | Neon Postgres connection string (pooled endpoint recommended) | `postgresql://user:pass@host.neon.tech/vertifile`  |
| `HMAC_SECRET`    | Required | Secret used to sign PVF document hashes. 32+ character random string. | `wX9...` (48-byte base64url — see section 3)  |
| `SESSION_SECRET` | Required | Signs session cookies. Without this, all users are logged out on every restart. 32+ character random string. | `kP3...` (48-byte base64url)  |
| `NODE_ENV`       | Required | Must be `production` in production. Controls logging format, error verbosity, and env-validator strictness. | `production` |

### 2.2 Required Conditionally

| Variable                | Required When                          | Description                                                             |
|-------------------------|----------------------------------------|-------------------------------------------------------------------------|
| `ED25519_PRIVATE_KEY_PEM` | `ED25519_REQUIRED=1` is set          | PEM-encoded Ed25519 private key for dual-signature PVF signing. If `ED25519_REQUIRED=1` and this is absent, boot fails. |
| `ED25519_REQUIRED`      | You want to enforce Ed25519 signing    | Set to `1` to fail-closed if the Ed25519 key is missing. Omit (or set to `0`) to allow the app to start without it. |
| `GOOGLE_CLIENT_SECRET`  | `GOOGLE_CLIENT_ID` is set              | Both OAuth vars must be set together. Setting only one is a fatal boot error. |
| `GOOGLE_CLIENT_ID`      | `GOOGLE_CLIENT_SECRET` is set          | See above.                                                              |

### 2.3 Optional (App Degrades Gracefully If Absent)

| Variable         | Required | Description                                                                  | Example value                              |
|------------------|----------|------------------------------------------------------------------------------|--------------------------------------------|
| `ADMIN_SECRET`   | Optional | Authenticates requests to `/api/admin/*` endpoints (e.g., `/api/admin/errors`). If unset, admin endpoints are unaccessible. Strongly recommended in production. 32+ character random string. | `aZ7...` (48-byte base64url) |
| `RESEND_API_KEY` | Optional | Resend API key for email delivery (signup confirmation, password reset, etc.). If unset, email is disabled and a warning is logged at boot. App remains fully functional for non-email flows. | `re_abc123...`                            |
| `SMTP_HOST`      | Optional | SMTP relay hostname (alternative to Resend). All `SMTP_*` vars must be set together if used. | `smtp.resend.com`                        |
| `SMTP_PORT`      | Optional | SMTP port.                                                                   | `465`                                      |
| `SMTP_USER`      | Optional | SMTP authentication username.                                                | `resend`                                   |
| `SMTP_PASS`      | Optional | SMTP authentication password.                                                | `re_abc123...`                             |
| `SMTP_FROM`      | Optional | Sender address used in outbound email.                                       | `noreply@vertifile.com`                    |
| `PORT`           | Set by Render | HTTP port the server binds to. Render injects this automatically. Do not set manually. | `3002` (local default) |

---

## 3. Generating Secrets

Use this command to generate a cryptographically secure random secret for `HMAC_SECRET`, `SESSION_SECRET`, and `ADMIN_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it three separate times to get three independent secrets. Never reuse the same value across variables.

**Do not use:**
- Short strings or passwords
- Strings from password managers that contain shell-special characters (use `base64url` output to avoid this)
- The same secret for multiple variables

Store all secrets in 1Password under the Vertifile vault before setting them on Render.

---

## 4. First-Time Deployment

Follow these steps exactly in order.

### Step 1 — Create the Neon Database

1. Log in to [console.neon.tech](https://console.neon.tech).
2. Create a new project named `vertifile-prod`.
3. Create a database named `vertifile` within that project.
4. Copy the **pooled connection string** (Neon calls it "Connection pooling" — use this, not the direct string, to handle Render's ephemeral process model).
5. Save the connection string to 1Password.

### Step 2 — Create the Render Web Service

1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. Click **New → Web Service**.
3. Connect your GitHub repository.
4. Set **Branch** to `main`.
5. Set **Build Command** to `npm install`.
6. Set **Start Command** to `npm start` (or `node server.js`).
7. Set **Runtime** to `Node`.
8. Choose an appropriate instance type (at minimum: Standard with 512 MB RAM; recommended: Standard with 1 GB RAM for production PVF workloads).

### Step 3 — Set Environment Variables on Render

In the Render dashboard for the service, go to **Environment** and add each variable from section 2.

Minimum required set:

```
DATABASE_URL      = <Neon pooled connection string>
HMAC_SECRET       = <generated — see section 3>
SESSION_SECRET    = <generated — see section 3>
ADMIN_SECRET      = <generated — see section 3>
NODE_ENV          = production
```

Add optional variables (Google OAuth, Resend) if the relevant features are needed at launch.

### Step 4 — Deploy

Push to `main` (or trigger a manual deploy from the Render dashboard):

```bash
git push origin main
```

Render will pull the latest commit, run `npm install`, and start the server.

### Step 5 — Confirm Migrations Ran

Open the Render log stream and confirm this line appears:

```
[DB] schema ready
```

This line is emitted by the database initialization module after all migrations complete successfully. If it does not appear within 30 seconds of startup, check the logs for migration errors before proceeding.

### Step 6 — Confirm PDF.js Vendor Files Are Present

If you are deploying PDF upload support, check for this log line at boot:

```
[pdfjs_vendor_missing] PDF.js vendor files missing
```

If this appears, the vendor files were not committed or are not on the deploy path. Fix with:

```bash
npm install pdfjs-dist@4.0.379
cp node_modules/pdfjs-dist/build/pdf.min.mjs vendor/pdfjs/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs vendor/pdfjs/
git add vendor/pdfjs/
git commit -m "Add PDF.js vendor files"
git push origin main
```

Non-PDF PVF uploads continue to work even if these files are missing. PDF uploads will fail with a clear error at upload time.

### Step 7 — Verify Health Endpoint

```bash
curl -i https://vertifile.com/api/health
```

Expected response:

```
HTTP/2 200
{"status":"ok"}
```

---

## 5. Post-Deployment Verification

Run all of these after every production deployment before marking the deploy complete.

### 5.1 Health Endpoints

```bash
# Basic health (no auth required)
curl -i https://vertifile.com/api/health

# Deep health: DB connectivity, key manager, migrations
curl -i https://vertifile.com/api/health/deep
```

Both must return `HTTP 200`. If `/api/health/deep` returns non-200, check Render logs immediately — the DB connection or key manager has a problem.

### 5.2 Status Endpoint

```bash
curl -i https://vertifile.com/api/status
```

Expected: `HTTP 200` with a JSON body containing version, uptime, and environment info.

### 5.3 Well-Known Endpoints

```bash
# Ed25519 key rotation log — must return valid JSON
curl -i https://vertifile.com/.well-known/vertifile-rotation-log

# IANA MIME type declaration
curl -i https://vertifile.com/.well-known/vertifile-mime
```

`vertifile-rotation-log` must return `HTTP 200` with a JSON array (may be empty `[]` on first deploy).

### 5.4 Render Log Check

In the Render log stream, confirm all of these appear at boot:

| Log line                                              | What it confirms                        |
|-------------------------------------------------------|-----------------------------------------|
| `[env-validator] OK: All required environment variables are set` | All required vars are present   |
| `[DB] schema ready`                                   | Migrations ran, schema is current       |
| `Server listening on port ...`                        | HTTP server is up                       |

### 5.5 Signup Flow End-to-End

1. Open `https://vertifile.com` in a private/incognito browser window.
2. Complete the signup form with a test email address.
3. Confirm the onboarding questionnaire loads.
4. Upload a test document and confirm the stamp preview appears.
5. If `RESEND_API_KEY` is set: confirm the confirmation email arrives within 2 minutes.

### 5.6 Admin Error Ring Buffer

```bash
curl -i -H "X-Admin-Secret: <your ADMIN_SECRET>" https://vertifile.com/api/admin/errors
```

Expected: `HTTP 200` with a JSON array. Should be empty on a fresh deploy. Any entries here indicate recent server errors that were caught by the error alerter middleware.

---

## 6. Rotating Secrets

### 6.1 Rotating SESSION_SECRET

**Effect:** All currently logged-in users will be immediately logged out when the new secret takes effect. Plan for off-peak hours.

**Steps:**

1. Generate a new secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Update `SESSION_SECRET` in the Render dashboard (Environment tab).
3. Trigger a redeploy (Render redeploys automatically when env vars change, or push a commit).
4. Verify `/api/health` returns 200 after redeploy.
5. Notify affected users if this is during business hours.

### 6.2 Rotating HMAC_SECRET

**Critical: Changing HMAC_SECRET does NOT invalidate existing PVF documents.** Existing PVFs were signed with the old secret and will continue to verify correctly using stored verification data. New PVFs issued after the rotation will use the new secret.

**However:** Do not rotate this key casually. Rotation is a one-way operation — once the old key is gone from the environment, it cannot be used to re-sign old documents. The only safe reason to rotate is a confirmed key compromise.

**Steps:**

1. Before rotating, confirm there is no active incident that requires verifying recent PVFs using the current key.
2. Generate a new secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. Update `HMAC_SECRET` in the Render dashboard.
4. Trigger a redeploy.
5. Verify `/api/health` and `/api/health/deep` return 200.
6. Issue a test PVF and verify it passes verification.
7. Record the rotation date and old key fingerprint in 1Password (do not store the old key value — store only the date and first 8 characters for audit purposes).

### 6.3 Rotating Ed25519 Keys

Ed25519 key rotation is a multi-step process that involves generating a new key, running a pre-flight check, activating the new key, and retiring the old one. The full procedure is documented in:

```
/Users/mac/Desktop/pvf-project/docs/RUNBOOK-PHASE3D.md
```

Follow RUNBOOK-PHASE3D.md chapter by chapter. Do not skip the pre-rotation checklist (Chapter 1). Every command in that runbook is copy-pasteable and includes expected output so you can confirm each step succeeded before proceeding.

**Summary of the rotation lifecycle:**

1. Generate new key (state: `pending`)
2. Run pre-flight — confirms DB access, Render access, prod health all green
3. Activate new key (state: `active`), old key moves to `retiring`
4. Verify new key is signing correctly
5. Retire old key after grace period

---

## 7. Monitoring and Alerts

### 7.1 Render Built-In Health Checks

Render pings `/api/health` automatically. If it returns non-200 for a sustained period, Render marks the service unhealthy and can trigger a restart. No configuration needed — this is active by default.

### 7.2 Prometheus Metrics

The application exposes a Prometheus-compatible metrics endpoint:

```
GET /api/metrics
```

Suggested scrape interval: **15 seconds**.

Key metrics to alert on:

| Metric                  | Alert threshold          | Action                                                    |
|-------------------------|--------------------------|-----------------------------------------------------------|
| `heap_used_mb`          | > 450 MB                 | Check for PVF content bloat in `documents` table. Consider instance upgrade. |
| `db_pool_waiting`       | > 5 connections waiting  | DB pool is saturated. Check for slow queries or N+1 patterns. |
| `http_error_rate_5xx`   | > 1% of requests         | Check `/api/admin/errors` for pattern. Check Render logs. |
| `pvf_signing_latency_ms`| > 2000 ms p99            | Investigate signing pipeline. Check Ed25519 key manager. |

### 7.3 Error Alerter Ring Buffer

The server maintains an in-memory ring buffer of recent server errors, accessible at:

```bash
curl -H "X-Admin-Secret: <ADMIN_SECRET>" https://vertifile.com/api/admin/errors
```

This endpoint returns the most recent unhandled server errors with stack traces, timestamps, and request context. Check this immediately when `/api/health/deep` returns non-200 or when users report unexpected errors.

### 7.4 Render Log Stream

Render streams all stdout/stderr output in the dashboard under **Logs**. Filter for:

- `FATAL` — always indicates a boot-time failure requiring immediate attention
- `ERROR` — runtime errors that were caught and logged
- `[DB]` — database lifecycle events (connect, schema ready, migration errors)
- `[env-validator]` — startup variable validation results

---

## 8. Common Issues

### "All users were logged out after a restart"

**Cause:** `SESSION_SECRET` is not set as a persistent environment variable, or it was changed. Without a stable `SESSION_SECRET`, each restart generates a new ephemeral secret and invalidates all existing session cookies.

**Fix:**
1. Confirm `SESSION_SECRET` is set in the Render dashboard Environment tab.
2. Confirm it has not changed since the last deploy.
3. If it was accidentally changed, restore the previous value from 1Password and redeploy.

**Prevention:** Always set `SESSION_SECRET` from 1Password. Never let Render generate it or fall back to an ephemeral value.

---

### "Unknown authentication strategy google" in logs

**Cause:** `GOOGLE_CLIENT_ID` and/or `GOOGLE_CLIENT_SECRET` are not set. Passport.js cannot initialize the Google OAuth strategy.

**Fix:** Either:
- Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Render dashboard (both must be set together), **or**
- Remove both variables entirely to disable Google OAuth cleanly. Email/password login continues to work.

**Note:** Setting only one of the two Google variables is a fatal boot error per `env-validator.js`.

---

### "Email rate-limited" or emails not sending

**Cause:** Resend's free tier allows 100 emails per day. If that limit is exceeded, outbound email fails silently (logged as a warning, not an error).

**Fix:**
1. Check the Resend dashboard for usage and limit status.
2. Upgrade the Resend plan if 100/day is insufficient.
3. If this is a spike event (e.g., many signups), wait for the daily reset window.

**Note:** If `RESEND_API_KEY` is not set at all, the app starts without email support and logs a warning at boot. This is not an error state — it is expected behavior when email is intentionally disabled.

---

### High memory usage / heap growing over time

**Cause:** Most commonly, oversized PVF content stored in the `documents` table is being loaded into memory repeatedly.

**Diagnosis:**
1. Check `/api/metrics` for `heap_used_mb` trend over time.
2. Check `/api/admin/errors` for any out-of-memory patterns.
3. Query Neon for row sizes in the `documents` table:
   ```sql
   SELECT id, pg_column_size(content) AS content_bytes
   FROM documents
   ORDER BY content_bytes DESC
   LIMIT 20;
   ```

**Fix:** If specific documents are abnormally large, investigate whether the PVF content embedding pipeline is storing raw binary content it should not be. Consider instance upgrade if baseline memory requirements have grown.

---

### Boot fails with "PDF.js vendor files missing"

**Cause:** `vendor/pdfjs/pdf.min.mjs` or `vendor/pdfjs/pdf.worker.min.mjs` are not present in the deployed build.

**Note:** This is logged as an error but does NOT crash the server. PDF uploads will fail with a clear error at upload time; all other features continue to work.

**Fix:** Commit the vendor files — see Step 6 of section 4.

---

### Ed25519 signing failures after key rotation

Follow RUNBOOK-PHASE3D.md from the beginning of the diagnostics chapter. Do not improvise — the runbook has specific expected outputs for each verification step.

---

## 9. Rollback

### 9.1 Application Rollback

Render deploys are tied to GitHub commits. To roll back:

1. Identify the last known-good commit SHA on `main`.
2. On GitHub, revert the problematic commit or reset `main` to the good SHA.
3. Push to `main` — Render auto-deploys the previous code.

Alternatively, use the Render dashboard: **Deploys → select a previous deploy → Rollback to this deploy**. This redeploys the previously built image without a new git push.

### 9.2 Database Rollback

**Migrations in Vertifile are forward-only.** There are no down migrations. This is intentional — rollback by schema reversal is high-risk and error-prone.

**If a migration caused data corruption or a critical bug:**

1. Do not attempt to run a reverse migration script unless one was explicitly prepared in advance.
2. Restore from the Neon point-in-time backup taken before the deploy.
3. Contact Neon support if the backup window has expired.

**Before any deploy that includes a schema change:**

```bash
npm run backup
```

This must be run manually before the deploy. Automated backups from Neon are available but may have a lag. A pre-deploy manual backup gives you a clean restore point at the exact moment before the change.

### 9.3 Emergency Procedure

For any change that could affect data integrity or verification correctness:

```bash
npm run backup   # Take a manual snapshot first
```

Then proceed with the change. If the change fails:

1. Immediately roll back the application to the previous Render deploy.
2. Assess whether any data was written during the failed deploy window.
3. If data was corrupted: restore from the pre-deploy backup.
4. Post a status update internally before the next deploy attempt.

---

## 10. Pre-Deployment Checklist

Run every box before pushing to `main`. If any box fails, stop and fix before deploying.

- [ ] All tests pass locally: `npm test`
- [ ] `CHANGELOG.md` is updated with the changes in this deploy
- [ ] OpenAPI specification matches current route behavior (no undocumented changes)
- [ ] No secrets or credentials are present in committed code (CI checks this automatically)
- [ ] `npm audit` is clean: `npm audit --audit-level=high` returns 0 high or critical vulnerabilities
- [ ] If this deploy includes a database schema change: `npm run backup` has been run against production immediately before deploying
- [ ] If this deploy includes Ed25519 key rotation: RUNBOOK-PHASE3D.md Chapter 1 pre-rotation checklist is complete and all boxes are checked
- [ ] `/api/health/deep` is returning 200 on the current production deploy before the new deploy goes out (confirms baseline health)
- [ ] Render environment variables are confirmed correct for this deploy (no stale values from a previous test)
- [ ] A rollback plan is identified: either a specific Render deploy to revert to, or a Neon restore point

---

*Vertifile — IANA MIME type `application/vnd.vertifile.pvf` — registered 2026-04-15*
