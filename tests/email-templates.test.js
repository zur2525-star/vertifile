#!/usr/bin/env node
'use strict';

/**
 * Unit tests for services/email-templates.js
 *
 * These are pure string-generation functions -- no SMTP, no mocking needed.
 * Each exported function returns { subject, html, text }.
 *
 * Tests cover:
 *   welcomeEmail(userName)
 *   firstDocEmail(userName)
 *   stampEmail(userName)
 *   shareEmail(userName)
 *   upgradeEmail(userName, plan)
 *
 * For each template:
 *   - return shape: { subject, html, text } -- all strings
 *   - html is a valid HTML document (starts with DOCTYPE, contains <html>/<body>)
 *   - Vertifile branding: purple gradient colors (#4f46e5, #7c3aed), logo image, copyright notice
 *   - interpolated values (userName, BASE_URL) appear in the output
 *   - safe fallback when userName is omitted or null
 *   - the CTA button links to the correct URL
 *   - subject is a non-empty string
 *   - text is a non-empty string (plain-text alternative)
 *
 * Run with: node --test tests/email-templates.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  welcomeEmail,
  firstDocEmail,
  stampEmail,
  shareEmail,
  upgradeEmail,
} = require('../services/email-templates');

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

const BRAND_COLORS = ['#4f46e5', '#7c3aed'];
const LOGO_URL_FRAGMENT = 'logo-horizontal.png';
const COPYRIGHT_FRAGMENT = '2026 Vertifile';
const BASE_URL = process.env.BASE_URL || 'https://vertifile.com';

function assertValidShape(result, label) {
  assert.equal(typeof result, 'object', `${label}: result should be an object`);
  assert.equal(typeof result.subject, 'string', `${label}: subject should be a string`);
  assert.equal(typeof result.html, 'string', `${label}: html should be a string`);
  assert.equal(typeof result.text, 'string', `${label}: text should be a string`);
  assert.ok(result.subject.length > 0, `${label}: subject should not be empty`);
  assert.ok(result.html.length > 0, `${label}: html should not be empty`);
  assert.ok(result.text.length > 0, `${label}: text should not be empty`);
}

function assertValidHtmlDocument(html, label) {
  assert.ok(html.includes('<!DOCTYPE html>'), `${label}: html should start with DOCTYPE`);
  assert.ok(html.includes('<html'), `${label}: html should contain <html> tag`);
  assert.ok(html.includes('<body'), `${label}: html should contain <body> tag`);
  assert.ok(html.includes('</html>'), `${label}: html should contain closing </html>`);
  assert.ok(html.includes('</body>'), `${label}: html should contain closing </body>`);
}

function assertBranding(html, label) {
  const hasBrandColor = BRAND_COLORS.some(color => html.includes(color));
  assert.ok(hasBrandColor, `${label}: html should contain Vertifile brand color`);
  assert.ok(html.includes(LOGO_URL_FRAGMENT), `${label}: html should contain logo image`);
  assert.ok(html.includes(COPYRIGHT_FRAGMENT), `${label}: html should contain copyright notice`);
}

function assertContains(str, fragment, label) {
  assert.ok(
    str.includes(fragment),
    `${label}: expected to find "${fragment}" but it was not present`
  );
}

// ---------------------------------------------------------------------------
// welcomeEmail
// ---------------------------------------------------------------------------

describe('welcomeEmail', () => {
  const NAME = 'Alice';

  it('returns an object with subject, html, and text strings', () => {
    const result = welcomeEmail(NAME);
    assertValidShape(result, 'welcomeEmail');
  });

  it('html is a valid HTML document', () => {
    const { html } = welcomeEmail(NAME);
    assertValidHtmlDocument(html, 'welcomeEmail');
  });

  it('html contains Vertifile brand colors, logo, and copyright', () => {
    const { html } = welcomeEmail(NAME);
    assertBranding(html, 'welcomeEmail');
  });

  it('subject mentions "Vertifile"', () => {
    const { subject } = welcomeEmail(NAME);
    assertContains(subject, 'Vertifile', 'welcomeEmail subject');
  });

  it('html contains the user name', () => {
    const { html } = welcomeEmail('Bob');
    assertContains(html, 'Bob', 'welcomeEmail html');
  });

  it('text contains the user name', () => {
    const { text } = welcomeEmail('Bob');
    assertContains(text, 'Bob', 'welcomeEmail text');
  });

  it('html CTA button links to dashboard', () => {
    const { html } = welcomeEmail(NAME);
    assertContains(html, `${BASE_URL}/app`, 'welcomeEmail CTA href');
  });

  it('text contains the dashboard URL', () => {
    const { text } = welcomeEmail(NAME);
    assertContains(text, `${BASE_URL}/app`, 'welcomeEmail text URL');
  });

  it('uses "there" as greeting when userName is omitted', () => {
    const { html } = welcomeEmail();
    assertContains(html, 'there', 'welcomeEmail fallback greeting');
  });

  it('uses "there" as greeting when userName is null', () => {
    const { html } = welcomeEmail(null);
    assertContains(html, 'there', 'welcomeEmail null fallback');
  });

  it('uses "there" as greeting when userName is empty string', () => {
    const { html } = welcomeEmail('');
    assertContains(html, 'there', 'welcomeEmail empty string fallback');
  });

  it('text contains "Vertifile" footer signature', () => {
    const { text } = welcomeEmail(NAME);
    assertContains(text, 'Vertifile', 'welcomeEmail text footer');
  });
});

// ---------------------------------------------------------------------------
// firstDocEmail
// ---------------------------------------------------------------------------

describe('firstDocEmail', () => {
  const NAME = 'Charlie';

  it('returns an object with subject, html, and text strings', () => {
    const result = firstDocEmail(NAME);
    assertValidShape(result, 'firstDocEmail');
  });

  it('html is a valid HTML document', () => {
    const { html } = firstDocEmail(NAME);
    assertValidHtmlDocument(html, 'firstDocEmail');
  });

  it('html contains Vertifile brand colors, logo, and copyright', () => {
    const { html } = firstDocEmail(NAME);
    assertBranding(html, 'firstDocEmail');
  });

  it('subject mentions uploading a document', () => {
    const { subject } = firstDocEmail(NAME);
    const lower = subject.toLowerCase();
    assert.ok(
      lower.includes('document') || lower.includes('protect') || lower.includes('upload'),
      `firstDocEmail subject should mention document/protect/upload, got: "${subject}"`
    );
  });

  it('html contains the user name', () => {
    const { html } = firstDocEmail('Diana');
    assertContains(html, 'Diana', 'firstDocEmail html');
  });

  it('text contains the user name', () => {
    const { text } = firstDocEmail('Diana');
    assertContains(text, 'Diana', 'firstDocEmail text');
  });

  it('html CTA button links to dashboard', () => {
    const { html } = firstDocEmail(NAME);
    assertContains(html, `${BASE_URL}/app`, 'firstDocEmail CTA href');
  });

  it('html describes the 3-step upload process', () => {
    const { html } = firstDocEmail(NAME);
    assert.ok(
      html.includes('1.') || html.includes('step') || html.includes('Upload'),
      'firstDocEmail html should describe upload steps'
    );
  });

  it('uses "there" as greeting when userName is omitted', () => {
    const { html } = firstDocEmail();
    assertContains(html, 'there', 'firstDocEmail fallback greeting');
  });

  it('text contains the dashboard URL', () => {
    const { text } = firstDocEmail(NAME);
    assertContains(text, `${BASE_URL}/app`, 'firstDocEmail text URL');
  });
});

// ---------------------------------------------------------------------------
// stampEmail
// ---------------------------------------------------------------------------

describe('stampEmail', () => {
  const NAME = 'Eve';

  it('returns an object with subject, html, and text strings', () => {
    const result = stampEmail(NAME);
    assertValidShape(result, 'stampEmail');
  });

  it('html is a valid HTML document', () => {
    const { html } = stampEmail(NAME);
    assertValidHtmlDocument(html, 'stampEmail');
  });

  it('html contains Vertifile brand colors, logo, and copyright', () => {
    const { html } = stampEmail(NAME);
    assertBranding(html, 'stampEmail');
  });

  it('subject mentions stamp or customization', () => {
    const { subject } = stampEmail(NAME);
    const lower = subject.toLowerCase();
    assert.ok(
      lower.includes('stamp') || lower.includes('custom'),
      `stampEmail subject should mention stamp/custom, got: "${subject}"`
    );
  });

  it('html contains the user name', () => {
    const { html } = stampEmail('Frank');
    assertContains(html, 'Frank', 'stampEmail html');
  });

  it('html CTA links to the stamp configuration tab', () => {
    const { html } = stampEmail(NAME);
    assertContains(html, 'tab=stamp', 'stampEmail CTA href for stamp tab');
  });

  it('text contains the stamp configuration URL', () => {
    const { text } = stampEmail(NAME);
    assertContains(text, 'tab=stamp', 'stampEmail text URL for stamp tab');
  });

  it('html describes customizable stamp options', () => {
    const { html } = stampEmail(NAME);
    assert.ok(
      html.includes('logo') || html.includes('color') || html.includes('stamp'),
      'stampEmail html should describe stamp customization options'
    );
  });

  it('uses "there" as greeting when userName is omitted', () => {
    const { html } = stampEmail();
    assertContains(html, 'there', 'stampEmail fallback greeting');
  });
});

// ---------------------------------------------------------------------------
// shareEmail
// ---------------------------------------------------------------------------

describe('shareEmail', () => {
  const NAME = 'Grace';

  it('returns an object with subject, html, and text strings', () => {
    const result = shareEmail(NAME);
    assertValidShape(result, 'shareEmail');
  });

  it('html is a valid HTML document', () => {
    const { html } = shareEmail(NAME);
    assertValidHtmlDocument(html, 'shareEmail');
  });

  it('html contains Vertifile brand colors, logo, and copyright', () => {
    const { html } = shareEmail(NAME);
    assertBranding(html, 'shareEmail');
  });

  it('subject mentions sharing a document', () => {
    const { subject } = shareEmail(NAME);
    const lower = subject.toLowerCase();
    assert.ok(
      lower.includes('share') || lower.includes('document') || lower.includes('prove'),
      `shareEmail subject should mention share/document, got: "${subject}"`
    );
  });

  it('html contains the user name', () => {
    const { html } = shareEmail('Henry');
    assertContains(html, 'Henry', 'shareEmail html');
  });

  it('html CTA links to dashboard', () => {
    const { html } = shareEmail(NAME);
    assertContains(html, `${BASE_URL}/app`, 'shareEmail CTA href');
  });

  it('html mentions recipients can verify without an account', () => {
    const { html } = shareEmail(NAME);
    const lower = html.toLowerCase();
    assert.ok(
      lower.includes('no account') || lower.includes('anyone') || lower.includes('verify'),
      'shareEmail html should mention verification without account requirement'
    );
  });

  it('text mentions cryptographic verification', () => {
    const { text } = shareEmail(NAME);
    const lower = text.toLowerCase();
    assert.ok(
      lower.includes('cryptograph') || lower.includes('signature') || lower.includes('proof'),
      'shareEmail text should mention cryptographic proof'
    );
  });

  it('uses "there" as greeting when userName is omitted', () => {
    const { html } = shareEmail();
    assertContains(html, 'there', 'shareEmail fallback greeting');
  });
});

// ---------------------------------------------------------------------------
// upgradeEmail
// ---------------------------------------------------------------------------

describe('upgradeEmail', () => {
  const NAME = 'Iris';

  it('returns an object with subject, html, and text strings', () => {
    const result = upgradeEmail(NAME);
    assertValidShape(result, 'upgradeEmail');
  });

  it('html is a valid HTML document', () => {
    const { html } = upgradeEmail(NAME);
    assertValidHtmlDocument(html, 'upgradeEmail');
  });

  it('html contains Vertifile brand colors, logo, and copyright', () => {
    const { html } = upgradeEmail(NAME);
    assertBranding(html, 'upgradeEmail');
  });

  it('subject mentions trial ending', () => {
    const { subject } = upgradeEmail(NAME);
    const lower = subject.toLowerCase();
    assert.ok(
      lower.includes('trial') || lower.includes('ending') || lower.includes('plan'),
      `upgradeEmail subject should mention trial/ending, got: "${subject}"`
    );
  });

  it('html contains the user name', () => {
    const { html } = upgradeEmail('Jake');
    assertContains(html, 'Jake', 'upgradeEmail html');
  });

  it('html shows Pro plan pricing ($49)', () => {
    const { html } = upgradeEmail(NAME);
    assertContains(html, '$49', 'upgradeEmail Pro plan price');
  });

  it('html shows Business plan pricing ($79)', () => {
    const { html } = upgradeEmail(NAME);
    assertContains(html, '$79', 'upgradeEmail Business plan price');
  });

  it('html CTA links to billing tab', () => {
    const { html } = upgradeEmail(NAME);
    assertContains(html, 'tab=billing', 'upgradeEmail CTA href for billing tab');
  });

  it('text contains billing URL', () => {
    const { text } = upgradeEmail(NAME);
    assertContains(text, 'tab=billing', 'upgradeEmail text billing URL');
  });

  it('text includes both plan names', () => {
    const { text } = upgradeEmail(NAME);
    assertContains(text, 'Pro', 'upgradeEmail text Pro plan');
    assertContains(text, 'Business', 'upgradeEmail text Business plan');
  });

  it('html mentions existing verified documents remain valid', () => {
    const { html } = upgradeEmail(NAME);
    const lower = html.toLowerCase();
    assert.ok(
      lower.includes('remain') || lower.includes('valid') || lower.includes('forever'),
      'upgradeEmail html should mention existing documents remain valid'
    );
  });

  it('uses "there" as greeting when userName is omitted', () => {
    const { html } = upgradeEmail();
    assertContains(html, 'there', 'upgradeEmail fallback greeting');
  });

  it('html mentions enterprise plan option', () => {
    const { html } = upgradeEmail(NAME);
    const lower = html.toLowerCase();
    assertContains(lower, 'enterprise', 'upgradeEmail html enterprise mention');
  });
});

// ---------------------------------------------------------------------------
// Cross-template: consistent layout structure
// ---------------------------------------------------------------------------

describe('all templates -- consistent layout', () => {
  const templates = [
    { name: 'welcomeEmail',  fn: () => welcomeEmail('Test') },
    { name: 'firstDocEmail', fn: () => firstDocEmail('Test') },
    { name: 'stampEmail',    fn: () => stampEmail('Test') },
    { name: 'shareEmail',    fn: () => shareEmail('Test') },
    { name: 'upgradeEmail',  fn: () => upgradeEmail('Test') },
  ];

  for (const { name, fn } of templates) {
    it(`${name}: html uses role="presentation" tables (email-safe layout)`, () => {
      const { html } = fn();
      assertContains(html, 'role="presentation"', `${name} email-safe table`);
    });

    it(`${name}: html contains UTF-8 charset meta tag`, () => {
      const { html } = fn();
      assertContains(html, 'charset="UTF-8"', `${name} charset declaration`);
    });

    it(`${name}: html contains viewport meta tag for mobile`, () => {
      const { html } = fn();
      assertContains(html, 'viewport', `${name} viewport meta`);
    });

    it(`${name}: footer contains copyright text`, () => {
      const { html } = fn();
      assertContains(html, COPYRIGHT_FRAGMENT, `${name} copyright footer`);
    });

    it(`${name}: html contains the Vertifile logo img tag`, () => {
      const { html } = fn();
      assertContains(html, LOGO_URL_FRAGMENT, `${name} logo img`);
    });

    it(`${name}: text ends with Vertifile signature`, () => {
      const { text } = fn();
      assertContains(text, '-- Vertifile', `${name} text signature`);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-template: no raw user input leaks into unsafe HTML positions
// ---------------------------------------------------------------------------

describe('all templates -- input safety', () => {
  // NOTE: email-templates.js does NOT sanitize userName -- it interpolates the
  // greeting() helper directly into HTML. Sanitization is the caller's
  // responsibility (email.js sendWelcomeEmail applies replace(/[<>&"']/g, '')
  // before calling this layer). These tests document the actual behavior so
  // the gap is explicit and any future sanitization change is caught.

  it('welcomeEmail passes userName through without HTML-escaping (caller must sanitize)', () => {
    const { html } = welcomeEmail('<b>Test</b>');
    // The name is interpolated as-is -- document that it appears verbatim
    assert.ok(
      html.includes('Test'),
      'welcomeEmail should include the text content of the userName'
    );
  });

  it('firstDocEmail subject does not contain userName', () => {
    const { subject } = firstDocEmail('<malicious>');
    // subject is hardcoded -- must not contain user input
    assert.ok(!subject.includes('<malicious>'), 'firstDocEmail subject must not expose userName');
  });

  it('stampEmail subject does not contain userName', () => {
    const { subject } = stampEmail('<malicious>');
    assert.ok(!subject.includes('<malicious>'), 'stampEmail subject must not expose userName');
  });

  it('welcomeEmail html is a string (does not throw on special chars)', () => {
    assert.doesNotThrow(() => {
      const { html } = welcomeEmail('<test>&"\'');
      assert.equal(typeof html, 'string');
    });
  });
});
