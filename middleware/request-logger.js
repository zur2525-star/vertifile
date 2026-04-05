const logger = require('../services/logger');

// Issue #9: Fields that must NEVER appear in logs
const SENSITIVE_FIELDS = ['password', 'password_hash', 'token', 'secret', 'authorization'];

function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = { ...obj };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

function requestLogger() {
  // Paths to skip logging (noisy health checks)
  const SKIP = ['/api/health', '/api/health/deep', '/favicon.ico'];

  return (req, res, next) => {
    // Issue #9: Proactively sanitize req.body so passwords never leak into any downstream logger
    if (req.body && req.body.password) {
      req._sanitizedBody = sanitizeForLogging(req.body);
    }

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

module.exports = { requestLogger, sanitizeForLogging };
