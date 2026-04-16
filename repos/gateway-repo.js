/**
 * Gateway Repository -- webhooks management.
 *
 * Part of the Phase 0 microservices migration. This module receives its
 * pool reference via init() at boot time, called by db.js after pool
 * creation.
 */

const { mapWebhookRow, mapAllWebhookRow } = require('./helpers');

let pool;

function init(p) {
  pool = p;
}

// ================================================================
// WEBHOOKS
// ================================================================
async function getWebhooksByOrg(orgId) {
  const { rows } = await pool.query('SELECT * FROM webhooks WHERE org_id = $1 AND active = 1', [orgId]);
  return rows.map(mapWebhookRow);
}

async function registerWebhook(orgId, url, events, secret) {
  const { rows } = await pool.query(
    'INSERT INTO webhooks (org_id, url, events, secret, active) VALUES ($1,$2,$3,$4,1) RETURNING id',
    [orgId, url, JSON.stringify(events), secret]
  );
  return rows[0].id;
}

async function removeWebhook(id, orgId) {
  const { rowCount } = await pool.query('DELETE FROM webhooks WHERE id = $1 AND org_id = $2', [id, orgId]);
  return rowCount > 0;
}

async function getAllWebhooks() {
  const { rows } = await pool.query('SELECT * FROM webhooks ORDER BY created_at DESC');
  return rows.map(mapAllWebhookRow);
}

module.exports = {
  init,
  functions: {
    getWebhooksByOrg,
    registerWebhook,
    removeWebhook,
    getAllWebhooks,
  },
};
