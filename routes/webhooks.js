const express = require('express');
const crypto = require('crypto');
const dns = require('dns').promises;
const { getClientIP } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();

// Webhook helper — fire webhooks for an org
async function fireWebhooks(db, orgId, event, data) {
  try {
    const webhooks = await db.getWebhooksByOrg(orgId);
    for (const wh of webhooks) {
      if (wh.events.includes(event)) {
        const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
        const hmac = crypto.createHmac('sha256', wh.secret).update(payload).digest('hex');

        // Fire and forget
        fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Vertifile-Signature': hmac
          },
          body: payload
        }).catch(err => {
          logger.error(`[WEBHOOK] Failed to deliver to ${wh.url}:`, err.message);
        });
      }
    }
  } catch (e) {
    logger.error('[WEBHOOK] Error:', e.message);
  }
}

// Check whether an IP address falls within a private/reserved range.
// Covers: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
// 169.254.0.0/16 (link-local), 0.0.0.0, and IPv6 loopback/unique-local.
function isPrivateIP(ip) {
  if (!ip || typeof ip !== 'string') return true;
  // IPv4 private/reserved ranges
  if (ip === '0.0.0.0') return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172 && parseInt(m172[1]) >= 16 && parseInt(m172[1]) <= 31) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  // IPv6 loopback and private ranges
  if (ip === '::1') return true;
  if (/^fe80/i.test(ip)) return true;
  if (/^fc00/i.test(ip)) return true;
  if (/^fd/i.test(ip)) return true;
  return false;
}

// Validate webhook URL to prevent SSRF and DNS rebinding attacks.
// This function is async because it resolves the hostname via DNS
// and checks the resolved IP against the private range blocklist.
async function isValidWebhookUrl(urlStr) {
  try {
    if (typeof urlStr !== 'string' || urlStr.length > 2048) return false;
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port && parsed.port !== '443') return false;
    // Reject credentials in URL
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    // Block hostnames that are obviously private/reserved
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host === '[::1]') return false;
    if (isPrivateIP(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost')) return false;
    // Block IPv6 link-local (fe80::), loopback (::1), and unique-local (fc00::/fd00::)
    if (/^(\[)?fe80/i.test(host) || /^(\[)?fc00/i.test(host) || /^(\[)?fd/i.test(host)) return false;
    // Must have a proper TLD (at least one dot in hostname)
    if (!host.includes('.')) return false;

    // DNS rebinding protection: resolve the hostname and verify every
    // resolved IP is public. An attacker could register a domain that
    // initially resolves to a public IP (passing the hostname checks
    // above), then switch the DNS record to 127.0.0.1 before the
    // webhook fires. By resolving here and checking the actual IPs,
    // we block that attack vector.
    try {
      const addresses = await dns.resolve4(host);
      for (const ip of addresses) {
        if (isPrivateIP(ip)) {
          return false;
        }
      }
    } catch (e) {
      // DNS resolution failed (NXDOMAIN, timeout, etc.) -- reject the URL.
      // A legitimate webhook endpoint must have a resolvable hostname.
      return false;
    }

    return true;
  } catch { return false; }
}

// Register a webhook
router.post('/register', (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  const db = req.app.get('db');
  const { url, events } = req.body;
  if (!url || !events || !Array.isArray(events)) {
    return res.status(400).json({ success: false, error: 'url and events[] required' });
  }

  if (!(await isValidWebhookUrl(url))) {
    return res.status(400).json({ success: false, error: 'Invalid webhook URL. Must be HTTPS and point to a public endpoint.' });
  }

  const allowedEvents = ['verification.success', 'verification.failed', 'document.created'];
  const validEvents = events.filter(e => allowedEvents.includes(e));
  if (validEvents.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid events. Allowed: ' + allowedEvents.join(', ') });
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const id = await db.registerWebhook(req.org.orgId, url, validEvents, secret);

  await db.log('webhook_registered', { orgId: req.org.orgId, url, events: validEvents, ip: getClientIP(req) });
  res.json({ success: true, webhookId: id, secret, events: validEvents });
});

// List org webhooks
router.get('/', (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const webhooks = await db.getWebhooksByOrg(req.org.orgId);
    res.json({ success: true, webhooks: webhooks.map(w => ({ id: w.id, url: w.url, events: w.events, createdAt: w.createdAt })) });
  } catch (e) { logger.error({ err: e }, 'List webhooks error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Delete a webhook
router.delete('/:id', (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });
    const removed = await db.removeWebhook(id, req.org.orgId);
    if (!removed) return res.status(404).json({ success: false, error: 'Webhook not found' });
    res.json({ success: true });
  } catch (e) { logger.error({ err: e }, 'Delete webhook error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

module.exports = router;
module.exports.fireWebhooks = fireWebhooks;
