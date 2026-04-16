#!/usr/bin/env node
'use strict';

/**
 * Vertifile — Performance Benchmark
 *
 * Starts the Express server on a random free port, creates a test API key,
 * runs N=100 iterations over each key endpoint, then prints a results table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/benchmark.js
 *   DATABASE_URL=postgres://... npm run benchmark
 *
 * Exits 0 on success, 1 on error.
 */

const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Guard: DATABASE_URL is required
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  process.stderr.write(
    '[benchmark] ERROR: DATABASE_URL environment variable is not set.\n' +
    '  Example: DATABASE_URL=postgres://user:pass@host/db node scripts/benchmark.js\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test environment constants
// ---------------------------------------------------------------------------
process.env.HMAC_SECRET     = process.env.HMAC_SECRET     || 'benchmark-hmac-secret-local';
process.env.ADMIN_SECRET    = process.env.ADMIN_SECRET    || 'benchmark-admin-secret-local';
process.env.SESSION_SECRET  = process.env.SESSION_SECRET  || 'benchmark-session-secret-local';
process.env.PORT            = '0'; // let the OS assign a free port

const HMAC_SECRET = process.env.HMAC_SECRET;
const N = 100; // iterations per endpoint

// ---------------------------------------------------------------------------
// Multipart/form-data builder (no external deps)
// ---------------------------------------------------------------------------
function buildMultipart(fields) {
  const boundary = '----VFBench' + crypto.randomBytes(12).toString('hex');
  const parts = [];

  for (const field of fields) {
    let header = `--${boundary}\r\n`;
    if (field.filename) {
      header += `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`;
      header += `Content-Type: ${field.contentType || 'application/octet-stream'}\r\n\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
    }
    parts.push(Buffer.from(header, 'utf8'));
    parts.push(Buffer.isBuffer(field.value) ? field.value : Buffer.from(String(field.value), 'utf8'));
    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  return { body, contentType };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
let server = null;
let BASE_URL = '';

function startServer() {
  return new Promise((resolve, reject) => {
    // Clear require cache so we get a clean app instance
    const appPath = path.resolve(__dirname, '..', 'server.js');
    const dbPath  = path.resolve(__dirname, '..', 'db.js');

    delete require.cache[appPath];
    delete require.cache[dbPath];

    const app = require(appPath);
    const db  = require(dbPath);

    db._ready.then(() => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        BASE_URL = `http://127.0.0.1:${port}`;
        process.stdout.write(`[benchmark] Server listening at ${BASE_URL}\n`);
        resolve();
      });
      server.on('error', reject);
    }).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Core benchmark runner
// ---------------------------------------------------------------------------
async function benchmark(name, fn, n = N) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  const mean  = total / n;
  return {
    name,
    n,
    min:  times[0],
    max:  times[n - 1],
    mean,
    p50:  times[Math.floor(n * 0.50)],
    p95:  times[Math.floor(n * 0.95)],
    p99:  times[Math.floor(n * 0.99)],
    rps:  1000 / mean,
  };
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------
function printTable(results) {
  // Column headers
  const COLS = ['Endpoint', 'N', 'Min ms', 'Max ms', 'Mean ms', 'p50 ms', 'p95 ms', 'p99 ms', 'Req/s'];

  // Format a number to fixed decimal places, or a string as-is
  const fmt = (v, dec) => (typeof v === 'number' ? v.toFixed(dec) : String(v));

  // Build rows as string arrays
  const rows = results.map(r => [
    r.name,
    String(r.n),
    fmt(r.min,  2),
    fmt(r.max,  2),
    fmt(r.mean, 2),
    fmt(r.p50,  2),
    fmt(r.p95,  2),
    fmt(r.p99,  2),
    fmt(r.rps,  1),
  ]);

  // Compute column widths
  const widths = COLS.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );

  const sep  = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const line = (cells) => '|' + cells.map((c, i) => ' ' + c.padStart(widths[i]) + ' ').join('|') + '|';

  process.stdout.write('\n');
  process.stdout.write(sep + '\n');
  process.stdout.write(line(COLS) + '\n');
  process.stdout.write(sep + '\n');
  for (const row of rows) {
    process.stdout.write(line(row) + '\n');
  }
  process.stdout.write(sep + '\n');
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// Small ~1 KB text file buffer (reused across iterations)
// ---------------------------------------------------------------------------
const SAMPLE_FILE = Buffer.from(
  'Vertifile benchmark test document.\n' +
  'This file is used for performance measurement only.\n' +
  'Content: ' + 'A'.repeat(900) + '\n'
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await startServer();

  // ------------------------------------------------------------------
  // 1. Create a test API key via POST /api/signup
  // ------------------------------------------------------------------
  const RUN_ID  = crypto.randomBytes(4).toString('hex');
  const signupEmail = `benchmark-${RUN_ID}@bench.internal`;

  process.stdout.write(`[benchmark] Creating test API key (${signupEmail})...\n`);

  const signupRes = await fetch(`${BASE_URL}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName:     'Benchmark Org',
      contactName: 'Benchmark Runner',
      email:       signupEmail,
      useCase:     'performance benchmarking',
      password:    'BenchmarkPass123!',
    }),
  });

  if (!signupRes.ok) {
    const text = await signupRes.text();
    throw new Error(`Signup failed (${signupRes.status}): ${text}`);
  }

  const signupData = await signupRes.json();
  if (!signupData.success || !signupData.apiKey) {
    throw new Error(`Signup returned unexpected payload: ${JSON.stringify(signupData)}`);
  }

  const apiKey = signupData.apiKey;
  process.stdout.write(`[benchmark] API key obtained: ${apiKey.slice(0, 12)}...\n`);

  // ------------------------------------------------------------------
  // 2. Create one PVF upfront so we have a real hash+signature for
  //    the verify benchmarks (avoids cold-path overhead inside the loop)
  // ------------------------------------------------------------------
  process.stdout.write('[benchmark] Creating seed PVF for verify benchmarks...\n');

  const { body: seedBody, contentType: seedCT } = buildMultipart([
    { name: 'file', filename: 'seed.txt', contentType: 'text/plain', value: SAMPLE_FILE },
  ]);

  const seedRes = await fetch(`${BASE_URL}/api/create-pvf?format=json`, {
    method: 'POST',
    headers: { 'Content-Type': seedCT, 'X-API-Key': apiKey },
    body: seedBody,
  });

  if (!seedRes.ok) {
    const text = await seedRes.text();
    throw new Error(`Seed PVF creation failed (${seedRes.status}): ${text}`);
  }

  const seedData = await seedRes.json();
  if (!seedData.success || !seedData.hash) {
    throw new Error(`Seed PVF returned unexpected payload: ${JSON.stringify(seedData)}`);
  }

  const seedHash = seedData.hash;
  const seedSig  = crypto.createHmac('sha256', HMAC_SECRET).update(seedHash).digest('hex');
  process.stdout.write(`[benchmark] Seed PVF hash: ${seedHash.slice(0, 16)}...\n`);

  // ------------------------------------------------------------------
  // 3. Run benchmarks
  // ------------------------------------------------------------------
  process.stdout.write(`[benchmark] Running benchmarks (N=${N} per endpoint)...\n\n`);

  const results = [];

  // --- GET /api/health (baseline) ---
  results.push(await benchmark('GET /api/health', async () => {
    const r = await fetch(`${BASE_URL}/api/health`);
    await r.text();
  }));
  process.stdout.write(`[benchmark] Done: GET /api/health\n`);

  // --- POST /api/demo/create-pvf (~1 KB text file) ---
  results.push(await benchmark('POST /api/demo/create-pvf', async () => {
    const { body, contentType } = buildMultipart([
      {
        name: 'file',
        filename: 'bench.txt',
        contentType: 'text/plain',
        value: Buffer.from('Benchmark iteration ' + performance.now()),
      },
    ]);
    const r = await fetch(`${BASE_URL}/api/demo/create-pvf`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    await r.text();
  }));
  process.stdout.write(`[benchmark] Done: POST /api/demo/create-pvf\n`);

  // --- POST /api/verify (verify seed PVF) ---
  results.push(await benchmark('POST /api/verify', async () => {
    const r = await fetch(`${BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: seedHash, signature: seedSig }),
    });
    await r.text();
  }));
  process.stdout.write(`[benchmark] Done: POST /api/verify\n`);

  // --- GET /api/verify-public (stateless — sends intentionally invalid params,
  //     which still exercises the full HTTP + routing + validation path.
  //     A valid Ed25519 verify-public call requires a live signing key that
  //     only exists at document-creation time; this measures the endpoint
  //     latency from the outside.) ---
  const fakeHash    = 'a'.repeat(64);
  const fakeSig     = 'A'.repeat(86);    // 86 base64url chars = 64 Ed25519 bytes
  const fakeKeyId   = 'b'.repeat(16);
  const fakePayload = fakeHash + '|fake-org|2026-01-01T00:00:00.000Z|' + 'c'.repeat(64) + '|';
  const verifyPublicUrl = `${BASE_URL}/api/verify-public` +
    `?hash=${fakeHash}&signature=${fakeSig}&keyId=${fakeKeyId}` +
    `&payload=${encodeURIComponent(fakePayload)}`;

  results.push(await benchmark('GET /api/verify-public', async () => {
    const r = await fetch(verifyPublicUrl);
    await r.text();
  }));
  process.stdout.write(`[benchmark] Done: GET /api/verify-public\n`);

  // --- GET /api/org/stats (auth required) ---
  results.push(await benchmark('GET /api/org/stats', async () => {
    const r = await fetch(`${BASE_URL}/api/org/stats`, {
      headers: { 'X-API-Key': apiKey },
    });
    await r.text();
  }));
  process.stdout.write(`[benchmark] Done: GET /api/org/stats\n`);

  // ------------------------------------------------------------------
  // 4. Print results table
  // ------------------------------------------------------------------
  printTable(results);

  // ------------------------------------------------------------------
  // 5. Shutdown
  // ------------------------------------------------------------------
  process.stdout.write('[benchmark] Shutting down server...\n');
  await stopServer();
  process.stdout.write('[benchmark] Done.\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[benchmark] FATAL: ${err.message || err}\n`);
  if (err.stack) process.stderr.write(err.stack + '\n');
  stopServer().finally(() => process.exit(1));
});
