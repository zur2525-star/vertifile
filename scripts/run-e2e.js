'use strict';

/**
 * E2E test runner for Vertifile.
 *
 * Steps:
 *   1. Validate required environment variables.
 *   2. Spawn the server on PORT=3002.
 *   3. Poll GET /api/health until 200 OK (30-second timeout).
 *   4. Run each E2E test file sequentially with `node --test`.
 *   5. Send SIGTERM to the server.
 *   6. Exit with 0 if all tests passed, 1 if any failed.
 */

const { spawn } = require('child_process');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const PORT = 3002;
const BASE_URL = `http://localhost:${PORT}`;
const HEALTH_URL = `${BASE_URL}/api/health`;
const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 30_000;

const E2E_TEST_FILES = [
  'tests/e2e-auth-flow.test.js',
  'tests/e2e-auth-onboarding.test.js',
  'tests/e2e-overage.test.js',
  'tests/e2e-stamp-config.test.js',
  'tests/e2e-upload-flow.test.js',
  'tests/e2e-verification.test.js',
];

// ---------------------------------------------------------------------------
// Environment validation & defaults
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  process.stderr.write(
    '[run-e2e] ERROR: DATABASE_URL is not set.\n' +
    '         Set it before running E2E tests, e.g.:\n' +
    '         DATABASE_URL=postgres://user:pass@localhost:5432/vertifile_test npm run test:e2e\n'
  );
  process.exit(1);
}

if (!process.env.HMAC_SECRET) {
  process.env.HMAC_SECRET = 'e2e-test-hmac-secret-do-not-use-in-production';
}

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'e2e-test-session-secret-do-not-use-in-production';
}

if (!process.env.ADMIN_SECRET) {
  process.env.ADMIN_SECRET = 'e2e-test-admin-secret-do-not-use-in-production';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the health endpoint until it responds with 200 OK.
 * Rejects after HEALTH_TIMEOUT_MS with a clear error.
 *
 * @returns {Promise<void>}
 */
async function waitForServer() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  process.stdout.write(`[run-e2e] Waiting for server at ${HEALTH_URL} ...\n`);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.status === 200) {
        process.stdout.write('[run-e2e] Server is ready.\n');
        return;
      }
      // Non-200 — server is up but unhealthy; keep waiting.
    } catch {
      // Connection refused / ECONNREFUSED — server not yet accepting connections.
    }

    await sleep(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `[run-e2e] Server did not become ready within ${HEALTH_TIMEOUT_MS / 1000} seconds. ` +
    `Check that ${HEALTH_URL} exists and returns 200.`
  );
}

/**
 * Spawn a child process and return a promise that resolves with its exit code.
 * stdout/stderr are inherited so output appears in the terminal in real time.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
function spawnProcess(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env,
    });

    child.on('error', (err) => {
      reject(new Error(`[run-e2e] Failed to spawn "${cmd}": ${err.message}`));
    });

    child.on('close', (code, signal) => {
      if (code !== null) {
        resolve(code);
      } else {
        // Killed by signal — treat as failure.
        resolve(1);
      }
    });
  });
}

/**
 * Kill a child process and wait for it to exit.
 *
 * @param {import('child_process').ChildProcess} child
 * @returns {Promise<void>}
 */
function killProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    child.once('close', () => resolve());

    try {
      child.kill('SIGTERM');
    } catch {
      // Process may have already exited — ignore.
      resolve();
    }

    // Force-kill after 5 seconds if SIGTERM is ignored.
    const forceTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore.
      }
    }, 5_000);

    child.once('close', () => clearTimeout(forceTimer));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- 1. Start the server ---------------------------------------------------

  process.stdout.write(`[run-e2e] Starting server (PORT=${PORT}) ...\n`);

  const serverEnv = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: process.env.NODE_ENV || 'test',
  };

  const serverProcess = spawn(
    process.execPath, // node
    [path.join(ROOT, 'server.js')],
    {
      stdio: 'inherit',
      env: serverEnv,
    }
  );

  let serverStartError = null;

  serverProcess.on('error', (err) => {
    serverStartError = err;
  });

  // Detect early exit (crash before health check passes).
  let serverExited = false;
  serverProcess.on('close', (code) => {
    serverExited = true;
    if (code !== 0) {
      serverStartError = serverStartError || new Error(
        `[run-e2e] Server process exited with code ${code} before tests could run.`
      );
    }
  });

  // --- 2. Wait for the server to be healthy ---------------------------------

  try {
    // Give the event loop a tick so the 'error' / 'close' listeners can fire
    // if the spawn itself fails immediately.
    await sleep(100);

    if (serverStartError) {
      throw serverStartError;
    }

    if (serverExited) {
      throw new Error(
        '[run-e2e] Server process exited immediately. Check server.js and DATABASE_URL.'
      );
    }

    await waitForServer();
  } catch (err) {
    process.stderr.write(`[run-e2e] ERROR: ${err.message}\n`);
    await killProcess(serverProcess);
    process.exit(1);
  }

  // --- 3. Run E2E tests sequentially ----------------------------------------

  const testEnv = {
    ...serverEnv,
    TEST_BASE_URL: BASE_URL,
  };

  let allPassed = true;

  for (const relTestFile of E2E_TEST_FILES) {
    const absTestFile = path.join(ROOT, relTestFile);

    process.stdout.write(`\n[run-e2e] Running: ${relTestFile}\n`);

    let exitCode;
    try {
      exitCode = await spawnProcess(
        process.execPath,
        ['--test', absTestFile],
        testEnv
      );
    } catch (spawnErr) {
      process.stderr.write(`[run-e2e] ERROR spawning test: ${spawnErr.message}\n`);
      exitCode = 1;
    }

    if (exitCode !== 0) {
      process.stderr.write(`[run-e2e] FAILED: ${relTestFile} (exit code ${exitCode})\n`);
      allPassed = false;
    } else {
      process.stdout.write(`[run-e2e] PASSED: ${relTestFile}\n`);
    }
  }

  // --- 4. Shut down the server ----------------------------------------------

  process.stdout.write('\n[run-e2e] Shutting down server ...\n');
  await killProcess(serverProcess);
  process.stdout.write('[run-e2e] Server stopped.\n');

  // --- 5. Exit with combined result -----------------------------------------

  if (allPassed) {
    process.stdout.write('[run-e2e] All E2E tests passed.\n');
    process.exit(0);
  } else {
    process.stderr.write('[run-e2e] One or more E2E tests failed.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[run-e2e] Unhandled error: ${err.message}\n`);
  process.exit(1);
});
