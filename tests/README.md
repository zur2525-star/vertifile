# Vertifile Tests

## Prerequisites

- **Node.js 18+** (uses the built-in `node:test` runner)
- **PostgreSQL** running and migrated (`npm run migrate`)
- **Server running** on `http://localhost:3002` (default)

## Running the E2E tests

1. Start the server in one terminal:

```bash
npm run dev
```

2. Run the tests in another terminal:

```bash
node --test tests/e2e-auth-onboarding.test.js
```

### Custom server URL

If the server is running on a different host or port, set `TEST_BASE_URL`:

```bash
TEST_BASE_URL=http://localhost:4000 node --test tests/e2e-auth-onboarding.test.js
```

### Run all tests in the `tests/` directory

```bash
node --test tests/
```

## Test structure

| File | Covers |
|---|---|
| `e2e-auth-onboarding.test.js` | Auth registration, login, logout, /me, onboarding wizard CRUD, health check, security headers, rate limiting, cookie flags |

## Test design notes

- **Self-contained**: Each test generates a unique email using a random run ID, so tests never collide across parallel or repeated runs.
- **No external dependencies**: Uses Node's built-in `node:test` and `node:assert` -- no Jest, Mocha, or other frameworks needed.
- **Rate limiter awareness**: Some security tests (lockout, rate limiting) are affected by the server's rate limiters. The tests document these constraints and accept either rate-limit or application-level responses as valid security behavior.
- **Environment-aware**: The Secure cookie flag test is commented out for local development (cookies are only Secure when `NODE_ENV=production`). Uncomment when running against staging/production.

## Covered scenarios

### Auth Flow (tests 1-10)
1. Valid registration returns 200 + session
2. Duplicate email returns generic response (no enumeration)
3. Weak password rejected (missing uppercase, digit, special char, too short)
4. Common blacklisted password rejected
5. Valid login returns user data
6. Wrong password returns generic error
7. Repeated failed attempts trigger lockout/rate-limit
8. Authenticated user gets full profile via /auth/me
9. Unauthenticated request to /auth/me returns 401
10. Logout destroys session

### Onboarding Flow (tests 11-13)
11. New user gets default wizard state
12. PUT saves wizard progress (and rejects empty body)
13. Complete finalizes wizard (and fails without prior state)

### Health (test 14)
14. GET /api/health returns 200 with DB status

### Security (tests 15-17+)
15. Rate limiting returns 429 after too many requests
16. Session cookie has HttpOnly and SameSite flags
17. Auth responses include Cache-Control: no-store and Pragma: no-cache

Plus additional edge-case tests for missing/invalid email, non-existent user login, and format validation.
