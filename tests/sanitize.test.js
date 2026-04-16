#!/usr/bin/env node
'use strict';

/**
 * Unit tests for middleware/sanitize.js
 *
 * Covers: escapeStr, sanitizeValue, and sanitizeBody middleware.
 * Run with: node tests/sanitize.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeBody, _test } = require('../middleware/sanitize');
const { escapeStr, sanitizeValue, MAX_DEPTH, LARGE_FIELD_ALLOWLIST, HTML_FIELD_ALLOWLIST } = _test;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run sanitizeBody as middleware against a synthetic req.body.
 * Returns { body, statusCode, jsonPayload } where statusCode / jsonPayload
 * are only set if res.status().json() was called (i.e. a 400 rejection).
 */
function runMiddleware(body) {
  const req = { body };
  let statusCode = null;
  let jsonPayload = null;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return {
        json(payload) {
          jsonPayload = payload;
        }
      };
    }
  };

  const next = () => { nextCalled = true; };

  sanitizeBody(req, res, next);

  return { body: req.body, statusCode, jsonPayload, nextCalled };
}

// ---------------------------------------------------------------------------
// 1. escapeStr
// ---------------------------------------------------------------------------

describe('escapeStr — HTML entity escaping', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeStr('a & b'), 'a &amp; b');
  });

  it('escapes less-than', () => {
    assert.equal(escapeStr('<script>'), '&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    assert.equal(escapeStr('x > 0'), 'x &gt; 0');
  });

  it('escapes double quote', () => {
    assert.equal(escapeStr('"hello"'), '&quot;hello&quot;');
  });

  it("escapes single quote", () => {
    assert.equal(escapeStr("it's"), "it&#x27;s");
  });

  it('escapes all five characters in one string', () => {
    const input = `<a href="url" class='x'>A & B</a>`;
    const output = escapeStr(input);
    assert.ok(!output.includes('<'), 'should not contain raw <');
    assert.ok(!output.includes('>'), 'should not contain raw >');
    assert.ok(!output.includes('"'), 'should not contain raw "');
    assert.ok(!output.includes("'"), "should not contain raw '");
    // & only appears as part of entity sequences
    const rawAmpersandCount = (output.match(/&(?!(amp|lt|gt|quot|#x27);)/g) || []).length;
    assert.equal(rawAmpersandCount, 0, 'should not contain unescaped &');
  });

  it('returns a number unchanged', () => {
    assert.equal(escapeStr(42), 42);
  });

  it('returns a boolean unchanged', () => {
    assert.equal(escapeStr(true), true);
    assert.equal(escapeStr(false), false);
  });

  it('returns null unchanged', () => {
    assert.equal(escapeStr(null), null);
  });

  it('returns undefined unchanged', () => {
    assert.equal(escapeStr(undefined), undefined);
  });

  it('handles empty string', () => {
    assert.equal(escapeStr(''), '');
  });

  it('does not alter a plain string with no special characters', () => {
    assert.equal(escapeStr('hello world'), 'hello world');
  });
});

// ---------------------------------------------------------------------------
// 2. sanitizeValue
// ---------------------------------------------------------------------------

describe('sanitizeValue — strings are escaped', () => {
  it('escapes HTML entities in a plain string value', () => {
    const result = sanitizeValue('username', '<script>xss</script>', 0);
    assert.equal(result, '&lt;script&gt;xss&lt;/script&gt;');
  });

  it('strips null bytes from a string', () => {
    const result = sanitizeValue('name', 'hello\x00world', 0);
    assert.equal(result, 'helloworld');
  });

  it('strips null bytes before escaping', () => {
    // null byte should be gone; remaining content gets escaped
    const result = sanitizeValue('name', '<b>\x00</b>', 0);
    assert.equal(result, '&lt;b&gt;&lt;/b&gt;');
  });
});

describe('sanitizeValue — LARGE_FIELD_ALLOWLIST behaviour', () => {
  it('customLogo is in LARGE_FIELD_ALLOWLIST', () => {
    assert.ok(LARGE_FIELD_ALLOWLIST.has('customLogo'));
  });

  it('customIcon is in LARGE_FIELD_ALLOWLIST', () => {
    assert.ok(LARGE_FIELD_ALLOWLIST.has('customIcon'));
  });

  it('pvf_content is in LARGE_FIELD_ALLOWLIST', () => {
    assert.ok(LARGE_FIELD_ALLOWLIST.has('pvf_content'));
  });

  it('content is in LARGE_FIELD_ALLOWLIST', () => {
    assert.ok(LARGE_FIELD_ALLOWLIST.has('content'));
  });

  it('customLogo accepts a string longer than 10000 chars without returning null', () => {
    const big = 'A'.repeat(10001);
    const result = sanitizeValue('customLogo', big, 0);
    // Should NOT be null — large field bypass applies
    assert.ok(result !== null);
    assert.equal(result.length, 10001);
  });

  it('a regular field with a string longer than 10000 chars returns null', () => {
    const big = 'A'.repeat(10001);
    const result = sanitizeValue('email', big, 0);
    assert.equal(result, null);
  });
});

describe('sanitizeValue — HTML_FIELD_ALLOWLIST: no escaping for HTML fields', () => {
  it('customIcon is in HTML_FIELD_ALLOWLIST', () => {
    assert.ok(HTML_FIELD_ALLOWLIST.has('customIcon'));
  });

  it('pvf_content is in HTML_FIELD_ALLOWLIST', () => {
    assert.ok(HTML_FIELD_ALLOWLIST.has('pvf_content'));
  });

  it('content is in HTML_FIELD_ALLOWLIST', () => {
    assert.ok(HTML_FIELD_ALLOWLIST.has('content'));
  });

  it('pvf_content value is NOT escaped', () => {
    const html = '<div class="pvf">Hello &amp; World</div>';
    const result = sanitizeValue('pvf_content', html, 0);
    // Null bytes stripped but no further escaping
    assert.equal(result, html);
  });

  it('content value is NOT escaped', () => {
    const html = '<p>paragraph & "quote"</p>';
    const result = sanitizeValue('content', html, 0);
    assert.equal(result, html);
  });

  it('customIcon value is NOT escaped', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    const result = sanitizeValue('customIcon', svg, 0);
    assert.equal(result, svg);
  });

  it('customLogo IS escaped (it is in LARGE_FIELD_ALLOWLIST but NOT HTML_FIELD_ALLOWLIST)', () => {
    const value = '<img src="x">';
    const result = sanitizeValue('customLogo', value, 0);
    assert.ok(result.includes('&lt;'), 'customLogo should still be HTML-escaped');
  });
});

describe('sanitizeValue — nested objects are recursed into', () => {
  it('escapes strings one level deep', () => {
    const obj = { label: '<b>bold</b>' };
    const result = sanitizeValue('wrapper', obj, 0);
    assert.equal(result.label, '&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes strings two levels deep', () => {
    const obj = { outer: { inner: '<script>' } };
    const result = sanitizeValue('data', obj, 0);
    assert.equal(result.outer.inner, '&lt;script&gt;');
  });

  it('removes __proto__ keys from nested objects', () => {
    const obj = { user: { name: 'Alice', __proto__: { admin: true } } };
    const result = sanitizeValue('data', obj, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.user, '__proto__'));
  });

  it('removes constructor keys from nested objects', () => {
    const parsed = JSON.parse('{"a": {"constructor": "evil"}}');
    const result = sanitizeValue('data', parsed, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.a, 'constructor'));
  });

  it('removes prototype keys from nested objects', () => {
    const parsed = JSON.parse('{"a": {"prototype": "evil"}}');
    const result = sanitizeValue('data', parsed, 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.a, 'prototype'));
  });
});

describe('sanitizeValue — arrays are recursed into', () => {
  it('escapes strings inside an array', () => {
    const result = sanitizeValue('tags', ['<a>', '<b>'], 0);
    assert.deepEqual(result, ['&lt;a&gt;', '&lt;b&gt;']);
  });

  it('handles mixed-type array elements', () => {
    const result = sanitizeValue('items', [1, '<x>', true, null], 0);
    assert.deepEqual(result, [1, '&lt;x&gt;', true, null]);
  });

  it('handles nested arrays', () => {
    const result = sanitizeValue('matrix', [['<row1col1>', 'safe'], ['<row2col1>']], 0);
    assert.equal(result[0][0], '&lt;row1col1&gt;');
    assert.equal(result[0][1], 'safe');
    assert.equal(result[1][0], '&lt;row2col1&gt;');
  });
});

describe('sanitizeValue — depth limit', () => {
  it('MAX_DEPTH is 5', () => {
    assert.equal(MAX_DEPTH, 5);
  });

  it('returns undefined when depth exceeds MAX_DEPTH', () => {
    const result = sanitizeValue('key', 'value', MAX_DEPTH + 1);
    assert.equal(result, undefined);
  });

  it('returns undefined at depth MAX_DEPTH + 1', () => {
    const result = sanitizeValue('key', { nested: 'value' }, MAX_DEPTH + 1);
    assert.equal(result, undefined);
  });

  it('does NOT drop values at exactly MAX_DEPTH', () => {
    const result = sanitizeValue('key', 'value', MAX_DEPTH);
    assert.equal(result, '&lt;value&gt;' === result ? result : 'value');
    // At depth MAX_DEPTH the string still gets processed (depth > MAX_DEPTH is the guard)
    assert.notEqual(result, undefined);
  });
});

describe('sanitizeValue — non-string primitives pass through', () => {
  it('passes through integers', () => {
    assert.equal(sanitizeValue('count', 42, 0), 42);
  });

  it('passes through floats', () => {
    assert.equal(sanitizeValue('ratio', 3.14, 0), 3.14);
  });

  it('passes through booleans', () => {
    assert.equal(sanitizeValue('active', true, 0), true);
    assert.equal(sanitizeValue('active', false, 0), false);
  });

  it('passes through null', () => {
    assert.equal(sanitizeValue('field', null, 0), null);
  });
});

// ---------------------------------------------------------------------------
// 3. sanitizeBody middleware
// ---------------------------------------------------------------------------

describe('sanitizeBody — basic sanitization', () => {
  it('escapes HTML in a top-level string field', () => {
    const { body, nextCalled } = runMiddleware({ name: '<script>alert(1)</script>' });
    assert.equal(body.name, '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.ok(nextCalled);
  });

  it('escapes multiple fields', () => {
    const { body, nextCalled } = runMiddleware({
      first: '<b>',
      second: '"quoted"',
      third: "it's"
    });
    assert.equal(body.first, '&lt;b&gt;');
    assert.equal(body.second, '&quot;quoted&quot;');
    assert.equal(body.third, "it&#x27;s");
    assert.ok(nextCalled);
  });

  it('leaves non-string fields untouched', () => {
    const { body, nextCalled } = runMiddleware({ count: 5, active: true, score: 9.9 });
    assert.equal(body.count, 5);
    assert.equal(body.active, true);
    assert.equal(body.score, 9.9);
    assert.ok(nextCalled);
  });

  it('does not escape HTML_FIELD_ALLOWLIST fields', () => {
    const html = '<div>rich content & "quotes"</div>';
    const { body, nextCalled } = runMiddleware({ content: html });
    assert.equal(body.content, html);
    assert.ok(nextCalled);
  });

  it('does not escape pvf_content', () => {
    const html = '<section id="pvf"><h1>Document</h1></section>';
    const { body, nextCalled } = runMiddleware({ pvf_content: html });
    assert.equal(body.pvf_content, html);
    assert.ok(nextCalled);
  });

  it('sanitizes nested objects', () => {
    const { body, nextCalled } = runMiddleware({ meta: { title: '<b>Report</b>' } });
    assert.equal(body.meta.title, '&lt;b&gt;Report&lt;/b&gt;');
    assert.ok(nextCalled);
  });

  it('sanitizes strings inside arrays', () => {
    const { body, nextCalled } = runMiddleware({ tags: ['<xss>', 'safe'] });
    assert.equal(body.tags[0], '&lt;xss&gt;');
    assert.equal(body.tags[1], 'safe');
    assert.ok(nextCalled);
  });
});

describe('sanitizeBody — oversized field rejection', () => {
  it('returns 400 when a regular field exceeds 10000 characters', () => {
    const { statusCode, jsonPayload, nextCalled } = runMiddleware({
      email: 'A'.repeat(10001)
    });
    assert.equal(statusCode, 400);
    assert.equal(jsonPayload.success, false);
    assert.ok(typeof jsonPayload.error === 'string');
    assert.ok(jsonPayload.error.includes('email'));
    assert.ok(!nextCalled);
  });

  it('does NOT reject customLogo exceeding 10000 characters', () => {
    const { statusCode, nextCalled } = runMiddleware({
      customLogo: 'data:image/png;base64,' + 'A'.repeat(10001)
    });
    assert.equal(statusCode, null);
    assert.ok(nextCalled);
  });

  it('does NOT reject customIcon exceeding 10000 characters', () => {
    const { statusCode, nextCalled } = runMiddleware({
      customIcon: '<svg>' + 'x'.repeat(10001) + '</svg>'
    });
    assert.equal(statusCode, null);
    assert.ok(nextCalled);
  });
});

describe('sanitizeBody — prototype pollution prevention', () => {
  it('removes __proto__ from the top-level body', () => {
    // Use Object.defineProperty to plant __proto__ without triggering the setter
    const body = Object.create(null);
    body.name = 'Alice';
    Object.defineProperty(body, '__proto__', { value: { admin: true }, enumerable: true, configurable: true, writable: true });
    const { nextCalled } = runMiddleware(body);
    assert.ok(!Object.prototype.hasOwnProperty.call(body, '__proto__'));
    assert.ok(nextCalled);
  });

  it('removes constructor from the top-level body', () => {
    const parsed = JSON.parse('{"constructor": "evil", "name": "Alice"}');
    const { body, nextCalled } = runMiddleware(parsed);
    assert.ok(!Object.prototype.hasOwnProperty.call(body, 'constructor'));
    assert.ok(nextCalled);
  });

  it('removes prototype from the top-level body', () => {
    const parsed = JSON.parse('{"prototype": "evil", "name": "Alice"}');
    const { body, nextCalled } = runMiddleware(parsed);
    assert.ok(!Object.prototype.hasOwnProperty.call(body, 'prototype'));
    assert.ok(nextCalled);
  });
});

describe('sanitizeBody — missing or non-object req.body', () => {
  it('calls next() immediately when req.body is undefined', () => {
    const req = {};
    let nextCalled = false;
    sanitizeBody(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() immediately when req.body is null', () => {
    const req = { body: null };
    let nextCalled = false;
    sanitizeBody(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() immediately when req.body is a string', () => {
    const req = { body: 'raw string body' };
    let nextCalled = false;
    sanitizeBody(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() immediately when req.body is a number', () => {
    const req = { body: 42 };
    let nextCalled = false;
    sanitizeBody(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('calls next() immediately when req.body is a boolean', () => {
    const req = { body: false };
    let nextCalled = false;
    sanitizeBody(req, {}, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('handles an empty object body without error', () => {
    const { body, nextCalled } = runMiddleware({});
    assert.deepEqual(body, {});
    assert.ok(nextCalled);
  });
});

describe('sanitizeBody — null byte removal', () => {
  it('strips null bytes from string fields', () => {
    const { body, nextCalled } = runMiddleware({ username: 'admin\x00injected' });
    assert.equal(body.username, 'admininjected');
    assert.ok(nextCalled);
  });

  it('strips null bytes before HTML escaping', () => {
    const { body, nextCalled } = runMiddleware({ note: '<p>\x00</p>' });
    assert.equal(body.note, '&lt;p&gt;&lt;/p&gt;');
    assert.ok(nextCalled);
  });
});
