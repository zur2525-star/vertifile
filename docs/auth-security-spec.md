# Vertifile Authentication Security Specification

**Author:** Avi (Security Guard)
**For:** Moshe (Auth Developer)
**Date:** 2026-04-05
**Status:** MANDATORY -- No auth code ships without passing every item in this spec.

---

## Current Security Baseline (What Already Exists)

Before building, Moshe must understand what is already deployed and must NOT weaken or duplicate:

| Layer | Status | Location |
|---|---|---|
| Helmet (CSP, HSTS, X-Frame-Options, Referrer-Policy, DNS prefetch, Permissions-Policy) | Active | `server.js` lines 63-78 |
| CORS whitelist (vertifile.com only in prod, credentials mode) | Active | `server.js` lines 80-89 |
| Input sanitization (XSS escape, null byte removal, field length limit) | Active | `middleware/sanitize.js` |
| Request timeout (30s) | Active | `middleware/timeout.js` |
| API rate limiting (200 req / 15 min) | Active | `server.js` line 132 |
| Auth rate limiting (5 attempts / 15 min) | Active | `middleware/auth.js` lines 96-102 |
| Signup rate limiting (10 / hour / IP) | Active | `middleware/auth.js` lines 105-109 |
| Timing-safe admin secret comparison | Active | `middleware/auth.js` lines 5-14 |
| Session store (PostgreSQL via connect-pg-simple) | Active | `server.js` lines 97-101 |
| HttpOnly + Secure + SameSite=Lax cookies | Active | `server.js` line 100 |
| Bcrypt hashing (12 rounds) | Active | `routes/auth.js` lines 19, 78 |
| Generic error on login failure ("Invalid email or password") | Active | `server.js` line 111 |
| Error tracking (in-memory + logger) | Active | `middleware/error-alerter.js` |
| Request logging (skip health checks) | Active | `middleware/request-logger.js` |
| Response envelope (requestId + timestamp) | Active | `middleware/response-envelope.js` |
| Subscription gating | Active | `middleware/requireSubscription.js` |

---

## 1. Password Security

### 1.1 Hashing

- Use `bcrypt` with a **minimum of 12 salt rounds**. This is already set in `routes/auth.js` -- do NOT lower it.
- The cost factor must be configurable via environment variable `BCRYPT_ROUNDS` with a floor of 12:
  ```
  const BCRYPT_ROUNDS = Math.max(12, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  ```

### 1.2 Password Requirements

Every password (registration, reset, change) must pass ALL of these:

| Rule | Regex / Check |
|---|---|
| Minimum 8 characters | `password.length >= 8` |
| Maximum 128 characters | `password.length <= 128` (prevent bcrypt DoS -- bcrypt truncates at 72 bytes but long inputs waste CPU) |
| At least 1 uppercase letter | `/[A-Z]/` |
| At least 1 lowercase letter | `/[a-z]/` |
| At least 1 digit | `/[0-9]/` |
| At least 1 special character | `/[^A-Za-z0-9]/` |
| Not in common passwords list | Check against top 1000 list (see 1.3) |
| Not the user's email | `password.toLowerCase() !== email.toLowerCase()` |

Return specific validation errors so the user knows what to fix:
```json
{
  "success": false,
  "error": "Password must contain at least one uppercase letter"
}
```

### 1.3 Common Password Blacklist

- Maintain a file at `data/common-passwords.txt` containing the top 1000 most common passwords (one per line).
- Load into a `Set` at startup for O(1) lookup.
- Check `commonPasswords.has(password.toLowerCase())` on every registration and password change.
- Source: Use the SecLists top 1000 passwords list or equivalent.

### 1.4 Password Handling Rules

- **NEVER** log a password, hashed or plaintext. Not in request logs, not in error logs, not in debug output.
- **NEVER** return a password hash in any API response, including user profile endpoints.
- **NEVER** include password in session data stored in PostgreSQL.
- Sanitize any error stack traces before logging to ensure password values from request body do not leak.
- The `requestLogger` middleware must explicitly exclude `req.body.password` from any logged data.

---

## 2. Session Security

### 2.1 Session ID Generation

- Session IDs must be generated using `crypto.randomBytes(32)` minimum (256-bit). The `express-session` library does this by default via `uid-safe` -- confirm this in `node_modules/uid-safe/index.js` and do NOT override the `genid` option with anything weaker.

### 2.2 Cookie Configuration

All session cookies MUST have these flags:

| Flag | Value | Reason |
|---|---|---|
| `httpOnly` | `true` | Prevents JavaScript access (XSS cannot steal sessions) |
| `secure` | `true` in production | Cookie only sent over HTTPS |
| `sameSite` | `'lax'` | Prevents CSRF on state-changing requests |
| `domain` | Not set (defaults to exact origin) | Do not set to `.vertifile.com` to prevent subdomain attacks |
| `path` | `'/'` | Default, no change needed |

This is already configured in `server.js` line 100. Do NOT weaken these settings.

### 2.3 Session Expiry

- **Maximum session lifetime:** 7 days (currently set to 30 days -- **MUST be reduced**).
- Change `maxAge` from `30 * 24 * 60 * 60 * 1000` to `7 * 24 * 60 * 60 * 1000`.
- **Sliding window:** On every authenticated request, refresh the cookie expiry by calling:
  ```js
  req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
  ```
  This means active users stay logged in, but inactive users get logged out after 7 days.
- **Absolute maximum:** Even with sliding, no session may live longer than 30 days. Store `session.createdAt` and check it:
  ```js
  if (Date.now() - req.session.createdAt > 30 * 24 * 60 * 60 * 1000) {
    req.session.destroy();
    return res.status(401).json({ success: false, error: 'Session expired, please sign in again' });
  }
  ```

### 2.4 Session Limits

- **Maximum 5 active sessions per user.** When a 6th session is created, destroy the oldest one.
- Implementation: Query `sessions` table for the user's active sessions, ordered by creation time. If count >= 5, delete the oldest.
- This prevents session accumulation from forgotten devices.

### 2.5 Session Invalidation

Sessions MUST be invalidated (destroyed in PostgreSQL) when:

- User changes their password
- User explicitly logs out (already implemented)
- User is deactivated by admin
- User resets password via forgot-password flow
- A security event is detected (e.g., impossible travel)

On password change, invalidate **all other sessions** (not the current one):
```sql
DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1
  AND sid != $2;
```

---

## 3. Rate Limiting (Auth Endpoints)

### 3.1 Rate Limit Matrix

| Endpoint | Limit | Window | Key | Current Status |
|---|---|---|---|---|
| `POST /auth/login` | 5 attempts | 15 minutes | IP | EXISTS but needs per-account tracking too |
| `POST /auth/register` | 3 attempts | 1 hour | IP | EXISTS at 10/hour -- **MUST reduce to 3** |
| `POST /auth/forgot-password` | 3 attempts | 1 hour | Email (normalized) | MISSING -- must add |
| `POST /auth/reset-password` | 5 attempts | 1 hour | IP | Uses authLimiter but needs own limiter |
| `POST /auth/verify-email` (send code) | 3 sends | 1 hour | User ID | MISSING -- must add |
| `POST /auth/verify-code` (check code) | 5 attempts | Per code | Code ID | MISSING -- must add |

### 3.2 Account Lockout

- After **10 failed login attempts** across all IPs for a single account within 1 hour, **lock the account for 30 minutes**.
- Store failed attempt count in the database: `users.failed_login_attempts` and `users.locked_until`.
- On successful login, reset the counter to 0.
- On lock, return the same generic error: `"Invalid email or password"` -- do NOT reveal the account is locked.
- Log the lockout event for security monitoring:
  ```js
  await db.log('account_locked', { userId: user.id, attempts: user.failed_login_attempts, ip: clientIP });
  ```

### 3.3 Rate Limiter Configuration

Create dedicated limiters (do not reuse the generic `authLimiter` for everything):

```js
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => getClientIP(req),
  message: { success: false, error: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.body.email || '').toLowerCase().trim(),
  message: { success: false, error: 'Too many password reset requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verifyEmailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.user?.id || getClientIP(req),
  message: { success: false, error: 'Too many verification requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});
```

---

## 4. Google OAuth Security

### 4.1 State Parameter (CSRF Protection)

- The `passport-google-oauth20` library handles the `state` parameter automatically. **Verify** that `session` is available before the OAuth redirect (session middleware must run before passport).
- If implementing a custom OAuth flow in the future, generate `state` with `crypto.randomBytes(32).toString('hex')`, store in session, and validate on callback.

### 4.2 Token Verification

- **Verify the `id_token` signature.** Passport does this by default when using the authorization code flow (which it does). Do NOT switch to implicit flow.
- **Check `email_verified`** from Google's profile data. Current code in `server.js` line 124 does NOT check this. **MUST add:**
  ```js
  if (!profile.emails[0].verified) {
    return done(null, false, { message: 'Google email not verified' });
  }
  ```
  Without this, someone could register a Google account with an unverified email and use it to access another user's Vertifile account.

### 4.3 Redirect URI Restrictions

- `callbackURL` is set to `/auth/google/callback` (relative). In production, Google Console must have ONLY these authorized redirect URIs:
  - `https://vertifile.com/auth/google/callback`
  - `https://www.vertifile.com/auth/google/callback`
- **No** `http://` URIs in production.
- **No** wildcard subdomains.
- Review Google Cloud Console quarterly to remove stale redirect URIs.

### 4.4 Account Linking

- When a user signs in with Google and an account with that email already exists (registered via email/password), do NOT auto-merge. Instead:
  1. Inform the user that an account with this email exists.
  2. Ask them to sign in with their password first, then link Google from their settings.
- This prevents account takeover via Google accounts with matching email addresses.

---

## 5. Email Verification

### 5.1 Code Generation

- Generate a **6-digit numeric code** using `crypto.randomInt(100000, 999999)`.
- Do NOT use `Math.random()` -- it is not cryptographically secure.
- Store the code as a **bcrypt hash** or use HMAC. If storing as plaintext for simplicity, ensure the database column is not exposed via any API endpoint.

### 5.2 Code Expiry

- Verification codes expire after **10 minutes**.
- Store `created_at` with the code and check: `Date.now() - created_at > 10 * 60 * 1000`.
- After expiry, the code is invalid. User must request a new one.

### 5.3 Attempt Limiting

- Maximum **5 attempts** per code. After 5 wrong attempts, invalidate the code entirely.
- Store `attempts` counter in the database alongside the code.
- On each failed attempt, increment and check:
  ```js
  if (codeRecord.attempts >= 5) {
    await db.invalidateVerificationCode(codeRecord.id);
    return res.status(400).json({ success: false, error: 'Too many attempts. Please request a new code.' });
  }
  ```

### 5.4 Timing-Safe Comparison

- Use `crypto.timingSafeEqual` to compare codes. This prevents timing attacks that could guess the code digit by digit.
- Since codes are numeric strings, convert to buffers of equal length:
  ```js
  const crypto = require('crypto');

  function verifyCode(provided, stored) {
    const a = Buffer.from(String(provided).padStart(6, '0'));
    const b = Buffer.from(String(stored).padStart(6, '0'));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  ```

### 5.5 Resend Limiting

- Maximum **3 code sends per hour** per user (see rate limiting section 3.1).
- Each new send invalidates the previous code.
- Do NOT allow multiple active codes for the same user.

---

## 6. API Security

### 6.1 User Enumeration Prevention

All authentication responses must take the **same amount of time** regardless of whether the user exists. This prevents attackers from determining which emails are registered.

**Login:** Already returning "Invalid email or password" for both cases. Good. But verify timing is consistent:
- When user does not exist, still run a dummy bcrypt compare to equalize response time:
  ```js
  if (!user) {
    // Dummy compare to prevent timing-based user enumeration
    await bcrypt.compare(password, '$2b$12$dummyhashvaluetowastetimedummyhashval');
    return done(null, false, { message: 'Invalid email or password' });
  }
  ```
  This is NOT currently in the codebase. **MUST add.**

**Registration:** Currently returns `"Email already registered"` -- this reveals that the email exists. **MUST change** to:
  1. Always return success: `"If this email is available, a verification code has been sent."`
  2. If email exists, silently send a "someone tried to register with your email" notification instead.

**Forgot password:** Already returns generic message. Good. Keep it.

### 6.2 Error Messages

| Scenario | Response | NEVER say |
|---|---|---|
| Wrong email | "Invalid email or password" | "No account with this email" |
| Wrong password | "Invalid email or password" | "Wrong password" |
| Account locked | "Invalid email or password" | "Account is locked" |
| OAuth-only account | "Invalid email or password" | "Use Google to sign in" |
| Email taken (register) | "Verification code sent" | "Email already registered" |
| Unverified email | "Please verify your email" | (this is OK -- user knows their own email) |

### 6.3 URL Security

- **NEVER** put user data in URL query parameters. Query params appear in:
  - Server access logs
  - Browser history
  - Referrer headers sent to external sites
  - Proxy logs
- Password reset tokens in URLs (current `?reset=TOKEN` pattern) are acceptable only because:
  - Tokens are single-use
  - Tokens expire in 30 minutes
  - HTTPS encrypts the URL in transit
- But consider switching to a POST-based reset flow in the future.

### 6.4 CORS

- Production CORS is already locked to `vertifile.com` and `www.vertifile.com`. **Do NOT add new origins** without Avi's review.
- The development fallback (`localhost:3002`) must NEVER appear in production. Verify this with:
  ```js
  if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.includes('http://localhost:3002')) {
    throw new Error('SECURITY: localhost in production CORS origins');
  }
  ```

---

## 7. Security Headers

### 7.1 Required Headers

These are already configured via Helmet in `server.js`. Verify each is present in production responses:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking (already set for HTML files) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Forces HTTPS for 1 year |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Content-Security-Policy` | See server.js directives | Prevents XSS, injection |
| `X-DNS-Prefetch-Control` | `off` | Prevents DNS leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Disables unused browser APIs |

### 7.2 Additional Headers for Auth Responses

On all `/auth/*` endpoints, add:
```js
res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
res.setHeader('Pragma', 'no-cache');
```
Auth responses must NEVER be cached by browsers or proxies.

---

## 8. Logging and Monitoring

### 8.1 What to Log

| Event | Data to Log |
|---|---|
| Successful login | `userId`, `ip`, `provider` (email/google), `userAgent` |
| Failed login | `email` (hashed or truncated), `ip`, `reason`, `userAgent` |
| Registration | `userId`, `ip`, `provider` |
| Password change | `userId`, `ip` |
| Password reset request | `email` (hashed), `ip` |
| Password reset completed | `userId`, `ip` |
| Account locked | `userId`, `ip`, `failedAttempts` |
| Session created | `userId`, `sessionId` (first 8 chars only), `ip` |
| Session destroyed | `userId`, `sessionId` (first 8 chars only), `reason` |
| Email verification sent | `userId`, `ip` |
| Email verified | `userId`, `ip` |
| OAuth login | `userId`, `provider`, `ip` |

### 8.2 What to NEVER Log

- Passwords (plaintext or hashed)
- Full session IDs (only first 8 characters)
- Full password reset tokens
- Verification codes
- Full email addresses in error logs (truncate: `z***@gmail.com`)

---

## 9. Known Gaps in Current Code (Moshe Must Fix)

These are security issues I found in the current codebase that MUST be resolved:

| # | Issue | File | Severity |
|---|---|---|---|
| 1 | Session maxAge is 30 days, must be 7 days | `server.js:100` | MEDIUM |
| 2 | Registration reveals if email exists ("Email already registered") | `routes/auth.js:18` | HIGH |
| 3 | No dummy bcrypt on failed login (timing-based user enumeration) | `server.js:111` | HIGH |
| 4 | Google OAuth does not check `email_verified` | `server.js:124` | HIGH |
| 5 | Signup rate limit is 10/hour, must be 3/hour | `middleware/auth.js:108` | MEDIUM |
| 6 | No per-account login failure tracking / account lockout | N/A | HIGH |
| 7 | No `Cache-Control: no-store` on auth responses | `routes/auth.js` | MEDIUM |
| 8 | Password validation only checks length, not complexity | `routes/auth.js:16,70` | HIGH |
| 9 | No common password blacklist | N/A | MEDIUM |
| 10 | No max password length (bcrypt DoS vector) | `routes/auth.js` | MEDIUM |
| 11 | No session limit per user (unlimited sessions) | N/A | MEDIUM |
| 12 | No session invalidation on password change | `routes/auth.js:79` | HIGH |
| 13 | No email verification system | N/A | HIGH |
| 14 | No dedicated rate limiter for forgot-password by email | `routes/auth.js:42` | MEDIUM |
| 15 | Request logger does not exclude password fields from body | `middleware/request-logger.js` | HIGH |

---

## 10. Code Review Checklist

Avi will use this checklist to review Moshe's auth code before it goes to production. Every item must be checked and pass. No exceptions.

### Password Handling

- [ ] 1. Bcrypt rounds >= 12, configurable via env with floor of 12
- [ ] 2. Password minimum 8 characters enforced on register, reset, and change
- [ ] 3. Password maximum 128 characters enforced (bcrypt DoS prevention)
- [ ] 4. Uppercase letter required (`/[A-Z]/`)
- [ ] 5. Lowercase letter required (`/[a-z]/`)
- [ ] 6. Digit required (`/[0-9]/`)
- [ ] 7. Special character required (`/[^A-Za-z0-9]/`)
- [ ] 8. Common password blacklist check (top 1000 list loaded at startup)
- [ ] 9. Password !== user's email address
- [ ] 10. Password field NEVER appears in any log output (grep entire codebase for `password` in logger calls)
- [ ] 11. Password hash NEVER returned in any API response (grep for `password_hash` in response objects)
- [ ] 12. Validation errors are specific (tell user what is missing, not just "invalid password")

### Session Security

- [ ] 13. Session ID generated by express-session default (crypto-random, 256-bit) -- `genid` not overridden
- [ ] 14. Cookie `httpOnly: true`
- [ ] 15. Cookie `secure: true` in production
- [ ] 16. Cookie `sameSite: 'lax'`
- [ ] 17. Cookie `domain` is NOT explicitly set
- [ ] 18. Session maxAge = 7 days (not 30)
- [ ] 19. Sliding window refresh implemented on authenticated requests
- [ ] 20. Absolute session lifetime = 30 days (with `session.createdAt` check)
- [ ] 21. Maximum 5 sessions per user enforced (oldest destroyed on overflow)
- [ ] 22. All sessions invalidated on password change (except current)
- [ ] 23. All sessions invalidated on password reset
- [ ] 24. Session destroyed on logout (already implemented -- verify still works)

### Rate Limiting

- [ ] 25. Login: 5 attempts / 15 min / IP
- [ ] 26. Registration: 3 attempts / 1 hour / IP
- [ ] 27. Forgot password: 3 attempts / 1 hour / email
- [ ] 28. Password reset: 5 attempts / 1 hour / IP
- [ ] 29. Verification send: 3 sends / 1 hour / user
- [ ] 30. Verification check: 5 attempts per code
- [ ] 31. Account lockout after 10 failed logins within 1 hour (30 min lock)
- [ ] 32. Lockout returns generic error (does not reveal lockout state)
- [ ] 33. Lockout event logged with userId and IP

### Google OAuth

- [ ] 34. `email_verified` field checked on Google callback
- [ ] 35. Unverified Google emails rejected
- [ ] 36. State parameter validated (passport default -- verify not disabled)
- [ ] 37. Only authorization code flow used (not implicit)
- [ ] 38. Redirect URIs in Google Console are ONLY production HTTPS URLs
- [ ] 39. No auto-merge of Google accounts with existing email/password accounts

### Email Verification

- [ ] 40. 6-digit code generated with `crypto.randomInt(100000, 999999)`
- [ ] 41. `Math.random()` NOT used anywhere for security-sensitive values
- [ ] 42. Code expires after 10 minutes
- [ ] 43. Max 5 attempts per code
- [ ] 44. Code invalidated after 5 failed attempts
- [ ] 45. `crypto.timingSafeEqual` used for code comparison
- [ ] 46. Previous code invalidated when new one is sent
- [ ] 47. Only 1 active code per user at a time

### API Security

- [ ] 48. Login failure message is always "Invalid email or password" regardless of reason
- [ ] 49. Dummy bcrypt compare executed when user not found (timing equalization)
- [ ] 50. Registration does NOT reveal if email exists
- [ ] 51. Forgot password returns same response whether email exists or not (already done -- verify)
- [ ] 52. No user data (email, ID, tokens) in URL query parameters (except single-use reset tokens)
- [ ] 53. `Cache-Control: no-store` set on all `/auth/*` responses
- [ ] 54. `Pragma: no-cache` set on all `/auth/*` responses

### Security Headers

- [ ] 55. `X-Content-Type-Options: nosniff` present (via Helmet)
- [ ] 56. `X-Frame-Options: DENY` present (via Helmet + static config)
- [ ] 57. `Strict-Transport-Security` present with `max-age >= 31536000`
- [ ] 58. `Referrer-Policy: strict-origin-when-cross-origin` present
- [ ] 59. CSP directives match spec (no `unsafe-eval`)
- [ ] 60. Permissions-Policy disables camera, microphone, geolocation, payment

### CORS

- [ ] 61. Production origins: ONLY `https://vertifile.com` and `https://www.vertifile.com`
- [ ] 62. `localhost` NOT in production CORS origins
- [ ] 63. Startup check throws error if localhost found in production origins
- [ ] 64. `credentials: true` in CORS config (for cookie-based sessions)

### Logging

- [ ] 65. All login events logged (success and failure)
- [ ] 66. All registration events logged
- [ ] 67. All password changes logged
- [ ] 68. All account lockouts logged
- [ ] 69. All session create/destroy events logged
- [ ] 70. Passwords NEVER in logs (grep full codebase: `logger.*password`, `console.*password`)
- [ ] 71. Session IDs truncated to 8 chars in logs
- [ ] 72. Emails truncated in error logs (not full address)

### General

- [ ] 73. No `console.log` left in auth code (use logger service only)
- [ ] 74. All database queries use parameterized queries (no string concatenation)
- [ ] 75. All user input validated before use (email format, string types, length limits)
- [ ] 76. `express-session` secret is loaded from env or secure file (already done -- verify)
- [ ] 77. `trust proxy` is set (already done -- needed for rate limiting behind proxy)
- [ ] 78. All auth endpoints return consistent JSON shape `{ success, error?, ... }`
- [ ] 79. No sensitive data in error stack traces sent to client
- [ ] 80. Global error handler does not leak internal details (already done -- verify)

---

## Appendix: Testing Requirements

Before Avi signs off, Moshe must demonstrate these tests pass:

1. **Try registering with password "password123"** -- must be rejected (common password).
2. **Try registering with password "abcdefgh"** -- must be rejected (no uppercase, no digit, no special).
3. **Try logging in 6 times with wrong password** -- 6th attempt must be rate limited.
4. **Try logging in 11 times with wrong password for same account** -- account must lock.
5. **Check API response for `/auth/login` with non-existent email** -- must say "Invalid email or password", not "User not found".
6. **Check response timing** for login with existing vs non-existing email -- must be within 50ms of each other.
7. **Register via Google with unverified email** -- must be rejected.
8. **Change password** -- verify all other sessions are destroyed.
9. **Create 6 sessions** -- verify the oldest is destroyed.
10. **Check response headers** on any `/auth/*` endpoint -- must include `Cache-Control: no-store`.
11. **Grep full codebase** for `password` in logger/console calls -- must find zero matches.
12. **Verify CORS** in production mode -- request from `http://evil.com` must be rejected.

---

**Moshe:** Build it right. I will be checking every line.

**Avi**
Security Guard, Vertifile
