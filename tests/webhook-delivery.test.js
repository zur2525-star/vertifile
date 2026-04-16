#!/usr/bin/env node
'use strict';

/**
 * Vertifile — fireWebhooks Delivery Unit Tests
 *
 * Tests the fireWebhooks() function exported from routes/webhooks.js.
 *
 * Uses Node.js built-in test runner (node:test) and assert (node:assert/strict).
 * Run with:   node tests/webhook-delivery.test.js
 *
 * Strategy: mock global.fetch so no real HTTP requests are made.
 * Mock db.getWebhooksByOrg() to return controlled webhook fixtures.
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// Skip DNS resolution inside isValidWebhookUrl (not exercised by fireWebhooks,
// but prevents accidental network calls if the module path triggers anything).
process.env.PORT = '0';

const { fireWebhooks } = require(
  path.resolve(__dirname, '../routes/webhooks.js')
);

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

/**
 * Install a controllable global.fetch mock.
 * Returns an object with:
 *   calls   — array of { url, opts } recorded per invocation
 *   setImpl — replace the response implementation mid-test
 *   restore — tear down, restoring the original global.fetch
 */
function createFetchMock(defaultImpl) {
  const originalFetch = global.fetch;
  const state = {
    calls: [],
    impl: defaultImpl || (async (_url, _opts) => ({
      ok: true,
      status: 200,
      text: async () => 'ok'
    }))
  };

  global.fetch = async (url, opts) => {
    state.calls.push({ url, opts });
    return state.impl(url, opts);
  };

  return {
    get calls() { return state.calls; },
    setImpl(fn) { state.impl = fn; },
    restore() { global.fetch = originalFetch; }
  };
}

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal db mock whose getWebhooksByOrg resolves to `webhooks`.
 */
function makeDb(webhooks) {
  return {
    getWebhooksByOrg: async (_orgId) => webhooks
  };
}

/**
 * Build a single webhook fixture.
 */
function makeWebhook({
  url = 'https://hooks.example.com/webhook',
  events = ['verification.success'],
  secret = 'test-secret-abc123'
} = {}) {
  return { url, events, secret };
}

// ---------------------------------------------------------------------------
// Compute expected HMAC for assertion helpers
// ---------------------------------------------------------------------------
function computeHmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Wait for fire-and-forget fetch to settle.
// fireWebhooks fires fetch without await, so we yield to the microtask queue
// to let the Promise resolve before asserting on state.calls.
// ---------------------------------------------------------------------------
function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

// ===========================================================================
// HMAC signing
// ===========================================================================
describe('fireWebhooks — HMAC signing', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('serialises the payload as JSON containing event, data, and timestamp', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', { docId: 42 });
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const body = mock.calls[0].opts.body;
    const parsed = JSON.parse(body); // must not throw
    assert.equal(parsed.event, 'verification.success');
    assert.deepEqual(parsed.data, { docId: 42 });
    assert.ok(typeof parsed.timestamp === 'string', 'timestamp must be a string');
    assert.ok(parsed.timestamp.length > 0, 'timestamp must be non-empty');
  });

  it('includes X-Vertifile-Signature header', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const headers = mock.calls[0].opts.headers;
    assert.ok('X-Vertifile-Signature' in headers, 'X-Vertifile-Signature header must be present');
  });

  it('signature is HMAC-SHA256 of the request body using the webhook secret', async () => {
    const secret = 'super-secret-key-xyz';
    const wh = makeWebhook({ events: ['verification.success'], secret });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', { file: 'test.pvf' });
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const { body, headers } = mock.calls[0].opts;
    const expected = computeHmac(secret, body);
    assert.equal(headers['X-Vertifile-Signature'], expected);
  });

  it('different secrets produce different signatures for the same payload', async () => {
    const data = { id: 99 };
    const db1 = makeDb([makeWebhook({ events: ['verification.success'], secret: 'secret-A' })]);
    const db2 = makeDb([makeWebhook({ events: ['verification.success'], secret: 'secret-B' })]);

    // First call
    await fireWebhooks(db1, 'org-1', 'verification.success', data);
    await flushMicrotasks();
    const sig1 = mock.calls[0].opts.headers['X-Vertifile-Signature'];

    mock.calls.length = 0; // reset recorded calls

    // Second call
    await fireWebhooks(db2, 'org-2', 'verification.success', data);
    await flushMicrotasks();
    const sig2 = mock.calls[0].opts.headers['X-Vertifile-Signature'];

    assert.notEqual(sig1, sig2, 'different secrets must yield different signatures');
  });

  it('signature is a 64-character lowercase hex string (SHA-256 output)', async () => {
    const wh = makeWebhook({ events: ['document.created'], secret: 'hex-test-secret' });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'document.created', { size: 1024 });
    await flushMicrotasks();

    const sig = mock.calls[0].opts.headers['X-Vertifile-Signature'];
    assert.match(sig, /^[0-9a-f]{64}$/, 'signature must be 64 hex characters');
  });
});

// ===========================================================================
// Request formatting
// ===========================================================================
describe('fireWebhooks — request formatting', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('uses POST method', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls[0].opts.method, 'POST');
  });

  it('sets Content-Type to application/json', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls[0].opts.headers['Content-Type'], 'application/json');
  });

  it('sends the serialised body as a string (not a Buffer or object)', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', { x: 1 });
    await flushMicrotasks();

    assert.equal(typeof mock.calls[0].opts.body, 'string');
  });

  it('delivers to the registered webhook URL', async () => {
    const url = 'https://api.myapp.com/events';
    const wh = makeWebhook({ url, events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls[0].url, url);
  });
});

// ===========================================================================
// Event filtering
// ===========================================================================
describe('fireWebhooks — event filtering', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('delivers when the webhook is subscribed to the fired event', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
  });

  it('does NOT deliver when the webhook is not subscribed to the fired event', async () => {
    const wh = makeWebhook({ events: ['document.created'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls.length, 0);
  });

  it('delivers to multiple webhooks subscribed to the same event', async () => {
    const wh1 = makeWebhook({ url: 'https://hooks.example.com/a', events: ['verification.success'] });
    const wh2 = makeWebhook({ url: 'https://hooks.example.com/b', events: ['verification.success'] });
    const wh3 = makeWebhook({ url: 'https://hooks.example.com/c', events: ['verification.success'] });
    const db = makeDb([wh1, wh2, wh3]);

    await fireWebhooks(db, 'org-1', 'verification.success', { id: 7 });
    await flushMicrotasks();

    assert.equal(mock.calls.length, 3);
    const urls = mock.calls.map(c => c.url);
    assert.ok(urls.includes('https://hooks.example.com/a'));
    assert.ok(urls.includes('https://hooks.example.com/b'));
    assert.ok(urls.includes('https://hooks.example.com/c'));
  });

  it('only delivers to webhooks subscribed to the specific event when the list is mixed', async () => {
    const wh1 = makeWebhook({ url: 'https://hooks.example.com/a', events: ['verification.success'] });
    const wh2 = makeWebhook({ url: 'https://hooks.example.com/b', events: ['document.created'] });
    const wh3 = makeWebhook({ url: 'https://hooks.example.com/c', events: ['verification.success', 'document.created'] });
    const db = makeDb([wh1, wh2, wh3]);

    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    assert.equal(mock.calls.length, 2);
    const urls = mock.calls.map(c => c.url);
    assert.ok(urls.includes('https://hooks.example.com/a'));
    assert.ok(urls.includes('https://hooks.example.com/c'));
    assert.ok(!urls.includes('https://hooks.example.com/b'));
  });
});

// ===========================================================================
// Delivery scenarios
// ===========================================================================
describe('fireWebhooks — delivery scenarios', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('completes without throwing on successful delivery (200 OK)', async () => {
    mock.setImpl(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();
    assert.equal(mock.calls.length, 1);
  });

  it('does not throw when the server responds with 500', async () => {
    mock.setImpl(async () => ({ ok: false, status: 500, text: async () => 'Internal Server Error' }));
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();
    // Attempt was made even though the response was a server error
    assert.equal(mock.calls.length, 1);
  });

  it('does not throw when fetch rejects (network error)', async () => {
    mock.setImpl(async () => { throw new Error('ECONNREFUSED'); });
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();
    assert.equal(mock.calls.length, 1);
  });

  it('does not throw when fetch times out (simulated slow response)', async () => {
    // Simulate a long-running fetch that eventually rejects
    mock.setImpl(() => new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('timeout')), 10)
    ));
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    // Give the delayed rejection time to be swallowed by .catch
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(mock.calls.length, 1);
  });

  it('still delivers to remaining webhooks when one fetch rejects', async () => {
    let callCount = 0;
    mock.setImpl(async () => {
      callCount++;
      if (callCount === 1) throw new Error('first one fails');
      return { ok: true, status: 200, text: async () => 'ok' };
    });

    const wh1 = makeWebhook({ url: 'https://hooks.example.com/a', events: ['verification.success'] });
    const wh2 = makeWebhook({ url: 'https://hooks.example.com/b', events: ['verification.success'] });
    const db = makeDb([wh1, wh2]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();

    // Both were attempted
    assert.equal(mock.calls.length, 2);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe('fireWebhooks — edge cases', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('is a no-op when the webhooks list is empty — no fetch calls made', async () => {
    const db = makeDb([]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 0);
  });

  it('handles null event data without throwing', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', null)
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const parsed = JSON.parse(mock.calls[0].opts.body);
    assert.equal(parsed.data, null);
  });

  it('handles undefined event data without throwing', async () => {
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', undefined)
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    // JSON.stringify({ data: undefined }) serialises data as absent;
    // the body must still be valid JSON.
    assert.doesNotThrow(() => JSON.parse(mock.calls[0].opts.body));
  });

  it('handles a very large payload without throwing', async () => {
    const largeData = { blob: 'x'.repeat(500_000) };
    const wh = makeWebhook({ events: ['document.created'] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'document.created', largeData)
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const body = mock.calls[0].opts.body;
    assert.ok(body.length > 500_000, 'body should contain the large payload');
  });

  it('handles an event name that contains special characters', async () => {
    const eventName = 'doc.created/v2+beta';
    const wh = makeWebhook({ events: [eventName] });
    const db = makeDb([wh]);

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', eventName, {})
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const parsed = JSON.parse(mock.calls[0].opts.body);
    assert.equal(parsed.event, eventName);
  });

  it('does not throw when db.getWebhooksByOrg rejects', async () => {
    const db = {
      getWebhooksByOrg: async () => { throw new Error('DB connection lost'); }
    };

    await assert.doesNotReject(
      () => fireWebhooks(db, 'org-1', 'verification.success', {})
    );
    await flushMicrotasks();

    assert.equal(mock.calls.length, 0);
  });
});

// ===========================================================================
// Security — secret must not leak
// ===========================================================================
describe('fireWebhooks — security', () => {
  let mock;

  before(() => { mock = createFetchMock(); });
  after(() => mock.restore());

  it('does not include the raw webhook secret in the request body', async () => {
    const secret = 'do-not-leak-this-secret-12345';
    const wh = makeWebhook({ events: ['verification.success'], secret });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.success', { docId: 1 });
    await flushMicrotasks();

    assert.equal(mock.calls.length, 1);
    const body = mock.calls[0].opts.body;
    assert.ok(!body.includes(secret), 'raw secret must not appear in the request body');
  });

  it('does not include the raw webhook secret in any request header', async () => {
    const secret = 'another-secret-value-xyz';
    const wh = makeWebhook({ events: ['verification.success'], secret });
    const db = makeDb([wh]);

    mock.calls.length = 0;
    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    const headers = mock.calls[0].opts.headers;
    for (const [key, value] of Object.entries(headers)) {
      assert.ok(
        !String(value).includes(secret),
        `raw secret must not appear in header "${key}"`
      );
    }
  });

  it('signature is a hex digest, not the raw secret', async () => {
    const secret = 'raw-secret-must-not-be-sig';
    const wh = makeWebhook({ events: ['verification.success'], secret });
    const db = makeDb([wh]);

    mock.calls.length = 0;
    await fireWebhooks(db, 'org-1', 'verification.success', {});
    await flushMicrotasks();

    const sig = mock.calls[0].opts.headers['X-Vertifile-Signature'];
    assert.notEqual(sig, secret);
    assert.match(sig, /^[0-9a-f]{64}$/);
  });
});

// ===========================================================================
// Payload integrity — same body is signed and sent
// ===========================================================================
describe('fireWebhooks — payload integrity', () => {
  let mock;

  beforeEach(() => { mock = createFetchMock(); });
  afterEach(() => mock.restore());

  it('the signature matches a locally recomputed HMAC of the exact body sent', async () => {
    const secret = 'integrity-check-secret';
    const wh = makeWebhook({ events: ['verification.failed'], secret });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'verification.failed', { reason: 'tampered' });
    await flushMicrotasks();

    const { body, headers } = mock.calls[0].opts;
    const recomputed = computeHmac(secret, body);
    assert.equal(
      headers['X-Vertifile-Signature'],
      recomputed,
      'sent signature must equal HMAC-SHA256(secret, body)'
    );
  });

  it('body contains the orgId passed to fireWebhooks — no: only event+data+timestamp are in body', async () => {
    // This test documents the actual shape: body is { event, data, timestamp }.
    // orgId is NOT included in the payload — it is only used to look up webhooks.
    const wh = makeWebhook({ events: ['verification.success'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'my-org-id-123', 'verification.success', { x: 1 });
    await flushMicrotasks();

    const parsed = JSON.parse(mock.calls[0].opts.body);
    // Confirm the three documented fields are present
    assert.ok('event' in parsed);
    assert.ok('data' in parsed);
    assert.ok('timestamp' in parsed);
    // orgId is intentionally absent from the payload
    assert.ok(!('orgId' in parsed));
  });

  it('timestamp in body is a valid ISO 8601 date string', async () => {
    const wh = makeWebhook({ events: ['document.created'] });
    const db = makeDb([wh]);

    await fireWebhooks(db, 'org-1', 'document.created', {});
    await flushMicrotasks();

    const { timestamp } = JSON.parse(mock.calls[0].opts.body);
    const d = new Date(timestamp);
    assert.ok(!isNaN(d.getTime()), 'timestamp must parse as a valid date');
  });
});
