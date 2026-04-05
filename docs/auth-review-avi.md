# Security Review -- Auth System

### Reviewer: Avi (Security Guard)
### Date: 2026-04-06
### Verdict: NEEDS FIXES

Moshe, I went through every line against my 80-item spec. You got some things right but there are critical gaps that block this from shipping. No sugarcoating. Here is every issue.

---

## Issues Found

### CRITICAL

**1. [CRITICAL] Registration reveals whether email exists**
- File: `routes/auth.js` line 91-93
- Problem: `res.status(400).json({ success: false, error: 'Email already registered' })` -- this tells attackers exactly which emails are registered in our system. User enumeration is a precondition to credential stuffing, phishing, and brute force.
- Spec reference: Section 6.1, checklist item #50
- Fix: Return a generic success response regardless:
```js
const existing = await db.getUserByEmail(email);
if (existing) {
  // Silently succeed — do NOT reveal email exists
  // In production: send a "someone tried to register with your email" notification
  return res.json({ success: true, message: 'If this email is available, a verification code has been sent.' });
}
```

**2. [CRITICAL] No dummy bcrypt compare on login when user not found (timing attack)**
- File: `server.js` line 111-112
- Problem: When user is not found, the code returns immediately with `done(null, false, ...)`. When user IS found, it runs `bcrypt.compare()` which takes ~250ms. An attacker can measure response times and determine which emails exist.
- Spec reference: Section 6.1, checklist item #49
- Fix: Add a dummy compare before the early return:
```js
if (!user) {
  await bcrypt.compare(password, '$2b$12$LJ3m4ys3Lk0TSwHFnHBGMeZR5JkXBqEWvRyDJyQGqOM5rLSsMwDOi');
  return done(null, false, { message: 'Invalid email or password' });
}
```
(Pre-hash a dummy value once at startup for best performance.)

**3. [CRITICAL] Google OAuth does NOT check email_verified**
- File: `server.js` lines 120-128
- Problem: The GoogleStrategy callback trusts whatever email Google returns without checking `profile.emails[0].verified`. A Google account can exist with an unverified email. This means someone could create a Google account with victim@example.com (unverified), then OAuth into Vertifile and access the victim's account.
- Spec reference: Section 4.2, checklist item #34-35
- Fix:
```js
async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0];
    if (!email || email.verified === false) {
      return done(null, false, { message: 'Google email not verified' });
    }
    let user = await db.getUserByProviderId('google', profile.id);
    if (!user) {
      user = await db.createUser({
        email: email.value,
        name: profile.displayName,
        provider: 'google',
        providerId: profile.id,
        avatarUrl: profile.photos?.[0]?.value || null,
      });
      await db.setEmailVerified(user.id, true); // Google-verified email
    }
    done(null, user);
  } catch (e) { done(e); }
}
```

**4. [CRITICAL] No per-account login failure tracking or lockout**
- Files: `server.js` (LocalStrategy), `routes/auth.js` (login route), `db.js` (users table)
- Problem: There is no `failed_login_attempts` column, no `locked_until` column, no lockout logic whatsoever. An attacker can brute-force passwords for any account without limit (only IP-based rate limiting exists, which is trivially bypassed with proxies/botnets).
- Spec reference: Section 3.2, checklist item #31-33
- Fix: Add columns to users table:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
```
Then in the LocalStrategy:
```js
if (user.locked_until && new Date(user.locked_until) > new Date()) {
  return done(null, false, { message: 'Invalid email or password' }); // Generic -- don't reveal lockout
}
if (!(await bcrypt.compare(password, user.password_hash))) {
  const attempts = (user.failed_login_attempts || 0) + 1;
  await pool.query('UPDATE users SET failed_login_attempts = $1 WHERE id = $2', [attempts, user.id]);
  if (attempts >= 10) {
    const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query('UPDATE users SET locked_until = $1 WHERE id = $2', [lockUntil, user.id]);
    await db.log('account_locked', { userId: user.id, attempts, ip: 'from-request' });
  }
  return done(null, false, { message: 'Invalid email or password' });
}
// On success: reset counter
await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
```

**5. [CRITICAL] No session invalidation on password change or reset**
- File: `routes/auth.js` lines 209-238 (reset-password), `db.js` line 608-610 (changeUserPassword)
- Problem: When a user changes or resets their password, all existing sessions remain valid. If an attacker has stolen a session, changing the password does NOT kick them out. This completely defeats the purpose of password rotation after compromise.
- Spec reference: Section 2.5, checklist items #22-23
- Fix: After password update, destroy all other sessions:
```js
// After bcrypt.hash and updateUserPassword:
await db.query(
  `DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1`,
  [String(reset.user_id)]
);
await db.log('sessions_invalidated', { userId: reset.user_id, reason: 'password_reset' });
```
For password change (user route), destroy all sessions EXCEPT current:
```js
await db.query(
  `DELETE FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1 AND sid != $2`,
  [String(userId), req.sessionID]
);
```

---

### HIGH

**6. [HIGH] Password validation only checks length, not complexity**
- File: `routes/auth.js` lines 83-88 (register), lines 215-217 (reset-password)
- Problem: Only checks `password.length < 8` and `password.length > 128`. No uppercase, lowercase, digit, or special character requirements. Users can register with "aaaaaaaa" as their password.
- Spec reference: Section 1.2, checklist items #4-7
- Fix: Create a shared validation function:
```js
function validatePasswordComplexity(password, email) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be less than 128 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Password cannot be your email address';
  return null; // valid
}
```
Use this in register, reset-password, and any change-password route.

**7. [HIGH] No common password blacklist**
- Files: None (does not exist)
- Problem: A user can register with "Password1!" which passes complexity rules but is in every attacker's dictionary. No `data/common-passwords.txt` file, no Set loaded at startup, no check.
- Spec reference: Section 1.3, checklist item #8
- Fix: Create `data/common-passwords.txt` with the top 1000 passwords (SecLists source). Load at startup:
```js
const commonPasswords = new Set(
  fs.readFileSync(path.join(__dirname, 'data/common-passwords.txt'), 'utf8')
    .split('\n').map(p => p.trim().toLowerCase()).filter(Boolean)
);
// In validation:
if (commonPasswords.has(password.toLowerCase())) {
  return 'This password is too common. Please choose a stronger password.';
}
```

**8. [HIGH] Google OAuth auto-merges/creates accounts without linking check**
- File: `server.js` lines 123-126
- Problem: If a user registers with email/password for foo@bar.com, then someone signs in with a Google account using foo@bar.com, the code creates a NEW user with a duplicate email (will fail on UNIQUE constraint) or silently overwrites. There is no check for existing email accounts with a different provider. The spec requires asking the user to sign in with their password first, then link Google from settings.
- Spec reference: Section 4.4, checklist item #39
- Fix:
```js
let user = await db.getUserByProviderId('google', profile.id);
if (!user) {
  const existingByEmail = await db.getUserByEmail(profile.emails[0].value);
  if (existingByEmail && existingByEmail.provider !== 'google') {
    return done(null, false, {
      message: 'An account with this email exists. Please sign in with your password first, then link Google from settings.'
    });
  }
  user = await db.createUser({ ... });
}
```

**9. [HIGH] Request logger does not exclude password from body**
- File: `middleware/request-logger.js` lines 14-20
- Problem: The logger logs `req.method`, `req.path`, etc. but does NOT explicitly exclude `req.body.password`. While it does not currently log `req.body`, if any future change adds body logging (or if Pino/the logger serializer captures it), passwords will leak into logs. The spec says this must be proactively prevented.
- Spec reference: Section 1.4, checklist items #10, #70
- Fix: Even though body is not logged now, add explicit defense:
```js
// In the logger or as middleware before auth routes:
if (req.body && req.body.password) {
  const sanitizedBody = { ...req.body, password: '[REDACTED]' };
  // use sanitizedBody if body is ever logged
}
```
Also: grep the entire codebase for any logger call that might include password. The `logger.error({ err: e }, 'Registration failed')` at line 120 of auth.js -- if `err` ever serializes the request body, the password leaks.

**10. [HIGH] No email verification system at all**
- Files: None
- Problem: No verification code generation, no verification endpoint, no `email_verified` enforcement. Users can register with any email and immediately use the system. The spec has an entire section (Section 5) with 8 checklist items for this.
- Spec reference: Section 5, checklist items #40-47
- Fix: This is a significant feature. At minimum:
  - Add a `verification_codes` table
  - Add `POST /auth/send-verification` endpoint
  - Add `POST /auth/verify-code` endpoint
  - Use `crypto.randomInt(100000, 999999)` for code generation
  - Use `crypto.timingSafeEqual` for code comparison
  - Max 5 attempts per code, 10-minute expiry
  - Block sensitive operations until email_verified = true

---

### MEDIUM

**11. [MEDIUM] Session maxAge is 30 days, spec says 7 days**
- File: `server.js` line 101
- Problem: `maxAge: 30 * 24 * 60 * 60 * 1000` -- this is 30 days. Spec requires 7 days with sliding window and 30-day absolute maximum.
- Spec reference: Section 2.3, checklist item #18
- Fix: Change to `maxAge: 7 * 24 * 60 * 60 * 1000`

**12. [MEDIUM] No sliding window session refresh**
- File: `middleware/requireAuth.js`
- Problem: No `req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;` in authenticated requests. Active users will get logged out after 7 days even if they use the app daily.
- Spec reference: Section 2.3, checklist item #19
- Fix: Add in requireAuth middleware after successful DB lookup:
```js
req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
```

**13. [MEDIUM] No absolute session lifetime check**
- File: `server.js` / `middleware/requireAuth.js`
- Problem: No `session.createdAt` is stored, no check against 30-day absolute max. Even with sliding window, a session could theoretically live forever.
- Spec reference: Section 2.3, checklist item #20
- Fix: On session creation, store `req.session.createdAt = Date.now()`. In requireAuth:
```js
if (req.session.createdAt && Date.now() - req.session.createdAt > 30 * 24 * 60 * 60 * 1000) {
  return req.session.destroy(() => {
    res.status(401).json({ success: false, error: 'Session expired, please sign in again' });
  });
}
```

**14. [MEDIUM] No session limit per user (unlimited sessions)**
- Files: None
- Problem: A user can create unlimited sessions from different devices/browsers. No check for max 5 active sessions. Sessions accumulate in the database forever (until expiry).
- Spec reference: Section 2.4, checklist item #21
- Fix: After `req.login()`, query active sessions for this user and destroy the oldest if count >= 5:
```js
const activeSessions = await db.query(
  `SELECT sid FROM sessions WHERE sess::jsonb->'passport'->>'user' = $1 ORDER BY expire ASC`,
  [String(user.id)]
);
if (activeSessions.rows.length > 5) {
  const toDelete = activeSessions.rows.slice(0, activeSessions.rows.length - 5);
  for (const s of toDelete) {
    await db.query('DELETE FROM sessions WHERE sid = $1', [s.sid]);
  }
}
```

**15. [MEDIUM] Signup rate limiter is 10/hour, spec says 3/hour**
- File: `middleware/auth.js` line 107
- Problem: `max: 10` but spec requires `max: 3`. And the register route uses `authLimiter` (5/15min) instead of `signupLimiter`. The `signupLimiter` is exported but never used.
- Spec reference: Section 3.1, checklist item #26
- Fix: Change `max: 10` to `max: 3` in signupLimiter. Use `signupLimiter` on the register route instead of `authLimiter`:
```js
router.post('/register', signupLimiter, async (req, res) => { ... });
```

**16. [MEDIUM] No dedicated rate limiter for forgot-password by email**
- File: `routes/auth.js` line 172
- Problem: Uses `authLimiter` which is keyed by IP. Spec requires a dedicated limiter keyed by normalized email (3/hour/email). An attacker could spam reset emails from different IPs.
- Spec reference: Section 3.1, checklist item #27
- Fix: Create `forgotPasswordLimiter`:
```js
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.body.email || '').toLowerCase().trim(),
  message: { success: false, error: 'Too many password reset requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

**17. [MEDIUM] No Cache-Control: no-store on auth responses**
- File: `routes/auth.js` (all endpoints)
- Problem: Auth responses (login, register, /me, etc.) can be cached by browsers or proxies. Sensitive user data in responses could be stored in browser cache and retrieved by the next user on a shared computer.
- Spec reference: Section 7.2, checklist items #53-54
- Fix: Add middleware at the top of the auth router:
```js
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});
```

**18. [MEDIUM] Bcrypt rounds not configurable via env variable**
- File: `routes/auth.js` line 95, line 229
- Problem: Hardcoded `bcrypt.hash(password, 12)`. Spec says it must be configurable via `BCRYPT_ROUNDS` with a floor of 12.
- Spec reference: Section 1.1, checklist item #1
- Fix:
```js
const BCRYPT_ROUNDS = Math.max(12, parseInt(process.env.BCRYPT_ROUNDS) || 12);
// Then use:
const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
```

**19. [MEDIUM] No CORS localhost safety check for production**
- File: `server.js` lines 81-85
- Problem: The localhost check relies on `process.env.NODE_ENV !== 'production'`. If someone deploys without setting NODE_ENV, localhost will be in the CORS list. Spec requires a startup check that throws.
- Spec reference: Section 6.4, checklist item #63
- Fix: Add after ALLOWED_ORIGINS definition:
```js
if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.includes('http://localhost:3002')) {
  throw new Error('SECURITY: localhost in production CORS origins');
}
```

**20. [MEDIUM] Login route leaks specific error for OAuth-only accounts**
- File: `server.js` line 113
- Problem: `if (!user.password_hash) return done(null, false, { message: 'Please use Google or Microsoft to sign in' })` -- this tells the attacker that an account exists AND it uses OAuth. Spec says ALL login failures must return "Invalid email or password".
- Spec reference: Section 6.2, checklist item #48
- Fix: Change message to `'Invalid email or password'`.

---

### LOW

**21. [LOW] Logout does not properly destroy session in DB**
- File: `routes/auth.js` line 164-166
- Problem: `req.logout()` only clears the Passport user from the session. It does NOT call `req.session.destroy()`, so the session record remains in PostgreSQL. The session is technically still alive (just without passport data).
- Fix:
```js
router.post('/logout', (req, res) => {
  const sid = req.sessionID;
  req.logout(() => {
    req.session.destroy((err) => {
      if (err) logger.warn({ err, sid: sid?.substring(0, 8) }, 'Session destroy failed');
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});
```

**22. [LOW] Login success/failure events not logged consistently**
- File: `routes/auth.js`, `server.js`
- Problem: Successful logins do call `updateLastLogin` but do not call `db.log()` for the audit trail. Failed logins are not explicitly logged with IP and user agent. The spec requires comprehensive audit logging for all auth events.
- Spec reference: Section 8.1, checklist items #65-69
- Fix: Add `db.log()` calls for every auth event:
```js
// On successful login:
await db.log('login_success', { userId: user.id, ip: getClientIP(req), provider: 'email', userAgent: req.get('user-agent') });
// On failed login:
await db.log('login_failed', { email: email.substring(0, 3) + '***', ip: getClientIP(req), reason: 'invalid_credentials' });
```

**23. [LOW] Google OAuth callback failure redirects to /app without error context**
- File: `routes/auth.js` line 55
- Problem: `failureRedirect: '/app'` -- on OAuth failure, user is silently redirected with no indication of what went wrong. No audit log entry either.
- Fix: Redirect to `/app?auth_error=1` and add a `failureFlash` or `failureMessage` option. Log the failure:
```js
passport.authenticate('google', {
  failureRedirect: '/app?auth_error=google_failed',
})
```

**24. [LOW] Password validation not applied on reset-password route with same rigor**
- File: `routes/auth.js` lines 215-217
- Problem: Reset-password only checks length >= 8. Does not check max length 128, does not run complexity validation. A user resetting their password can set "aaaaaaaa".
- Fix: Use the same `validatePasswordComplexity()` function from issue #6 on the reset-password route.

**25. [LOW] No audit log for registration events**
- File: `routes/auth.js` register handler (lines 70-123)
- Problem: Successful registration does not write to the audit log. We have no record of when accounts were created (beyond the `created_at` column on users).
- Spec reference: Section 8.1, checklist item #66
- Fix: Add after successful user creation:
```js
await db.log('user_registered', { userId: user.id, ip: getClientIP(req), provider: 'email' });
```

**26. [LOW] session.createdAt not set on login for absolute lifetime tracking**
- File: `routes/auth.js` login/register handlers
- Problem: Related to issue #13. Even if we add the check in requireAuth, nobody sets `req.session.createdAt` during login/register.
- Fix: Inside `req.login()` callback, add:
```js
req.session.createdAt = Date.now();
```

---

## What's Good

Credit where due. Moshe got these things right:

1. **Bcrypt with 12 rounds** -- correct and not lowered. Good.
2. **HttpOnly + Secure + SameSite=lax cookies** -- properly configured in server.js line 101.
3. **Forgot-password returns generic message** -- line 182/198 in auth.js. Does not reveal email existence. Good.
4. **Parameterized queries everywhere** -- no SQL injection vectors found. All db.js queries use $1, $2, etc. Good.
5. **Session store in PostgreSQL** -- using connect-pg-simple with proper schema. Good.
6. **Helmet configured properly** -- CSP, HSTS, X-Frame-Options, Referrer-Policy, DNS prefetch, Permissions-Policy all present.
7. **CORS locked to vertifile.com in production** -- credentials mode enabled. Good.
8. **Input sanitization exists** -- sanitizeBody middleware runs before auth routes.
9. **requireAuth middleware does DB round-trip** -- does not trust stale session data. Loads fresh user on every authenticated request. Good.
10. **Session secret loaded from env or secure file** -- persistent across restarts, 600 permissions on file. Good.
11. **Password reset tokens are single-use** -- deleted after use. 30-minute expiry. Good.
12. **Name input truncated** -- `String(name).trim().substring(0, 255)`. Prevents storage overflow. Good.
13. **Max password length enforced at 128** -- prevents bcrypt DoS on registration (but missing on reset -- see issue #24).
14. **trust proxy set** -- required for rate limiting behind Render's proxy. Good.
15. **Email sanitization** -- lowercased and trimmed before lookup. Prevents duplicate accounts via case tricks. Good.

---

## Required Before Merge (MUST FIX)

These are non-negotiable. This code does NOT ship until all of these are resolved:

1. **Registration must NOT reveal email existence** (issue #1)
2. **Add dummy bcrypt compare on login when user not found** (issue #2)
3. **Google OAuth must check email_verified** (issue #3)
4. **Per-account login failure tracking + lockout after 10 attempts** (issue #4)
5. **Session invalidation on password change AND reset** (issue #5)
6. **Password complexity validation** (uppercase, lowercase, digit, special char) (issue #6)
7. **Common password blacklist** (issue #7)
8. **Google OAuth account linking safety** (issue #8)
9. **Request logger must never log passwords** (issue #9)
10. **OAuth-only account login message must be generic** (issue #20)
11. **Logout must destroy session in DB** (issue #21)
12. **Session maxAge reduced to 7 days** (issue #11)

---

## Recommended (Not Blocking, But Do Soon)

These are not blocking the merge but should be addressed within the next sprint:

1. Email verification system (issue #10) -- this is HIGH severity but I understand it requires email service integration. Must be the NEXT thing built after this merge.
2. Sliding window session refresh (issue #12)
3. Absolute session lifetime with createdAt (issue #13)
4. Session limit per user -- max 5 (issue #14)
5. Signup rate limit reduced to 3/hour (issue #15)
6. Dedicated forgot-password rate limiter by email (issue #16)
7. Cache-Control: no-store on auth responses (issue #17)
8. Bcrypt rounds configurable via env (issue #18)
9. CORS localhost production safety check (issue #19)
10. Comprehensive audit logging for all auth events (issue #22, #25)
11. OAuth failure redirect with error context (issue #23)
12. Password complexity on reset-password route (issue #24)
13. session.createdAt tracking (issue #26)

---

## Checklist Status (80 items)

| Range | Status |
|---|---|
| #1-3 (bcrypt rounds, min/max length) | PASS (rounds=12, min=8, max=128 on register) |
| #4-7 (complexity: upper, lower, digit, special) | FAIL -- not implemented |
| #8 (common password blacklist) | FAIL -- not implemented |
| #9 (password != email) | FAIL -- not checked |
| #10-11 (password not in logs/responses) | PARTIAL -- not proactively excluded |
| #12 (specific validation errors) | FAIL -- only generic "8 chars" message |
| #13 (session ID generation) | PASS -- express-session default |
| #14-16 (cookie flags) | PASS |
| #17 (cookie domain not set) | PASS |
| #18 (session maxAge 7 days) | FAIL -- still 30 days |
| #19 (sliding window) | FAIL |
| #20 (absolute lifetime) | FAIL |
| #21 (max 5 sessions) | FAIL |
| #22-23 (session invalidation) | FAIL |
| #24 (session destroy on logout) | PARTIAL -- logout does not destroy session |
| #25-30 (rate limiting matrix) | PARTIAL -- only authLimiter used |
| #31-33 (account lockout) | FAIL |
| #34-35 (Google email_verified) | FAIL |
| #36-38 (OAuth state, auth code flow, redirect URIs) | PASS (passport defaults) |
| #39 (no auto-merge) | FAIL |
| #40-47 (email verification) | FAIL -- not implemented |
| #48 (generic login error) | FAIL -- OAuth message leaks |
| #49 (dummy bcrypt) | FAIL |
| #50 (registration enumeration) | FAIL |
| #51 (forgot-password generic) | PASS |
| #52 (no data in URLs) | PASS |
| #53-54 (Cache-Control) | FAIL |
| #55-60 (security headers) | PASS (via Helmet) |
| #61-64 (CORS) | PARTIAL -- no production safety check |
| #65-72 (logging) | PARTIAL -- minimal logging |
| #73 (no console.log) | PASS |
| #74 (parameterized queries) | PASS |
| #75 (input validation) | PASS |
| #76 (session secret) | PASS |
| #77 (trust proxy) | PASS |
| #78 (consistent JSON shape) | PASS |
| #79-80 (no sensitive data in errors) | PASS |

**Passed: ~35/80**
**Failed: ~30/80**
**Partial: ~10/80**
**N/A (email verification not built): ~5/80**

---

Moshe -- the foundation is solid. You did not introduce any SQL injection, the session store is right, Helmet is right, CORS is right. But the auth-specific security is incomplete. The 12 must-fix items above are real vulnerabilities, not theoretical concerns. Fix them, then ping me for re-review.

-- Avi
Security Guard, Vertifile
