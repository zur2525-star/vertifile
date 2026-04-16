const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../services/logger');
const { getClientIP } = require('../middleware/auth');
const router = express.Router();

// Use shared authenticateAdmin from middleware — set via app.set('authenticateAdmin') in server.js
function authenticateAdmin(req, res, next) {
  const fn = req.app.get('authenticateAdmin');
  if (fn) return fn(req, res, next);
  return res.status(500).json({ success: false, error: 'Admin auth not configured' });
}

// Admin stats — global overview
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const chain = req.app.get('chain');
    const stats = await db.getStats();
    const blockchainStats = await chain.getStats();
    res.json({ success: true, ...stats, blockchain: blockchainStats });
  } catch (e) { logger.error({ err: e }, 'Admin stats error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Admin audit log — paginated, filterable
router.get('/audit', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;
    const event = req.query.event || undefined;
    const orgId = req.query.orgId || undefined;
    const entries = await db.getAuditLog({ limit, offset, event, orgId });
    res.json({ success: true, entries, limit, offset });
  } catch (e) { logger.error({ err: e }, 'Admin audit error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Admin — list API keys
router.get('/keys', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const keys = await db.listApiKeys();
    res.json({ success: true, keys });
  } catch (e) { logger.error({ err: e }, 'Admin keys error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Admin — create API key
router.post('/keys', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { escapeHtml } = require('../templates/pvf');
    let { orgName, plan } = req.body;
    if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });

    // Sanitize orgName to prevent stored XSS (orgName is rendered in PVF stamps and admin views)
    orgName = escapeHtml(orgName).substring(0, 100);

    const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
    const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
    const rateLimitVal = plan === 'enterprise' ? 10000 : plan === 'business' ? 1000 : 100;

    await db.createApiKey({ apiKey, orgId, orgName, plan: plan || 'pro', rateLimit: rateLimitVal });
    await db.log('api_key_created', { orgId, orgName, plan, ip: getClientIP(req) });

    res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'pro' });
  } catch (e) { logger.error({ err: e }, 'Admin create key error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
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
    logger.error({ err: e }, 'Admin documents listing error');
    res.status(500).json({ success: false, error: 'Failed to list documents' });
  }
});

// Admin — list all webhooks
router.get('/webhooks', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const webhooks = db.getAllWebhooks ? await db.getAllWebhooks() : [];
    res.json({ success: true, webhooks });
  } catch (e) {
    logger.error({ err: e }, 'Admin webhooks listing error');
    res.status(500).json({ success: false, error: 'Failed to list webhooks' });
  }
});

// ================================================================
// Legacy /api/keys routes
// ================================================================

// Generate new API key (legacy admin endpoint)
router.post('/keys-legacy/create', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { escapeHtml } = require('../templates/pvf');
    let { orgName, plan, allowedIPs } = req.body;
    if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });
    orgName = escapeHtml(orgName).substring(0, 100);

    const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
    const orgId = 'org_' + uuidv4().split('-')[0];
    const rateLimitVal = plan === 'enterprise' ? 10000 : plan === 'business' ? 1000 : 100;

    await db.createApiKey({
      apiKey,
      orgId,
      orgName,
      plan: plan || 'pro',
      rateLimit: rateLimitVal,
      allowedIPs: (allowedIPs && Array.isArray(allowedIPs) && allowedIPs.length > 0) ? allowedIPs : undefined
    });

    await db.log('api_key_created', { orgId, orgName, plan: plan || 'pro', ip: getClientIP(req), hasIpWhitelist: !!(allowedIPs && allowedIPs.length) });
    logger.info({ event: 'api_key_created', orgName, plan: plan || 'pro' }, `API Key created for ${orgName}`);
    res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'pro' });
  } catch (e) { logger.error({ err: e }, 'Legacy create key error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// List API keys (legacy)
router.get('/keys-legacy', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const keys = (await db.listApiKeys()).map(k => ({
      ...k,
      apiKey: k.apiKey.substring(0, 12) + '...'
    }));
    res.json({ success: true, keys, total: keys.length });
  } catch (e) { logger.error({ err: e }, 'Legacy list keys error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ================================================================
// ERROR TRACKING
// ================================================================

// Admin — recent errors and stats
router.get('/errors', authenticateAdmin, (req, res) => {
  const { getRecentErrors, getErrorStats } = require('../middleware/error-alerter');
  res.json({ success: true, errors: getRecentErrors(), stats: getErrorStats() });
});

// ================================================================
// MONITORING ENDPOINTS
// ================================================================

// Log a health check result (called by monitoring system)
router.post('/health-log', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { status, responseMs, details } = req.body;
    await db.logHealthCheck(status || 'ok', responseMs || 0, details || {});
    res.json({ success: true });
  } catch (e) { logger.error({ err: e }, 'Health log error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Get health check history
router.get('/monitoring', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const hours = Math.max(1, Math.min(8760, parseInt(req.query.hours) || 24));
    const history = await db.getHealthHistory(hours);
    res.json({ success: true, history });
  } catch (e) { logger.error({ err: e }, 'Monitoring error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Get uptime stats
router.get('/uptime', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const stats = await db.getUptimeStats(days);
    res.json({ success: true, ...stats });
  } catch (e) { logger.error({ err: e }, 'Uptime error'); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Self-check endpoint — requires admin auth, logs its own health
router.get('/self-check', authenticateAdmin, async (req, res) => {
  const start = Date.now();
  const db = req.app.get('db');
  try {
    const stats = await db.getStats();
    const ms = Date.now() - start;
    await db.logHealthCheck('ok', ms, { documents: stats.documents, organizations: stats.organizations });
    res.json({ success: true, status: 'ok', responseMs: ms, ...stats });
  } catch (e) {
    const ms = Date.now() - start;
    logger.error({ err: e }, 'Self-check failed');
    await db.logHealthCheck('error', ms, {}).catch(() => {});
    res.status(500).json({ success: false, status: 'error', responseMs: ms });
  }
});

// ================================================================
// REVENUE & OVERAGE MONITORING
// ================================================================

// Revenue overview — MRR, overage, documents, plan breakdown
router.get('/revenue', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const month = req.query.month || undefined; // defaults to current month
    const overview = await db.getRevenueOverview(month);
    res.json({ success: true, ...overview });
  } catch (e) {
    logger.error({ err: e }, 'Admin revenue overview error');
    res.status(500).json({ success: false, error: 'Failed to load revenue overview' });
  }
});

// Overage details — users who exceeded their plan limit
router.get('/overage', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const month = req.query.month || undefined;
    const overage = await db.getOverageUsers(month);
    res.json({ success: true, ...overage });
  } catch (e) {
    logger.error({ err: e }, 'Admin overage details error');
    res.status(500).json({ success: false, error: 'Failed to load overage details' });
  }
});

// Usage trends — monthly aggregation for charts
router.get('/usage-trends', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const numMonths = Math.min(parseInt(req.query.months) || 6, 24);
    const trends = await db.getUsageTrends(numMonths);
    res.json({ success: true, ...trends });
  } catch (e) {
    logger.error({ err: e }, 'Admin usage trends error');
    res.status(500).json({ success: false, error: 'Failed to load usage trends' });
  }
});

// Single user monthly usage (for billing detail view)
router.get('/user/:userId/usage', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }
    const month = req.query.month || undefined;
    const usage = await db.getUserMonthlyUsage(userId, month);
    res.json({ success: true, ...usage });
  } catch (e) {
    logger.error({ err: e }, 'Admin user usage error');
    res.status(500).json({ success: false, error: 'Failed to load user usage' });
  }
});

// ================================================================
// DASHBOARD ENDPOINTS
// ================================================================

// Dashboard overview — all stats in one call
router.get('/overview', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const stats = await db.getStats();
    const recentDocs = await db.getRecentDocuments(10);
    const recentAudit = await db.getAuditLog({ limit: 10, offset: 0 });
    const dailyStats = await db.getDailyStats(30);
    res.json({ success: true, stats, recentDocs, recentAudit, dailyStats });
  } catch (e) {
    logger.error({ err: e }, 'Overview failed');
    res.status(500).json({ success: false, error: 'Failed to load overview' });
  }
});

// Full org details for slide panel
router.get('/org/:orgId', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    // Security: validate orgId format (alphanumeric + underscore, reasonable length)
    if (!req.params.orgId || req.params.orgId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(req.params.orgId)) {
      return res.status(400).json({ success: false, error: 'Invalid organization ID' });
    }
    const org = await db.getApiKeyByOrgId(req.params.orgId);
    if (!org) return res.status(404).json({ success: false, error: 'Organization not found' });
    const docs = await db.getDocumentsByOrg(req.params.orgId);
    const docCount = await db.getDocumentCount(req.params.orgId);
    const auditEntries = await db.getAuditLog({ limit: 20, offset: 0, orgId: req.params.orgId });
    res.json({ success: true, org, documents: docs, documentCount: docCount, audit: auditEntries });
  } catch (e) {
    logger.error({ err: e }, 'Org details failed');
    res.status(500).json({ success: false, error: 'Failed to load organization' });
  }
});

// Security alerts
router.get('/alerts', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const alerts = await db.getSecurityAlerts(50);
    res.json({ success: true, alerts });
  } catch (e) {
    logger.error({ err: e }, 'Alerts failed');
    res.status(500).json({ success: false, error: 'Failed to load alerts' });
  }
});

// Change org plan
router.post('/org/:orgId/plan', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    // Security: validate orgId format
    if (!req.params.orgId || req.params.orgId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(req.params.orgId)) {
      return res.status(400).json({ success: false, error: 'Invalid organization ID' });
    }
    const { plan } = req.body;
    if (!['pro', 'business', 'enterprise'].includes(plan)) return res.status(400).json({ success: false, error: 'Invalid plan' });
    await db.updateOrgPlan(req.params.orgId, plan);
    await db.log('plan_changed', { orgId: req.params.orgId, plan, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    logger.error({ err: e }, 'Plan change failed');
    res.status(500).json({ success: false, error: 'Failed to change plan' });
  }
});

// Export data as CSV
router.get('/export/:type', authenticateAdmin, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { type } = req.params;
    // Security: strictly validate export type against allowlist
    if (!['documents', 'keys', 'audit'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid export type. Allowed: documents, keys, audit' });
    }
    let data, filename;
    if (type === 'documents') {
      data = await db.getAllDocumentsForExport();
      filename = 'vertifile-documents.csv';
    } else if (type === 'keys') {
      data = await db.getAllKeysForExport();
      filename = 'vertifile-api-keys.csv';
    } else if (type === 'audit') {
      data = await db.getAllAuditForExport();
      filename = 'vertifile-audit-log.csv';
    } else {
      return res.status(400).json({ success: false, error: 'Invalid export type' });
    }
    if (!data.length) return res.status(404).json({ success: false, error: 'No data' });
    const headers = Object.keys(data[0]).join(',');
    // Security: CSV injection prevention — prefix cells starting with =, +, -, @, \t, \r
    // with a single quote so spreadsheet apps don't interpret them as formulas.
    function csvSafe(v) {
      let s = String(v || '').replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s + '"';
    }
    const rows = data.map(r => Object.values(r).map(csvSafe).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(headers + '\n' + rows);
  } catch (e) {
    logger.error({ err: e }, 'Export failed');
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

module.exports = router;
