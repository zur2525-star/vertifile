#!/usr/bin/env node
'use strict';

/**
 * Unit tests for services/env-validator.js
 *
 * Exercises validateEnv() across production and development modes.
 * Each test saves and restores process.env to avoid cross-test pollution.
 * process.exit is stubbed so fatal errors can be asserted without actually
 * terminating the test process.
 *
 * Runner: node:test  (matches the rest of the test suite)
 * Usage:  node tests/env-validator.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Module path (resolved once; cleared from require cache before each test)
// ---------------------------------------------------------------------------
const VALIDATOR_PATH = path.resolve(__dirname, '..', 'services', 'env-validator');
const LOGGER_PATH    = path.resolve(__dirname, '..', 'services', 'logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Evict env-validator (and logger) from the require cache so each test gets a
 * fresh module evaluation. Logger is evicted too because it reads NODE_ENV at
 * require-time to decide between JSON and pretty-print transports.
 */
function clearModuleCache() {
  delete require.cache[require.resolve(VALIDATOR_PATH)];
  delete require.cache[require.resolve(LOGGER_PATH)];
}

/**
 * Minimal set of env vars that satisfy every production requirement.
 */
const PROD_REQUIRED = {
  DATABASE_URL:   'postgres://test:test@localhost/testdb',
  HMAC_SECRET:    'test-hmac-secret-value',
  SESSION_SECRET: 'test-session-secret-value',
  ADMIN_SECRET:   'test-admin-secret-value',
};

// ---------------------------------------------------------------------------
// Per-test env snapshot / restore
// ---------------------------------------------------------------------------

let savedEnv;

beforeEach(() => {
  // Deep-clone the current env so we can fully restore it after each test.
  savedEnv = { ...process.env };
});

afterEach(() => {
  // Restore env to exactly what it was before this test ran.
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, savedEnv);

  // Always evict from the require cache so the next test starts clean.
  clearModuleCache();
});

// ---------------------------------------------------------------------------
// Utility: set up a clean environment, call validateEnv(), capture side effects
// ---------------------------------------------------------------------------

/**
 * Run validateEnv() in a controlled environment.
 *
 * @param {object} envOverrides  - Exact set of env vars to expose. Any key set
 *                                 to undefined is deleted from process.env.
 * @returns {{ exitCode: number|null, fatalMessages: string[], warnMessages: string[] }}
 */
function runValidator(envOverrides = {}) {
  // Wipe the slate — start from an empty env, then apply overrides.
  // We keep PATH and a handful of system vars that node needs to function.
  const systemKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP',
                      'NODE_PATH', 'npm_execpath', 'npm_config_cache'];
  for (const key of Object.keys(process.env)) {
    if (!systemKeys.includes(key)) {
      delete process.env[key];
    }
  }

  // Apply caller-supplied overrides (undefined value = ensure the key is absent).
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  clearModuleCache();

  // Stub process.exit so a fatal validation error is captured, not propagated.
  let exitCode = null;
  const originalExit = process.exit;
  process.exit = (code) => { exitCode = code ?? 0; };

  // Capture logger output via the pino logger's methods.
  const fatalMessages = [];
  const warnMessages  = [];

  // We intercept at the logger object level after requiring it.
  const logger = require(LOGGER_PATH);
  const origFatal = logger.fatal.bind(logger);
  const origWarn  = logger.warn.bind(logger);
  const origInfo  = logger.info.bind(logger);
  const origError = logger.error.bind(logger);

  logger.fatal = (...args) => { fatalMessages.push(args.map(String).join(' ')); };
  logger.warn  = (...args) => { warnMessages.push(args.map(String).join(' ')); };
  logger.info  = () => {};   // suppress noise in test output
  logger.error = () => {};   // suppress noise in test output

  try {
    const { validateEnv } = require(VALIDATOR_PATH);
    validateEnv();
  } finally {
    // Restore originals unconditionally.
    process.exit = originalExit;
    logger.fatal = origFatal;
    logger.warn  = origWarn;
    logger.info  = origInfo;
    logger.error = origError;
  }

  return { exitCode, fatalMessages, warnMessages };
}

// ===========================================================================
// 1. Production mode
// ===========================================================================

describe('validateEnv() — production mode (NODE_ENV=production)', () => {

  it('exits with code 1 when DATABASE_URL is missing', () => {
    const env = { NODE_ENV: 'production', ...PROD_REQUIRED };
    delete env.DATABASE_URL;

    const { exitCode, fatalMessages } = runValidator(env);

    assert.equal(exitCode, 1, 'process.exit(1) must be called');
    const combined = fatalMessages.join('\n');
    assert.ok(
      combined.includes('DATABASE_URL'),
      `fatal messages must mention DATABASE_URL — got: ${combined}`
    );
  });

  it('exits with code 1 when HMAC_SECRET is missing', () => {
    const env = { NODE_ENV: 'production', ...PROD_REQUIRED };
    delete env.HMAC_SECRET;

    const { exitCode, fatalMessages } = runValidator(env);

    assert.equal(exitCode, 1);
    assert.ok(fatalMessages.join('\n').includes('HMAC_SECRET'));
  });

  it('exits with code 1 when SESSION_SECRET is missing', () => {
    const env = { NODE_ENV: 'production', ...PROD_REQUIRED };
    delete env.SESSION_SECRET;

    const { exitCode, fatalMessages } = runValidator(env);

    assert.equal(exitCode, 1);
    assert.ok(fatalMessages.join('\n').includes('SESSION_SECRET'));
  });

  it('exits with code 1 when DATABASE_URL is set to whitespace only', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      DATABASE_URL: '   ',
    });
    assert.equal(exitCode, 1);
  });

  it('exits with code 1 when HMAC_SECRET is set to whitespace only', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      HMAC_SECRET: '   ',
    });
    assert.equal(exitCode, 1);
  });

  it('exits with code 1 when SESSION_SECRET is set to whitespace only', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      SESSION_SECRET: '  ',
    });
    assert.equal(exitCode, 1);
  });

  it('exits with code 1 when ED25519_REQUIRED=1 but ED25519_PRIVATE_KEY_PEM is missing', () => {
    const { exitCode, fatalMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      ED25519_REQUIRED: '1',
      // ED25519_PRIVATE_KEY_PEM deliberately absent
    });

    assert.equal(exitCode, 1);
    assert.ok(fatalMessages.join('\n').includes('ED25519_PRIVATE_KEY_PEM'));
  });

  it('exits with code 1 when ED25519_REQUIRED=1 and ED25519_PRIVATE_KEY_PEM is whitespace only', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      ED25519_REQUIRED: '1',
      ED25519_PRIVATE_KEY_PEM: '   ',
    });
    assert.equal(exitCode, 1);
  });

  it('does NOT exit when all required vars are present and ED25519_REQUIRED is unset', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
    });
    assert.equal(exitCode, null, 'process.exit must not be called when config is valid');
  });

  it('does NOT exit when all required vars are present and ED25519_REQUIRED=1 with key configured', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      ED25519_REQUIRED: '1',
      ED25519_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nfakekey\n-----END PRIVATE KEY-----\n',
    });
    // env-validator checks presence only, not PEM validity — so no exit
    assert.equal(exitCode, null);
  });

  it('warns (does not exit) when SMTP credentials are missing', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      // SMTP_* deliberately absent
    });

    assert.equal(exitCode, null, 'SMTP absence must not be fatal');
    const combined = warnMessages.join('\n');
    assert.ok(
      combined.includes('SMTP'),
      `warn messages must mention SMTP — got: ${combined}`
    );
  });

  it('warns (does not exit) when SMTP_PASS is whitespace only', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      SMTP_HOST: 'smtp.resend.com',
      SMTP_USER: 'resend',
      SMTP_PASS: '   ',
    });
    assert.equal(exitCode, null);
    assert.ok(warnMessages.join('\n').includes('SMTP'));
  });

  it('does NOT warn when all SMTP vars are set', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      SMTP_HOST: 'smtp.resend.com',
      SMTP_USER: 'resend',
      SMTP_PASS: 're_example_key',
    });
    assert.equal(exitCode, null);
    assert.ok(!warnMessages.join('\n').includes('SMTP'), 'SMTP warning should not fire when configured');
  });

  it('exits with code 1 when GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing', () => {
    const { exitCode, fatalMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      GOOGLE_CLIENT_ID: 'some-client-id',
      // GOOGLE_CLIENT_SECRET deliberately absent
    });

    assert.equal(exitCode, 1);
    assert.ok(fatalMessages.join('\n').includes('GOOGLE_CLIENT_SECRET'));
  });

  it('exits with code 1 when GOOGLE_CLIENT_SECRET is set but GOOGLE_CLIENT_ID is missing', () => {
    const { exitCode, fatalMessages } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      GOOGLE_CLIENT_SECRET: 'some-client-secret',
      // GOOGLE_CLIENT_ID deliberately absent
    });

    assert.equal(exitCode, 1);
    assert.ok(fatalMessages.join('\n').includes('GOOGLE_CLIENT_ID'));
  });

  it('does NOT exit when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      GOOGLE_CLIENT_ID:     'some-client-id',
      GOOGLE_CLIENT_SECRET: 'some-client-secret',
    });
    assert.equal(exitCode, null);
  });

  it('does NOT exit when neither GOOGLE_CLIENT_ID nor GOOGLE_CLIENT_SECRET is set', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'production',
      ...PROD_REQUIRED,
      // Both Google vars absent — that is fine; OAuth is optional
    });
    assert.equal(exitCode, null);
  });

  it('treats RENDER env var as production even when NODE_ENV is absent', () => {
    const env = { ...PROD_REQUIRED, RENDER: '1' };
    delete env.DATABASE_URL;

    const { exitCode } = runValidator(env);
    assert.equal(exitCode, 1, 'RENDER flag must trigger production mode');
  });
});

// ===========================================================================
// 2. Development mode
// ===========================================================================

describe('validateEnv() — development mode (NODE_ENV=development or unset)', () => {

  it('does NOT exit when DATABASE_URL is missing in development', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'development',
      // DATABASE_URL absent
    });
    assert.equal(exitCode, null);
  });

  it('does NOT exit when HMAC_SECRET is missing in development', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'development',
    });
    assert.equal(exitCode, null);
  });

  it('does NOT exit when SESSION_SECRET is missing in development', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'development',
    });
    assert.equal(exitCode, null);
  });

  it('does NOT exit when ED25519_REQUIRED=1 but key is missing in development', () => {
    const { exitCode } = runValidator({
      NODE_ENV: 'development',
      ED25519_REQUIRED: '1',
      // ED25519_PRIVATE_KEY_PEM absent
    });
    assert.equal(exitCode, null);
  });

  it('emits a warning (not a fatal) for missing required vars in development', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'development',
      // All required vars absent
    });

    assert.equal(exitCode, null);
    // At minimum DATABASE_URL, HMAC_SECRET, and SESSION_SECRET must be warned about
    const combined = warnMessages.join('\n');
    assert.ok(combined.includes('DATABASE_URL'),   `missing DATABASE_URL warn — got: ${combined}`);
    assert.ok(combined.includes('HMAC_SECRET'),    `missing HMAC_SECRET warn — got: ${combined}`);
    assert.ok(combined.includes('SESSION_SECRET'), `missing SESSION_SECRET warn — got: ${combined}`);
  });

  it('does NOT exit when NODE_ENV is not set at all', () => {
    const { exitCode } = runValidator({
      // NODE_ENV deliberately absent; all other vars absent too
    });
    assert.equal(exitCode, null);
  });

  it('emits a warning about SMTP in development too', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'development',
    });
    assert.equal(exitCode, null);
    assert.ok(
      warnMessages.join('\n').includes('SMTP'),
      'SMTP warning must appear in development'
    );
  });

  it('issues a warning (not a fatal) for incomplete Google OAuth config in development', () => {
    const { exitCode, warnMessages } = runValidator({
      NODE_ENV: 'development',
      ...PROD_REQUIRED,
      GOOGLE_CLIENT_ID: 'only-id-no-secret',
      // GOOGLE_CLIENT_SECRET absent
    });

    assert.equal(exitCode, null, 'Google OAuth mismatch must not be fatal in development');
    assert.ok(
      warnMessages.join('\n').includes('GOOGLE_CLIENT_SECRET'),
      'Missing GOOGLE_CLIENT_SECRET must appear in dev warnings'
    );
  });
});
