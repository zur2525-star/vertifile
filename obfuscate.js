/**
 * Vertifile PVF Obfuscation Module
 * Obfuscates the JavaScript inside .pvf files to prevent tampering.
 */

const JavaScriptObfuscator = require('javascript-obfuscator');

/**
 * Obfuscate JavaScript code with strong settings.
 * Preserves functionality while making reverse engineering very difficult.
 */
function obfuscateCode(code, seed) {
  const result = JavaScriptObfuscator.obfuscate(code, {
    // Core transforms
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,

    // String protection
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: 'function',
    splitStrings: true,
    splitStringsChunkLength: 8,

    // Identifier mangling
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,

    // Anti-debug (supplements our own DevTools detection)
    debugProtection: false,  // We have our own detection
    selfDefending: true,     // Prevents code formatting/beautification

    // Deterministic seed per document (same doc = same obfuscation)
    seed: seed || 0,

    // Target
    target: 'browser',

    // Don't transform these (they interface with DOM)
    reservedNames: [
      'HASH', 'SIG', 'API', 'token', 'init',
      'show', 'setOk', 'setFk', 'freezeStamp',
      'triggerFlip', 'showLocal', 'activateWaves',
      'startRefresh', '__securityFrozen', '__devToolsOpen',
      'isLocal'
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
