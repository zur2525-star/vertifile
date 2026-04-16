#!/usr/bin/env node
'use strict';

/**
 * Unit tests for middleware/request-logger.js
 *
 * Run with: node --test tests/middleware-request-logger.test.js
 *
 * Covers:
 *
 * sanitizeForLogging:
 *   - Primitive / falsy values pass through unchanged
 *   - Non-sensitive fields pass through unchanged
 *   - Exact SENSITIVE_FIELDS list: password, password_hash, token, secret,
 *     authorization — each replaced with '[REDACTED]'
 *   - Key comparison is case-insensitive (PASSWORD, Token, AUTHORIZATION, etc.)
 *   - Fields NOT in the list (cookie, apiKey, creditCard, etc.) are NOT scrubbed
 *   - Original object is not mutated
 *   - Output shape is a shallow copy
 *
 * requestLogger middleware:
 *   - Calls next() synchronously
 *   - Registers a 'finish' listener on res
 *   - Skips logging for /api/health, /api/health/deep, /favicon.ico
 *   - Does NOT skip for other paths
 *   - Sets req._sanitizedBody only when req.body contains a password field
 *   - Does NOT set req._sanitizedBody when body has no password field
 *   - On finish, logs via logger.info for 2xx responses
 *   - On finish, logs via logger.warn for 4xx responses
 *   - Log data includes method, path, status, ms, ip fields
 *   - IP extracted from x-forwarded-for header (first address)
 *   - IP falls back to socket.remoteAddress when header is absent
 *   - IP falls back to 'unknown' when both are absent
 *
 * Uses node:test + node:assert/strict. No server startup required.
 * sanitizeForLogging is exported as part of the module's public API.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Logger mock — installed before loading the middleware.
// We capture calls so we can assert which method (info vs warn) was used and
// what data was passed.
// ---------------------------------------------------------------------------

const LOGGER_PATH = require.resolve('../services/logger');

// Mutable capture state — reset via resetCapture() before each relevant test.
let capturedCalls = [];

function resetCapture() {
  capturedCalls = [];
}

const mockLogger = {
  info(...args)  { capturedCalls.push({ level: 'info',  args }); },
  warn(...args)  { capturedCalls.push({ level: 'warn',  args }); },
  error(...args) { capturedCalls.push({ level: 'error', args }); },
  debug(...args) { capturedCalls.push({ level: 'debug', args }); },
};

before(() => {
  require.cache[LOGGER_PATH] = {
    id: LOGGER_PATH,
    filename: LOGGER_PATH,
    loaded: true,
    exports: mockLogger,
  };
});

after(() => {
  delete require.cache[LOGGER_PATH];
  delete require.cache[require.resolve('../middleware/request-logger')];
});

// Load after the mock is installed.
const { requestLogger, sanitizeForLogging } = require('../middleware/request-logger');

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/documents',
    body: null,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
}

/**
 * Minimal res mock with a .on() / .emit() EventEmitter interface and
 * a configurable statusCode.
 */
function mockRes(overrides = {}) {
  const listeners = {};

  const res = {
    statusCode: 200,

    on(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },

    emit(event) {
      (listeners[event] || []).forEach(fn => fn());
    },

    ...overrides,
  };

  return res;
}

// ---------------------------------------------------------------------------
// 1. sanitizeForLogging — primitive / falsy values
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — non-object inputs', () => {

  it('returns null as-is', () => {
    assert.equal(sanitizeForLogging(null), null);
  });

  it('returns undefined as-is', () => {
    assert.equal(sanitizeForLogging(undefined), undefined);
  });

  it('returns a string as-is', () => {
    assert.equal(sanitizeForLogging('hello'), 'hello');
  });

  it('returns a number as-is', () => {
    assert.equal(sanitizeForLogging(42), 42);
  });

  it('returns false as-is', () => {
    assert.equal(sanitizeForLogging(false), false);
  });

  it('returns 0 as-is', () => {
    assert.equal(sanitizeForLogging(0), 0);
  });

});

// ---------------------------------------------------------------------------
// 2. sanitizeForLogging — non-sensitive fields pass through unchanged
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — non-sensitive fields are preserved', () => {

  it('email field is preserved', () => {
    const result = sanitizeForLogging({ email: 'user@vertifile.com' });
    assert.equal(result.email, 'user@vertifile.com');
  });

  it('name field is preserved', () => {
    const result = sanitizeForLogging({ name: 'Zur Halfon' });
    assert.equal(result.name, 'Zur Halfon');
  });

  it('id field is preserved', () => {
    const result = sanitizeForLogging({ id: 99 });
    assert.equal(result.id, 99);
  });

  it('plan field is preserved', () => {
    const result = sanitizeForLogging({ plan: 'pro' });
    assert.equal(result.plan, 'pro');
  });

  it('status field is preserved', () => {
    const result = sanitizeForLogging({ status: 'active' });
    assert.equal(result.status, 'active');
  });

  it('multiple non-sensitive fields all pass through', () => {
    const input = { id: 1, email: 'a@b.com', plan: 'trial', status: 'ok' };
    const result = sanitizeForLogging(input);
    assert.deepEqual(result, input);
  });

});

// ---------------------------------------------------------------------------
// 3. sanitizeForLogging — exact SENSITIVE_FIELDS list
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — "password" is redacted', () => {

  it('replaces password value with "[REDACTED]"', () => {
    const result = sanitizeForLogging({ password: 's3cr3t' });
    assert.equal(result.password, '[REDACTED]');
  });

  it('password field key is still present after redaction', () => {
    const result = sanitizeForLogging({ password: 's3cr3t' });
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'password'));
  });

});

describe('sanitizeForLogging — "password_hash" is redacted', () => {

  it('replaces password_hash value with "[REDACTED]"', () => {
    const result = sanitizeForLogging({ password_hash: '$2b$10$abc' });
    assert.equal(result.password_hash, '[REDACTED]');
  });

});

describe('sanitizeForLogging — "token" is redacted', () => {

  it('replaces token value with "[REDACTED]"', () => {
    const result = sanitizeForLogging({ token: 'eyJhbGciOiJIUzI1NiJ9' });
    assert.equal(result.token, '[REDACTED]');
  });

});

describe('sanitizeForLogging — "secret" is redacted', () => {

  it('replaces secret value with "[REDACTED]"', () => {
    const result = sanitizeForLogging({ secret: 'super-secret-value' });
    assert.equal(result.secret, '[REDACTED]');
  });

});

describe('sanitizeForLogging — "authorization" is redacted', () => {

  it('replaces authorization value with "[REDACTED]"', () => {
    const result = sanitizeForLogging({ authorization: 'Bearer abc123' });
    assert.equal(result.authorization, '[REDACTED]');
  });

});

// ---------------------------------------------------------------------------
// 4. sanitizeForLogging — case-insensitive key matching
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — key matching is case-insensitive', () => {

  it('PASSWORD (uppercase) is redacted', () => {
    const result = sanitizeForLogging({ PASSWORD: 'secret' });
    assert.equal(result.PASSWORD, '[REDACTED]');
  });

  it('Token (mixed case) is redacted', () => {
    const result = sanitizeForLogging({ Token: 'abc' });
    assert.equal(result.Token, '[REDACTED]');
  });

  it('AUTHORIZATION (uppercase) is redacted', () => {
    const result = sanitizeForLogging({ AUTHORIZATION: 'Bearer xyz' });
    assert.equal(result.AUTHORIZATION, '[REDACTED]');
  });

  it('Secret (title case) is redacted', () => {
    const result = sanitizeForLogging({ Secret: 'val' });
    assert.equal(result.Secret, '[REDACTED]');
  });

  it('Password_Hash (mixed case) is redacted', () => {
    const result = sanitizeForLogging({ Password_Hash: '$2b$hash' });
    assert.equal(result.Password_Hash, '[REDACTED]');
  });

});

// ---------------------------------------------------------------------------
// 5. sanitizeForLogging — fields NOT in the sensitive list are NOT scrubbed
//    (testing what the code actually does, not aspirational behavior)
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — fields outside SENSITIVE_FIELDS are preserved', () => {

  it('cookie field is NOT redacted (not in SENSITIVE_FIELDS list)', () => {
    const result = sanitizeForLogging({ cookie: 'session=abc' });
    assert.equal(result.cookie, 'session=abc');
  });

  it('apiKey field is NOT redacted', () => {
    const result = sanitizeForLogging({ apiKey: 'key-123' });
    assert.equal(result.apiKey, 'key-123');
  });

  it('api_key field is NOT redacted', () => {
    const result = sanitizeForLogging({ api_key: 'key-456' });
    assert.equal(result.api_key, 'key-456');
  });

  it('creditCard field is NOT redacted', () => {
    const result = sanitizeForLogging({ creditCard: '4111111111111111' });
    assert.equal(result.creditCard, '4111111111111111');
  });

  it('credit_card field is NOT redacted', () => {
    const result = sanitizeForLogging({ credit_card: '4111111111111111' });
    assert.equal(result.credit_card, '4111111111111111');
  });

});

// ---------------------------------------------------------------------------
// 6. sanitizeForLogging — original object is not mutated
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — does not mutate the original object', () => {

  it('original password value is unchanged after sanitize', () => {
    const original = { password: 's3cr3t', email: 'a@b.com' };
    sanitizeForLogging(original);
    assert.equal(original.password, 's3cr3t');
  });

  it('original token value is unchanged after sanitize', () => {
    const original = { token: 'tok123' };
    sanitizeForLogging(original);
    assert.equal(original.token, 'tok123');
  });

  it('returns a different object reference than the input', () => {
    const original = { password: 'abc' };
    const result = sanitizeForLogging(original);
    assert.notEqual(result, original);
  });

});

// ---------------------------------------------------------------------------
// 7. sanitizeForLogging — mixed sensitive and non-sensitive fields
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — mixed field objects', () => {

  it('redacts only sensitive fields and preserves the rest', () => {
    const input = {
      email: 'test@vertifile.com',
      password: 'hunter2',
      token: 'jwt.token.here',
      name: 'Test User',
      plan: 'active',
    };
    const result = sanitizeForLogging(input);

    assert.equal(result.email, 'test@vertifile.com');
    assert.equal(result.password, '[REDACTED]');
    assert.equal(result.token, '[REDACTED]');
    assert.equal(result.name, 'Test User');
    assert.equal(result.plan, 'active');
  });

  it('all five sensitive fields are redacted simultaneously', () => {
    const input = {
      password: 'pw',
      password_hash: 'hash',
      token: 'tok',
      secret: 'sec',
      authorization: 'Bearer x',
      email: 'keep@me.com',
    };
    const result = sanitizeForLogging(input);

    assert.equal(result.password, '[REDACTED]');
    assert.equal(result.password_hash, '[REDACTED]');
    assert.equal(result.token, '[REDACTED]');
    assert.equal(result.secret, '[REDACTED]');
    assert.equal(result.authorization, '[REDACTED]');
    assert.equal(result.email, 'keep@me.com');
  });

});

// ---------------------------------------------------------------------------
// 8. sanitizeForLogging — shallow (no recursion / no array support)
//    The implementation does NOT recurse. Nested values are copied as-is.
// ---------------------------------------------------------------------------

describe('sanitizeForLogging — shallow copy only (no recursion)', () => {

  it('nested object under a non-sensitive key is NOT recursed into', () => {
    const nested = { password: 'inner-secret' };
    const input  = { user: nested };
    const result = sanitizeForLogging(input);

    // The nested password is untouched because sanitizeForLogging is shallow.
    assert.deepEqual(result.user, nested);
    assert.equal(result.user.password, 'inner-secret');
  });

  it('array field is copied as-is (arrays not iterated)', () => {
    const arr   = [{ password: 'pw1' }, { password: 'pw2' }];
    const input = { items: arr };
    const result = sanitizeForLogging(input);

    assert.deepEqual(result.items, arr);
  });

});

// ---------------------------------------------------------------------------
// 9. requestLogger — middleware behavior
// ---------------------------------------------------------------------------

describe('requestLogger — next() is called synchronously', () => {

  it('calls next() on the same tick', () => {
    const mw = requestLogger();
    const req = mockReq();
    const res = mockRes();
    let called = false;

    mw(req, res, () => { called = true; });

    assert.equal(called, true);
  });

});

describe('requestLogger — registers finish listener on res', () => {

  it('attaches a "finish" listener to res', () => {
    const mw = requestLogger();
    const req = mockReq();
    let finishRegistered = false;

    const res = mockRes();
    const originalOn = res.on.bind(res);
    res.on = (event, handler) => {
      if (event === 'finish') finishRegistered = true;
      originalOn(event, handler);
    };

    mw(req, res, () => {});

    assert.equal(finishRegistered, true);
  });

});

// ---------------------------------------------------------------------------
// 10. requestLogger — req._sanitizedBody
// ---------------------------------------------------------------------------

describe('requestLogger — req._sanitizedBody', () => {

  it('sets req._sanitizedBody when req.body contains a password field', () => {
    const mw = requestLogger();
    const req = mockReq({ body: { password: 'secret', email: 'a@b.com' } });
    const res = mockRes();

    mw(req, res, () => {});

    assert.ok(req._sanitizedBody, '_sanitizedBody should be set');
    assert.equal(req._sanitizedBody.password, '[REDACTED]');
    assert.equal(req._sanitizedBody.email, 'a@b.com');
  });

  it('does NOT set req._sanitizedBody when body has no password field', () => {
    const mw = requestLogger();
    const req = mockReq({ body: { email: 'a@b.com', name: 'Test' } });
    const res = mockRes();

    mw(req, res, () => {});

    assert.equal(req._sanitizedBody, undefined);
  });

  it('does NOT set req._sanitizedBody when body is null', () => {
    const mw = requestLogger();
    const req = mockReq({ body: null });
    const res = mockRes();

    mw(req, res, () => {});

    assert.equal(req._sanitizedBody, undefined);
  });

  it('does NOT mutate req.body.password — original body is untouched', () => {
    const mw = requestLogger();
    const req = mockReq({ body: { password: 'mypass' } });
    const res = mockRes();

    mw(req, res, () => {});

    assert.equal(req.body.password, 'mypass');
  });

});

// ---------------------------------------------------------------------------
// 11. requestLogger — skip list (no log emitted for health / favicon paths)
// ---------------------------------------------------------------------------

describe('requestLogger — skips logging for specific paths', () => {

  it('does not log when path is /api/health', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/health' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls.length, 0, 'no log should be emitted for /api/health');
  });

  it('does not log when path is /api/health/deep', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/health/deep' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls.length, 0, 'no log should be emitted for /api/health/deep');
  });

  it('does not log when path is /favicon.ico', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/favicon.ico' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls.length, 0, 'no log should be emitted for /favicon.ico');
  });

  it('does log for a regular path like /api/documents', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/documents' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls.length, 1, 'a log should be emitted for /api/documents');
  });

});

// ---------------------------------------------------------------------------
// 12. requestLogger — log level selection based on status code
// ---------------------------------------------------------------------------

describe('requestLogger — uses logger.info for 2xx responses', () => {

  it('calls logger.info for HTTP 200', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/documents' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'info');
  });

  it('calls logger.info for HTTP 201', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/upload', method: 'POST' });
    const res = mockRes({ statusCode: 201 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'info');
  });

  it('calls logger.info for HTTP 301 (below 400)', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/redirect' });
    const res = mockRes({ statusCode: 301 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'info');
  });

});

describe('requestLogger — uses logger.warn for 4xx responses', () => {

  it('calls logger.warn for HTTP 400', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/documents' });
    const res = mockRes({ statusCode: 400 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'warn');
  });

  it('calls logger.warn for HTTP 401', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/documents' });
    const res = mockRes({ statusCode: 401 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'warn');
  });

  it('calls logger.warn for HTTP 403', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/documents' });
    const res = mockRes({ statusCode: 403 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'warn');
  });

  it('calls logger.warn for HTTP 404', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/missing' });
    const res = mockRes({ statusCode: 404 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'warn');
  });

  it('calls logger.warn for HTTP 500', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/crash' });
    const res = mockRes({ statusCode: 500 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.level, 'warn');
  });

});

// ---------------------------------------------------------------------------
// 13. requestLogger — log data shape
// ---------------------------------------------------------------------------

describe('requestLogger — log data object shape', () => {

  it('log data includes method, path, status, ms, ip', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ method: 'POST', path: '/api/upload' });
    const res = mockRes({ statusCode: 201 });

    mw(req, res, () => {});
    res.emit('finish');

    const logData = capturedCalls[0]?.args[0];
    assert.ok(Object.prototype.hasOwnProperty.call(logData, 'method'));
    assert.ok(Object.prototype.hasOwnProperty.call(logData, 'path'));
    assert.ok(Object.prototype.hasOwnProperty.call(logData, 'status'));
    assert.ok(Object.prototype.hasOwnProperty.call(logData, 'ms'));
    assert.ok(Object.prototype.hasOwnProperty.call(logData, 'ip'));
  });

  it('method matches req.method', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ method: 'DELETE', path: '/api/doc/1' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.method, 'DELETE');
  });

  it('path matches req.path', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/verify' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.path, '/api/verify');
  });

  it('status matches res.statusCode', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/verify' });
    const res = mockRes({ statusCode: 204 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.status, 204);
  });

  it('ms is a non-negative number', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({ path: '/api/verify' });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    const ms = capturedCalls[0]?.args[0]?.ms;
    assert.ok(typeof ms === 'number');
    assert.ok(ms >= 0);
  });

});

// ---------------------------------------------------------------------------
// 14. requestLogger — IP extraction
// ---------------------------------------------------------------------------

describe('requestLogger — IP address extraction', () => {

  it('uses the first address from x-forwarded-for when header is present', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({
      path: '/api/verify',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.ip, '203.0.113.5');
  });

  it('trims whitespace from the x-forwarded-for first address', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({
      path: '/api/verify',
      headers: { 'x-forwarded-for': '  198.51.100.10  , 172.16.0.1' },
    });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.ip, '198.51.100.10');
  });

  it('falls back to socket.remoteAddress when x-forwarded-for is absent', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({
      path: '/api/verify',
      headers: {},
      socket: { remoteAddress: '192.0.2.1' },
    });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.ip, '192.0.2.1');
  });

  it('falls back to "unknown" when both x-forwarded-for and socket are absent', () => {
    resetCapture();
    const mw = requestLogger();
    const req = mockReq({
      path: '/api/verify',
      headers: {},
      socket: null,
    });
    const res = mockRes({ statusCode: 200 });

    mw(req, res, () => {});
    res.emit('finish');

    assert.equal(capturedCalls[0]?.args[0]?.ip, 'unknown');
  });

});
