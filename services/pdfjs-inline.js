/**
 * PDF.js Conditional Inline Bundling (Option E — per Avi's spec v2)
 * ============================================================================
 *
 * This module injects the PDF.js library and worker directly into a PVF HTML
 * file at upload time, but ONLY when the uploaded document is application/pdf.
 * Text and image PVFs are returned byte-identical to the input.
 *
 * Why: Vertifile's "works fully offline" guarantee. A CDN reference breaks the
 * guarantee. Server-side rasterization (Phase 4) is the correct long-term fix,
 * but Option E is tonight's no-compromise bridge.
 *
 * Safety:
 *  - The two <script> tags injected here both carry id attributes
 *    (id="pdfjs-main" and id="pdfjs-worker"). The obfuscator regex in
 *    obfuscate.js line 97 is /<script>([\s\S]*?)<\/script>/ — it matches
 *    ONLY tags with no attributes. Therefore the obfuscator will skip our
 *    injected bundles and only obfuscate the main template script block.
 *  - escapeScriptClose() rewrites every literal "</script" inside the library
 *    source to "<\/script". The browser HTML tokenizer closes a <script> block
 *    on the literal string "</script" regardless of surrounding context, so
 *    this escaping is mandatory.
 *
 * Both files live in vendor/pdfjs/ and are read once, cached in process memory.
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PDFJS_MAIN_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.min.mjs');
const PDFJS_WORKER_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.worker.min.mjs');

let __mainCache = null;
let __workerCache = null;

// Module-level availability flag. Computed once at require time via fs.existsSync.
// Pipeline callers can read isPdfjsAvailable() to decide whether to fail fast on
// a PDF upload before running the entire template/obfuscate chain.
let __pdfjsAvailable = (function() {
  try {
    return fs.existsSync(PDFJS_MAIN_PATH) && fs.existsSync(PDFJS_WORKER_PATH);
  } catch (e) {
    return false;
  }
})();

function isPdfjsAvailable() {
  return __pdfjsAvailable;
}

/**
 * Escape literal </script sequences that would break out of a <script> block.
 * The HTML tokenizer closes a script block on "</script" regardless of
 * surrounding quotes, comments, or template literals.
 */
function escapeScriptClose(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}

/**
 * Load and cache the PDF.js main + worker source files from disk.
 * Throws synchronously if either file is missing — deployment bug, not a
 * runtime condition. A startup sanity check in server.js should validate
 * both files exist at boot so upload-time failures don't surprise anyone.
 */
function loadPdfJs() {
  if (__mainCache === null) {
    __mainCache = escapeScriptClose(fs.readFileSync(PDFJS_MAIN_PATH, 'utf8'));
    __workerCache = escapeScriptClose(fs.readFileSync(PDFJS_WORKER_PATH, 'utf8'));
  }
  return { main: __mainCache, worker: __workerCache };
}

/**
 * Inject PDF.js main library + worker source into a PVF HTML string.
 * Only runs when mimeType === 'application/pdf'. Returns HTML unchanged for
 * every other MIME type, so text and image PVFs pay zero bytes.
 *
 * The main library is loaded as an ES module (type="module") because
 * pdfjs-dist v4 only ships .mjs files — there is no UMD build. The end of
 * pdf.min.mjs assigns itself to globalThis.pdfjsLib, so window.pdfjsLib is
 * available to our template script after the module resolves.
 *
 * The worker source is stored as <script type="text/plain"> — the browser
 * ignores type="text/plain" as an executable script, so we can read its
 * textContent from the template script and construct a Blob URL at runtime.
 */
function injectPdfJsBundle(html, mimeType) {
  if (mimeType !== 'application/pdf') return html;
  if (typeof html !== 'string' || html.length === 0) return html;

  const { main, worker } = loadPdfJs();

  // Inject just before </head> so the module starts loading before the
  // body parses. Two tags:
  //   1. <script id="pdfjs-main" type="module"> — main library as ES module
  //   2. <script id="pdfjs-worker" type="text/plain"> — worker source stashed
  //      for the template script to lift into a Blob URL at runtime
  //
  // Both tags carry data-vf-bundle so the client-side computeCodeIntegrity()
  // selector skips them. The server-side regex /<script>/ already skips them
  // (it requires no attributes immediately after `script`), so the hash chain
  // stays symmetric: both sides hash ONLY the obfuscated main template script.
  const bundle =
    '<script id="pdfjs-main" type="module" data-vf-bundle="pdfjs-main">\n' + main + '\n</script>\n' +
    '<script id="pdfjs-worker" type="text/plain" data-vf-bundle="pdfjs-worker">\n' + worker + '\n</script>\n';

  // If there's no </head>, the template is malformed — fall back to prepending
  // the bundle at the start of the document so the library still loads.
  if (html.indexOf('</head>') === -1) {
    return bundle + html;
  }
  // Use function-callback form of String.prototype.replace() — the 2-arg
  // string form interprets $&, $$, $', $`, and $1-$99 as replacement patterns,
  // which corrupts the pdf.js bundle (contains `this.#$&&this.#yt()`). The
  // callback form treats the return value as a literal string with no
  // pattern interpretation, so $& inside `bundle` stays intact.
  return html.replace('</head>', function() { return bundle + '</head>'; });
}

module.exports = { injectPdfJsBundle, loadPdfJs, escapeScriptClose, isPdfjsAvailable };
