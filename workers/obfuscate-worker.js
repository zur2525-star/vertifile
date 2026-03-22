const { parentPort, workerData } = require('worker_threads');
const JavaScriptObfuscator = require('javascript-obfuscator');

const { code, options } = workerData;
try {
  const result = JavaScriptObfuscator.obfuscate(code, options);
  parentPort.postMessage({ success: true, code: result.getObfuscatedCode() });
} catch (e) {
  parentPort.postMessage({ success: false, code: code, error: e.message });
}
