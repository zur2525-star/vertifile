/**
 * Vertifile PVF Obfuscation Module
 * Obfuscates the JavaScript inside .pvf files to prevent tampering.
 */

const JavaScriptObfuscator = require('javascript-obfuscator');

/**
 * Obfuscate JavaScript code with settings safe for iframe/Electron contexts.
 */
function obfuscateCode(code, seed) {
  const result = JavaScriptObfuscator.obfuscate(code, {
    // Core transforms
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: false,       // Disabled — can produce invalid code in some contexts

    // String protection — conservative settings to prevent corruption
    stringArray: true,
    stringArrayThreshold: 0.5,
    stringArrayEncoding: [],         // No encoding — base64 encoding can corrupt strings
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: 'variable',
    splitStrings: false,             // Disabled — splitting strings can break HTML/CSS content
    transformObjectKeys: false,      // Disabled — prevents object key corruption

    // Identifier mangling
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,

    // Anti-debug
    debugProtection: false,
    selfDefending: false,            // Disabled — causes SyntaxError in iframe/Electron

    // Deterministic seed per document (same doc = same obfuscation)
    seed: seed || 0,

    // Target
    target: 'browser',

    // Reserved names — functions and variables used by the PVF viewer and verification
    reservedNames: [
      'HASH', 'SIG', 'API', 'RCPT', 'token', 'init',
      'show', 'setOk', 'setFk', 'freezeStamp',
      'triggerFlip', 'showLocal', 'activateWaves',
      'startRefresh', '__securityFrozen', '__devToolsOpen',
      '__screenCaptured', 'blankForCapture', 'screenCaptureGuard',
      'isLocal', 'hashFingerprint', 'environmentCheck',
      'pvfBridge', '__TAURI__',
      'postMessage', 'MutationObserver', 'querySelector',
      'contentDocument', 'contentWindow'
    ],

    // Reserved strings — don't obfuscate these string values
    reservedStrings: [
      'Vertifile', 'pvf-verification', 'verified', 'failed',
      'forged', 'big-x', 'lbl', 'stamp',
      'pvf:hash', 'pvf:version', 'pvf:signature',
      'PVF:1.0', 'screen-capture', 'display-capture'
    ]
  });

  return result.getObfuscatedCode();
}

/**
 * Obfuscate the <script> section of a PVF HTML string.
 * Extracts the script, obfuscates it, and puts it back.
 */
function obfuscatePvf(pvfHtml, seed) {
  // Extract the script content between <script> and </script>
  const scriptMatch = pvfHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return pvfHtml;

  const originalScript = scriptMatch[1];

  try {
    const obfuscatedScript = obfuscateCode(originalScript, seed);
    return pvfHtml.replace(
      `<script>${originalScript}</script>`,
      `<script>${obfuscatedScript}</script>`
    );
  } catch (error) {
    console.error('[OBFUSCATION] Failed, using original code:', error.message);
    return pvfHtml;
  }
}

module.exports = { obfuscateCode, obfuscatePvf };
