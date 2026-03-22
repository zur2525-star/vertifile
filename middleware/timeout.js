const logger = require('../services/logger');

function requestTimeout(ms = 30000) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ method: req.method, path: req.path, ms }, 'Request timeout');
        res.status(408).json({ success: false, error: 'Request timeout' });
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

module.exports = { requestTimeout };
