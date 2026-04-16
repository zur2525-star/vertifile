#!/usr/bin/env node
'use strict';

/**
 * Unit tests for middleware/error-handler.js and middleware/error-alerter.js
 *
 * Run with: node --test tests/error-handler.test.js
 *
 * Covers:
 *   - Custom error classes: ValidationError, AuthenticationError,
 *     NotFoundError, RateLimitError
 *   - errorHandler middleware: status codes, JSON shape, special cases
 *   - error-alerter: trackError, getRecentErrors, getErrorStats, ring buffer
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Module imports
// ---------------------------------------------------------------------------

const {
  errorHandler,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError
} = require('../middleware/error-handler');

const {
  trackError,
  getRecentErrors,
  getErrorStats,
  _test: alerterTest
} = require('../middleware/error-alerter');

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express-like req mock.
 * path and method default to the most common test values.
 */
function mockReq(overrides = {}) {
  return {
    path: '/test',
    method: 'GET',
    ...overrides
  };
}

/**
 * Build a mock res object that captures status and JSON output.
 * Mirrors the chaining pattern Express uses: res.status(n).json(body).
 *
 * After calling errorHandler the captured values are available as:
 *   res._status   — the numeric HTTP status code
 *   res._body     — the parsed JSON body
 *   res._headers  — map of headers set via setHeader()
 */
function mockRes() {
  const res = {
    _status: null,
    _body: null,
    _headers: {},

    setHeader(name, value) {
      this._headers[name] = value;
    },

    status(code) {
      this._status = code;
      return {
        json: (body) => {
          res._body = body;
        }
      };
    }
  };
  return res;
}

/**
 * Invoke errorHandler and return the captured res mock so assertions are
 * easy: const res = callHandler(err, req);
 */
function callHandler(err, reqOverrides = {}) {
  const req = mockReq(reqOverrides);
  const res = mockRes();
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  errorHandler(err, req, res, next);

  res._nextCalled = nextCalled;
  return res;
}

// ---------------------------------------------------------------------------
// Reset alerter state between every test so tests are isolated
// ---------------------------------------------------------------------------
beforeEach(() => {
  alerterTest.reset();
});

// ===========================================================================
// 1. Custom error classes
// ===========================================================================

describe('ValidationError', () => {
  it('is an instance of Error', () => {
    const err = new ValidationError('bad input');
    assert.ok(err instanceof Error);
  });

  it('has name "ValidationError"', () => {
    const err = new ValidationError('bad input');
    assert.equal(err.name, 'ValidationError');
  });

  it('stores the provided message', () => {
    const err = new ValidationError('field is required');
    assert.equal(err.message, 'field is required');
  });

  it('has statusCode 400', () => {
    const err = new ValidationError('x');
    assert.equal(err.statusCode, 400);
  });

  it('has code "VALIDATION_ERROR"', () => {
    const err = new ValidationError('x');
    assert.equal(err.code, 'VALIDATION_ERROR');
  });

  it('stores optional details when provided', () => {
    const details = [{ field: 'email', msg: 'invalid' }];
    const err = new ValidationError('invalid', details);
    assert.deepEqual(err.details, details);
  });

  it('details is null when not provided', () => {
    const err = new ValidationError('x');
    assert.equal(err.details, null);
  });
});

describe('AuthenticationError', () => {
  it('is an instance of Error', () => {
    const err = new AuthenticationError();
    assert.ok(err instanceof Error);
  });

  it('has name "AuthenticationError"', () => {
    const err = new AuthenticationError();
    assert.equal(err.name, 'AuthenticationError');
  });

  it('defaults message to "Authentication required"', () => {
    const err = new AuthenticationError();
    assert.equal(err.message, 'Authentication required');
  });

  it('accepts a custom message', () => {
    const err = new AuthenticationError('Session expired');
    assert.equal(err.message, 'Session expired');
  });

  it('has statusCode 401', () => {
    const err = new AuthenticationError();
    assert.equal(err.statusCode, 401);
  });

  it('has code "AUTHENTICATION_ERROR"', () => {
    const err = new AuthenticationError();
    assert.equal(err.code, 'AUTHENTICATION_ERROR');
  });
});

describe('NotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new NotFoundError();
    assert.ok(err instanceof Error);
  });

  it('has name "NotFoundError"', () => {
    const err = new NotFoundError();
    assert.equal(err.name, 'NotFoundError');
  });

  it('defaults message to "Resource not found"', () => {
    const err = new NotFoundError();
    assert.equal(err.message, 'Resource not found');
  });

  it('accepts a custom message', () => {
    const err = new NotFoundError('Document not found');
    assert.equal(err.message, 'Document not found');
  });

  it('has statusCode 404', () => {
    const err = new NotFoundError();
    assert.equal(err.statusCode, 404);
  });

  it('has code "NOT_FOUND"', () => {
    const err = new NotFoundError();
    assert.equal(err.code, 'NOT_FOUND');
  });
});

describe('RateLimitError', () => {
  it('is an instance of Error', () => {
    const err = new RateLimitError();
    assert.ok(err instanceof Error);
  });

  it('has name "RateLimitError"', () => {
    const err = new RateLimitError();
    assert.equal(err.name, 'RateLimitError');
  });

  it('defaults message to "Too many requests"', () => {
    const err = new RateLimitError();
    assert.equal(err.message, 'Too many requests');
  });

  it('accepts a custom message', () => {
    const err = new RateLimitError('Slow down');
    assert.equal(err.message, 'Slow down');
  });

  it('has statusCode 429', () => {
    const err = new RateLimitError();
    assert.equal(err.statusCode, 429);
  });

  it('has code "RATE_LIMIT_EXCEEDED"', () => {
    const err = new RateLimitError();
    assert.equal(err.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('stores retryAfterSeconds when provided', () => {
    const err = new RateLimitError('Slow down', 60);
    assert.equal(err.retryAfter, 60);
  });

  it('retryAfter is null when not provided', () => {
    const err = new RateLimitError();
    assert.equal(err.retryAfter, null);
  });
});

// ===========================================================================
// 2. errorHandler middleware
// ===========================================================================

describe('errorHandler — ValidationError', () => {
  it('responds with HTTP 400', () => {
    const res = callHandler(new ValidationError('name is required'));
    assert.equal(res._status, 400);
  });

  it('sets success:false in the body', () => {
    const res = callHandler(new ValidationError('name is required'));
    assert.equal(res._body.success, false);
  });

  it('body includes the error message', () => {
    const res = callHandler(new ValidationError('name is required'));
    assert.equal(res._body.error, 'name is required');
  });

  it('body includes the correct code', () => {
    const res = callHandler(new ValidationError('x'));
    assert.equal(res._body.code, 'VALIDATION_ERROR');
  });

  it('body includes details when present on the error', () => {
    const details = [{ field: 'email', msg: 'invalid format' }];
    const res = callHandler(new ValidationError('validation failed', details));
    assert.deepEqual(res._body.details, details);
  });

  it('body does not include details when not present', () => {
    const res = callHandler(new ValidationError('x'));
    assert.equal(Object.prototype.hasOwnProperty.call(res._body, 'details'), false);
  });

  it('sets Cache-Control: no-store', () => {
    const res = callHandler(new ValidationError('x'));
    assert.equal(res._headers['Cache-Control'], 'no-store');
  });
});

describe('errorHandler — AuthenticationError', () => {
  it('responds with HTTP 401', () => {
    const res = callHandler(new AuthenticationError());
    assert.equal(res._status, 401);
  });

  it('sets success:false in the body', () => {
    const res = callHandler(new AuthenticationError());
    assert.equal(res._body.success, false);
  });

  it('body includes the error message', () => {
    const res = callHandler(new AuthenticationError('Session expired'));
    assert.equal(res._body.error, 'Session expired');
  });

  it('body includes code AUTHENTICATION_ERROR', () => {
    const res = callHandler(new AuthenticationError());
    assert.equal(res._body.code, 'AUTHENTICATION_ERROR');
  });
});

describe('errorHandler — NotFoundError', () => {
  it('responds with HTTP 404', () => {
    const res = callHandler(new NotFoundError());
    assert.equal(res._status, 404);
  });

  it('sets success:false in the body', () => {
    const res = callHandler(new NotFoundError());
    assert.equal(res._body.success, false);
  });

  it('body includes the error message', () => {
    const res = callHandler(new NotFoundError('Document not found'));
    assert.equal(res._body.error, 'Document not found');
  });

  it('body includes code NOT_FOUND', () => {
    const res = callHandler(new NotFoundError());
    assert.equal(res._body.code, 'NOT_FOUND');
  });
});

describe('errorHandler — RateLimitError', () => {
  it('responds with HTTP 429', () => {
    const res = callHandler(new RateLimitError());
    assert.equal(res._status, 429);
  });

  it('sets success:false in the body', () => {
    const res = callHandler(new RateLimitError());
    assert.equal(res._body.success, false);
  });

  it('body includes the error message', () => {
    const res = callHandler(new RateLimitError('Too many requests'));
    assert.equal(res._body.error, 'Too many requests');
  });

  it('body includes code RATE_LIMIT_EXCEEDED', () => {
    const res = callHandler(new RateLimitError());
    assert.equal(res._body.code, 'RATE_LIMIT_EXCEEDED');
  });

  it('sets Retry-After header when retryAfter is given', () => {
    const res = callHandler(new RateLimitError('slow down', 30));
    assert.equal(res._headers['Retry-After'], '30');
  });

  it('body includes retryAfter when given', () => {
    const res = callHandler(new RateLimitError('slow down', 30));
    assert.equal(res._body.retryAfter, 30);
  });

  it('does NOT set Retry-After header when retryAfter is absent', () => {
    const res = callHandler(new RateLimitError());
    assert.equal(Object.prototype.hasOwnProperty.call(res._headers, 'Retry-After'), false);
  });
});

describe('errorHandler — generic Error (500)', () => {
  // Force development mode so the real message leaks through (not production masking)
  let origEnv;
  beforeEach(() => {
    origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it('responds with HTTP 500', () => {
    const res = callHandler(new Error('something blew up'));
    assert.equal(res._status, 500);
  });

  it('sets success:false in the body', () => {
    const res = callHandler(new Error('something blew up'));
    assert.equal(res._body.success, false);
  });

  it('body has code INTERNAL_ERROR', () => {
    const res = callHandler(new Error('something blew up'));
    assert.equal(res._body.code, 'INTERNAL_ERROR');
  });

  it('does NOT expose raw internal message in production', () => {
    process.env.NODE_ENV = 'production';
    const res = callHandler(new Error('secret db credentials'));
    assert.equal(res._body.error, 'Internal server error');
  });

  it('does expose message in development', () => {
    process.env.NODE_ENV = 'development';
    const res = callHandler(new Error('something blew up'));
    assert.equal(res._body.error, 'something blew up');
  });

  it('includes stack in development', () => {
    process.env.NODE_ENV = 'development';
    const res = callHandler(new Error('boom'));
    assert.ok(typeof res._body.stack === 'string');
    assert.ok(res._body.stack.length > 0);
  });

  it('does NOT include stack in production', () => {
    process.env.NODE_ENV = 'production';
    const res = callHandler(new Error('boom'));
    assert.equal(Object.prototype.hasOwnProperty.call(res._body, 'stack'), false);
  });
});

describe('errorHandler — CORS error', () => {
  it('responds with HTTP 403 for CORS origin rejection', () => {
    const err = new Error('Not allowed by CORS');
    const res = callHandler(err);
    assert.equal(res._status, 403);
  });

  it('body has success:false', () => {
    const err = new Error('Not allowed by CORS');
    const res = callHandler(err);
    assert.equal(res._body.success, false);
  });

  it('body has code CORS_ERROR', () => {
    const err = new Error('Not allowed by CORS');
    const res = callHandler(err);
    assert.equal(res._body.code, 'CORS_ERROR');
  });

  it('body error message mentions CORS', () => {
    const err = new Error('Not allowed by CORS');
    const res = callHandler(err);
    assert.ok(res._body.error.includes('CORS'));
  });
});

describe('errorHandler — CSRF error (message)', () => {
  it('responds with HTTP 403 for invalid csrf token message', () => {
    const err = new Error('invalid csrf token');
    const res = callHandler(err);
    assert.equal(res._status, 403);
  });

  it('body has code CSRF_ERROR', () => {
    const err = new Error('invalid csrf token');
    const res = callHandler(err);
    assert.equal(res._body.code, 'CSRF_ERROR');
  });

  it('body has success:false', () => {
    const err = new Error('invalid csrf token');
    const res = callHandler(err);
    assert.equal(res._body.success, false);
  });
});

describe('errorHandler — CSRF error (code EBADCSRFTOKEN)', () => {
  it('responds with HTTP 403 for EBADCSRFTOKEN error code', () => {
    const err = new Error('forbidden');
    err.code = 'EBADCSRFTOKEN';
    const res = callHandler(err);
    assert.equal(res._status, 403);
  });

  it('body has code CSRF_ERROR', () => {
    const err = new Error('forbidden');
    err.code = 'EBADCSRFTOKEN';
    const res = callHandler(err);
    assert.equal(res._body.code, 'CSRF_ERROR');
  });
});

describe('errorHandler — response envelope shape', () => {
  it('every response includes success, error, and code keys', () => {
    const errors = [
      new ValidationError('v'),
      new AuthenticationError(),
      new NotFoundError(),
      new RateLimitError(),
      new Error('generic')
    ];
    for (const err of errors) {
      const res = callHandler(err);
      assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'success'), `missing success for ${err.name}`);
      assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'error'), `missing error for ${err.name}`);
      assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'code'), `missing code for ${err.name}`);
    }
  });

  it('success is always false', () => {
    const errors = [
      new ValidationError('v'),
      new AuthenticationError(),
      new NotFoundError(),
      new RateLimitError(),
      new Error('generic')
    ];
    for (const err of errors) {
      const res = callHandler(err);
      assert.equal(res._body.success, false, `success should be false for ${err.name}`);
    }
  });

  it('Cache-Control: no-store is always set', () => {
    const errors = [
      new ValidationError('v'),
      new AuthenticationError(),
      new NotFoundError(),
      new RateLimitError(),
      new Error('generic')
    ];
    for (const err of errors) {
      const res = callHandler(err);
      assert.equal(res._headers['Cache-Control'], 'no-store', `no-store missing for ${err.name}`);
    }
  });
});

// ===========================================================================
// 3. error-alerter module
// ===========================================================================

describe('trackError — records errors', () => {
  it('adds one entry after a single trackError call', () => {
    trackError(new Error('oops'), mockReq());
    const errors = getRecentErrors();
    assert.equal(errors.length, 1);
  });

  it('entry has correct path from req', () => {
    trackError(new Error('oops'), mockReq({ path: '/api/verify' }));
    const [entry] = getRecentErrors();
    assert.equal(entry.path, '/api/verify');
  });

  it('entry has correct method from req', () => {
    trackError(new Error('oops'), mockReq({ method: 'POST' }));
    const [entry] = getRecentErrors();
    assert.equal(entry.method, 'POST');
  });

  it('entry records the error message', () => {
    trackError(new Error('database connection failed'), mockReq());
    const [entry] = getRecentErrors();
    assert.equal(entry.error, 'database connection failed');
  });

  it('entry has a timestamp string', () => {
    trackError(new Error('x'), mockReq());
    const [entry] = getRecentErrors();
    assert.ok(typeof entry.timestamp === 'string');
    assert.ok(entry.timestamp.length > 0);
  });

  it('timestamp is a valid ISO date string', () => {
    trackError(new Error('x'), mockReq());
    const [entry] = getRecentErrors();
    const parsed = new Date(entry.timestamp);
    assert.ok(!isNaN(parsed.getTime()));
  });

  it('accumulates multiple entries', () => {
    trackError(new Error('first'), mockReq());
    trackError(new Error('second'), mockReq());
    trackError(new Error('third'), mockReq());
    assert.equal(getRecentErrors().length, 3);
  });

  it('uses "unknown" when req is null', () => {
    trackError(new Error('x'), null);
    const [entry] = getRecentErrors();
    assert.equal(entry.path, 'unknown');
    assert.equal(entry.method, 'unknown');
  });

  it('uses "unknown" when req is undefined', () => {
    trackError(new Error('x'), undefined);
    const [entry] = getRecentErrors();
    assert.equal(entry.path, 'unknown');
    assert.equal(entry.method, 'unknown');
  });
});

describe('getRecentErrors — ordering', () => {
  it('most recent error is first (prepend order)', () => {
    trackError(new Error('first'), mockReq());
    trackError(new Error('second'), mockReq());
    const errors = getRecentErrors();
    // unshift() means the newest entry sits at index 0
    assert.equal(errors[0].error, 'second');
    assert.equal(errors[1].error, 'first');
  });

  it('returns all entries when count is within limit', () => {
    trackError(new Error('a'), mockReq());
    trackError(new Error('b'), mockReq());
    trackError(new Error('c'), mockReq());
    const errors = getRecentErrors(10);
    assert.equal(errors.length, 3);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      trackError(new Error(`err${i}`), mockReq());
    }
    const errors = getRecentErrors(3);
    assert.equal(errors.length, 3);
  });

  it('default limit is 20', () => {
    for (let i = 0; i < 25; i++) {
      trackError(new Error(`err${i}`), mockReq());
    }
    const errors = getRecentErrors();
    assert.equal(errors.length, 20);
  });

  it('returns an empty array when no errors have been tracked', () => {
    const errors = getRecentErrors();
    assert.deepEqual(errors, []);
  });
});

describe('getErrorStats — counts and summary', () => {
  it('returns total:0 when no errors recorded', () => {
    const stats = getErrorStats();
    assert.equal(stats.total, 0);
  });

  it('total reflects the number of tracked errors', () => {
    trackError(new Error('a'), mockReq());
    trackError(new Error('b'), mockReq());
    const stats = getErrorStats();
    assert.equal(stats.total, 2);
  });

  it('last24h equals total for freshly tracked errors', () => {
    trackError(new Error('a'), mockReq());
    trackError(new Error('b'), mockReq());
    const stats = getErrorStats();
    assert.equal(stats.last24h, 2);
  });

  it('topPaths is an array', () => {
    trackError(new Error('x'), mockReq({ path: '/api/upload' }));
    const stats = getErrorStats();
    assert.ok(Array.isArray(stats.topPaths));
  });

  it('topPaths includes the path of a tracked error', () => {
    trackError(new Error('x'), mockReq({ path: '/api/upload' }));
    const stats = getErrorStats();
    assert.ok(stats.topPaths.includes('/api/upload'));
  });

  it('topPaths contains no duplicate paths', () => {
    trackError(new Error('a'), mockReq({ path: '/api/upload' }));
    trackError(new Error('b'), mockReq({ path: '/api/upload' }));
    trackError(new Error('c'), mockReq({ path: '/api/verify' }));
    const stats = getErrorStats();
    const unique = [...new Set(stats.topPaths)];
    assert.deepEqual(stats.topPaths, unique);
  });

  it('topPaths has at most 5 entries', () => {
    const paths = ['/a', '/b', '/c', '/d', '/e', '/f', '/g'];
    for (const p of paths) {
      trackError(new Error('x'), mockReq({ path: p }));
    }
    const stats = getErrorStats();
    assert.ok(stats.topPaths.length <= 5);
  });

  it('stats object has total, last24h, and topPaths keys', () => {
    const stats = getErrorStats();
    assert.ok(Object.prototype.hasOwnProperty.call(stats, 'total'));
    assert.ok(Object.prototype.hasOwnProperty.call(stats, 'last24h'));
    assert.ok(Object.prototype.hasOwnProperty.call(stats, 'topPaths'));
  });
});

describe('error-alerter — ring buffer eviction', () => {
  it('MAX_ERRORS is 100', () => {
    assert.equal(alerterTest.MAX_ERRORS, 100);
  });

  it('does not exceed MAX_ERRORS entries', () => {
    for (let i = 0; i < alerterTest.MAX_ERRORS + 10; i++) {
      trackError(new Error(`err${i}`), mockReq());
    }
    // getRecentErrors with a large limit to bypass the slice limit
    const errors = getRecentErrors(alerterTest.MAX_ERRORS + 10);
    assert.equal(errors.length, alerterTest.MAX_ERRORS);
  });

  it('oldest entry is evicted when buffer is full', () => {
    // Fill the buffer exactly
    for (let i = 0; i < alerterTest.MAX_ERRORS; i++) {
      trackError(new Error(`err-${i}`), mockReq());
    }
    // The oldest entry (added first) is now at the tail
    const before = getRecentErrors(alerterTest.MAX_ERRORS);
    const oldestBefore = before[before.length - 1];
    assert.equal(oldestBefore.error, 'err-0');

    // Push one more — err-0 should be gone
    trackError(new Error('new-entry'), mockReq());
    const after = getRecentErrors(alerterTest.MAX_ERRORS + 1);
    assert.equal(after.length, alerterTest.MAX_ERRORS);

    const messages = after.map(e => e.error);
    assert.ok(!messages.includes('err-0'), 'err-0 should have been evicted');
    assert.ok(messages.includes('new-entry'), 'new-entry should be present');
  });

  it('newest entry is at index 0 after overflow', () => {
    for (let i = 0; i < alerterTest.MAX_ERRORS + 5; i++) {
      trackError(new Error(`err-${i}`), mockReq());
    }
    const errors = getRecentErrors(1);
    assert.equal(errors[0].error, `err-${alerterTest.MAX_ERRORS + 4}`);
  });
});
