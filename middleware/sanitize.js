const logger = require('../services/logger');

function escapeStr(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function sanitizeBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  for (const key of Object.keys(req.body)) {
    if (typeof req.body[key] === 'string') {
      // Block oversized fields
      if (req.body[key].length > 10000) {
        return res.status(400).json({ success: false, error: `Field '${key}' exceeds maximum length` });
      }
      // Remove null bytes
      req.body[key] = req.body[key].replace(/\x00/g, '');
      // Don't escape fields that are expected to contain HTML/SVG (customIcon, pvf content)
      if (key !== 'customIcon' && key !== 'pvf_content' && key !== 'content') {
        req.body[key] = escapeStr(req.body[key]);
      }
    }
  }
  next();
}

module.exports = { sanitizeBody };
