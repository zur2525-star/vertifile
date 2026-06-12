// ============================================================
// services/stamp-override.js
// ============================================================
// Shared builder for the Layer 2 stamp override script.
//
// Used by BOTH:
//   - routes/pages.js  → injectStampConfig (serving)
//   - routes/api.js    → /verify dual-hash fallback (verification)
//
// CRITICAL: This function must be DETERMINISTIC. Given the same cfg
// input, it must produce byte-identical output every call, on every
// server. Otherwise the dual-hash verification breaks.
//
// No Date.now(), no random seeds, no iteration-order dependencies,
// no external state, no time-sensitive logic.
// ============================================================

'use strict';

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
// Strict raster-only data URI. SVG is deliberately excluded (data:image/svg+xml
// can carry script) and the base64 payload charset is locked down so the value
// can never break out of the attribute/DOM context it is emitted into.
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;

/**
 * Sanitize and normalize a stamp config for override script emission.
 * Returns an object with only the fields that passed validation.
 * Unknown / malformed fields are dropped (NOT silently coerced).
 */
function sanitizeCfg(rawCfg) {
  const out = {};
  if (!rawCfg || typeof rawCfg !== 'object') return out;

  // waveColors: array of up to 7 strict hex colors
  if (Array.isArray(rawCfg.waveColors) && rawCfg.waveColors.length) {
    const cleaned = [];
    for (let i = 0; i < rawCfg.waveColors.length && cleaned.length < 7; i++) {
      const c = rawCfg.waveColors[i];
      if (typeof c === 'string' && HEX6_RE.test(c)) {
        cleaned.push(c);
      }
    }
    if (cleaned.length > 0) out.waveColors = cleaned;
  }

  // accent: single strict hex color
  if (typeof rawCfg.accentColor === 'string' && HEX6_RE.test(rawCfg.accentColor)) {
    out.accent = rawCfg.accentColor;
  }

  // customLogo: must be a strict base64 raster data:image/ URI (no SVG)
  if (typeof rawCfg.customLogo === 'string' && DATA_IMAGE_RE.test(rawCfg.customLogo)) {
    out.customLogo = rawCfg.customLogo;
  }

  // brandText: trimmed, max 16 chars
  if (typeof rawCfg.brandText === 'string') {
    const t = rawCfg.brandText.trim();
    if (t.length > 0) out.brandText = t.slice(0, 16);
  }

  return out;
}

/**
 * Escape a JSON string for safe embedding inside a <script> tag.
 * Prevents </script> breakout and handles Unicode line terminators
 * that JavaScript treats as newlines but JSON does not.
 */
function escapeJsonForScript(jsonStr) {
  return jsonStr
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build the exact text that will be emitted as the inner textContent
 * of the override <script data-vf-stamp-override> tag, WITHOUT the
 * surrounding <script ...> and </script> tags.
 *
 * This is the string that the server uses to compute the expected
 * code-integrity hash in the dual-hash verify fallback.
 *
 * Returns empty string if cfg has no applicable fields (no override).
 */
function buildOverrideScriptInnerText(rawCfg) {
  const cfg = sanitizeCfg(rawCfg);
  if (Object.keys(cfg).length === 0) return '';

  // IMPORTANT: keys MUST be emitted in a fixed order for determinism.
  // JSON.stringify iterates own enumerable keys in insertion order,
  // so build the payload with explicit ordering.
  const payload = {
    waveColors: cfg.waveColors || null,
    accent: cfg.accent || null,
    customLogo: cfg.customLogo || null,
    brandText: cfg.brandText || null
  };
  const payloadJson = escapeJsonForScript(JSON.stringify(payload));

  // The runtime override logic. KEEP INDENTATION AND WHITESPACE STABLE.
  // Changing a single character here will invalidate every existing
  // document's dual-hash verification once redeployed.
  return '(function(){\n' +
    '      window.__VF_STAMP_OVERRIDE__ = ' + payloadJson + ';\n' +
    '      function applyOverride(){\n' +
    '        var o = window.__VF_STAMP_OVERRIDE__;\n' +
    '        if (!o) return;\n' +
    '        try {\n' +
    '          if (o.waveColors && o.waveColors.length) {\n' +
    '            var paths = document.querySelectorAll(\'.holo-waves svg path[stroke], .holo-waves path[stroke]\');\n' +
    '            for (var i=0; i<paths.length && i<o.waveColors.length; i++) {\n' +
    '              paths[i].setAttribute(\'stroke\', o.waveColors[i]);\n' +
    '            }\n' +
    '          }\n' +
    '          if (o.accent) {\n' +
    '            document.documentElement.style.setProperty(\'--vf-accent\', o.accent);\n' +
    '            var brandEls = document.querySelectorAll(\'.brand, .vfs-brand\');\n' +
    '            for (var j=0; j<brandEls.length; j++) brandEls[j].style.color = o.accent;\n' +
    '          }\n' +
    '          if (o.customLogo) {\n' +
    '            var coin = document.querySelector(\'.stamp-coin\') || document.querySelector(\'.vfs-stamp-coin\');\n' +
    '            if (coin) {\n' +
    '              var center = coin.querySelector(\'.center\') || coin.querySelector(\'.vfs-center\');\n' +
    '              if (center) center.style.display = \'none\';\n' +
    '              var existing = coin.querySelector(\'.vf-custom-logo-overlay\');\n' +
    '              if (existing) existing.remove();\n' +
    '              var overlay = document.createElement(\'div\');\n' +
    '              overlay.className = \'vf-custom-logo-overlay\';\n' +
    '              overlay.style.cssText = \'position:absolute;top:19%;left:19%;width:62%;height:62%;border-radius:50%;overflow:hidden;background:#fff;border:1px solid rgba(124,58,237,.12);z-index:10;display:flex;align-items:center;justify-content:center\';\n' +
    '              var logoImg = document.createElement(\'img\');\n' +
    '              logoImg.src = o.customLogo;\n' +
    '              logoImg.style.cssText = \'width:100%;height:100%;object-fit:cover;display:block\';\n' +
    '              logoImg.alt = \'Custom logo\';\n' +
    '              overlay.appendChild(logoImg);\n' +
    '              var ring = coin.querySelector(\'.ring\') || coin;\n' +
    '              ring.appendChild(overlay);\n' +
    '            }\n' +
    '          }\n' +
    '          if (o.brandText) {\n' +
    '            var brandEls2 = document.querySelectorAll(\'.stamp .brand\');\n' +
    '            for (var k=0; k<brandEls2.length; k++) brandEls2[k].textContent = o.brandText;\n' +
    '            var tp = document.querySelector(\'.stamp svg textPath\');\n' +
    '            if (tp) {\n' +
    '              tp.textContent = \'VERIFIED BY \' + o.brandText.toUpperCase() + \' \\u2022 DOCUMENT APPROVED \\u2022 BLOCKCHAIN SECURED \\u2022\';\n' +
    '            }\n' +
    '          }\n' +
    '        } catch(e) { /* fail open */ }\n' +
    '      }\n' +
    '      if (document.readyState === \'loading\') {\n' +
    '        document.addEventListener(\'DOMContentLoaded\', applyOverride);\n' +
    '      } else {\n' +
    '        applyOverride();\n' +
    '      }\n' +
    '    })();';
}

/**
 * FROZEN legacy variant of buildOverrideScriptInnerText — emits the exact
 * text the pre-rewrite builder produced (recovered from git history).
 * Previously downloaded old-format PVFs have THIS text baked into their
 * client-side code-integrity hash, so the /verify dual-hash fallback must
 * be able to recompute it forever. Deliberately self-contained (own copy
 * of the legacy sanitization, with the old looser customLogo check) so it
 * can never drift when sanitizeCfg or the live template above are edited.
 *
 * The legacy text is ONLY hashed for comparison in routes/api.js — it is
 * never injected into served HTML (injection uses the safe builder above).
 */
function buildOverrideScriptInnerTextLegacy(rawCfg) {
  const cfg = {};
  if (!rawCfg || typeof rawCfg !== 'object') return '';

  // waveColors: array of up to 7 strict hex colors
  if (Array.isArray(rawCfg.waveColors) && rawCfg.waveColors.length) {
    const cleaned = [];
    for (let i = 0; i < rawCfg.waveColors.length && cleaned.length < 7; i++) {
      const c = rawCfg.waveColors[i];
      if (typeof c === 'string' && HEX6_RE.test(c)) {
        cleaned.push(c);
      }
    }
    if (cleaned.length > 0) cfg.waveColors = cleaned;
  }

  // accent: single strict hex color
  if (typeof rawCfg.accentColor === 'string' && HEX6_RE.test(rawCfg.accentColor)) {
    cfg.accent = rawCfg.accentColor;
  }

  // customLogo: legacy check — must be data:image/ URI (pre-rewrite rule)
  if (typeof rawCfg.customLogo === 'string' && rawCfg.customLogo.startsWith('data:image/')) {
    cfg.customLogo = rawCfg.customLogo;
  }

  // brandText: trimmed, max 16 chars
  if (typeof rawCfg.brandText === 'string') {
    const t = rawCfg.brandText.trim();
    if (t.length > 0) cfg.brandText = t.slice(0, 16);
  }

  if (Object.keys(cfg).length === 0) return '';

  const payload = {
    waveColors: cfg.waveColors || null,
    accent: cfg.accent || null,
    customLogo: cfg.customLogo || null,
    brandText: cfg.brandText || null
  };
  const payloadJson = escapeJsonForScript(JSON.stringify(payload));

  // EXACT pre-rewrite template. DO NOT EDIT — every character below is
  // load-bearing for the dual-hash verification of old downloaded files.
  return '(function(){\n' +
    '      window.__VF_STAMP_OVERRIDE__ = ' + payloadJson + ';\n' +
    '      function applyOverride(){\n' +
    '        var o = window.__VF_STAMP_OVERRIDE__;\n' +
    '        if (!o) return;\n' +
    '        try {\n' +
    '          if (o.waveColors && o.waveColors.length) {\n' +
    '            var paths = document.querySelectorAll(\'.holo-waves svg path[stroke], .holo-waves path[stroke]\');\n' +
    '            for (var i=0; i<paths.length && i<o.waveColors.length; i++) {\n' +
    '              paths[i].setAttribute(\'stroke\', o.waveColors[i]);\n' +
    '            }\n' +
    '          }\n' +
    '          if (o.accent) {\n' +
    '            document.documentElement.style.setProperty(\'--vf-accent\', o.accent);\n' +
    '            var brandEls = document.querySelectorAll(\'.brand, .vfs-brand\');\n' +
    '            for (var j=0; j<brandEls.length; j++) brandEls[j].style.color = o.accent;\n' +
    '          }\n' +
    '          if (o.customLogo) {\n' +
    '            var coin = document.querySelector(\'.stamp-coin\') || document.querySelector(\'.vfs-stamp-coin\');\n' +
    '            if (coin) {\n' +
    '              var center = coin.querySelector(\'.center\') || coin.querySelector(\'.vfs-center\');\n' +
    '              if (center) center.style.display = \'none\';\n' +
    '              var existing = coin.querySelector(\'.vf-custom-logo-overlay\');\n' +
    '              if (existing) existing.remove();\n' +
    '              var overlay = document.createElement(\'div\');\n' +
    '              overlay.className = \'vf-custom-logo-overlay\';\n' +
    '              overlay.style.cssText = \'position:absolute;top:19%;left:19%;width:62%;height:62%;border-radius:50%;overflow:hidden;background:#fff;border:1px solid rgba(124,58,237,.12);z-index:10;display:flex;align-items:center;justify-content:center\';\n' +
    '              overlay.innerHTML = \'<img src="\' + o.customLogo + \'" style="width:100%;height:100%;object-fit:cover;display:block" alt="Custom logo"/>\';\n' +
    '              var ring = coin.querySelector(\'.ring\') || coin;\n' +
    '              ring.appendChild(overlay);\n' +
    '            }\n' +
    '          }\n' +
    '          if (o.brandText) {\n' +
    '            var brandEls2 = document.querySelectorAll(\'.stamp .brand\');\n' +
    '            for (var k=0; k<brandEls2.length; k++) brandEls2[k].textContent = o.brandText;\n' +
    '            var tp = document.querySelector(\'.stamp svg textPath\');\n' +
    '            if (tp) {\n' +
    '              tp.textContent = \'VERIFIED BY \' + o.brandText.toUpperCase() + \' \\u2022 DOCUMENT APPROVED \\u2022 BLOCKCHAIN SECURED \\u2022\';\n' +
    '            }\n' +
    '          }\n' +
    '        } catch(e) { /* fail open */ }\n' +
    '      }\n' +
    '      if (document.readyState === \'loading\') {\n' +
    '        document.addEventListener(\'DOMContentLoaded\', applyOverride);\n' +
    '      } else {\n' +
    '        applyOverride();\n' +
    '      }\n' +
    '    })();';
}

/**
 * Wrap buildOverrideScriptInnerText output in the
 * <script data-vf-stamp-override>...</script> tag.
 * This is what gets injected into the PVF HTML.
 * Always uses the NEW safe builder — never the legacy variant.
 */
function buildOverrideScriptTag(rawCfg) {
  const inner = buildOverrideScriptInnerText(rawCfg);
  if (!inner) return '';
  return '<script data-vf-stamp-override>' + inner + '</script>';
}

module.exports = {
  sanitizeCfg,
  buildOverrideScriptInnerText,
  buildOverrideScriptInnerTextLegacy,
  buildOverrideScriptTag,
  escapeJsonForScript
};
