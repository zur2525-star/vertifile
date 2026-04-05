# Final Security Approval -- Auth System

### Reviewer: Avi (Security Guard)
### Date: 2026-04-06

### Verdict: APPROVED WITH ONE MINOR FINDING

---

## Issue-by-Issue Verification

| # | Severity | Issue | Fixed? | Notes |
|---|----------|-------|--------|-------|
| 1 | CRITICAL | Registration reveals email existence | YES | `routes/auth.js` line 170-174. When email exists, returns generic `"If this email is available, a verification code has been sent."` with `200 OK`. No enumeration possible. Correct. |
| 2 | CRITICAL | No dummy bcrypt compare on login (timing attack) | YES | `server.js` line 115 defines `DUMMY_HASH` constant at startup. Lines 122-124: when user not found, runs `bcrypt.compare(password, DUMMY_HASH)` before returning. Lines 128-130: same treatment for OAuth-only accounts. Both branches now take the same time as a real compare. Correct. |
| 3 | CRITICAL | Google OAuth does not check email_verified | YES | `server.js` lines 162-165. Checks `profile.emails?.[0]` and rejects if `email.verified === false`. After user creation, calls `db.setEmailVerified(user.id, true)` at line 186. Correct. |
| 4 | CRITICAL | No per-account login failure tracking or lockout | YES | `db.js` lines 177-178 add `failed_login_attempts` and `locked_until` columns. `server.js` lines 134-148: checks lockout before password compare, increments counter on failure, locks at 10 attempts for 30 minutes, resets on success at line 151. All with generic error messages. Correct. |
| 5 | CRITICAL | No session invalidation on password change/reset | YES | **Reset:** `routes/auth.js` lines 370-374: deletes ALL sessions for the user after password reset. **Change:** `db.js` lines 611-625: `changeUserPassword()` now accepts `currentSessionId` parameter and deletes all sessions except current. `routes/user.js` line 210: passes `req.sessionID`. Both paths have audit log entries. Correct. |
| 6 | HIGH | Password validation only checks length | YES | `routes/auth.js` lines 37-50: `validatePasswordComplexity()` checks min 8, max 128, uppercase, lowercase, digit, special character, password != email. Used on register (line 164) and reset-password (line 350). Correct. |
| 7 | HIGH | No common password blacklist | YES | `routes/auth.js` lines 22-32: loads `data/common-passwords.txt` at startup into a Set. File exists and contains standard common passwords. Check is integrated into `validatePasswordComplexity()` at line 46-48. Gracefully warns if file is missing. Correct. |
| 8 | HIGH | Google OAuth auto-merges accounts without linking check | YES | `server.js` lines 170-176: after `getUserByProviderId` returns null, checks `getUserByEmail` and if an account exists with a different provider, returns error asking user to sign in with password first. No silent merge or overwrite. Correct. |
| 9 | HIGH | Request logger does not exclude password from body | YES | `middleware/request-logger.js` lines 3-15: defines `SENSITIVE_FIELDS` array including password, password_hash, token, secret, authorization. `sanitizeForLogging()` replaces them with `[REDACTED]`. Line 23: proactively sanitizes `req.body` when password is present. Body is never included in log output. Correct. |
| 10 | HIGH | No email verification system | PARTIAL | `middleware/requireAuth.js` lines 81-93: `requireVerifiedEmail` middleware exists and is exported. `db.js` has `setEmailVerified()`. However, verification code generation, sending, and verification endpoints are not yet built. Acknowledged in original review as not blocking merge but must be next priority. Accepted as-is per original agreement. |
| 11 | MEDIUM | Session maxAge is 30 days, spec says 7 days | YES | `server.js` line 106: `maxAge: 7 * 24 * 60 * 60 * 1000`. Changed from 30 days to 7 days. Correct. |
| 12 | MEDIUM | No sliding window session refresh | YES | `middleware/requireAuth.js` line 62: `req.session.cookie.maxAge = SLIDING_SESSION_MS` (7 days) is set on every authenticated request. Active users get their session extended. Correct. |
| 13 | MEDIUM | No absolute session lifetime check | YES | `middleware/requireAuth.js` lines 19, 35-43: defines `ABSOLUTE_SESSION_MAX_MS` as 30 days. Checks `req.session.createdAt` and destroys session if exceeded. Returns proper 401 with `session_expired` error. Correct. |
| 14 | MEDIUM | No session limit per user (unlimited sessions) | YES | Implemented in three places: Google callback (lines 129-138), register (lines 198-209), and login (lines 259-271) in `routes/auth.js`. All query sessions by user, keep newest 5, delete oldest excess. Correct. |
| 15 | MEDIUM | Signup rate limiter is 10/hour, spec says 3/hour | YES | `middleware/auth.js` line 107: `max: 3`. `routes/auth.js` line 150: register route uses `signupLimiter` instead of `authLimiter`. Correct. |
| 16 | MEDIUM | No dedicated rate limiter for forgot-password by email | YES | `routes/auth.js` lines 64-71: `forgotPasswordLimiter` with `max: 3`, 1-hour window, keyed by normalized email via `keyGenerator`. Used on forgot-password route at line 305. Correct. |
| 17 | MEDIUM | No Cache-Control: no-store on auth responses | YES | `routes/auth.js` lines 55-59: `router.use()` middleware sets `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache` on all auth responses. Correct. |
| 18 | MEDIUM | Bcrypt rounds not configurable via env variable | YES | `routes/auth.js` line 17: `const BCRYPT_ROUNDS = Math.max(12, parseInt(process.env.BCRYPT_ROUNDS) || 12)`. Floor of 12 enforced. Used in register (line 177) and reset-password (line 365). Correct. |
| 19 | MEDIUM | No CORS localhost safety check for production | YES | `server.js` lines 87-90: checks if production AND localhost is in origins, throws `Error('SECURITY: localhost in production CORS origins')`. Correct. |
| 20 | MEDIUM | Login route leaks specific error for OAuth-only accounts | YES | `server.js` lines 127-131: OAuth-only accounts now get the same generic `'Invalid email or password'` message, plus a dummy bcrypt compare for timing safety. No information leakage. Correct. |
| 21 | LOW | Logout does not properly destroy session in DB | YES | `routes/auth.js` lines 290-299: `req.logout()` callback calls `req.session.destroy()`, then `res.clearCookie('connect.sid')`. Logs warning on failure with truncated session ID. Correct. |
| 22 | LOW | Login success/failure events not logged consistently | YES | **Success:** `routes/auth.js` line 255 logs `login_success` with userId, IP, provider, userAgent. Google callback line 126 does the same. **Failure:** Line 241 logs `login_failed` with truncated email, IP, and reason. Correct. |
| 23 | LOW | Google OAuth callback failure redirects without error context | YES | `routes/auth.js` line 118: `failureRedirect: '/app?auth_error=google_failed'`. Provides error context in the URL parameter. Correct. |
| 24 | LOW | Password validation not applied on reset-password route | YES | `routes/auth.js` lines 349-353: `validatePasswordComplexity(password)` is called on reset-password with full complexity rules. Correct. |
| 25 | LOW | No audit log for registration events | YES | `routes/auth.js` line 186: `db.log('user_registered', { userId: user.id, ip: getClientIP(req), provider: 'email' })`. Correct. |
| 26 | LOW | session.createdAt not set on login | YES | Set in three places: Google callback (line 124), register (line 194), and login (line 250) in `routes/auth.js`. All set `req.session.createdAt = Date.now()`. Correct. |

---

## New Issues Found

### NEW-1 [LOW] Change-password route in user.js skips full password complexity validation

- **File:** `routes/user.js` line 203
- **Problem:** The change-password route only checks `newPassword.length < 8`. It does NOT call `validatePasswordComplexity()` from `routes/auth.js`. This means a user changing their password through settings can set "aaaaaaaa" or a common password, bypassing the complexity rules and blacklist that protect registration and reset.
- **Severity:** LOW -- the user already has access to the account, so this is a self-harm scenario rather than an attack vector. But it weakens the password policy.
- **Fix:** Import or duplicate `validatePasswordComplexity` and use it in the change-password route. Also note that line 208 hardcodes `bcrypt.hash(newPassword, 12)` instead of using the configurable `BCRYPT_ROUNDS` constant.
- **Blocking merge?** No. This is a consistency issue, not a vulnerability. Add to next sprint.

---

## Summary

**26 original issues:**
- 25 out of 26 fully fixed and verified
- 1 (issue #10 -- email verification system) partially addressed with the `requireVerifiedEmail` middleware guard, which was agreed as acceptable per the original review since it requires email service integration

**1 new minor issue found:**
- Change-password route in `user.js` missing full password complexity validation (LOW severity, not blocking)

---

## Security Posture Assessment

The auth system has gone from roughly 35/80 passing checklist items to approximately 70/80. The remaining gaps are:

1. **Email verification endpoints** (not yet built, requires email service -- scheduled for next sprint)
2. **Change-password complexity validation** (new finding, LOW severity)
3. **Change-password bcrypt rounds** using hardcoded 12 instead of `BCRYPT_ROUNDS` constant (cosmetic -- 12 is the floor anyway)

The five CRITICAL vulnerabilities -- email enumeration, timing attacks, unverified OAuth email, account lockout, and session invalidation -- are all properly resolved. The code is defensive, uses generic error messages consistently, and maintains comprehensive audit logging.

Moshe did good work here. Every fix matches what I specified in the original review. The lockout logic is clean, the dummy bcrypt hashes prevent timing leaks in all branches, and the session management is now properly scoped with sliding windows, absolute lifetimes, and per-user limits.

---

## Signature

**Avi -- Security Lead -- APPROVED FOR MERGE**

The auth system passes security review. The one new finding (NEW-1) is LOW severity and should be addressed in the next sprint alongside the email verification system. This code is safe to ship.

-- Avi
Security Guard, Vertifile
