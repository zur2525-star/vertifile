const logger = require('../services/logger');

function requestLogger() {
  // Paths to skip logging (noisy health checks)
  const SKIP = ['/api/health', '/api/health/deep', '/favicon.ico'];

  return (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      if (SKIP.some(p => req.path === p || req.path.startsWith(p))) return;

      const ms = Date.now() - start;
      const logData = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms,
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown',
      };

      if (res.statusCode >= 400) {
        logger.warn(logData, `${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
      } else {
        logger.info(logData, `${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
      }
    });

    next();
  };
}

module.exports = { requestLogger };
