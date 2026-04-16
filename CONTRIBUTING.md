# Contributing to Vertifile

Thank you for taking the time to contribute. Vertifile is a cryptographic document verification platform with strict requirements around correctness, security, and code quality. Every contribution is reviewed carefully to maintain those standards. This document explains how to work within the project effectively.

---

## Getting Started

**Clone the repository**

```bash
git clone https://github.com/vertifile/pvf-project.git
cd pvf-project
```

**Install dependencies**

```bash
npm ci
```

**Configure environment variables**

Copy the example below into a `.env` file (never commit this file). The three required secrets are auto-generated to `data/` if absent, but you may set them explicitly for reproducibility in local testing.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Neon or local Postgres 16) |
| `HMAC_SECRET` | Yes | HMAC signing secret |
| `SESSION_SECRET` | Yes | Express session secret |
| `ADMIN_SECRET` | Yes | Admin dashboard access token |
| `POLYGON_PRIVATE_KEY` | No | Polygon wallet private key for blockchain anchoring |
| `POLYGON_CONTRACT` | No | Deployed smart contract address |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

**Run the development server**

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default.

---

## Development Workflow

1. **Create a branch from `main`** — see branch naming conventions below.
2. **Write your code** — follow the code style rules in the next section.
3. **Run the full test suite** — all 31 suites must pass before you open a PR:

   ```bash
   npm test
   ```

4. **Run the benchmark** if your change is performance-sensitive (file I/O, signing pipeline, database queries):

   ```bash
   npm run benchmark
   ```

   Include benchmark output in your PR description if a performance-relevant path changed.

5. **Commit** with a clear message following the conventions below.
6. **Push and open a pull request** against `main`.

---

## Code Style

**Pure Node.js, no external build tooling**

The project uses zero build steps and zero transpilation. All server code is plain CommonJS (`"type": "commonjs"` in `package.json`). Keep it that way.

**No emojis — anywhere**

No emojis in source code, comments, commit messages, or documentation. This is a firm project convention. Use plain text and SVG icons instead.

**Use the pino logger — never `console.log` in production server code**

```js
// correct
const logger = require('pino')();
logger.info({ userId }, 'document created');

// wrong — CI will reject this
console.log('document created');
```

CI scans the following paths for `console.log`, `console.debug`, `console.info`, `console.warn`, and `console.error` and fails the build if any are found:

- `routes/`
- `middleware/`
- `services/`
- `db.js`
- `server.js`
- `blockchain.js`
- `obfuscate.js`

`console` is permitted in `tests/`, `scripts/`, `public/`, `templates/`, `viewer/`, and `sdk.js`.

**Parameterized SQL — never string interpolation**

```js
// correct
const result = await db.query(
  'SELECT * FROM documents WHERE id = $1 AND org_id = $2',
  [documentId, orgId]
);

// wrong — SQL injection risk, will not pass review
const result = await db.query(
  `SELECT * FROM documents WHERE id = '${documentId}'`
);
```

**No unused dependencies**

The project targets zero development dependencies. Do not add `devDependencies` without a compelling reason and explicit discussion in your PR. If a package is only needed for tests, check whether the equivalent functionality is available natively in `node:test`, `node:assert`, or other built-in modules first.

**Secrets always come from environment variables**

Never hardcode secrets, keys, passwords, or tokens. CI scans for common secret patterns and fails the build if any are found outside of test files.

**Locale strings**

Every new user-facing string must be added to all 10 locale files in `public/locales/` (en, he, ar, fr, es, de, ru, zh, ja, pt) before the PR can merge. CI validates that all locale JSON files are syntactically valid.

---

## Testing Requirements

The test suite runs on Node's built-in `node:test` runner. There are no external test dependencies — do not introduce Jest, Mocha, Vitest, or any other test framework.

**What requires tests**

- Every new API endpoint
- Every new middleware module
- Every new service function that contains business logic
- Every security-sensitive code path (CSRF, authentication, authorization, input validation)

**Test file location and naming**

Place tests in `tests/` and name the file after the module being tested:

```
tests/my-new-feature.test.js
```

**Import pattern for integration tests**

```js
const { createTestApp, makeRequest } = require('./helpers.js');
```

Consult existing test files for the full helper API before writing new integration tests.

**CSRF-protected endpoints**

Any test that exercises a mutating endpoint (POST, PUT, PATCH, DELETE) behind CSRF protection must obtain a CSRF token first. Follow the pattern established in `tests/csrf.test.js` and `tests/admin.test.js` — fetch the token from the appropriate endpoint and attach it to the request header.

**Running a single suite during development**

```bash
# Examples
npm run test:signing
npm run test:webhook-security
npm run test:csrf

# See package.json for the complete list of per-suite scripts
```

---

## Pull Request Checklist

Before marking your PR ready for review, confirm every item below:

- [ ] Tests added for all new code (endpoints, middleware, services)
- [ ] All 31 existing test suites pass locally (`npm test`)
- [ ] CI passes — check the GitHub Actions `quality-gates` job
- [ ] No emojis anywhere in the diff (code, comments, docs, commit messages)
- [ ] No `console.log` in production server code
- [ ] No hardcoded secrets or credentials
- [ ] All new user-facing strings added to all 10 locale files (`public/locales/`)
- [ ] `SECURITY.md` updated if the change adds, removes, or modifies a security control
- [ ] OpenAPI specification updated if adding or changing any endpoint (`public/api/openapi.json`)
- [ ] `CHANGELOG.md` updated with a summary of the change under `[Unreleased]`
- [ ] Benchmark output included in the PR description if a performance-sensitive path changed

---

## Security Issues

**Do not open public GitHub issues for security vulnerabilities.**

If you discover a security issue, send a private report to:

**security@vertifile.com**

Include a description of the vulnerability, steps to reproduce, and the potential impact. You will receive a response within 72 hours. The full security model is documented in [SECURITY.md](./SECURITY.md).

---

## Commit Message Conventions

Each commit message must start with one of the following prefixes:

| Prefix | When to use |
|---|---|
| `feat:` | A new feature visible to users or API consumers |
| `fix:` | A bug fix |
| `test:` | Test-only changes (no production code changed) |
| `docs:` | Documentation only (README, SECURITY.md, comments, etc.) |
| `security:` | A security improvement or hardening measure |
| `refactor:` | Internal restructuring with no behavior change |
| `perf:` | A performance improvement |
| `chore:` | Tooling, dependencies, build scripts, CI configuration |

**Examples**

```
feat: add webhook signature verification endpoint
fix: correct CSRF token expiry on session renewal
security: enforce HSTS preload on all responses
perf: batch Ed25519 verifications in rotation handler
chore: pin postgres image to 16.3 in CI
```

Keep the subject line under 72 characters. Use the body to explain why the change was made, not what — the diff shows what.

---

## Branch Naming

| Pattern | Use for |
|---|---|
| `feat/short-description` | New features |
| `fix/issue-number-description` | Bug fixes tied to a GitHub issue |
| `fix/short-description` | Bug fixes without an issue number |
| `security/short-description` | Security improvements |
| `perf/short-description` | Performance work |
| `docs/short-description` | Documentation-only changes |
| `refactor/short-description` | Internal restructuring |
| `chore/short-description` | Tooling and dependency updates |
| `test/short-description` | Test-only additions or fixes |

Use lowercase and hyphens only. Keep names short and descriptive.

**Examples**

```
feat/ed25519-key-rotation-api
fix/42-csrf-token-missing-on-redirect
security/rate-limit-verify-public
```

---

## Architecture Decisions

For changes that affect the overall structure of the system — adding a new dependency, changing the authentication model, introducing a new module boundary, altering the signing pipeline — open a GitHub issue first to discuss the approach before writing code.

For significant decisions that are approved and implemented, write an Architecture Decision Record (ADR) in `docs/architecture-decisions/`. Use a sequentially numbered filename:

```
docs/architecture-decisions/0001-use-ed25519-for-public-verification.md
docs/architecture-decisions/0002-zero-knowledge-client-side-hashing.md
```

An ADR should cover: the context, the decision, the alternatives considered, and the consequences. This creates a durable record of why the system is the way it is.
