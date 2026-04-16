#!/usr/bin/env node
'use strict';

/**
 * Vertifile — SSRF Protection Unit Tests
 *
 * Tests the isPrivateIP and isValidWebhookUrl functions exported from
 * routes/webhooks.js.
 *
 * Uses Node.js built-in test runner (node:test) and assert (node:assert).
 * Run with:   node tests/webhook-security.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Set PORT=0 before loading the module so isValidWebhookUrl skips DNS
// resolution. This keeps tests deterministic in offline / CI environments.
// ---------------------------------------------------------------------------
process.env.PORT = '0';

const { isPrivateIP, isValidWebhookUrl } = require(
  path.resolve(__dirname, '../routes/webhooks.js')
);

// ---------------------------------------------------------------------------
// isPrivateIP
// ---------------------------------------------------------------------------
describe('isPrivateIP', () => {

  describe('invalid / missing input', () => {
    it('returns true for null', () => {
      assert.equal(isPrivateIP(null), true);
    });

    it('returns true for undefined', () => {
      assert.equal(isPrivateIP(undefined), true);
    });

    it('returns true for empty string', () => {
      assert.equal(isPrivateIP(''), true);
    });

    it('returns true for a non-string number', () => {
      assert.equal(isPrivateIP(8888), true);
    });

    it('returns true for a non-string object', () => {
      assert.equal(isPrivateIP({}), true);
    });
  });

  describe('loopback — 127.x.x.x', () => {
    it('returns true for 127.0.0.1', () => {
      assert.equal(isPrivateIP('127.0.0.1'), true);
    });

    it('returns true for 127.0.0.0', () => {
      assert.equal(isPrivateIP('127.0.0.0'), true);
    });

    it('returns true for 127.255.255.255', () => {
      assert.equal(isPrivateIP('127.255.255.255'), true);
    });

    it('returns true for 127.1.2.3', () => {
      assert.equal(isPrivateIP('127.1.2.3'), true);
    });
  });

  describe('Class A private — 10.x.x.x', () => {
    it('returns true for 10.0.0.0', () => {
      assert.equal(isPrivateIP('10.0.0.0'), true);
    });

    it('returns true for 10.0.0.1', () => {
      assert.equal(isPrivateIP('10.0.0.1'), true);
    });

    it('returns true for 10.255.255.255', () => {
      assert.equal(isPrivateIP('10.255.255.255'), true);
    });

    it('returns true for 10.123.45.67', () => {
      assert.equal(isPrivateIP('10.123.45.67'), true);
    });
  });

  describe('Class B private — 172.16.0.0/12', () => {
    it('returns true for 172.16.0.0 (start of range)', () => {
      assert.equal(isPrivateIP('172.16.0.0'), true);
    });

    it('returns true for 172.16.0.1', () => {
      assert.equal(isPrivateIP('172.16.0.1'), true);
    });

    it('returns true for 172.24.0.1 (middle of range)', () => {
      assert.equal(isPrivateIP('172.24.0.1'), true);
    });

    it('returns true for 172.31.255.255 (end of range)', () => {
      assert.equal(isPrivateIP('172.31.255.255'), true);
    });

    it('returns false for 172.15.255.255 (just below range)', () => {
      assert.equal(isPrivateIP('172.15.255.255'), false);
    });

    it('returns false for 172.32.0.0 (just above range)', () => {
      assert.equal(isPrivateIP('172.32.0.0'), false);
    });

    it('returns false for 172.15.0.1', () => {
      assert.equal(isPrivateIP('172.15.0.1'), false);
    });

    it('returns false for 172.32.1.1', () => {
      assert.equal(isPrivateIP('172.32.1.1'), false);
    });
  });

  describe('Class C private — 192.168.x.x', () => {
    it('returns true for 192.168.0.0', () => {
      assert.equal(isPrivateIP('192.168.0.0'), true);
    });

    it('returns true for 192.168.1.1', () => {
      assert.equal(isPrivateIP('192.168.1.1'), true);
    });

    it('returns true for 192.168.255.255', () => {
      assert.equal(isPrivateIP('192.168.255.255'), true);
    });
  });

  describe('link-local — 169.254.x.x', () => {
    it('returns true for 169.254.0.0', () => {
      assert.equal(isPrivateIP('169.254.0.0'), true);
    });

    it('returns true for 169.254.169.254 (AWS metadata endpoint)', () => {
      assert.equal(isPrivateIP('169.254.169.254'), true);
    });

    it('returns true for 169.254.255.255', () => {
      assert.equal(isPrivateIP('169.254.255.255'), true);
    });
  });

  describe('reserved 0.x.x.x block', () => {
    it('returns true for 0.0.0.0', () => {
      assert.equal(isPrivateIP('0.0.0.0'), true);
    });

    it('returns true for 0.0.0.1', () => {
      assert.equal(isPrivateIP('0.0.0.1'), true);
    });

    it('returns true for 0.255.255.255', () => {
      assert.equal(isPrivateIP('0.255.255.255'), true);
    });
  });

  describe('IPv6 loopback — ::1', () => {
    it('returns true for ::1', () => {
      assert.equal(isPrivateIP('::1'), true);
    });
  });

  describe('IPv6 link-local — fe80::', () => {
    it('returns true for fe80::1', () => {
      assert.equal(isPrivateIP('fe80::1'), true);
    });

    it('returns true for fe80:: (lowercase)', () => {
      assert.equal(isPrivateIP('fe80::'), true);
    });

    it('returns true for FE80::1 (uppercase)', () => {
      assert.equal(isPrivateIP('FE80::1'), true);
    });

    it('returns true for fe80:0:0:0:1:2:3:4', () => {
      assert.equal(isPrivateIP('fe80:0:0:0:1:2:3:4'), true);
    });
  });

  describe('IPv6 unique-local — fc00:: and fd::', () => {
    it('returns true for fc00::1', () => {
      assert.equal(isPrivateIP('fc00::1'), true);
    });

    it('returns true for FC00::1 (uppercase)', () => {
      assert.equal(isPrivateIP('FC00::1'), true);
    });

    it('returns true for fd00::1', () => {
      assert.equal(isPrivateIP('fd00::1'), true);
    });

    it('returns true for fd12:3456:789a::1', () => {
      assert.equal(isPrivateIP('fd12:3456:789a::1'), true);
    });

    it('returns true for FD::1 (uppercase fd)', () => {
      assert.equal(isPrivateIP('FD::1'), true);
    });
  });

  describe('public IP addresses — must return false', () => {
    it('returns false for 8.8.8.8 (Google DNS)', () => {
      assert.equal(isPrivateIP('8.8.8.8'), false);
    });

    it('returns false for 1.1.1.1 (Cloudflare DNS)', () => {
      assert.equal(isPrivateIP('1.1.1.1'), false);
    });

    it('returns false for 93.184.216.34 (example.com)', () => {
      assert.equal(isPrivateIP('93.184.216.34'), false);
    });

    it('returns false for 52.84.0.1 (AWS public range)', () => {
      assert.equal(isPrivateIP('52.84.0.1'), false);
    });

    it('returns false for 104.21.0.1 (Cloudflare public range)', () => {
      assert.equal(isPrivateIP('104.21.0.1'), false);
    });
  });

});

// ---------------------------------------------------------------------------
// isValidWebhookUrl
// ---------------------------------------------------------------------------
describe('isValidWebhookUrl', () => {

  // NOTE: process.env.PORT is already set to '0' at the top of this file,
  // so DNS resolution is skipped in all tests below.

  describe('non-string input', () => {
    it('returns false for null', async () => {
      assert.equal(await isValidWebhookUrl(null), false);
    });

    it('returns false for undefined', async () => {
      assert.equal(await isValidWebhookUrl(undefined), false);
    });

    it('returns false for a number', async () => {
      assert.equal(await isValidWebhookUrl(123), false);
    });

    it('returns false for a plain object', async () => {
      assert.equal(await isValidWebhookUrl({}), false);
    });
  });

  describe('empty string', () => {
    it('returns false for empty string', async () => {
      assert.equal(await isValidWebhookUrl(''), false);
    });
  });

  describe('URL length limit', () => {
    it('returns false for a URL longer than 2048 characters', async () => {
      const longPath = 'a'.repeat(2050);
      const url = 'https://hooks.example.com/' + longPath;
      assert.equal(await isValidWebhookUrl(url), false);
    });

    it('returns false for a URL exactly at 2049 characters', async () => {
      // Build a URL that is exactly 2049 chars
      const base = 'https://hooks.example.com/';
      const padding = 'x'.repeat(2049 - base.length);
      const url = base + padding;
      assert.equal(url.length, 2049);
      assert.equal(await isValidWebhookUrl(url), false);
    });
  });

  describe('protocol enforcement — must be https', () => {
    it('returns false for http:// URL', async () => {
      assert.equal(await isValidWebhookUrl('http://hooks.example.com/webhook'), false);
    });

    it('returns false for ftp:// URL', async () => {
      assert.equal(await isValidWebhookUrl('ftp://hooks.example.com/webhook'), false);
    });

    it('returns false for ws:// URL', async () => {
      assert.equal(await isValidWebhookUrl('ws://hooks.example.com/webhook'), false);
    });

    it('returns false for wss:// URL', async () => {
      assert.equal(await isValidWebhookUrl('wss://hooks.example.com/webhook'), false);
    });
  });

  describe('port restriction — only default 443 is allowed', () => {
    it('returns false for https on port 8080', async () => {
      assert.equal(await isValidWebhookUrl('https://hooks.example.com:8080/hook'), false);
    });

    it('returns false for https on port 8443', async () => {
      assert.equal(await isValidWebhookUrl('https://hooks.example.com:8443/hook'), false);
    });

    it('returns false for https on port 3000', async () => {
      assert.equal(await isValidWebhookUrl('https://hooks.example.com:3000/hook'), false);
    });

    it('returns false for https on port 80', async () => {
      assert.equal(await isValidWebhookUrl('https://hooks.example.com:80/hook'), false);
    });

    it('returns true for https with explicit port 443', async () => {
      // Port 443 is the default for https — browser normalises it away,
      // but parsed.port will be '443' when explicitly written.
      // The function allows '' or '443'.
      assert.equal(await isValidWebhookUrl('https://hooks.example.com:443/hook'), true);
    });
  });

  describe('URL credentials — must be rejected', () => {
    it('returns false for URL with username and password', async () => {
      assert.equal(
        await isValidWebhookUrl('https://user:pass@hooks.example.com/hook'),
        false
      );
    });

    it('returns false for URL with username only', async () => {
      assert.equal(
        await isValidWebhookUrl('https://user@hooks.example.com/hook'),
        false
      );
    });

    // Note: 'https://:@host/path' — the URL API normalises both username and
    // password to empty strings (falsy). The guard `parsed.username || parsed.password`
    // does not trigger on empty strings, so the URL is treated as credential-free.
    // This test documents that boundary explicitly.
    it('returns true for URL with empty username and password (no real credentials present)', async () => {
      assert.equal(
        await isValidWebhookUrl('https://:@hooks.example.com/hook'),
        true
      );
    });
  });

  describe('blocked hostnames — localhost variants', () => {
    it('returns false for "localhost"', async () => {
      assert.equal(await isValidWebhookUrl('https://localhost/hook'), false);
    });

    it('returns false for "127.0.0.1"', async () => {
      assert.equal(await isValidWebhookUrl('https://127.0.0.1/hook'), false);
    });

    it('returns false for "::1" (IPv6 loopback)', async () => {
      assert.equal(await isValidWebhookUrl('https://[::1]/hook'), false);
    });
  });

  describe('blocked TLDs — .internal, .local, .localhost', () => {
    it('returns false for *.internal hostname', async () => {
      assert.equal(await isValidWebhookUrl('https://service.internal/hook'), false);
    });

    it('returns false for *.local hostname', async () => {
      assert.equal(await isValidWebhookUrl('https://mydevbox.local/hook'), false);
    });

    it('returns false for *.localhost hostname', async () => {
      assert.equal(await isValidWebhookUrl('https://app.localhost/hook'), false);
    });

    it('returns false for deeply nested .internal', async () => {
      assert.equal(
        await isValidWebhookUrl('https://api.payments.internal/hook'),
        false
      );
    });
  });

  describe('hostname without a dot — no TLD', () => {
    it('returns false for single-label hostname "webhook"', async () => {
      assert.equal(await isValidWebhookUrl('https://webhook/hook'), false);
    });

    it('returns false for single-label "intranet"', async () => {
      assert.equal(await isValidWebhookUrl('https://intranet/hook'), false);
    });
  });

  describe('blocked IPv6 ranges in hostname', () => {
    it('returns false for fe80:: link-local in brackets', async () => {
      assert.equal(
        await isValidWebhookUrl('https://[fe80::1]/hook'),
        false
      );
    });

    it('returns false for fc00:: unique-local in brackets', async () => {
      assert.equal(
        await isValidWebhookUrl('https://[fc00::1]/hook'),
        false
      );
    });

    it('returns false for fd00:: unique-local in brackets', async () => {
      assert.equal(
        await isValidWebhookUrl('https://[fd00::1]/hook'),
        false
      );
    });
  });

  describe('private IPv4 as hostname', () => {
    it('returns false for 192.168.1.1', async () => {
      assert.equal(await isValidWebhookUrl('https://192.168.1.1/hook'), false);
    });

    it('returns false for 10.0.0.1', async () => {
      assert.equal(await isValidWebhookUrl('https://10.0.0.1/hook'), false);
    });

    it('returns false for 172.16.0.1', async () => {
      assert.equal(await isValidWebhookUrl('https://172.16.0.1/hook'), false);
    });

    it('returns false for 169.254.169.254 (AWS metadata)', async () => {
      assert.equal(
        await isValidWebhookUrl('https://169.254.169.254/latest/meta-data/'),
        false
      );
    });
  });

  describe('valid HTTPS URLs — must return true', () => {
    it('returns true for https://hooks.example.com/webhook', async () => {
      assert.equal(
        await isValidWebhookUrl('https://hooks.example.com/webhook'),
        true
      );
    });

    it('returns true for https://api.stripe.com/v1/webhooks', async () => {
      assert.equal(
        await isValidWebhookUrl('https://api.stripe.com/v1/webhooks'),
        true
      );
    });

    it('returns true for a URL with a query string', async () => {
      assert.equal(
        await isValidWebhookUrl('https://hooks.example.com/hook?token=abc123'),
        true
      );
    });

    it('returns true for a URL with a path and no trailing slash', async () => {
      assert.equal(
        await isValidWebhookUrl('https://notify.myservice.io/events/vertifile'),
        true
      );
    });

    it('returns true for a two-part TLD (co.uk)', async () => {
      assert.equal(
        await isValidWebhookUrl('https://hooks.myservice.co.uk/webhook'),
        true
      );
    });
  });

});
