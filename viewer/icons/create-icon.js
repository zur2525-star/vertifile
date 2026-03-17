#!/usr/bin/env node
/**
 * Generate a simple PNG icon for PVF Viewer
 * Requires: canvas (npm i canvas) — or use sips on macOS
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create a simple SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#4c1d95"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
  <g transform="translate(512,512) scale(18)">
    <path d="M0-24l20.8 12v16.7c0 16.7-10 31.7-23.4 36.7C-16-55.1-23.4-40.1-23.4 4.6v-16.7L0-24z"
          fill="none" stroke="white" stroke-width="2" opacity="0.9"/>
    <path d="M-8 2l6 6 12-12" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <text x="512" y="820" text-anchor="middle" fill="white" font-family="Arial" font-weight="800" font-size="200" opacity="0.95">PVF</text>
</svg>`;

const svgPath = path.join(__dirname, 'icon.svg');
const pngPath = path.join(__dirname, 'icon.png');

fs.writeFileSync(svgPath, svg);
console.log('SVG icon created:', svgPath);

// Try to convert SVG to PNG using sips (macOS) or rsvg-convert
try {
  // On macOS, use sips to convert
  execSync(`qlmanage -t -s 1024 -o "${__dirname}" "${svgPath}" 2>/dev/null || true`);

  // Alternative: use built-in macOS tools
  const script = `
    tell application "System Events"
      set svgFile to POSIX file "${svgPath}"
    end tell
  `;

  console.log('PNG icon may need manual conversion from SVG.');
  console.log('Use: sips -s format png icon.svg --out icon.png');
} catch (e) {
  console.log('Could not auto-convert. SVG is ready for manual conversion.');
}
