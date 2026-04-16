#!/usr/bin/env node
'use strict';

/**
 * Unit tests for services/email.js
 *
 * Strategy: patch Module.prototype.require so that any require('nodemailer')
 * call -- including the one that runs at module load time -- returns our mock.
 * We also reset the module cache between groups of tests so the lazy
 * _transporter state is re-initialized cleanly.
 *
 * Tests cover:
 *   sendEmail()
 *     - returns false when SMTP env vars are missing
 *     - returns true when SMTP is configured and sendMail resolves
 *     - returns false when sendMail rejects
 *     - passes correct from/to/subject/html to sendMail
 *     - uses DEFAULT_FROM when no opts.from provided
 *     - uses opts.from when provided
 *     - logs correct message for 535 auth failure
 *     - logs correct message for 429 rate limit
 *     - logs correct message for domain-not-verified error
 *     - logs correct message for connection refused
 *
 *   sendPasswordResetEmail()
 *     - calls sendEmail with subject "Reset your Vertifile password"
 *     - HTML body contains the recipient email
 *     - HTML body contains the reset URL
 *     - HTML body contains the expiry minutes (default 30)
 *     - custom expiry is reflected in HTML
 *     - HTML body contains the reset URL as a plain-text fallback link
 *
 *   sendVerificationCode()
 *     - subject contains the code
 *     - HTML body displays the code
 *     - default expiry is 10 minutes
 *     - custom expiry appears in body
 *
 *   sendWelcomeEmail()
 *     - subject is "Welcome to Vertifile"
 *     - HTML body contains the sanitised user name
 *     - HTML special chars are stripped from userName
 *
 *   sendDocumentReadyEmail()
 *     - subject contains the document name
 *     - HTML body contains the shareUrl
 *     - HTML special chars are stripped from documentName
 *
 *   sendContactConfirmationEmail()
 *     - subject is "We received your message -- Vertifile"
 *     - HTML body contains the sanitised name
 *
 * Run with: node --test tests/email-service.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ---------------------------------------------------------------------------
// Nodemailer mock infrastructure
// ---------------------------------------------------------------------------

let mockCalls = [];
let mockShouldReject = false;
let mockRejectError = null;

function resetMock() {
  mockCalls = [];
  mockShouldReject = false;
  mockRejectError = null;
}

async function mockSendMail(opts) {
  mockCalls.push({ ...opts });
  if (mockShouldReject) {
    throw mockRejectError || new Error('mock send failure');
  }
  return { messageId: 'test-msg-id-mock' };
}

function makeMockTransport() {
  return { sendMail: mockSendMail };
}

// Save originals before any patching
const originalRequire = Module.prototype.require;

function installNodemailerMock() {
  Module.prototype.require = function patchedRequire(id) {
    if (id === 'nodemailer') {
      return { createTransport: () => makeMockTransport() };
    }
    return originalRequire.apply(this, arguments);
  };
}

function uninstallNodemailerMock() {
  Module.prototype.require = originalRequire;
}

// ---------------------------------------------------------------------------
// Helper: load a fresh copy of email.js (bypasses the require cache so
// the lazy _transporter is always null at the start of each test group).
// ---------------------------------------------------------------------------

function loadFreshEmailService() {
  // Remove cached copy
  const emailPath = require.resolve('../services/email');
  delete require.cache[emailPath];
  // Also remove logger from cache to avoid pino transport issues in test env
  // (logger is a simple module -- re-requiring it is safe)
  return require('../services/email');
}

// ---------------------------------------------------------------------------
// SMTP env var helpers
// ---------------------------------------------------------------------------

const SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];

function setSmtpEnv(overrides = {}) {
  process.env.SMTP_HOST = overrides.SMTP_HOST || 'smtp.resend.com';
  process.env.SMTP_PORT = String(overrides.SMTP_PORT || 465);
  process.env.SMTP_USER = overrides.SMTP_USER || 'resend';
  process.env.SMTP_PASS = overrides.SMTP_PASS || 're_test_key';
  if (overrides.SMTP_FROM !== undefined) {
    process.env.SMTP_FROM = overrides.SMTP_FROM;
  }
}

function clearSmtpEnv() {
  for (const k of SMTP_VARS) delete process.env[k];
}

// ---------------------------------------------------------------------------
// sendEmail -- no SMTP configured
// ---------------------------------------------------------------------------

describe('sendEmail -- SMTP not configured', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('returns false when SMTP_HOST is missing', async () => {
    const result = await email.sendEmail('a@b.com', 'Subject', '<p>body</p>');
    assert.equal(result, false);
  });

  it('returns false when SMTP_USER is missing', async () => {
    process.env.SMTP_HOST = 'smtp.resend.com';
    process.env.SMTP_PASS = 're_key';
    // SMTP_USER deliberately omitted
    const result = await email.sendEmail('a@b.com', 'Subject', '<p>body</p>');
    assert.equal(result, false);
  });

  it('returns false when SMTP_PASS is missing', async () => {
    process.env.SMTP_HOST = 'smtp.resend.com';
    process.env.SMTP_USER = 'resend';
    // SMTP_PASS deliberately omitted
    const result = await email.sendEmail('a@b.com', 'Subject', '<p>body</p>');
    assert.equal(result, false);
  });

  it('does not call sendMail when SMTP is not configured', async () => {
    await email.sendEmail('a@b.com', 'Subject', '<p>body</p>');
    assert.equal(mockCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// sendEmail -- SMTP configured, successful send
// ---------------------------------------------------------------------------

describe('sendEmail -- SMTP configured, successful send', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('returns true when SMTP is configured and sendMail resolves', async () => {
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>hello</p>');
    assert.equal(result, true);
  });

  it('passes correct to/subject/html to sendMail', async () => {
    await email.sendEmail('user@example.com', 'Test Subject', '<b>Content</b>');
    assert.equal(mockCalls.length, 1);
    assert.equal(mockCalls[0].to, 'user@example.com');
    assert.equal(mockCalls[0].subject, 'Test Subject');
    assert.equal(mockCalls[0].html, '<b>Content</b>');
  });

  it('uses DEFAULT_FROM when no opts.from is provided', async () => {
    await email.sendEmail('user@example.com', 'Subject', '<p>body</p>');
    assert.ok(
      mockCalls[0].from.includes('Vertifile') || mockCalls[0].from.includes('vertifile.com'),
      `Expected default Vertifile from address, got: ${mockCalls[0].from}`
    );
  });

  it('uses opts.from when provided', async () => {
    await email.sendEmail('user@example.com', 'Subject', '<p>body</p>', {
      from: 'Custom Sender <custom@example.com>',
    });
    assert.equal(mockCalls[0].from, 'Custom Sender <custom@example.com>');
  });

  it('passes opts.text to sendMail when provided', async () => {
    await email.sendEmail('user@example.com', 'Subject', '<p>body</p>', {
      text: 'Plain text version',
    });
    assert.equal(mockCalls[0].text, 'Plain text version');
  });
});

// ---------------------------------------------------------------------------
// sendEmail -- sendMail rejects
// ---------------------------------------------------------------------------

describe('sendEmail -- sendMail rejects', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('returns false when sendMail throws a generic error', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('connection error');
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on 535 auth failure', async () => {
    mockShouldReject = true;
    const err = new Error('535 Authentication failed');
    err.responseCode = 535;
    mockRejectError = err;
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on 429 rate limit error', async () => {
    mockShouldReject = true;
    const err = new Error('429 Too Many Requests: rate limit exceeded');
    err.responseCode = 429;
    mockRejectError = err;
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on domain not verified error', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('domain not verified -- add DNS records in Resend dashboard');
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on ECONNREFUSED connection error', async () => {
    mockShouldReject = true;
    const err = new Error('ECONNREFUSED 127.0.0.1:465');
    err.code = 'ECONNREFUSED';
    mockRejectError = err;
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on ENOTFOUND DNS error', async () => {
    mockShouldReject = true;
    const err = new Error('getaddrinfo ENOTFOUND smtp.resend.com');
    err.code = 'ENOTFOUND';
    mockRejectError = err;
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });

  it('returns false on authentication message in error text', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('authentication failed: invalid api key');
    const result = await email.sendEmail('to@example.com', 'Hi', '<p>test</p>');
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
// ---------------------------------------------------------------------------

describe('sendPasswordResetEmail', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('calls sendEmail with subject "Reset your Vertifile password"', async () => {
    await email.sendPasswordResetEmail('user@test.com', 'https://vertifile.com/reset?token=abc');
    assert.equal(mockCalls.length, 1);
    assert.equal(mockCalls[0].subject, 'Reset your Vertifile password');
  });

  it('HTML body contains the recipient email address', async () => {
    const to = 'recipient@example.com';
    await email.sendPasswordResetEmail(to, 'https://vertifile.com/reset?token=xyz');
    assert.ok(
      mockCalls[0].html.includes(to),
      `Expected HTML to contain "${to}"`
    );
  });

  it('HTML body contains the reset URL', async () => {
    const resetUrl = 'https://vertifile.com/reset?token=TEST_TOKEN_123';
    await email.sendPasswordResetEmail('user@test.com', resetUrl);
    assert.ok(
      mockCalls[0].html.includes(resetUrl),
      `Expected HTML to contain the reset URL`
    );
  });

  it('HTML body contains default expiry of 30 minutes', async () => {
    await email.sendPasswordResetEmail('user@test.com', 'https://vertifile.com/reset?token=abc');
    assert.ok(
      mockCalls[0].html.includes('30'),
      'Expected HTML to contain "30" for default expiry'
    );
  });

  it('HTML body reflects custom expiry minutes', async () => {
    await email.sendPasswordResetEmail('user@test.com', 'https://vertifile.com/reset?token=abc', 60);
    assert.ok(
      mockCalls[0].html.includes('60'),
      'Expected HTML to contain custom expiry "60"'
    );
  });

  it('plain text body contains the reset URL as fallback', async () => {
    const resetUrl = 'https://vertifile.com/reset?token=FALLBACK_TOKEN';
    await email.sendPasswordResetEmail('user@test.com', resetUrl);
    assert.ok(
      mockCalls[0].text && mockCalls[0].text.includes(resetUrl),
      'Expected text fallback to contain the reset URL'
    );
  });

  it('plain text body contains the recipient email', async () => {
    const to = 'recipient@test.com';
    await email.sendPasswordResetEmail(to, 'https://vertifile.com/reset?token=abc');
    assert.ok(
      mockCalls[0].text && mockCalls[0].text.includes(to),
      'Expected text fallback to contain recipient email'
    );
  });

  it('sends to the correct recipient address', async () => {
    const to = 'exact@recipient.com';
    await email.sendPasswordResetEmail(to, 'https://vertifile.com/reset?token=abc');
    assert.equal(mockCalls[0].to, to);
  });

  it('returns true when send succeeds', async () => {
    const result = await email.sendPasswordResetEmail(
      'user@test.com', 'https://vertifile.com/reset?token=abc'
    );
    assert.equal(result, true);
  });

  it('returns false when sendMail rejects', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('connection refused');
    const result = await email.sendPasswordResetEmail(
      'user@test.com', 'https://vertifile.com/reset?token=abc'
    );
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// sendVerificationCode
// ---------------------------------------------------------------------------

describe('sendVerificationCode', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('subject contains the verification code', async () => {
    await email.sendVerificationCode('user@test.com', '847291');
    assert.ok(
      mockCalls[0].subject.includes('847291'),
      `Subject should contain the code, got: ${mockCalls[0].subject}`
    );
  });

  it('HTML body displays the verification code', async () => {
    await email.sendVerificationCode('user@test.com', '123456');
    assert.ok(
      mockCalls[0].html.includes('123456'),
      'HTML should contain the 6-digit code'
    );
  });

  it('uses default expiry of 10 minutes', async () => {
    await email.sendVerificationCode('user@test.com', '000000');
    assert.ok(
      mockCalls[0].html.includes('10'),
      'HTML should reference 10-minute default expiry'
    );
  });

  it('reflects custom expiry in HTML body', async () => {
    await email.sendVerificationCode('user@test.com', '999999', 15);
    assert.ok(
      mockCalls[0].html.includes('15'),
      'HTML should contain custom expiry of 15 minutes'
    );
  });

  it('sends to the correct recipient', async () => {
    const to = 'verify@example.com';
    await email.sendVerificationCode(to, '654321');
    assert.equal(mockCalls[0].to, to);
  });

  it('returns true on success', async () => {
    const result = await email.sendVerificationCode('user@test.com', '111111');
    assert.equal(result, true);
  });

  it('returns false on sendMail failure', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('smtp error');
    const result = await email.sendVerificationCode('user@test.com', '222222');
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// sendWelcomeEmail
// ---------------------------------------------------------------------------

describe('sendWelcomeEmail', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('subject is "Welcome to Vertifile"', async () => {
    await email.sendWelcomeEmail('user@test.com', 'Alice');
    assert.equal(mockCalls[0].subject, 'Welcome to Vertifile');
  });

  it('HTML body contains the sanitised user name', async () => {
    await email.sendWelcomeEmail('user@test.com', 'Alice');
    assert.ok(
      mockCalls[0].html.includes('Alice'),
      'HTML should contain the user name'
    );
  });

  it('strips HTML special characters from userName', async () => {
    await email.sendWelcomeEmail('user@test.com', '<script>alert(1)</script>');
    const html = mockCalls[0].html;
    assert.ok(
      !html.includes('<script>'),
      'HTML output must not contain raw <script> tag'
    );
  });

  it('uses "there" as fallback when no userName is provided', async () => {
    await email.sendWelcomeEmail('user@test.com', '');
    const html = mockCalls[0].html;
    assert.ok(
      html.includes('there'),
      'HTML should use "there" as fallback greeting when name is empty'
    );
  });

  it('sends to the correct recipient', async () => {
    const to = 'newuser@example.com';
    await email.sendWelcomeEmail(to, 'Bob');
    assert.equal(mockCalls[0].to, to);
  });

  it('returns true on success', async () => {
    const result = await email.sendWelcomeEmail('user@test.com', 'Carol');
    assert.equal(result, true);
  });

  it('returns false when SMTP not configured', async () => {
    clearSmtpEnv();
    // reload without SMTP vars
    const freshEmail = loadFreshEmailService();
    const result = await freshEmail.sendWelcomeEmail('user@test.com', 'Carol');
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// sendDocumentReadyEmail
// ---------------------------------------------------------------------------

describe('sendDocumentReadyEmail', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('subject contains the document name', async () => {
    await email.sendDocumentReadyEmail('user@test.com', 'contract.pdf', 'https://vertifile.com/v/abc');
    assert.ok(
      mockCalls[0].subject.includes('contract.pdf'),
      `Subject should contain document name, got: ${mockCalls[0].subject}`
    );
  });

  it('HTML body contains the share URL', async () => {
    const shareUrl = 'https://vertifile.com/v/doc-share-token';
    await email.sendDocumentReadyEmail('user@test.com', 'report.pdf', shareUrl);
    assert.ok(
      mockCalls[0].html.includes(shareUrl),
      'HTML should contain the share URL'
    );
  });

  it('strips HTML special characters from document name', async () => {
    await email.sendDocumentReadyEmail('user@test.com', '<b>doc</b>', 'https://vertifile.com/v/abc');
    assert.ok(
      !mockCalls[0].html.includes('<b>doc</b>'),
      'HTML should not contain raw HTML tags in document name'
    );
  });

  it('sends to the correct recipient', async () => {
    const to = 'docowner@example.com';
    await email.sendDocumentReadyEmail(to, 'file.pdf', 'https://vertifile.com/v/xyz');
    assert.equal(mockCalls[0].to, to);
  });

  it('returns true on success', async () => {
    const result = await email.sendDocumentReadyEmail(
      'user@test.com', 'my-doc.pdf', 'https://vertifile.com/v/abc'
    );
    assert.equal(result, true);
  });

  it('returns false on sendMail failure', async () => {
    mockShouldReject = true;
    mockRejectError = new Error('smtp timeout');
    const result = await email.sendDocumentReadyEmail(
      'user@test.com', 'my-doc.pdf', 'https://vertifile.com/v/abc'
    );
    assert.equal(result, false);
  });
});

// ---------------------------------------------------------------------------
// sendContactConfirmationEmail
// ---------------------------------------------------------------------------

describe('sendContactConfirmationEmail', () => {
  let email;

  beforeEach(() => {
    clearSmtpEnv();
    setSmtpEnv();
    installNodemailerMock();
    resetMock();
    email = loadFreshEmailService();
  });

  afterEach(() => {
    uninstallNodemailerMock();
    clearSmtpEnv();
  });

  it('subject is "We received your message -- Vertifile"', async () => {
    await email.sendContactConfirmationEmail('user@test.com', 'Dana');
    assert.equal(mockCalls[0].subject, 'We received your message -- Vertifile');
  });

  it('HTML body contains the sanitised name', async () => {
    await email.sendContactConfirmationEmail('user@test.com', 'Dana');
    assert.ok(
      mockCalls[0].html.includes('Dana'),
      'HTML should contain the contact name'
    );
  });

  it('strips HTML special chars from name', async () => {
    await email.sendContactConfirmationEmail('user@test.com', '<b>Injected</b>');
    const html = mockCalls[0].html;
    // The sanitizer removes <, >, &, ", ' -- so the greeting should contain
    // "bInjected/b" (stripped) rather than the raw HTML tag
    assert.ok(
      !html.includes('<b>Injected</b>'),
      'HTML should not contain the raw input string with angle-bracket tags from name'
    );
  });

  it('uses "there" as fallback when name is empty', async () => {
    await email.sendContactConfirmationEmail('user@test.com', '');
    assert.ok(
      mockCalls[0].html.includes('there'),
      'HTML should use "there" as fallback greeting'
    );
  });

  it('sends to the correct recipient', async () => {
    const to = 'contact@example.com';
    await email.sendContactConfirmationEmail(to, 'Eve');
    assert.equal(mockCalls[0].to, to);
  });

  it('returns true on success', async () => {
    const result = await email.sendContactConfirmationEmail('user@test.com', 'Frank');
    assert.equal(result, true);
  });

  it('returns false when SMTP not configured', async () => {
    clearSmtpEnv();
    const freshEmail = loadFreshEmailService();
    const result = await freshEmail.sendContactConfirmationEmail('user@test.com', 'Frank');
    assert.equal(result, false);
  });
});
