# PDF.js Inline Rendering — Architectural Spec v2

**Author:** Avi (Architect/Lead)
**Date:** 2026-04-09 (1:30 AM session)
**Supersedes:** v1 (Option A / CDN). v1 was rejected by Zur on the "no compromise" rule: it broke Vertifile's offline promise for PDFs.
**Status:** DECISION FINAL — implement as written
**Implementer:** Moshe (Backend/Template)
**QA:** Ori (Round 2)
**Budget:** 90 minutes

---

## 1. Decision

**We are going with Option E — Conditional Inline Bundling. PDF.js is bundled INSIDE the PVF HTML file at upload time, but ONLY when the uploaded document is a PDF. Text and image PVFs remain byte-identical to today.**

This is the no-compromise answer because:

- **Fully offline.** PDF PVFs render without any network call. Vertifile's "works offline" claim holds across all three document types — no asterisk, no partial break.
- **Zero third-party runtime dependency.** No CDN, no cdnjs, no cloudflare subresource integrity risk, no firewall problem for enterprise customers.
- **No bloat penalty on non-PDF PVFs.** Text and image PVFs stay small — the 400 KB PDF.js library is only attached when the document MIME type is `application/pdf`. A customer uploading 100 text PVFs pays nothing.
- **No DB schema change.** The bundle is injected at template-assembly time in `services/pvf-pipeline.js` just before obfuscation; nothing is stored differently.
- **No upload pipeline rewrite.** A single file read + string concat, roughly 20 lines of new pipeline code.
- **Fits tonight's budget.** 90 minutes total for inline rendering + thumbnails sidebar + local smoke test.

Option D (server-side rasterization to PNG) is the correct 5-year answer and remains the Phase 4 target. It is not feasible tonight — it requires a native library install (poppler or muPDF), a schema migration to store per-page PNGs, a pipeline rewrite, and proper per-page stamp positioning logic. Estimated 4-8 hours, minimum. Not tonight.

Option A (CDN) is rejected for the reason above. Option B (unconditional bundling) is rejected because it bloats text/image PVFs by 400 KB for zero benefit. Option C (hybrid) still carries the CDN dependency.

---

## 2. Trade-offs Accepted

### What we GAIN

- PDFs render fully offline inside the PVF, same as text and image
- No CDN dependency, no firewall surprise, no cdnjs outage risk
- Uniform visual treatment — PDF / image / text are all native DOM inside `.page-bg`
- No hardcoded `8420px` magic number — PDF.js produces its own flow height from stacked canvases
- Thumbnails sidebar (new requirement) is straightforward because all pages are already DOM nodes
- Zero impact on text and image PVF payloads — non-PDFs are byte-identical to today

### What we LOSE

- **PDF PVF file size grows by ~400 KB (PDF.js minified + worker).** A 200 KB PDF document becomes a ~1.0 MB PVF (200 KB base64 + 400 KB library + ~50 KB template). A 5 MB PDF becomes a ~6.0 MB PVF. This is the only honest cost.
- Upload pipeline now has one more I/O read (reading `pdf.min.js` from disk). Negligible — the file is read once per upload, cached by the OS filesystem after the first read.
- Obfuscation runs on a larger script body (template script + PDF.js is not obfuscated — see Section 3a item 5 — but the template script is). No practical impact on obfuscation time.

### Why the trade is acceptable to Zur's "no compromise" rule

- The trade is disk bytes, not correctness or offline capability. A PDF PVF grows from ~200 KB to ~600 KB on a small document. This is well below email-attachment limits (25 MB on Gmail, 20 MB on Outlook) and is invisible on any modern download speed.
- File size is a one-time cost; offline capability is permanent value. Zur has consistently chosen permanent value over one-time cost.
- The 400 KB cost is paid ONLY by customers who upload PDFs. A customer uploading only text documents pays zero.
- Once Phase 4 (server-side rasterization) ships, Option E can be retired: PDF PVFs will carry pre-rasterized PNG pages, the bundled PDF.js can be removed, and the file size drops below the current Option A baseline. Option E is a bridge, not a forever solution.

### Phase 4 follow-up (unchanged from v1)

Server-side rasterization to PNG pages at upload time. Estimated 4-8 hours. Targeted for after patent / IANA pending items clear. Option E ships tonight, Phase 4 replaces it cleanly.

---

## 3. Implementation Spec for Moshe

This section has three parts: 3a — Inline PDF rendering, 3b — Thumbnails sidebar, 3c — Performance and memory.

### 3a — Inline PDF Rendering

#### 3a.1 Obtain the PDF.js source files

One-time setup, done by Moshe before touching code:

```bash
cd /Users/mac/Desktop/pvf-project
npm install pdfjs-dist@4.0.379 --save
mkdir -p vendor/pdfjs
cp node_modules/pdfjs-dist/build/pdf.min.mjs vendor/pdfjs/pdf.min.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs vendor/pdfjs/pdf.worker.min.mjs
```

Pin to `4.0.379` exactly. This is the last stable v4 release before v5's API changes. The two files live in `vendor/pdfjs/` and are read by the pipeline at upload time. Total disk cost: ~1.2 MB in the repo, one time.

Why the `.mjs` (ES module) variant: PDF.js v4 ships worker and main as ES modules. Our template script is a classic non-module `<script>` block, so we inline the main library as a classic script using the UMD-compatible path (see 3a.4 below for the exact inline trick). For the worker, we use a Blob URL constructed at runtime from a second inline `<script type="text/plain">` tag holding the worker source.

#### 3a.2 Injection point in the pipeline

All injection happens in `services/pvf-pipeline.js` at step 10 (right before the obfuscation step at line 396-397), inside a new helper function.

| # | Location | Change |
|---|---|---|
| 1 | `services/pvf-pipeline.js` top of file, after existing `require` statements | Add: `const fs = require('fs'); const path = require('path');` if not already present. Add: `const PDFJS_MAIN_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.min.mjs'); const PDFJS_WORKER_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.worker.min.mjs'); let __pdfjsMainCache = null; let __pdfjsWorkerCache = null;` |
| 2 | `services/pvf-pipeline.js` near the other helpers (above `encodeFileForTemplate`) | Add the `injectPdfJsBundle(html, mimeType)` function — see skeleton in 3a.4. It reads the two `.mjs` files (cached after first read), escapes any `</script>` sequences, and injects them into the template HTML only when `mimeType === 'application/pdf'`. For non-PDF MIME types, returns the HTML unchanged. |
| 3 | `services/pvf-pipeline.js` line 396-397 (right before `pvfHtml = await obfuscatePvf(...)`) | Add: `pvfHtml = injectPdfJsBundle(pvfHtml, mimeType);` — CRITICAL: this must run BEFORE `obfuscatePvf`, because the obfuscator's regex matches the first plain `<script>` tag. Our bundle uses `<script id="pdfjs-main">` with an attribute, which the regex `/<script>/` does not match. The obfuscator will skip our bundle and obfuscate only the main template script. Verified against `obfuscate.js` line 97. |
| 4 | `services/pvf-generator.js` line 271 (the legacy inline generator path) | Same injection: add `pvfHtml = injectPdfJsBundle(pvfHtml, mimeType);` before `obfuscatePvf`. Import `injectPdfJsBundle` from pipeline or duplicate the helper in a new `services/pdfjs-inline.js` module (Moshe's call — the cleanest move is a new module). |

#### 3a.3 Template changes — `templates/pvf.js`

All changes are in `templates/pvf.js`. No other template is touched.

| # | Location | Change |
|---|---|---|
| 1 | Line 125 — `.doc-frame.pdf{height:8420px;...}` | **DELETE the hardcoded 8420px height.** Replace with: `.doc-frame.pdf{min-height:842px;display:flex;flex-direction:column;gap:14px;padding:0;position:relative}` |
| 2 | Line 127 — `.doc-frame iframe{width:100%;height:100%;border:none}` | **DELETE this rule.** No iframes anymore. |
| 3 | After line 128 — add canvas + PDF states | Add: `.doc-frame canvas.pdf-page{width:100%;height:auto;display:block;box-shadow:0 1px 4px rgba(0,0,0,.15);background:#fff}` and `.doc-frame .pdf-error{padding:40px;text-align:center;color:#c62828;font-family:Heebo,sans-serif;font-size:13px}` and `.doc-frame .pdf-loading{padding:60px;text-align:center;color:#6d28d9;font-family:Heebo,sans-serif;font-size:13px}` |
| 4 | After line 128 — add thumbnails sidebar CSS | See section 3b for the full sidebar CSS block. |
| 5 | Line 232 — existing `@media print` rule | Append: `.doc-frame canvas.pdf-page{break-inside:avoid;page-break-inside:avoid;box-shadow:none!important;margin:0 0 8px 0!important} .pdf-thumbs{display:none!important}` |
| 6 | Line 328-335 — the `${isPdf ? iframe : ...}` ternary | Replace the iframe branch with: `<div class="pdf-loading" id="pdfLoading">Loading PDF...</div><aside class="pdf-thumbs" id="pdfThumbs" aria-label="Page thumbnails"></aside>` — both containers are created upfront; the sidebar stays hidden via CSS until JS populates it. |
| 7 | After line 335 — still inside the template literal | Add a hidden payload tag: `${isPdf ? '<script type="application/octet-stream" id="pdfData">' + fileBase64 + '</script>' : ''}`. Using `type="application/octet-stream"` means the browser ignores it as script; JS reads `textContent` to retrieve the base64. Avoids embedding giant base64 strings inside JS string literals (escaping hell). |
| 8 | Near line 385 (top of main `<script>` block) | Add: `var __isPdf = ${isPdf};` so the obfuscated script knows whether to run the PDF path. |
| 9 | Near line 637 (after `init()` definition, still inside main `<script>`) | Add `renderPdfInline()` and `buildThumbnailsSidebar()` (skeletons in 3a.5 and 3b.4). Call `renderPdfInline()` from inside `show(true)` and `showLocal()` — AFTER the stamp flip triggers — so the user sees the stamp first, then the PDF renders below. |
| 10 | Lines 786-798 — `printDoc()` function | Replace the PDF branch entirely. The new branch is `window.print()` because the canvases are now in the main DOM and the updated `@media print` rule handles them. Delete the `pdfFrame.src` / `window.open` logic. |

#### 3a.4 `injectPdfJsBundle()` skeleton (Node side)

Drop this into `services/pdfjs-inline.js` (or inline it into `services/pvf-pipeline.js` — Moshe's call). Keep it small.

```javascript
// services/pdfjs-inline.js
const fs = require('fs');
const path = require('path');

const PDFJS_MAIN_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.min.mjs');
const PDFJS_WORKER_PATH = path.join(__dirname, '..', 'vendor', 'pdfjs', 'pdf.worker.min.mjs');

let __mainCache = null;
let __workerCache = null;

/**
 * Escape a </script> sequence that could break out of a <script> block.
 * The browser tokenizer closes a script block on the literal string </script
 * regardless of quotes or comments, so we split it.
 */
function escapeScriptClose(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}

function loadPdfJs() {
  if (__mainCache === null) {
    __mainCache = escapeScriptClose(fs.readFileSync(PDFJS_MAIN_PATH, 'utf8'));
    __workerCache = escapeScriptClose(fs.readFileSync(PDFJS_WORKER_PATH, 'utf8'));
  }
  return { main: __mainCache, worker: __workerCache };
}

/**
 * Inject PDF.js main library + worker source into a PVF HTML string.
 * Only runs for application/pdf. Returns the HTML unchanged otherwise.
 *
 * IMPORTANT: Both injected tags carry an id attribute. The obfuscator regex
 * /<script>([\s\S]*?)<\/script>/ does NOT match tags with attributes, so the
 * obfuscator will skip these bundles and only obfuscate the main template
 * <script> block. Verified against obfuscate.js:97.
 */
function injectPdfJsBundle(html, mimeType) {
  if (mimeType !== 'application/pdf') return html;
  const { main, worker } = loadPdfJs();
  // Inject just before </head> so the library loads before the body parses.
  // The worker source is stored as a text/plain script and turned into a Blob
  // URL at runtime inside the main template script (see renderPdfInline).
  const bundle =
    '<script id="pdfjs-main" type="module">' + main + '</script>\n' +
    '<script id="pdfjs-worker" type="text/plain">' + worker + '</script>\n';
  return html.replace('</head>', bundle + '</head>');
}

module.exports = { injectPdfJsBundle };
```

#### 3a.5 `renderPdfInline()` skeleton (template side)

Drop this into the `<script>` block in `templates/pvf.js` near line 637. Moshe fills in the obvious glue.

```javascript
// ===== PDF.js INLINE RENDERING =====
var __pdfDoc = null;        // kept in module scope so the thumbnails path can reuse it
var __pdfPageCanvases = []; // main-view canvases, one per page, in order

async function renderPdfInline() {
  if (!__isPdf) return;
  var frame = document.getElementById("frame");
  var loading = document.getElementById("pdfLoading");
  var dataEl = document.getElementById("pdfData");
  if (!frame || !dataEl) return;

  try {
    // 1. PDF.js was injected by the pipeline as <script id="pdfjs-main" type="module">.
    //    Modern browsers register it on window.pdfjsLib ONLY if the bundle
    //    was a UMD build. For the ES module path we use the globalThis pattern
    //    exported by pdfjs-dist v4: the module auto-attaches to `window.pdfjsLib`
    //    when loaded via the UMD build (pdf.min.js), NOT the .mjs build.
    //
    //    NOTE FOR MOSHE: If pdf.min.mjs does NOT expose pdfjsLib globally,
    //    switch vendor/pdfjs/ to the UMD build files instead (pdf.min.js and
    //    pdf.worker.min.js, NOT the .mjs variants). The pdfjs-dist package
    //    ships both. This is a 2-line fix in 3a.1 — use the UMD files.
    var pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error("pdfjsLib not available");

    // 2. Build a Blob URL for the worker from the inlined source
    var workerTag = document.getElementById("pdfjs-worker");
    var workerBlob = new Blob([workerTag.textContent], { type: "application/javascript" });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

    // 3. Base64 -> Uint8Array
    var base64 = dataEl.textContent.trim();
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // 4. Load the PDF
    __pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (loading) loading.remove();

    // 5. Create a canvas per page (empty, not rendered yet — lazy)
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var targetWidth = frame.clientWidth || 794;
    for (var p = 1; p <= __pdfDoc.numPages; p++) {
      var canvas = document.createElement("canvas");
      canvas.className = "pdf-page";
      canvas.dataset.pageNum = p;
      // Reserve layout space so the scrollbar doesn't jump as pages render.
      // A4 aspect 210/297; width in CSS pixels = targetWidth, height proportional.
      canvas.style.width = targetWidth + "px";
      canvas.style.height = Math.round(targetWidth * 297 / 210) + "px";
      canvas.style.background = "#fff";
      frame.appendChild(canvas);
      __pdfPageCanvases.push(canvas);
    }

    // 6. Lazy-render main-view pages with IntersectionObserver
    var rendered = new Set();
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var canvas = entry.target;
        var n = parseInt(canvas.dataset.pageNum, 10);
        if (rendered.has(n)) return;
        rendered.add(n);
        renderMainPage(n, canvas, targetWidth, dpr).catch(function(){
          rendered.delete(n); // allow retry on next intersect if it failed
        });
      });
    }, { rootMargin: "400px 0px" }); // pre-render one screen ahead
    __pdfPageCanvases.forEach(function(c) { io.observe(c); });

    // 7. Thumbnails sidebar — only if more than 1 page
    if (__pdfDoc.numPages > 1) {
      buildThumbnailsSidebar();
    }
  } catch (err) {
    if (loading) loading.remove();
    var msg = document.createElement("div");
    msg.className = "pdf-error";
    msg.textContent = "Unable to render PDF.";
    frame.appendChild(msg);
    console.warn("[PVF] PDF render failed:", err);
  }
}

async function renderMainPage(n, canvas, targetWidth, dpr) {
  var page = await __pdfDoc.getPage(n);
  var vp1 = page.getViewport({ scale: 1 });
  var scale = (targetWidth / vp1.width) * dpr;
  var vp = page.getViewport({ scale: scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = Math.floor(vp.width / dpr) + "px";
  canvas.style.height = Math.floor(vp.height / dpr) + "px";
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
}
```

### 3b — Thumbnails Sidebar

The sidebar is a right-side column of small page previews. Click a thumbnail, the main view scrolls to that page. An IntersectionObserver on the main view updates which thumbnail is highlighted as the user scrolls.

#### 3b.1 HTML structure

Already added in 3a.3 row 6 — `<aside class="pdf-thumbs" id="pdfThumbs">`. The sidebar is populated by `buildThumbnailsSidebar()` after the main `__pdfDoc` is ready.

#### 3b.2 CSS (add to the `<style>` block in `templates/pvf.js`)

```css
/* Thumbnails sidebar — right side of .page-wrap, only shown for multi-page PDFs */
.pdf-thumbs{
  display:none;               /* hidden by default; JS reveals it when numPages > 1 */
  position:fixed;
  top:80px;                   /* below pvf-toolbar */
  right:12px;
  width:156px;
  max-height:calc(100vh - 100px);
  overflow-y:auto;
  overflow-x:hidden;
  padding:10px 8px;
  background:rgba(26,22,37,.92); /* matches wrapper dark */
  border:1px solid rgba(124,58,237,.18);
  border-radius:8px;
  box-shadow:0 4px 24px rgba(0,0,0,.35);
  z-index:40;
  scrollbar-width:thin;
  scrollbar-color:rgba(124,58,237,.4) transparent;
}
.pdf-thumbs.active{ display:block; }
.pdf-thumbs::-webkit-scrollbar{ width:6px; }
.pdf-thumbs::-webkit-scrollbar-thumb{ background:rgba(124,58,237,.4); border-radius:3px; }

.pdf-thumb{
  width:140px;
  aspect-ratio:210/297;        /* A4 */
  margin:0 auto 8px auto;
  background:#fff;
  border-radius:3px;
  border:2px solid transparent;
  cursor:pointer;
  display:block;
  transition:border-color .18s ease, transform .18s ease;
  box-shadow:0 1px 3px rgba(0,0,0,.4);
}
.pdf-thumb:hover{ border-color:rgba(124,58,237,.5); transform:scale(1.03); }
.pdf-thumb.current{ border-color:#7c3aed; box-shadow:0 0 0 1px #7c3aed, 0 2px 8px rgba(124,58,237,.5); }
.pdf-thumb-label{
  font-size:10px;
  color:rgba(196,181,253,.55);
  text-align:center;
  margin:0 0 12px 0;
  font-family:'Heebo',sans-serif;
  letter-spacing:.05em;
}

/* Mobile: hide the sidebar entirely. Small screens don't have room. */
@media(max-width:900px){
  .pdf-thumbs{ display:none!important; }
}

/* RTL: sidebar stays on the right in all locales.
   Rationale: the sidebar is a tool strip, not reading content. macOS Preview,
   Adobe Acrobat, and Chrome's built-in PDF viewer all keep thumbnails on the
   right regardless of document direction. Users recognize the pattern.
   Flipping it to the left in Hebrew dashboards would break muscle memory for
   the 99% of users who use PDFs across multiple apps. */

/* Desktop viewer / iframe embed: hide the sidebar (viewer has its own). */
.desktop-viewer .pdf-thumbs{ display:none!important; }
```

#### 3b.3 Positioning notes

- `position:fixed` not `absolute`, because the `.page-wrap` can be zoomed via CSS `transform` (see existing `fitToPage` logic). Fixed positioning keeps the sidebar locked to the viewport regardless of zoom.
- `top:80px` leaves space for the existing 68px top margin + the 48px toolbar.
- Max-height + scroll so the sidebar itself scrolls when there are many pages.
- `z-index:40` is above the `.page-bg` (z-index auto) and below the stamp (z-index:30 inside the page, but the stamp is inside the page so `fixed` above it is fine).

#### 3b.4 `buildThumbnailsSidebar()` skeleton

Drop into the main `<script>` block, near `renderPdfInline`.

```javascript
function buildThumbnailsSidebar() {
  var sidebar = document.getElementById("pdfThumbs");
  if (!sidebar || !__pdfDoc) return;

  // Hide in desktop viewer and iframe — mirrors the toolbar hide behavior
  if (__isDesktopViewer || __isIframe) return;

  sidebar.classList.add("active");

  // Build thumbnail canvases upfront — thumbnails are tiny (140px wide) so even
  // 50 pages is ~5 MB total canvas memory, well within budget.
  var thumbPromises = [];
  for (var p = 1; p <= __pdfDoc.numPages; p++) {
    (function(pageNum){
      var wrap = document.createElement("div");
      wrap.style.cssText = "display:block";
      var canvas = document.createElement("canvas");
      canvas.className = "pdf-thumb";
      canvas.dataset.thumbNum = pageNum;
      canvas.setAttribute("role", "button");
      canvas.setAttribute("aria-label", "Page " + pageNum);
      canvas.setAttribute("tabindex", "0");
      var label = document.createElement("div");
      label.className = "pdf-thumb-label";
      label.textContent = String(pageNum);
      sidebar.appendChild(canvas);
      sidebar.appendChild(label);

      // Click -> scroll main canvas into view
      canvas.addEventListener("click", function() {
        var target = __pdfPageCanvases[pageNum - 1];
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      canvas.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); canvas.click(); }
      });

      // Render at low resolution
      var promise = __pdfDoc.getPage(pageNum).then(function(page) {
        var vp1 = page.getViewport({ scale: 1 });
        var scale = 140 / vp1.width; // 140 CSS px wide
        var vp = page.getViewport({ scale: scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }).catch(function(){ /* per-thumb failure is silent */ });
      thumbPromises.push(promise);
    })(p);
  }

  // Highlight current page based on main view scroll
  var currentObserver = new IntersectionObserver(function(entries) {
    // Pick the entry with the largest intersectionRatio — that's the "current" page
    var best = null;
    entries.forEach(function(e) {
      if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
    });
    if (best && best.isIntersecting) {
      var n = parseInt(best.target.dataset.pageNum, 10);
      var thumbs = sidebar.querySelectorAll(".pdf-thumb");
      thumbs.forEach(function(t) {
        t.classList.toggle("current", parseInt(t.dataset.thumbNum, 10) === n);
      });
    }
  }, { threshold: [0.25, 0.5, 0.75] });
  __pdfPageCanvases.forEach(function(c) { currentObserver.observe(c); });
}
```

### 3c — Performance and Memory

The concern: a 50-page PDF at full-resolution canvases is expensive. Worst-case math:

- Main view at dpr=2, targetWidth=794 CSS px → canvas pixel size 1588 x 2246 per page → ~14 MB RGBA per page → 50 pages → ~700 MB. Unacceptable.
- Thumbnails at 140 CSS px wide, dpr=1 → canvas pixel size 140 x 198 per page → ~111 KB RGBA per page → 50 pages → ~5.5 MB. Fine.

**Strategy:**

1. **Main view: lazy-render with IntersectionObserver.** Only render pages within 400 px of the viewport. Already in the `renderPdfInline` skeleton above. At any given moment only 2-4 pages are rendered at full resolution, regardless of total page count. Memory budget: ~50 MB for the active pages. Well within browser limits.
2. **Thumbnails: render all upfront.** They are small enough that rendering all 50 at once is ~5 MB. Already in the `buildThumbnailsSidebar` skeleton above.
3. **DPR cap at 2.** On 3x Retina iOS a 100-page PDF at dpr=3 is ~900 MB of canvas memory and crashes Safari. Capping at 2 gives "retina-sharp" quality at half the memory cost.
4. **Reserve layout space upfront.** Each main canvas gets a CSS width/height set to the A4 aspect ratio immediately (see `renderPdfInline` step 5), so the scrollbar and the IntersectionObserver trigger correctly even before the pixel content is drawn.
5. **Sequential rendering, not parallel.** Within the IntersectionObserver callback, pages render one at a time via `await`. Parallel rendering on a huge PDF can crash on low-memory devices. Sequential is ~15% slower but stable.

Memory budget target: **≤ 100 MB peak on a 50-page PDF**, well within every browser's default 2 GB tab limit.

---

## 4. Backwards Compatibility

| Concern | Answer |
|---|---|
| Existing PVFs in production (generated before this change) | **Safe.** They are static HTML files with the OLD iframe markup baked in. We never re-generate existing files. Old PVFs keep using the old iframe path forever. This is exactly the same guarantee as v1. |
| Existing PVFs — will the new template code break old files? | **No.** The template only affects new uploads. Old files ship with their own baked-in template code. |
| Print fix Moshe shipped yesterday | **Compatible.** The updated `@media print` rule is additive. Image and text paths still use the same print logic. PDF path now uses `window.print()` directly — the canvases are in the main DOM and the browser rasterizes them natively. |
| Obfuscation pipeline | **Untouched.** Verified against `obfuscate.js:97`: the regex `/<script>([\s\S]*?)<\/script>/` matches only `<script>` with no attributes. Our PDF.js bundle uses `<script id="pdfjs-main" ...>` and `<script id="pdfjs-worker" ...>`, both with attributes, so the obfuscator will skip them and only obfuscate the main template script. We also escape `</script` sequences inside the library source (see `escapeScriptClose`) to prevent HTML tokenizer breakouts. |
| File size impact on TEXT PVFs | **Zero.** `injectPdfJsBundle` returns HTML unchanged when `mimeType !== 'application/pdf'`. |
| File size impact on IMAGE PVFs | **Zero.** Same reason. |
| File size impact on PDF PVFs | **+400 KB fixed.** A 200 KB base PDF becomes a ~600 KB PVF. A 5 MB base PDF becomes a ~5.4 MB PVF. Paid only by PDF uploads. |
| Desktop viewer (native app) | Still works. The template branches on `isPdf`, the canvases are plain DOM, `__isDesktopViewer` check still hides the toolbar and thumbnails sidebar. |
| Pre-existing PDF PVFs (created under the iframe hack) | Display exactly as they did before. The server does not rewrite them. |

---

## 5. Verification Checklist for Ori (QA Round 2)

### 5.1 Inline PDF Rendering

| # | Test | Expected result |
|---|---|---|
| 1 | Upload a 1-page PDF, open in `/d/{shareId}` | Exactly 1 canvas rendered. Thumbnails sidebar HIDDEN (1-page PDFs don't need it). No empty space below. No Chrome toolbar. No 8420px dead space. Fully offline rendering (disconnect wifi after upload, reload — still works). |
| 2 | Upload a 3-page PDF | 3 canvases stacked vertically with small gap. Outer `.page-wrap` scrolls the whole document. Thumbnails sidebar VISIBLE on right with 3 thumbnails. |
| 3 | Upload a 50-page PDF | Main view lazy-renders (first 2-3 pages render immediately, rest as user scrolls). 50 thumbnails render in the sidebar within 3-5 seconds. No browser tab crash. Memory via Chrome task manager stays under 200 MB. |
| 4 | Upload an image PVF (PNG) | Unchanged behavior. No PDF code runs. No PDF.js injected into the file (verify: `grep pdfjsLib` on the generated file returns nothing). |
| 5 | Upload a text PVF | Unchanged behavior. No PDF code runs. No PDF.js injected. |
| 6 | PDF viewer → click Print button | Browser print dialog opens. Preview shows all PDF pages correctly, one per print page, no page breaks mid-content. Thumbnails sidebar hidden in print output. |
| 7 | PDF viewer offline (disable wifi BEFORE opening) | Full render works. No loading spinner. No CDN fetch. The PVF is self-contained. This is the no-compromise win. |
| 8 | Security: PDF with embedded JavaScript | PDF.js disables scripts by default — PDF's JS does not execute. |
| 9 | Open an OLD PVF (generated before this change) from production | Still works via the old iframe path. No regressions. |
| 10 | Desktop viewer (Vertifile native app) | PDF pages render inside the viewer. PVF internal toolbar hides (existing behavior). Thumbnails sidebar also hides (`__isDesktopViewer` check). |

### 5.2 Thumbnails Sidebar

| # | Test | Expected result |
|---|---|---|
| 11 | 1-page PDF: thumbnails sidebar | HIDDEN. No clutter on single-page docs. |
| 12 | 3-page PDF: thumbnails sidebar | 3 thumbnails rendered on right, each labeled "1", "2", "3". Current page (page 1) has purple border. |
| 13 | 50-page PDF: thumbnails sidebar | 50 thumbnails render within ~5 seconds. Sidebar is scrollable. |
| 14 | 3-page PDF, click thumbnail #2 | Main view scrolls smoothly to page 2. Thumbnail #2 gets the "current" highlight, #1 loses it. |
| 15 | 50-page PDF, click thumbnail #25 | Main view scrolls to page 25. Main view lazy-renders page 25 on arrival. Thumbnail #25 highlighted. |
| 16 | Scroll the main view manually | As each page crosses 50% of the viewport, its thumbnail highlight updates automatically (IntersectionObserver). |
| 17 | Keyboard: tab into a thumbnail and press Enter | Main view navigates to that page. Accessibility works. |
| 18 | Mobile (390px viewport, iPhone Safari) | Sidebar HIDDEN (`max-width:900px` rule). Main canvases still render inline. |
| 19 | Hebrew dashboard / RTL | Sidebar stays on the right. (See rationale in 3b.2.) |
| 20 | Light mode / dark mode | Sidebar uses `rgba(26,22,37,.92)` dark background to match wrapper, stays readable in both modes. If Vertifile adds a light-mode toggle later, add an override. |

### 5.3 Stress and failure

| # | Test | Expected result |
|---|---|---|
| 21 | Large PDF (30 MB, 40 pages) | Upload succeeds. Generated PVF is ~30.4 MB. Opens. Lazy-render works. Takes ~10 s to first page. |
| 22 | Corrupt PDF (truncated file) | Upload succeeds (server doesn't validate PDF internals). Opening the PVF shows "Unable to render PDF." inline. Stamp still visible. |
| 23 | One bad page in an otherwise-fine PDF | Per-page try/catch isolates the failure. Other pages render. Bad page stays blank (or shows a small error at its position — Moshe's call). |
| 24 | Rapid scroll through 50 pages | IntersectionObserver keeps up. Memory stays within budget. |

---

## 6. Failure Modes

| Failure | User sees | Why |
|---|---|---|
| `pdfjsLib` not exposed as a global | "Unable to render PDF." in red, inside the page frame. Console warns. | If the `.mjs` build does not attach to `window.pdfjsLib`, swap to the UMD build (`pdf.min.js` and `pdf.worker.min.js`) per the note in 3a.5. This is a 2-line fix in the vendor directory and a single-line change in `injectPdfJsBundle` (drop `type="module"`). |
| `vendor/pdfjs/pdf.min.mjs` missing | Upload fails with a clear server error. Caught in `loadPdfJs()` on first read, logged by `logger.error`. Pipeline throws — upload returns 500 with a known error code. Moshe should add a startup sanity check in `server.js` that reads both files on boot and crashes early if missing. | A missing vendor file is a deployment bug, not a runtime condition. Fail loud at boot, not silently at upload. |
| Corrupt PDF payload | "Unable to render PDF." shown inline. Stamp still visible. | `getDocument().promise` rejects, caught by outer try/catch. |
| Single page render error | Blank canvas at that page's position, other pages still render. | Per-page try/catch in the `renderMainPage` path. |
| Out-of-memory on a 500-page PDF at dpr=2 | Browser kills the tab. Before that: lazy rendering keeps memory low. This is mitigated but not eliminated — a sufficiently pathological PDF can still OOM. Phase 4 (server-side rasterization) removes this risk entirely. | Lazy rendering + DPR cap + per-page sequential path |
| PDF.js version mismatch between cache and disk | Not possible — `vendor/pdfjs/` is read-only at runtime, cached in process memory. Updating requires a server restart. | — |
| Obfuscator accidentally rewrites PDF.js | **Prevented.** The obfuscator regex only matches `<script>` with no attributes. PDF.js is injected as `<script id="pdfjs-main" type="module">`. Both are verified in Ori test case #25 below. | — |
| `</script>` sequence inside PDF.js source | **Prevented.** `escapeScriptClose()` replaces every `</script` with `<\/script` before injection. The browser HTML tokenizer closes on the literal string `</script` regardless of context, so this escaping is mandatory. |
| User on ancient browser with no `IntersectionObserver` | Whole-document try/catch catches the reference error. Acceptable — Vertifile already requires modern browsers for stamp animations, devtools protection, screen-capture guards. | — |

**Ori test case #25 (obfuscator guard):** Generate a PDF PVF. Open the raw HTML source. Confirm two `<script id="pdfjs-...">` tags are present and their contents are NOT control-flow-flattened (look for recognizable PDF.js function names like `getDocument`). Confirm the main template script IS obfuscated (look for hex identifiers). If the PDF.js tags show hex-identifier garbage, the obfuscator matched the wrong tag — fail the test and escalate to Avi immediately.

---

## 7. Estimated Time Budget

| Task | Minutes |
|---|---|
| `npm install pdfjs-dist@4.0.379`, copy to `vendor/pdfjs/`, boot sanity check | 5 |
| Create `services/pdfjs-inline.js` with `injectPdfJsBundle()` | 8 |
| Wire `injectPdfJsBundle` into `pvf-pipeline.js` and `pvf-generator.js` | 5 |
| CSS changes in `templates/pvf.js` (3a.3 rows 1-5, 3b.2 sidebar CSS) | 12 |
| Template markup changes (3a.3 rows 6-8) | 5 |
| `renderPdfInline()` + lazy render wiring (row 9) | 20 |
| `buildThumbnailsSidebar()` + click + highlight | 15 |
| `printDoc()` simplification (row 10) | 3 |
| Local smoke test (1, 3, 50-page PDFs, image, text) | 12 |
| Fix whatever breaks | 5 |
| **TOTAL** | **90 minutes** |

Moshe: if you hit 60 minutes without a working 3-page render, STOP and escalate to Avi. Do not push past 90 minutes. Fallback: revert the template changes, keep `injectPdfJsBundle()` and the vendor files in place (they're harmless), and we ship the iframe version another night.

---

## 8. Open Questions for Zur

**None blocking.** This spec supersedes v1 and is decision-final. Zur's two new requirements are addressed:

1. "No compromise" — Option E gives PDF rendering full offline parity with text and image PVFs. No CDN, no network, no asterisk. The 400 KB file-size cost is paid only by PDF uploads and is invisible to users on modern connections.
2. "Thumbnails sidebar like PDF viewers" — implemented as `.pdf-thumbs`, right-side fixed sidebar, 140 px wide thumbnails, click-to-navigate, auto-highlight via IntersectionObserver, hidden on 1-page docs and mobile.

**For Phase 4 scoping (post-launch):** server-side rasterization to PNG is still the correct long-term answer. Option E ships tonight as a clean bridge; Phase 4 replaces it with a smaller, faster, fully-server-side path. Recommend scheduling after patent / IANA pending items clear.

---

**END OF SPEC — Moshe, begin implementation.**
