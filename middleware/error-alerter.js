const logger = require('../services/logger');

// In-memory error tracking
const recentErrors = [];
const MAX_ERRORS = 100;

function trackError(err, req) {
  const entry = {
    timestamp: new Date().toISOString(),
    path: req?.path || 'unknown',
    method: req?.method || 'unknown',
    error: err.message,
    stack: err.stack?.split('\n')[1]?.trim() || ''
  };
  recentErrors.unshift(entry);
  if (recentErrors.length > MAX_ERRORS) recentErrors.pop();

  // Log with full context
  logger.error({
    event: 'unhandled_error',
    path: entry.path,
    method: entry.method,
    error: entry.error
  }, `Error: ${entry.error}`);
}

function getRecentErrors(limit = 20) {
  return recentErrors.slice(0, limit);
}

function getErrorStats() {
  const last24h = recentErrors.filter(e =>
    new Date(e.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  return {
    total: recentErrors.length,
    last24h: last24h.length,
    topPaths: [...new Set(last24h.map(e => e.path))].slice(0, 5)
  };
}

module.exports = { trackError, getRecentErrors, getErrorStats };
