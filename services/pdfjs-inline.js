/**
 * PDF.js Conditional Inline Bundling (Phase 3 — Option B)
 * ============================================================================
 *
 * This module injects the PDF.js MAIN library directly into a PVF HTML file at
 * upload time, but ONLY when the uploaded document is application/pdf. Text
 * and image PVFs are returned byte-identical to the input.
 *
 * The worker is NO LONGER inlined. It is served as a same-origin HTTPS asset
 * from /vendor/pdfjs/pdf.worker.min.mjs (see server.js static route). Chrome
 * rejects module workers constructed from blob: URLs (opaque origin), and
 * pdfjs-dist v4 is ES-module-only with no UMD fallback, so a real HTTPS URL
 * is the only viable path. Trade-off: PDF PVFs need vertifile.com reachable
 * to render. Signing + Ed25519 verification stay 100% self-contained.
 *
 * Phase 4 follow-up: server-side rasterization to PNG removes the need for
 * PDF.js in the viewer entirely and restores full offline operation.
 *
 * Safety:
 *  - The injected <script id="pdfjs-main"> tag carries an id attribute so the
 *    obfuscator regex /<script>([\s\S]*?)<\/script>/ in obfuscate.js:97
 *    (which matches only tags with no attributes) skips it. The hash chain
 *    stays symmetric: both sides hash only the obfuscated main template script.
 *  - escapeScriptClose() rewrites every literal "</script" inside the library
 *    source to "<\/script". The HTML tokenizer closes a <script> block on
 *    "</script" regardless of surrounding context, so this escaping is
 *    mandatory.
 *
 * Size impact vs Phase 2: ~1.3 MB saved per PDF PVF (the worker source is
 * no longer embedded).
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PDFJS_MAIN_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.min.mjs');
// Worker is still kept on disk — it's served by the Express static route at
// /vendor/pdfjs/pdf.worker.min.mjs. We don't read it here, but we keep it in
// the availability check so a broken deploy fails loud.
const PDFJS_WORKER_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.worker.min.mjs');

let __mainCache = null;

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
 * Load and cache the PDF.js main library source from disk.
 * Throws synchronously if the file is missing — deployment bug, not a
 * runtime condition. The startup sanity check in server.js validates both
 * main and worker files exist at boot so upload-time failures don't surprise
 * anyone. The worker file is served via the static route, not read here.
 */
function loadPdfJs() {
  if (__mainCache === null) {
    __mainCache = escapeScriptClose(fs.readFileSync(PDFJS_MAIN_PATH, 'utf8'));
  }
  return { main: __mainCache };
}

/**
 * Inject PDF.js main library into a PVF HTML string. Only runs when
 * mimeType === 'application/pdf'. Returns HTML unchanged for every other
 * MIME type, so text and image PVFs pay zero bytes.
 *
 * The main library is loaded as an ES module (type="module") because
 * pdfjs-dist v4 only ships .mjs files — there is no UMD build. The end of
 * pdf.min.mjs assigns itself to globalThis.pdfjsLib, so window.pdfjsLib is
 * available to our template script after the module resolves.
 *
 * The worker is NOT inlined. The template script sets
 * pdfjsLib.GlobalWorkerOptions.workerSrc to the absolute HTTPS URL
 * https://vertifile.com/vendor/pdfjs/pdf.worker.min.mjs and the browser
 * fetches it at PDF load time.
 */
function injectPdfJsBundle(html, mimeType) {
  if (mimeType !== 'application/pdf') return html;
  if (typeof html !== 'string' || html.length === 0) return html;

  const { main } = loadPdfJs();

  // Inject just before </head> so the module starts loading before the
  // body parses. Single tag:
  //   <script id="pdfjs-main" type="module"> — main library as ES module
  //
  // The tag carries data-vf-bundle so the client-side computeCodeIntegrity()
  // selector skips it. The server-side regex /<script>/ already skips it
  // (it requires no attributes immediately after `script`), so the hash chain
  // stays symmetric: both sides hash ONLY the obfuscated main template script.
  const bundle =
    '<script id="pdfjs-main" type="module" data-vf-bundle="pdfjs-main">\n' + main + '\n</script>\n';

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
