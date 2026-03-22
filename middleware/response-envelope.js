const crypto = require('crypto');

function responseEnvelope() {
  return (req, res, next) => {
    // Add requestId to every request
    req.requestId = crypto.randomUUID();

    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json to add envelope
    res.json = function(data) {
      // Only wrap API responses (not static files)
      if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        if (typeof data === 'object' && data !== null) {
          data.requestId = req.requestId;
          data.timestamp = new Date().toISOString();
        }
      }
      return originalJson(data);
    };

    next();
  };
}

module.exports = { responseEnvelope };
