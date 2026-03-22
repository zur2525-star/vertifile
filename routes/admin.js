const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../services/logger');
const router = express.Router();

// Use shared authenticateAdmin from middleware — set via app.set('authenticateAdmin') in server.js
function authenticateAdmin(req, res, next) {
  const fn = req.app.get('authenticateAdmin');
  if (fn) return fn(req, res, next);
  return res.status(500).json({ success: false, error: 'Admin auth not configured' });
}

// Admin stats — global overview
router.get('/stats', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const chain = req.app.get('chain');
  const stats = await db.getStats();
  const blockchainStats = await chain.getStats();
  res.json({ success: true, ...stats, blockchain: blockchainStats });
});

// Admin audit log — paginated, filterable
router.get('/audit', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const event = req.query.event || undefined;
  const orgId = req.query.orgId || undefined;
  const entries = await db.getAuditLog({ limit, offset, event, orgId });
  res.json({ success: true, entries, limit, offset });
});

// Admin — list API keys
router.get('/keys', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const keys = await db.listApiKeys();
  res.json({ success: true, keys });
});

// Admin — create API key
router.post('/keys', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const { orgName, plan } = req.body;
  if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });

  const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
  const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
  const rateLimitVal = plan === 'enterprise' ? 10000 : plan === 'professional' ? 100 : 5;

  await db.createApiKey({ apiKey, orgId, orgName, plan: plan || 'free', rateLimit: rateLimitVal });
  await db.log('api_key_created', { orgId, orgName, plan, ip: getClientIP(req) });

  res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'free' });
});

// Admin — delete API key
router.delete('/keys/:key', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const key = await db.getApiKey(req.params.key);
    if (!key) return res.status(404).json({ success: false, error: 'API key not found' });
    await db.deactivateApiKey(req.params.key);
    await db.log('api_key_deleted', { apiKey: req.params.key.substring(0, 12) + '...', orgId: key.orgId, ip: getClientIP(req) });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete key' });
  }
});

// Admin — list all documents (paginated, searchable)
router.get('/documents', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const search = req.query.search || '';
  try {
    const docs = await db.getAllDocuments({ limit, offset, search });
    res.json({ success: true, documents: docs, limit, offset });
  } catch (e) {
    res.json({ success: true, documents: [], limit, offset });
  }
});

// Admin — list all webhooks
router.get('/webhooks', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const webhooks = db.getAllWebhooks ? await db.getAllWebhooks() : [];
    res.json({ success: true, webhooks });
  } catch (e) {
    res.json({ success: true, webhooks: [] });
  }
});

// ================================================================
// Legacy /api/keys routes
// ================================================================

// Generate new API key (legacy admin endpoint)
router.post('/keys-legacy/create', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const { escapeHtml } = require('../templates/pvf');
  let { orgName, plan, allowedIPs } = req.body;
  if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });
  orgName = escapeHtml(orgName).substring(0, 100);

  const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
  const orgId = 'org_' + uuidv4().split('-')[0];
  const rateLimitVal = plan === 'enterprise' ? 10000 : plan === 'professional' ? 100 : 5;

  await db.createApiKey({
    apiKey,
    orgId,
    orgName,
    plan: plan || 'free',
    rateLimit: rateLimitVal,
    allowedIPs: (allowedIPs && Array.isArray(allowedIPs) && allowedIPs.length > 0) ? allowedIPs : undefined
  });

  await db.log('api_key_created', { orgId, orgName, plan: plan || 'free', ip: getClientIP(req), hasIpWhitelist: !!(allowedIPs && allowedIPs.length) });
  logger.info({ event: 'api_key_created', orgName, plan: plan || 'free' }, `API Key created for ${orgName}`);
  res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'free' });
});

// List API keys (legacy)
router.get('/keys-legacy', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const keys = (await db.listApiKeys()).map(k => ({
    ...k,
    apiKey: k.apiKey.substring(0, 12) + '...'
  }));
  res.json({ success: true, keys, total: keys.length });
});

// ================================================================
// MONITORING ENDPOINTS
// ================================================================

// Log a health check result (called by monitoring system)
router.post('/health-log', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const { status, responseMs, details } = req.body;
  await db.logHealthCheck(status || 'ok', responseMs || 0, details || {});
  res.json({ success: true });
});

// Get health check history
router.get('/monitoring', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const hours = parseInt(req.query.hours) || 24;
  const history = await db.getHealthHistory(hours);
  res.json({ success: true, history });
});

// Get uptime stats
router.get('/uptime', authenticateAdmin, async (req, res) => {
  const db = req.app.get('db');
  const days = parseInt(req.query.days) || 30;
  const stats = await db.getUptimeStats(days);
  res.json({ success: true, ...stats });
});

// Self-check endpoint — logs its own health
router.get('/self-check', async (req, res) => {
  const start = Date.now();
  const db = req.app.get('db');
  try {
    const stats = await db.getStats();
    const ms = Date.now() - start;
    await db.logHealthCheck('ok', ms, { documents: stats.documents, organizations: stats.organizations });
    res.json({ success: true, status: 'ok', responseMs: ms, ...stats });
  } catch (e) {
    const ms = Date.now() - start;
    await db.logHealthCheck('error', ms, { error: e.message }).catch(() => {});
    res.status(500).json({ success: false, status: 'error', responseMs: ms, error: e.message });
  }
});

module.exports = router;
