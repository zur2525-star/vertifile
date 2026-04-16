const logger = require('../services/logger');

function escapeStr(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// Fields that carry base64 data-URIs or large HTML/SVG payloads.
// They have their own size checks downstream (db.js caps customLogo at
// 500 KB; customIcon at 700 KB in routes/user.js).
const LARGE_FIELD_ALLOWLIST = new Set([
  'customLogo',   // stamp config — base64 logo data URI
  'customIcon',   // branding — base64/SVG icon
  'pvf_content',  // PVF HTML blob
  'content'       // generic large content field
]);

// Fields that are expected to contain HTML/SVG — skip escaping
const HTML_FIELD_ALLOWLIST = new Set(['customIcon', 'pvf_content', 'content']);

// Security: Maximum nesting depth to prevent prototype pollution via deeply nested objects
const MAX_DEPTH = 5;

function sanitizeValue(key, value, depth) {
  if (depth > MAX_DEPTH) return undefined; // drop excessively nested values
  if (typeof value === 'string') {
    // Block oversized fields
    if (!LARGE_FIELD_ALLOWLIST.has(key) && value.length > 10000) {
      return null; // signal to reject
    }
    // Remove null bytes
    value = value.replace(/\x00/g, '');
    // Escape unless it is a known HTML field
    if (!HTML_FIELD_ALLOWLIST.has(key)) {
      value = escapeStr(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = sanitizeValue(key, value[i], depth + 1);
    }
    return value;
  }
  if (value && typeof value === 'object') {
    // Security: reject __proto__, constructor, prototype keys (prototype pollution)
    for (const k of Object.keys(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        delete value[k];
        continue;
      }
      const result = sanitizeValue(k, value[k], depth + 1);
      if (result === null) return null; // oversized field in nested object
      value[k] = result;
    }
    return value;
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') return next();

  // Security: reject __proto__, constructor, prototype at top level
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (key in req.body) delete req.body[key];
  }

  for (const key of Object.keys(req.body)) {
    const result = sanitizeValue(key, req.body[key], 0);
    if (result === null) {
      return res.status(400).json({ success: false, error: `Field '${key}' exceeds maximum length` });
    }
    req.body[key] = result;
  }
  next();
}

module.exports = { sanitizeBody };

// Exported for unit tests only — not part of the public API.
module.exports._test = { escapeStr, sanitizeValue, MAX_DEPTH, LARGE_FIELD_ALLOWLIST, HTML_FIELD_ALLOWLIST };
