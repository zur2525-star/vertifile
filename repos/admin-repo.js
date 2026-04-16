/**
 * Admin Repository -- API keys, audit log, monitoring, health checks,
 * branding, stats, dashboard helpers, revenue/overage tracking,
 * and export functions.
 *
 * Part of the Phase 0 microservices migration. This module receives its
 * pool and queryWithRetry references via init() at boot time, called by
 * db.js after pool creation.
 */

const { escapeLike, mapKeyRow, mapKeyListRow, mapAuditRow, mapAllDocRow } = require('./helpers');

let pool;
let queryWithRetry;

function init(p, qwr) {
  pool = p;
  queryWithRetry = qwr;
}

// ================================================================
// API KEYS
// ================================================================
async function getApiKey(key) {
  const { rows } = await queryWithRetry('SELECT * FROM api_keys WHERE api_key = $1', [key]);
  return rows.length ? mapKeyRow(rows[0]) : null;
}

async function getOrgByOrgId(orgId) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE org_id = $1', [orgId]);
  return rows.length ? rows[0] : null;
}

async function createApiKey({ apiKey, orgId, orgName, plan = 'pro', rateLimit = 100, allowedIPs }) {
  await pool.query(
    `INSERT INTO api_keys (api_key, org_id, org_name, plan, created_at, documents_created, active, rate_limit, allowed_ips)
     VALUES ($1,$2,$3,$4,$5,0,1,$6,$7)`,
    [apiKey, orgId, orgName, plan, new Date().toISOString(), rateLimit,
     allowedIPs ? JSON.stringify(allowedIPs) : null]
  );
}

async function incrementDocCount(apiKey) {
  await pool.query('UPDATE api_keys SET documents_created = documents_created + 1 WHERE api_key = $1', [apiKey]);
}

async function listApiKeys() {
  const { rows } = await pool.query('SELECT * FROM api_keys ORDER BY created_at DESC');
  return rows.map(mapKeyListRow);
}

async function deactivateApiKey(apiKey) {
  await pool.query('UPDATE api_keys SET active = 0 WHERE api_key = $1', [apiKey]);
}

// Alias for compatibility -- some callers may reference deleteApiKey
const deleteApiKey = deactivateApiKey;

async function getApiKeyByOrgId(orgId) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE org_id = $1', [orgId]);
  return rows[0] || null;
}

async function updateOrgPlan(orgId, plan) {
  const limits = { pro: 500, business: 10000, enterprise: 100000 };
  await pool.query('UPDATE api_keys SET plan = $1, rate_limit = $2 WHERE org_id = $3', [plan, limits[plan], orgId]);
}

// ================================================================
// BRANDING
// ================================================================
async function updateBranding(orgId, data) {
  const icon = data.customIcon || data.custom_icon || null;
  const color = data.brandColor || data.brand_color || null;
  const waveCol = data.waveColor || data.wave_color || null;
  await pool.query('UPDATE api_keys SET custom_icon = $1, brand_color = $2, wave_color = $3 WHERE org_id = $4', [icon, color, waveCol, orgId]);
}

async function getBranding(orgId) {
  const { rows } = await pool.query('SELECT custom_icon, brand_color, wave_color FROM api_keys WHERE org_id = $1', [orgId]);
  return rows[0] || { custom_icon: null, brand_color: null, wave_color: null };
}

// ================================================================
// AUDIT LOG
// ================================================================
async function log(event, details = {}) {
  const logger = require('../services/logger');
  try {
    await queryWithRetry(
      'INSERT INTO audit_log (timestamp, event, details) VALUES ($1, $2, $3)',
      [new Date().toISOString(), event, JSON.stringify(details)]
    );
  } catch (e) {
    logger.error('[AUDIT] Failed to write:', e.message);
  }
}

async function getAuditLog({ limit = 50, offset = 0, event, orgId } = {}) {
  let rows;
  if (event) {
    const res = await pool.query(
      'SELECT * FROM audit_log WHERE event = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
      [event, limit, offset]
    );
    rows = res.rows;
  } else if (orgId) {
    const res = await pool.query(
      "SELECT * FROM audit_log WHERE details::jsonb->>'orgId' = $1 ORDER BY id DESC LIMIT $2 OFFSET $3",
      [orgId, limit, offset]
    );
    rows = res.rows;
  } else {
    const res = await pool.query(
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    rows = res.rows;
  }
  return rows.map(mapAuditRow);
}

// ================================================================
// STATS
// ================================================================
async function getStats() {
  const [d, o, a] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM documents'),
    pool.query('SELECT COUNT(*) as count FROM api_keys WHERE active = 1'),
    pool.query('SELECT COUNT(*) as count FROM audit_log'),
  ]);
  return {
    totalDocuments: Number(d.rows[0].count),
    totalOrganizations: Number(o.rows[0].count),
    totalAuditEntries: Number(a.rows[0].count),
  };
}

async function getOrgStats(orgId) {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM documents WHERE org_id = $1', [orgId]);
  return { documentsCreated: Number(rows[0].count) };
}

// ================================================================
// DASHBOARD HELPERS
// ================================================================
async function getRecentDocuments(limit = 10) {
  const { rows } = await pool.query('SELECT hash, original_name, mime_type, file_size, created_at, org_id, verified FROM documents ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getDailyStats(days = 30) {
  const { rows } = await pool.query(`
    SELECT DATE(created_at::timestamptz) as date, COUNT(*) as documents
    FROM documents
    WHERE created_at::timestamptz > NOW() - INTERVAL '1 day' * $1
    GROUP BY DATE(created_at::timestamptz)
    ORDER BY date
  `, [days]);
  return rows;
}

async function getSecurityAlerts(limit = 50) {
  const { rows } = await pool.query(`
    SELECT * FROM audit_log
    WHERE event IN ('auth_failed', 'verify_failed', 'rate_limited', 'code_tampered', 'chain_broken', 'invalid_signature')
    ORDER BY timestamp DESC LIMIT $1
  `, [limit]);
  return rows;
}

async function getAllDocuments({ limit = 50, offset = 0, search = '' } = {}) {
  let rows;
  if (search) {
    const pattern = '%' + escapeLike(search) + '%';
    const res = await pool.query(
      `SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash
       FROM documents WHERE hash LIKE $1 OR original_name LIKE $2 OR org_name LIKE $3
       ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [pattern, pattern, pattern, limit, offset]
    );
    rows = res.rows;
  } else {
    const res = await pool.query(
      `SELECT hash, original_name, mime_type, file_size, created_at, org_id, org_name, recipient, recipient_hash
       FROM documents ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    rows = res.rows;
  }
  return rows.map(mapAllDocRow);
}

// ================================================================
// EXPORT HELPERS (admin data export)
// ================================================================
async function getAllDocumentsForExport() {
  const { rows } = await pool.query('SELECT hash, original_name, mime_type, file_size, created_at, org_id, verified FROM documents ORDER BY created_at DESC');
  return rows;
}

async function getAllKeysForExport() {
  const { rows } = await pool.query('SELECT org_id, org_name, plan, rate_limit, documents_created, active, created_at FROM api_keys ORDER BY created_at DESC');
  return rows;
}

async function getAllAuditForExport() {
  const { rows } = await pool.query('SELECT event, details, timestamp FROM audit_log ORDER BY timestamp DESC LIMIT 10000');
  return rows;
}

// ================================================================
// MONITORING
// ================================================================
async function logHealthCheck(status, responseMs, details = {}) {
  await pool.query('INSERT INTO health_checks (status, response_ms, details) VALUES ($1, $2, $3)', [status, responseMs, JSON.stringify(details)]);
  // Keep only last 30 days
  await pool.query("DELETE FROM health_checks WHERE checked_at < NOW() - INTERVAL '30 days'");
}

async function getHealthHistory(hours = 24) {
  const { rows } = await pool.query(
    'SELECT * FROM health_checks WHERE checked_at > NOW() - make_interval(hours => $1::int) ORDER BY checked_at DESC LIMIT 500',
    [hours]
  );
  return rows;
}

async function getUptimeStats(days = 30) {
  const { rows: total } = await pool.query(
    "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'ok') as ok FROM health_checks WHERE checked_at > NOW() - make_interval(days => $1::int)",
    [days]
  );
  const r = total[0];
  const uptimePercent = r.total > 0 ? ((r.ok / r.total) * 100).toFixed(2) : '100.00';
  const { rows: incidents } = await pool.query(
    "SELECT checked_at, details FROM health_checks WHERE status != 'ok' AND checked_at > NOW() - make_interval(days => $1::int) ORDER BY checked_at DESC LIMIT 20",
    [days]
  );
  const { rows: avgResp } = await pool.query(
    "SELECT ROUND(AVG(response_ms)) as avg_ms FROM health_checks WHERE status = 'ok' AND checked_at > NOW() - make_interval(days => $1::int)",
    [days]
  );
  return {
    uptimePercent,
    totalChecks: parseInt(r.total),
    okChecks: parseInt(r.ok),
    failedChecks: parseInt(r.total) - parseInt(r.ok),
    avgResponseMs: avgResp[0]?.avg_ms || 0,
    incidents
  };
}

// ================================================================
// HEALTH CHECK
// ================================================================
async function healthCheck() {
  const start = Date.now();
  try {
    const { rows } = await pool.query('SELECT NOW() AS server_time, current_database() AS db_name');
    const ms = Date.now() - start;
    return {
      ok: true,
      responseMs: ms,
      serverTime: rows[0].server_time,
      database: rows[0].db_name,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  } catch (e) {
    const ms = Date.now() - start;
    return {
      ok: false,
      responseMs: ms,
      error: e.message,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
  }
}

// ================================================================
// MIGRATION (no-op for PostgreSQL -- data lives in the managed DB)
// ================================================================
async function migrateFromJson() {
  return { documents: 0, keys: 0 };
}

// ================================================================
// REVENUE & OVERAGE TRACKING
// ================================================================

// Plan pricing map -- monthly base price per plan
const PLAN_PRICES = { pro: 49, business: 79, enterprise: 0 };
const PLAN_LIMITS = { pro: 500, business: 1000, enterprise: Infinity };
const OVERAGE_RATES = { pro: 0.15, business: 0.10, enterprise: 0 };

/**
 * Track a single document upload in the overage_log.
 * Called after every successful upload. Uses UPSERT to increment counters.
 * Returns overageInfo if the user is now over their plan limit.
 */
async function trackOverage(userId, plan) {
  const month = new Date().toISOString().slice(0, 7); // '2026-04'
  const limit = PLAN_LIMITS[plan] || 500;
  const rate = OVERAGE_RATES[plan] || 0.15;

  // Upsert: increment documents_used, recalculate overage
  const { rows } = await pool.query(
    `INSERT INTO overage_log (user_id, month, documents_used, documents_limit, overage_rate)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (user_id, month) DO UPDATE SET
       documents_used = overage_log.documents_used + 1,
       documents_limit = $3,
       overage_rate = $4,
       overage_count = GREATEST(overage_log.documents_used + 1 - $3, 0),
       overage_charge = GREATEST(overage_log.documents_used + 1 - $3, 0) * $4,
       updated_at = NOW()
     RETURNING documents_used, documents_limit, overage_count, overage_charge`,
    [userId, month, limit, rate]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    documentsUsed: row.documents_used,
    documentsLimit: row.documents_limit,
    overageCount: row.overage_count,
    overageCharge: parseFloat(row.overage_charge)
  };
}

/**
 * Revenue overview for admin dashboard.
 * Aggregates users by plan, calculates MRR + overage revenue for a given month.
 */
async function getRevenueOverview(month) {
  if (!month) month = new Date().toISOString().slice(0, 7);

  // Count users by plan
  const planCounts = await pool.query(
    `SELECT plan, COUNT(*)::int AS count FROM users GROUP BY plan`
  );
  const byPlan = {};
  let totalUsers = 0;
  for (const row of planCounts.rows) {
    byPlan[row.plan] = row.count;
    totalUsers += row.count;
  }

  // Calculate MRR from plan base prices
  let mrr = 0;
  for (const [plan, count] of Object.entries(byPlan)) {
    mrr += (PLAN_PRICES[plan] || 0) * count;
  }

  // Total overage revenue for the month
  const overageResult = await pool.query(
    `SELECT COALESCE(SUM(overage_charge), 0)::numeric AS total_overage,
            COALESCE(SUM(overage_count), 0)::int AS total_overage_docs
     FROM overage_log WHERE month = $1`,
    [month]
  );
  const overageRevenue = parseFloat(overageResult.rows[0].total_overage);
  const documentsOverage = overageResult.rows[0].total_overage_docs;

  // Total documents created this month
  const docsResult = await pool.query(
    `SELECT COALESCE(SUM(documents_used), 0)::int AS total_docs
     FROM overage_log WHERE month = $1`,
    [month]
  );
  const documentsCreated = docsResult.rows[0].total_docs;

  return {
    period: month,
    totalUsers,
    byPlan,
    mrr,
    overageRevenue,
    totalRevenue: mrr + overageRevenue,
    documentsCreated,
    documentsOverage
  };
}

/**
 * List all users who exceeded their plan limit for a given month.
 */
async function getOverageUsers(month) {
  if (!month) month = new Date().toISOString().slice(0, 7);

  const { rows } = await pool.query(
    `SELECT ol.user_id, u.email, u.plan,
            ol.documents_used, ol.documents_limit,
            ol.overage_count, ol.overage_charge
     FROM overage_log ol
     JOIN users u ON u.id = ol.user_id
     WHERE ol.month = $1 AND ol.overage_count > 0
     ORDER BY ol.overage_count DESC`,
    [month]
  );

  const users = rows.map(r => ({
    id: r.user_id,
    email: r.email,
    plan: r.plan,
    used: r.documents_used,
    limit: r.documents_limit,
    overage: r.overage_count,
    overageCharge: parseFloat(r.overage_charge)
  }));

  const totalOverage = users.reduce((sum, u) => sum + u.overageCharge, 0);

  return { users, totalOverage: Math.round(totalOverage * 100) / 100 };
}

/**
 * Monthly usage trends for the last N months. Used by admin charts.
 */
async function getUsageTrends(numMonths) {
  if (!numMonths || numMonths < 1) numMonths = 6;

  const { rows } = await pool.query(
    `SELECT
       ol.month,
       COUNT(DISTINCT ol.user_id)::int AS users,
       COALESCE(SUM(ol.documents_used), 0)::int AS documents,
       COALESCE(SUM(ol.overage_charge), 0)::numeric AS overage_revenue
     FROM overage_log ol
     WHERE ol.month >= TO_CHAR(NOW() - ($1 || ' months')::INTERVAL, 'YYYY-MM')
     GROUP BY ol.month
     ORDER BY ol.month ASC`,
    [String(numMonths)]
  );

  // Add base MRR per month from user plan counts
  const months = [];
  for (const row of rows) {
    // Approximate MRR based on active users that month
    const planCountsForMonth = await pool.query(
      `SELECT u.plan, COUNT(*)::int AS count
       FROM users u
       JOIN overage_log ol ON ol.user_id = u.id AND ol.month = $1
       GROUP BY u.plan`,
      [row.month]
    );
    let monthMrr = 0;
    for (const pc of planCountsForMonth.rows) {
      monthMrr += (PLAN_PRICES[pc.plan] || 0) * pc.count;
    }

    months.push({
      month: row.month,
      users: row.users,
      documents: row.documents,
      revenue: monthMrr + parseFloat(row.overage_revenue)
    });
  }

  return { months };
}

/**
 * Single user usage for a specific month -- for billing detail views.
 */
async function getUserMonthlyUsage(userId, month) {
  if (!month) month = new Date().toISOString().slice(0, 7);

  const { rows } = await pool.query(
    `SELECT ol.*, u.email, u.plan, u.name
     FROM overage_log ol
     JOIN users u ON u.id = ol.user_id
     WHERE ol.user_id = $1 AND ol.month = $2`,
    [userId, month]
  );

  if (!rows.length) {
    return {
      userId,
      month,
      documentsUsed: 0,
      documentsLimit: 0,
      overageCount: 0,
      overageCharge: 0,
      overageRate: 0
    };
  }

  const r = rows[0];
  return {
    userId: r.user_id,
    email: r.email,
    name: r.name,
    plan: r.plan,
    month: r.month,
    documentsUsed: r.documents_used,
    documentsLimit: r.documents_limit,
    overageCount: r.overage_count,
    overageCharge: parseFloat(r.overage_charge),
    overageRate: parseFloat(r.overage_rate)
  };
}

module.exports = {
  init,
  functions: {
    getApiKey,
    getOrgByOrgId,
    createApiKey,
    incrementDocCount,
    listApiKeys,
    deactivateApiKey,
    deleteApiKey,
    getApiKeyByOrgId,
    updateOrgPlan,
    updateBranding,
    getBranding,
    log,
    getAuditLog,
    getStats,
    getOrgStats,
    getRecentDocuments,
    getDailyStats,
    getSecurityAlerts,
    getAllDocuments,
    getAllDocumentsForExport,
    getAllKeysForExport,
    getAllAuditForExport,
    logHealthCheck,
    getHealthHistory,
    getUptimeStats,
    healthCheck,
    migrateFromJson,
    // Revenue & overage tracking
    trackOverage,
    getRevenueOverview,
    getOverageUsers,
    getUsageTrends,
    getUserMonthlyUsage,
    PLAN_PRICES,
    PLAN_LIMITS,
    OVERAGE_RATES,
  },
};
