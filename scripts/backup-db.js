const logger = require('../services/logger');
const db = require('../db');

async function backup() {
  await db._ready;
  const tables = ['documents', 'api_keys', 'users', 'audit_log', 'webhooks', 'health_checks'];
  const backup = {};

  for (const table of tables) {
    try {
      const { rows } = await db._db.query(`SELECT * FROM ${table}`);
      backup[table] = rows;
      logger.info({ table, count: rows.length }, `Backed up ${table}`);
    } catch (e) {
      logger.warn({ table, error: e.message }, `Skip ${table}`);
    }
  }

  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'data', 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `backup-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(backup, null, 2));
  logger.info({ filename, tables: Object.keys(backup).length }, 'Backup complete');

  // Keep only last 7 backups
  const files = fs.readdirSync(dir).filter(f => f.startsWith('backup-')).sort();
  while (files.length > 7) {
    const old = files.shift();
    fs.unlinkSync(path.join(dir, old));
    logger.info({ deleted: old }, 'Old backup deleted');
  }

  process.exit(0);
}

backup().catch(e => { logger.error({ err: e }, 'Backup failed'); process.exit(1); });
