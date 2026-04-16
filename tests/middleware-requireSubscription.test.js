#!/usr/bin/env node
'use strict';

/**
 * Unit tests for middleware/requireSubscription.js
 *
 * Run with: node --test tests/middleware-requireSubscription.test.js
 *
 * Covers:
 *   - Allows through users with 'active' subscription_status
 *   - Allows through users with 'trial' subscription_status
 *   - Blocks 'cancelled' status — returns 403
 *   - Blocks 'expired' status — returns 403
 *   - Blocks 'pending' status — returns 403
 *   - Blocks any unrecognised status — returns 403
 *   - Missing req.user — returns 401
 *   - req.user present but subscription_status is undefined — returns 403
 *   - Response body shape: success, error code, plan, message
 *   - plan field reflects req.user.selected_plan when present
 *   - plan field is null when selected_plan is absent
 *   - next() is NOT called when access is denied
 *   - next() IS called when access is allowed
 *
 * Uses node:test + node:assert/strict. No server startup required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const requireSubscription = require('../middleware/requireSubscription');

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express-like req mock with a user attached.
 * Pass user:null to simulate the unauthenticated / no-passport case.
 */
function mockReq(user) {
  return { user };
}

/**
 * Build a mock res that captures status().json() calls.
 * Mirrors the chaining pattern used by Express:
 *   res.status(403).json({ ... })
 */
function mockRes() {
  const res = {
    _status: null,
    _body: null,

    status(code) {
      res._status = code;
      return {
        json(body) {
          res._body = body;
        },
      };
    },
  };
  return res;
}

/**
 * Run requireSubscription and return { res, nextCalled } for assertions.
 */
function run(user) {
  const req = mockReq(user);
  const res = mockRes();
  let nextCalled = false;
  requireSubscription(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

// ---------------------------------------------------------------------------
// 1. Allowed statuses
// ---------------------------------------------------------------------------

describe('requireSubscription — allowed statuses', () => {

  it('calls next() for status "active"', () => {
    const { nextCalled } = run({ subscription_status: 'active' });
    assert.equal(nextCalled, true);
  });

  it('does not send a response for status "active"', () => {
    const { res } = run({ subscription_status: 'active' });
    assert.equal(res._status, null);
    assert.equal(res._body, null);
  });

  it('calls next() for status "trial"', () => {
    const { nextCalled } = run({ subscription_status: 'trial' });
    assert.equal(nextCalled, true);
  });

  it('does not send a response for status "trial"', () => {
    const { res } = run({ subscription_status: 'trial' });
    assert.equal(res._status, null);
    assert.equal(res._body, null);
  });

});

// ---------------------------------------------------------------------------
// 2. Blocked statuses
// ---------------------------------------------------------------------------

describe('requireSubscription — blocked status "cancelled"', () => {

  it('returns HTTP 403', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.equal(res._status, 403);
  });

  it('does NOT call next()', () => {
    const { nextCalled } = run({ subscription_status: 'cancelled' });
    assert.equal(nextCalled, false);
  });

  it('body has success:false', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.equal(res._body?.success, false);
  });

  it('body error is "subscription_required"', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.equal(res._body?.error, 'subscription_required');
  });

  it('body includes the human-readable message', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.ok(typeof res._body?.message === 'string' && res._body.message.length > 0);
  });

});

describe('requireSubscription — blocked status "expired"', () => {

  it('returns HTTP 403', () => {
    const { res } = run({ subscription_status: 'expired' });
    assert.equal(res._status, 403);
  });

  it('does NOT call next()', () => {
    const { nextCalled } = run({ subscription_status: 'expired' });
    assert.equal(nextCalled, false);
  });

  it('body has success:false', () => {
    const { res } = run({ subscription_status: 'expired' });
    assert.equal(res._body?.success, false);
  });

  it('body error is "subscription_required"', () => {
    const { res } = run({ subscription_status: 'expired' });
    assert.equal(res._body?.error, 'subscription_required');
  });

});

describe('requireSubscription — blocked status "pending"', () => {

  it('returns HTTP 403', () => {
    const { res } = run({ subscription_status: 'pending' });
    assert.equal(res._status, 403);
  });

  it('does NOT call next()', () => {
    const { nextCalled } = run({ subscription_status: 'pending' });
    assert.equal(nextCalled, false);
  });

});

describe('requireSubscription — blocked status "none"', () => {

  it('returns HTTP 403', () => {
    const { res } = run({ subscription_status: 'none' });
    assert.equal(res._status, 403);
  });

  it('does NOT call next()', () => {
    const { nextCalled } = run({ subscription_status: 'none' });
    assert.equal(nextCalled, false);
  });

});

describe('requireSubscription — unrecognised status string', () => {

  it('returns HTTP 403 for an arbitrary unknown status', () => {
    const { res } = run({ subscription_status: 'unknown-status-xyz' });
    assert.equal(res._status, 403);
  });

  it('does NOT call next() for an unknown status', () => {
    const { nextCalled } = run({ subscription_status: 'unknown-status-xyz' });
    assert.equal(nextCalled, false);
  });

});

describe('requireSubscription — undefined subscription_status', () => {

  it('returns HTTP 403 when subscription_status is undefined', () => {
    const { res } = run({ subscription_status: undefined });
    assert.equal(res._status, 403);
  });

  it('does NOT call next() when subscription_status is undefined', () => {
    const { nextCalled } = run({ subscription_status: undefined });
    assert.equal(nextCalled, false);
  });

});

// ---------------------------------------------------------------------------
// 3. Missing req.user (not authenticated)
// ---------------------------------------------------------------------------

describe('requireSubscription — missing req.user', () => {

  it('returns HTTP 401 when req.user is undefined', () => {
    const { res } = run(undefined);
    assert.equal(res._status, 401);
  });

  it('returns HTTP 401 when req.user is null', () => {
    const { res } = run(null);
    assert.equal(res._status, 401);
  });

  it('body has success:false when req.user is missing', () => {
    const { res } = run(undefined);
    assert.equal(res._body?.success, false);
  });

  it('body error is "Please sign in" when req.user is missing', () => {
    const { res } = run(undefined);
    assert.equal(res._body?.error, 'Please sign in');
  });

  it('does NOT call next() when req.user is missing', () => {
    const { nextCalled } = run(undefined);
    assert.equal(nextCalled, false);
  });

});

// ---------------------------------------------------------------------------
// 4. plan field in the 403 response body
// ---------------------------------------------------------------------------

describe('requireSubscription — plan field in 403 body', () => {

  it('plan reflects req.user.selected_plan when present', () => {
    const { res } = run({ subscription_status: 'expired', selected_plan: 'pro' });
    assert.equal(res._body?.plan, 'pro');
  });

  it('plan is null when selected_plan is absent', () => {
    const { res } = run({ subscription_status: 'expired' });
    assert.equal(res._body?.plan, null);
  });

  it('plan is null when selected_plan is explicitly null', () => {
    const { res } = run({ subscription_status: 'expired', selected_plan: null });
    assert.equal(res._body?.plan, null);
  });

  it('plan key is present in the response body', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'plan'));
  });

  it('plan key is present even without a selected_plan', () => {
    const { res } = run({ subscription_status: 'cancelled' });
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'plan'));
  });

});

// ---------------------------------------------------------------------------
// 5. Full response envelope shape
// ---------------------------------------------------------------------------

describe('requireSubscription — 403 response envelope', () => {

  it('body includes success, error, plan, and message keys', () => {
    const { res } = run({ subscription_status: 'expired' });
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'success'));
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'error'));
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'plan'));
    assert.ok(Object.prototype.hasOwnProperty.call(res._body, 'message'));
  });

  it('success is always false in the 403 body', () => {
    const statuses = ['cancelled', 'expired', 'pending', 'none', 'random'];
    for (const status of statuses) {
      const { res } = run({ subscription_status: status });
      assert.equal(res._body?.success, false, `success should be false for status "${status}"`);
    }
  });

  it('error field is always "subscription_required" in the 403 body', () => {
    const statuses = ['cancelled', 'expired', 'pending', 'none'];
    for (const status of statuses) {
      const { res } = run({ subscription_status: status });
      assert.equal(
        res._body?.error,
        'subscription_required',
        `error should be subscription_required for status "${status}"`
      );
    }
  });

});
