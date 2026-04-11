const logger = require('../services/logger');

function escapeStr(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function sanitizeBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();
  // Fields that carry base64 data-URIs or large HTML/SVG payloads.
  // They have their own size checks downstream (db.js caps customLogo at
  // 500 KB; customIcon at 700 KB in routes/user.js).
  const LARGE_FIELD_ALLOWLIST = new Set([
    'customLogo',   // stamp config — base64 logo data URI
    'customIcon',   // branding — base64/SVG icon
    'pvf_content',  // PVF HTML blob
    'content'       // generic large content field
  ]);

  for (const key of Object.keys(req.body)) {
    if (typeof req.body[key] === 'string') {
      // Block oversized fields — but allow known large-payload fields through
      // (they are validated individually by their respective handlers)
      if (!LARGE_FIELD_ALLOWLIST.has(key) && req.body[key].length > 10000) {
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
