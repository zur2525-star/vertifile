#!/usr/bin/env node
/**
 * Convert response-327212-pre-examination.md to a print-ready PDF.
 * Uses a minimal Markdown->HTML renderer (no npm deps) and Chrome headless.
 * Output: response-327212-pre-examination.pdf
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = __dirname;
const mdPath = path.join(DIR, 'response-327212-pre-examination.md');
const htmlPath = path.join(DIR, 'response-327212-pre-examination.html');
const pdfPath = path.join(DIR, 'response-327212-pre-examination.pdf');

// --- Minimal Markdown -> HTML (headings, lists, tables, bold, code, hr, paragraphs) ---
function mdToHtml(md) {
  // Strip YAML front-matter
  md = md.replace(/^---[\s\S]*?---\n/, '');

  // Escape angle brackets in inline content first (simplistic — good enough for this doc)
  md = md.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let inList = false;
  let listType = null;

  function closeList() {
    if (inList) { out.push(`</${listType}>`); inList = false; listType = null; }
  }

  function inline(s) {
    // bold **text**
    s = s.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    // italic _text_
    s = s.replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
    // inline code `code`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^\s*---\s*$/.test(line)) { closeList(); out.push('<hr/>'); i++; continue; }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { closeList(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    // Tables (| a | b | followed by |---|---|)
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|\s*$/.test(lines[i+1])) {
      closeList();
      const headerCells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      i += 2;
      out.push('<table><thead><tr>' + headerCells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        out.push('<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
        i++;
      }
      out.push('</tbody></table>');
      continue;
    }

    // Unordered list
    const ul = line.match(/^(\s*)-\s+(.*)$/);
    if (ul) {
      if (!inList || listType !== 'ul') { closeList(); out.push('<ul>'); inList = true; listType = 'ul'; }
      const content = ul[2].replace(/^\[([ x])\]\s*/, (_, ch) => ch === 'x' ? '<input type="checkbox" checked disabled/> ' : '<input type="checkbox" disabled/> ');
      out.push(`<li>${inline(content)}</li>`);
      i++; continue;
    }

    // Ordered list
    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ol) {
      if (!inList || listType !== 'ol') { closeList(); out.push('<ol>'); inList = true; listType = 'ol'; }
      out.push(`<li>${inline(ol[3])}</li>`);
      i++; continue;
    }

    // Blank line
    if (!line.trim()) { closeList(); out.push(''); i++; continue; }

    // Paragraph
    closeList();
    // Collect consecutive non-blank non-special lines
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\s*-\s|\s*\d+\.\s|\s*\|)/.test(lines[i]) && !/^\s*---\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push('<p>' + inline(para.join('<br/>\n')) + '</p>');
  }
  closeList();
  return out.join('\n');
}

let md = fs.readFileSync(mdPath, 'utf8');

// Use safe tokens in markdown that survive HTML-escaping, then inject the
// real signature + name block after markdown rendering.
const SIG_TOKEN  = 'VFSIGTOKEN20260419';
const NAME_TOKEN = 'VFNAMETOKEN20260419';
md = md.replace('<!-- SIGNATURE_SVG_PLACEHOLDER -->', SIG_TOKEN);
md = md.replace('<!-- APPLICANT_NAME_PLACEHOLDER -->', NAME_TOKEN);

let body = mdToHtml(md);

// Embed the handwritten signature SVG as a base64 data URI so it travels
// inside the PDF (no external dependency).
const sigPath = path.join(DIR, 'signature.svg');
let sigHtml = '<p>__________________________</p>';
if (fs.existsSync(sigPath)) {
  const sigB64 = fs.readFileSync(sigPath).toString('base64');
  sigHtml =
    '<div class="signature-block">' +
      '<img src="data:image/svg+xml;base64,' + sigB64 + '" class="signature-img" alt="חתימה"/>' +
    '</div>';
}
body = body.replace(SIG_TOKEN, sigHtml);

// Final signer block: bold name, then role, centered at bottom.
const nameHtml =
  '<div class="signer-block">' +
    '<div class="signer-name">צור חלפון</div>' +
    '<div class="signer-role">מבקש הפטנט</div>' +
  '</div>';
body = body.replace(NAME_TOKEN, nameHtml);

const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>תגובה להודעה לפני בחינה — בקשת פטנט 327212</title>
<style>
  @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
  :root {
    --ink: #111;
    --ink-soft: #333;
    --rule: #c7c7c7;
    --rule-soft: #e5e5e5;
    --accent: #1a1a1a;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Arial", "Helvetica Neue", "David", sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    color: var(--ink);
    direction: rtl;
  }
  h1 { font-size: 20pt; margin: 0 0 14pt; text-align: center; letter-spacing: -0.3pt; }
  h2 { font-size: 14pt; margin: 22pt 0 10pt; border-bottom: 1px solid var(--rule); padding-bottom: 4pt; }
  h3 { font-size: 12pt; margin: 16pt 0 6pt; color: var(--accent); }
  h4 { font-size: 11pt; margin: 12pt 0 4pt; }
  p { margin: 6pt 0; }
  ul, ol { margin: 6pt 18pt; padding: 0; }
  li { margin: 3pt 0; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 14pt 0; }
  strong { color: var(--ink); }
  code {
    font-family: var(--mono);
    font-size: 10pt;
    background: #f3f3f3;
    padding: 1pt 4pt;
    border-radius: 3pt;
  }
  a { color: var(--ink); text-decoration: underline; word-break: break-all; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8pt 0 12pt;
    font-size: 10pt;
  }
  th, td {
    border: 1px solid var(--rule);
    padding: 6pt 8pt;
    text-align: right;
    vertical-align: top;
  }
  th { background: #f0f0f0; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  /* Avoid split rows */
  tr, li, h1, h2, h3, h4 { page-break-inside: avoid; }
  h2, h3 { page-break-after: avoid; }
  /* Signature block */
  p:last-of-type { margin-bottom: 0; }
  /* Checkbox alignment */
  input[type="checkbox"] { margin-left: 4pt; transform: translateY(1pt); }
  /* Header/letterhead block spacing */
  body > p:first-of-type { margin-top: 0; }
  /* Signer block — signature + name at the very end of the document */
  .signature-block {
    margin: 32pt 0 0;
    display: flex;
    justify-content: center;
    page-break-inside: avoid;
  }
  .signature-img {
    max-height: 80pt;
    max-width: 240pt;
    width: auto;
    height: auto;
    display: block;
    object-fit: contain;
  }
  .signer-block {
    margin: 0 0 12pt;
    padding-top: 6pt;
    text-align: center;
    border-top: 1.5px solid var(--ink);
    max-width: 260pt;
    margin-left: auto;
    margin-right: auto;
    page-break-inside: avoid;
  }
  .signer-name {
    font-size: 14pt;
    font-weight: 800;
    color: var(--ink);
    letter-spacing: -0.2pt;
  }
  .signer-role {
    font-size: 10pt;
    color: var(--ink-soft);
    margin-top: 2pt;
  }
</style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('[build-response-pdf] HTML written: ' + htmlPath);

// --- Chrome headless -> PDF ---
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(chrome)) {
  console.error('Chrome not found at ' + chrome);
  process.exit(1);
}

try {
  execSync(`"${chrome}" --headless=new --disable-gpu --no-sandbox --print-to-pdf-no-header --print-to-pdf="${pdfPath}" "file://${htmlPath}"`, {
    stdio: 'inherit',
  });
  const stat = fs.statSync(pdfPath);
  console.log('[build-response-pdf] PDF written: ' + pdfPath + '  (' + (stat.size / 1024).toFixed(1) + ' KB)');
} catch (err) {
  console.error('Chrome PDF generation failed:', err.message);
  process.exit(1);
}
