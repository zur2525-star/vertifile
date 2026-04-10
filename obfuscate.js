/**
const logger = require("./services/logger");
 * Vertifile PVF Obfuscation Module
 * Obfuscates the JavaScript inside .pvf files to prevent tampering.
 * Uses worker threads to avoid blocking the event loop.
 */

const { Worker } = require('worker_threads');
const path = require('path');

const OBFUSCATION_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  stringArrayEncoding: [],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: 'variable',
  splitStrings: false,
  transformObjectKeys: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  debugProtection: false,
  selfDefending: false,
  target: 'browser',
  reservedNames: [
    'HASH', 'SIG', 'API', 'RCPT', 'SHAREID', 'SIG_ED', 'KEY_ID', 'CREATED', 'ORGID', 'token', 'init',
    'show', 'setOk', 'setFk', 'freezeStamp',
    'triggerFlip', 'showLocal', 'activateWaves',
    'startRefresh', '__securityFrozen', '__devToolsOpen',
    '__screenCaptured', 'blankForCapture', 'screenCaptureGuard',
    'isLocal', 'hashFingerprint', 'environmentCheck',
    'pvfBridge', '__TAURI__',
    'postMessage', 'MutationObserver', 'querySelector',
    'contentDocument', 'contentWindow'
  ],
  reservedStrings: [
    'Vertifile', 'pvf-verification', 'verified', 'failed',
    'forged', 'big-x', 'lbl', 'stamp',
    'pvf:hash', 'pvf:version', 'pvf:signature',
    'PVF:1.0', 'screen-capture', 'display-capture'
  ]
};

/**
 * Obfuscate code in a worker thread (non-blocking).
 * Returns a Promise that resolves with the obfuscated code.
 * Falls back to original code on failure or timeout.
 */
function obfuscateCode(code, seed) {
  return new Promise((resolve) => {
    const options = { ...OBFUSCATION_OPTIONS, seed: seed || 0 };
    const worker = new Worker(path.join(__dirname, 'workers', 'obfuscate-worker.js'), {
      workerData: { code, options }
    });

    const timeout = setTimeout(() => {
      logger.error('[OBFUSCATION] Worker timed out after 30s, using original code');
      worker.terminate();
      resolve(code);
    }, 30000);

    worker.on('message', (msg) => {
      clearTimeout(timeout);
      if (msg.success) {
        resolve(msg.code);
      } else {
        logger.error('[OBFUSCATION] Worker failed:', msg.error);
        resolve(code);
      }
    });

    worker.on('error', (err) => {
      clearTimeout(timeout);
      logger.error('[OBFUSCATION] Worker error:', err.message);
      resolve(code);
    });

    worker.on('exit', (exitCode) => {
      if (exitCode !== 0) {
        clearTimeout(timeout);
        resolve(code);
      }
    });
  });
}

/**
 * Obfuscate the <script> section of a PVF HTML string.
 * Returns a Promise. Non-blocking.
 */
async function obfuscatePvf(pvfHtml, seed) {
  const scriptMatch = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return pvfHtml;

  const originalScript = scriptMatch[1];

  try {
    const obfuscatedScript = await obfuscateCode(originalScript, seed);
    return pvfHtml.replace(
      `<script>${originalScript}</script>`,
      `<script>${obfuscatedScript}</script>`
    );
  } catch (error) {
    logger.error('[OBFUSCATION] Failed, using original code:', error.message);
    return pvfHtml;
  }
}

module.exports = { obfuscateCode, obfuscatePvf };
