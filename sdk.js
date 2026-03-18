#!/usr/bin/env node
/**
 * Vertifile SDK — CLI + Library
 *
 * Usage as CLI:
 *   node sdk.js convert document.pdf
 *   node sdk.js convert document.pdf --output protected.pvf
 *
 * Usage as library:
 *   const { convertToPvf } = require('./sdk');
 *   await convertToPvf('document.pdf', 'output.pvf', { apiKey: '...' });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== CONFIG =====
const DEFAULT_SERVER = process.env.VERTIFILE_SERVER || 'http://localhost:3002';
const DEFAULT_API_KEY = process.env.VERTIFILE_API_KEY || '';

/**
 * Convert any file to .pvf format
 *
 * @param {string} inputPath - Path to the source file (PDF, image, text)
 * @param {string} outputPath - Path for the output .pvf file (optional)
 * @param {object} options - { apiKey, server }
 * @returns {object} - { success, outputPath, hash, size }
 */
async function convertToPvf(inputPath, outputPath, options = {}) {
  const server = options.server || DEFAULT_SERVER;
  const apiKey = options.apiKey || DEFAULT_API_KEY;

  if (!apiKey) {
    throw new Error('API key required. Set VERTIFILE_API_KEY env var or pass apiKey option.');
  }

  // Verify input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  // Default output path: same name but .pvf
  if (!outputPath) {
    outputPath = inputPath.replace(/\.[^.]+$/, '') + '.pvf';
  }

  const fileName = path.basename(inputPath);
  const fileBuffer = fs.readFileSync(inputPath);

  console.log(`📄 Input:  ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`🔒 Processing blindly (not reading content)...`);

  // Create form data manually using fetch
  const FormData = (await import('node-fetch')).FormData || globalThis.FormData;

  // Use native fetch or node-fetch
  let fetchFn;
  try {
    fetchFn = globalThis.fetch || (await import('node-fetch')).default;
  } catch {
    fetchFn = globalThis.fetch;
  }

  // Build multipart request
  const boundary = '----VertifileBoundary' + crypto.randomBytes(8).toString('hex');
  const mimeType = getMimeType(inputPath);

  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
    `Content-Type: ${mimeType}\r\n\r\n`,
  ];

  const bodyStart = Buffer.from(bodyParts.join(''));
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetchFn(`${server}/api/create-pvf`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Server error: ${error.error || response.statusText}`);
  }

  const pvfContent = await response.text();

  if (!pvfContent.includes('PVF') && !pvfContent.includes('Vertifile')) {
    throw new Error('Invalid PVF response from server');
  }

  // Save .pvf file
  fs.writeFileSync(outputPath, pvfContent, 'utf8');

  const stats = fs.statSync(outputPath);
  console.log(`✅ Output: ${path.basename(outputPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`📍 Saved:  ${path.resolve(outputPath)}`);

  return {
    success: true,
    outputPath: path.resolve(outputPath),
    inputSize: fileBuffer.length,
    outputSize: stats.size,
  };
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[ext] || 'application/octet-stream';
}

// ===== CLI MODE =====
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
╔══════════════════════════════════════════╗
║        Vertifile SDK — CLI Tool          ║
╚══════════════════════════════════════════╝

Usage:
  node sdk.js <input-file> [output-file]

Examples:
  node sdk.js document.pdf
  node sdk.js contract.pdf protected-contract.pvf
  node sdk.js photo.png

Environment:
  VERTIFILE_API_KEY   Your API key (required)
  VERTIFILE_SERVER    Server URL (default: http://localhost:3002)
`);
    process.exit(0);
  }

  const inputFile = args[0];
  const outputFile = args[1] || null;
  const apiKey = process.env.VERTIFILE_API_KEY;

  if (!apiKey) {
    console.error('❌ Set VERTIFILE_API_KEY environment variable');
    process.exit(1);
  }

  console.log('');
  console.log('🛡️  Vertifile — Converting to PVF');
  console.log('─'.repeat(40));

  convertToPvf(inputFile, outputFile, {
    apiKey: process.env.VERTIFILE_API_KEY,
    server: process.env.VERTIFILE_SERVER || DEFAULT_SERVER,
  })
    .then(result => {
      console.log('─'.repeat(40));
      console.log('🎉 Done! Open the .pvf file in a browser.');
      console.log('');
    })
    .catch(err => {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { convertToPvf };
