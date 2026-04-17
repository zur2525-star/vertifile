const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const db = require('./db');
const chain = require('./blockchain');
const { createAuthenticateApiKey, createAuthenticateAdmin } = require('./middleware/auth');
const { requestTimeout } = require('./middleware/timeout');
const { sanitizeBody } = require('./middleware/sanitize');
const logger = require('./services/logger');
const { signHash, generateToken } = require('./services/pvf-generator');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const gatewayRoutes = require('./routes/gateway');
const webhookRoutes = require('./routes/webhooks');
const pageRoutes = require('./routes/pages');
const onboardingRoutes = require('./routes/onboarding');
const wellKnownRoutes = require('./routes/well-known');
const keyManager = require('./services/key-manager');
const { requestLogger } = require('./middleware/request-logger');
const { responseEnvelope } = require('./middleware/response-envelope');
const { trackError } = require('./middleware/error-alerter');
const { csrfProtection, csrfTokenEndpoint } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/error-handler');
const { validateEnv } = require('./services/env-validator');

// ---- Startup environment validation ----
// Must run before any middleware or routes so missing vars cause a clear
// boot-time error rather than a silent runtime failure.
validateEnv();

const app = express();
const PORT = process.env.PORT || 3002;

// ---- Boot sanity check: PDF.js vendor files must exist on disk ----
// The PVF pipeline reads these at upload time for PDF documents.
// A missing file is a deployment bug, not a runtime condition — fail loud
// at boot so it never surprises us mid-upload. See services/pdfjs-inline.js
// for the runtime injection logic and docs/PDF-JS-INLINE-SPEC.md section 6.
(function verifyPdfjsVendor() {
  const pdfjsMain = path.join(__dirname, 'vendor', 'pdfjs', 'pdf.min.mjs');
  const pdfjsWorker = path.join(__dirname, 'vendor', 'pdfjs', 'pdf.worker.min.mjs');
  if (!fs.existsSync(pdfjsMain) || !fs.existsSync(pdfjsWorker)) {
    logger.error(
      { event: 'pdfjs_vendor_missing', pdfjsMain, pdfjsWorker },
      'PDF.js vendor files missing. Run: npm install pdfjs-dist@4.0.379 && cp node_modules/pdfjs-dist/build/pdf.min.mjs vendor/pdfjs/ && cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs vendor/pdfjs/'
    );
    // Do not crash — non-PDF PVFs still work. Log loud and continue.
    // PDF uploads will throw a clear error at injection time.
  }
})();

// SESSION_SECRET — MUST be set as an environment variable in production.
//
// On Render: Dashboard -> Your Service -> Environment -> Add Environment Variable
//   Key:   SESSION_SECRET
//   Value: (generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
//
// Without SESSION_SECRET in production, every deploy/restart invalidates all
// active sessions (users get logged out). env-validator.js will fatal-exit if
// SESSION_SECRET is missing when RENDER or NODE_ENV=production is set.
//
// In development: falls back to a file persisted at data/.session_secret so
// you don't get logged out on every nodemon restart.
function loadOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // In production (Render), require SESSION_SECRET env var — no file fallback
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    logger.warn('[SECURITY] SESSION_SECRET env var not set in production — generating ephemeral secret (sessions will not survive restarts)');
    return 'vf_session_' + crypto.randomBytes(32).toString('hex');
  }
  // Development only: file-based persistence
  const SESSION_SECRET_FILE = path.join(__dirname, 'data', '.session_secret');
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const s = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      if (s.length >= 32) return s;
    }
  } catch (e) { /* fall through */ }
  const s = 'vf_session_' + crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(SESSION_SECRET_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_SECRET_FILE, s, { mode: 0o600 });
  } catch (e) { logger.error('[SECURITY] Could not persist session secret:', e.message); }
  return s;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.set('db', db);
app.set('chain', chain);
app.set('upload', upload);
app.set('authenticateApiKey', createAuthenticateApiKey(db));
app.set('authenticateAdmin', createAuthenticateAdmin(db));
app.set('trust proxy', 1);

// Stamp config in-memory cache (Layer 2 visual wrapper)
// userId -> { config, expiresAt }
// TTL 5 min. Invalidated on POST /api/user/stamp. Max 10k entries.
const STAMP_CACHE_TTL_MS = 5 * 60 * 1000;
const STAMP_CACHE_MAX_SIZE = 10000;
const stampCache = new Map();
stampCache._get = function(userId) {
  const e = this.get(userId);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { this.delete(userId); return null; }
  return e.config;
};
stampCache._set = function(userId, config) {
  // Evict expired entries if cache is at capacity
  if (this.size >= STAMP_CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [key, val] of this) {
      if (now > val.expiresAt) this.delete(key);
    }
    // If still at capacity after expiry sweep, drop oldest 20%
    if (this.size >= STAMP_CACHE_MAX_SIZE) {
      const keysToDelete = Array.from(this.keys()).slice(0, Math.floor(STAMP_CACHE_MAX_SIZE * 0.2));
      for (const k of keysToDelete) this.delete(k);
    }
  }
  this.set(userId, { config, expiresAt: Date.now() + STAMP_CACHE_TTL_MS });
};
app.set('stampCache', stampCache);

// Generate a fresh cryptographic nonce for every request.
// CSP uses 'unsafe-inline' for scriptSrc. The nonce middleware was removed
// because the project serves static HTML via express.static, and static files
// cannot receive a dynamic nonce attribute. Modern browsers ignore
// 'unsafe-inline' when a nonce source is present in the CSP, which breaks
// every inline <script> on the static pages (hero animation, FAQ, etc.).
// If server-side rendering is added in the future, nonces can be reintroduced.

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // required for static HTML inline scripts (animations, etc.)
        // Note: do NOT add a nonce source here — modern browsers IGNORE 'unsafe-inline'
        // when a nonce source is present, which would break every inline <script>
        // in the static HTML pages (hero animation, FAQ toggle, scroll reveal, etc.).
        "https://plausible.io",
      ],
      scriptSrcAttr: ["'unsafe-inline'"], // inline event handlers (onclick, onload) used throughout static HTML
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.vertifile.com", "https://vertifile.com", "https://plausible.io"],
      frameSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],          // Prevent base tag injection
      formAction: ["'self'"],       // Prevent form submission to external domains
      frameAncestors: ["'none'"],   // Prevent clickjacking (replaces X-Frame-Options)
      workerSrc: ["'self'", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false,
  dnsPrefetchControl: { allow: false },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
  }
}));

// helmet v8 silently ignores permissionsPolicy — set the header manually
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

const ALLOWED_ORIGINS = [
  'https://vertifile.com',
  'https://www.vertifile.com',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3002'] : [])
];

// Issue #19: CORS localhost safety check for production
if (process.env.NODE_ENV === 'production' && ALLOWED_ORIGINS.includes('http://localhost:3002')) {
  throw new Error('SECURITY: localhost in production CORS origins');
}

// ---- Phase 2D: public crypto verification — trust-minimized CORS ----
// These endpoints publish cryptographic material (public keys, verification
// results) and are meant to be called from any origin, including third-party
// auditors running in a browser. They send Access-Control-Allow-Origin: *
// with NO credentials. The restrictive CORS below applies to every OTHER
// route (documents, dashboards, API keys).
const PUBLIC_CORS_PATHS = new Set([
  '/api/verify-public',
  '/.well-known/vertifile-pubkey.pem',
  '/.well-known/vertifile-jwks.json'
]);
const publicCorsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  credentials: false,
  maxAge: 86400
});
const restrictiveCorsMiddleware = cors({
  origin: (origin, cb) => { if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true); else cb(new Error('Not allowed by CORS')); },
  methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Secret', 'X-CSRF-Token'], credentials: true, maxAge: 86400
});
app.use((req, res, next) => {
  if (PUBLIC_CORS_PATHS.has(req.path)) {
    return publicCorsMiddleware(req, res, next);
  }
  return restrictiveCorsMiddleware(req, res, next);
});
app.use((req, res, next) => { express.json({ limit: '1mb' })(req, res, (err) => { if (err) return res.status(400).json({ success: false, error: 'Invalid JSON body' }); next(); }); });
app.use(sanitizeBody);
app.use(compression({
  // Only compress responses larger than 1KB (small JSON responses are faster uncompressed)
  threshold: 1024,
  // Standard compression level (good balance of speed vs ratio)
  level: 6,
  // Skip compression for PVF responses (already large HTML, benefit is marginal
  // vs CPU cost) and for already-compressed formats
  filter: (req, res) => {
    const ct = res.getHeader('content-type');
    if (ct && (
      ct.includes('application/vnd.vertifile.pvf') ||
      ct.includes('image/') ||
      ct.includes('video/')
    )) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// ---- PDF.js vendor static route (Phase 3 — Option B) ----
// Serves the pinned pdfjs-dist@4.10.38 worker as a same-origin HTTPS asset.
// Why not a Blob URL inlined into the PVF? Chrome rejects module workers
// from blob: URLs (opaque origin), and pdfjs-dist v4 ships ES-module-only
// with no UMD fallback. Hosting the worker at a real HTTPS URL side-steps
// both problems.
// Trade-off: PDF PVFs need vertifile.com reachable to render. Signing and
// Ed25519 verification remain fully self-contained. Phase 4 will rasterize
// PDFs to PNG server-side so the viewer no longer needs PDF.js at all.
// Files are pinned to pdfjs-dist@4.10.38 on disk → safe to cache forever.
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'vendor', 'pdfjs'), {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    // CORS: allow the worker to load from any origin (PVFs may be embedded
    // anywhere). No credentials sent — this asset contains no user data.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'], maxAge: '7d',
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) {
      // HTML: no cache — always revalidate so nav/content stays fresh
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
    } else if (fp.endsWith('.json') && fp.includes('locales')) {
      // Locale JSON: short cache so translations update quickly
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    } else if (fp.endsWith('.js') || fp.endsWith('.css')) {
      // JS/CSS: no-cache forces ETag revalidation on every request (304 if unchanged).
      // This ensures fresh code immediately after deploy without content-hash filenames.
      res.setHeader('Cache-Control', 'public, no-cache');
    } else if (fp.endsWith('.svg') || fp.endsWith('.ico')) {
      // SVG icons/favicon: 30 days (rarely change)
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
    // Images/fonts keep the default 7d maxAge from express.static
  }
}));

app.use(session({
  store: new PgSession({ pool: db._db, tableName: 'sessions' }), secret: loadOrCreateSessionSecret(),
  resave: false, saveUninitialized: false, proxy: true,
  cookie: { secure: !!(process.env.RENDER || process.env.NODE_ENV === 'production'), httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => { try { done(null, await db.getUserById(id)); } catch(e) { done(e); } });

// Pre-hash a dummy value once for timing-safe comparison when user not found — Issue #2
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lk0TSwHFnHBGMeZR5JkXBqEWvRyDJyQGqOM5rLSsMwDOi';

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await db.getUserByEmail(email.toLowerCase().trim());

    // Issue #2: Dummy bcrypt compare when user not found (prevent timing attacks)
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return done(null, false, { message: 'Invalid email or password' });
    }

    // Issue #20: Generic error for OAuth-only accounts (don't reveal provider)
    if (!user.password_hash) {
      await bcrypt.compare(password, DUMMY_HASH);
      return done(null, false, { message: 'Invalid email or password' });
    }

    // Issue #4: Check account lockout before password check
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return done(null, false, { message: 'Invalid email or password' }); // Generic — don't reveal lockout
    }

    if (!(await bcrypt.compare(password, user.password_hash))) {
      // Issue #4: Track failed login attempts + lockout after 10
      const attempts = (user.failed_login_attempts || 0) + 1;
      await db.query('UPDATE users SET failed_login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      if (attempts >= 10) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minute lockout
        await db.query('UPDATE users SET locked_until = $1 WHERE id = $2', [lockUntil, user.id]);
        await db.log('account_locked', { userId: user.id, attempts, ip: 'from-request' });
      }
      return done(null, false, { message: 'Invalid email or password' });
    }

    // Issue #4: On successful login, reset failure counter
    await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

    done(null, user);
  } catch(e) { done(e); }
}));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      // Issue #3: Check that Google email is verified
      const email = profile.emails?.[0];
      if (!email || email.verified === false) {
        return done(null, false, { message: 'Google email not verified' });
      }

      let user = await db.getUserByProviderId('google', profile.id);
      if (!user) {
        // Issue #8: Don't auto-merge — if email exists with different provider, show error
        const existingByEmail = await db.getUserByEmail(email.value);
        if (existingByEmail && existingByEmail.provider !== 'google') {
          return done(null, false, {
            message: 'An account with this email exists. Please sign in with your password first, then link Google from settings.'
          });
        }

        user = await db.createUser({
          email: email.value,
          name: profile.displayName,
          provider: 'google',
          providerId: profile.id,
          avatarUrl: profile.photos?.[0]?.value || null,
        });
        // Google-verified email — mark as verified
        await db.setEmailVerified(user.id, true);
      }
      done(null, user);
    } catch(e) { done(e); }
  }));
}

// ---- CSRF protection (synchronizer token pattern) ----
// Applied after session + passport so the token can be stored in req.session.
// Excluded routes (API key auth, webhooks, public endpoints) are skipped
// inside the csrfProtection middleware. See middleware/csrf.js for details.
app.use(csrfProtection);

// Endpoint for frontend pages to fetch a CSRF token for the current session.
// Must be mounted AFTER csrfProtection so the session is available.
app.get('/api/csrf-token', csrfTokenEndpoint);

app.use(requestTimeout(30000));

const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', (req, res, next) => {
  // Phase 2D: /verify-public is a public audit endpoint. It has its own
  // 500/15min route-level limiter (verifyLimiter in routes/api.js) and must
  // NOT be subject to the global 200/15min cap, which would deny legitimate
  // verification attempts from shared IPs (NAT, CGNAT, cloud).
  if (req.path === '/verify-public') return next();
  return globalApiLimiter(req, res, next);
});

app.use(responseEnvelope());
app.use(requestLogger());

// Mount routes
app.use('/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gateway', gatewayRoutes);
app.use('/api/webhooks', webhookRoutes);
app.post('/api/keys/create', (req, res, next) => { req.url = '/keys-legacy/create'; adminRoutes(req, res, next); });
app.get('/api/keys', (req, res, next) => { req.url = '/keys-legacy'; adminRoutes(req, res, next); });
app.use('/api', onboardingRoutes);
// Mount /.well-known/ BEFORE the static/page handler so it takes priority over wildcards.
app.use('/.well-known', wellKnownRoutes);
app.use('/', pageRoutes);

// Audit-log errors to the database (best effort, before the standardized handler)
app.use(async (err, req, res, next) => {
  try {
    await db.log('server_error', {
      path: req.path,
      method: req.method,
      error: err.message,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
    });
  } catch (_) { /* audit logging is best effort -- never swallow the original error */ }
  next(err);
});

// Standardized error response middleware -- must be LAST (after all routes)
app.use(errorHandler);

// Bootstrap
db._ready.then(async () => {
  // Initialize Ed25519 key manager AFTER env vars are loaded but BEFORE routes accept work.
  // In Phase 2A this is invisible: if no ED25519_PRIVATE_KEY_PEM is set, no key is loaded
  // and signing.signEd25519() returns null. The pipeline is unchanged.
  keyManager.initialize();
  await db.migrateFromJson();
  const existingKeys = await db.listApiKeys();
  if (existingKeys.length === 0) {
    const defaultKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
    await db.createApiKey({ apiKey: defaultKey, orgId: 'org_default', orgName: 'Vertifile Demo', plan: 'professional', rateLimit: 100 });
    logger.info('  Default API key created: ' + defaultKey);
  }
  // Register demo document
  const demoContent = { name: '\u05d9\u05d5\u05e1\u05d9 \u05db\u05d4\u05df', degree: '\u05d1\u05d5\u05d2\u05e8 \u05d1\u05de\u05d3\u05e2\u05d9 \u05d4\u05de\u05d7\u05e9\u05d1 (B.Sc.)', average: '92.4', year: '2024', docId: 'PVF-2024-00482', issuer: '\u05d0\u05d5\u05e0\u05d9\u05d1\u05e8\u05e1\u05d9\u05d8\u05ea \u05ea\u05dc \u05d0\u05d1\u05d9\u05d1' };
  const demoHash = crypto.createHash('sha256').update(JSON.stringify(demoContent)).digest('hex');
  const demoSig = signHash(demoHash);
  if (!(await db.getDocument(demoHash))) {
    await db.createDocument({ hash: demoHash, signature: demoSig, originalName: 'demo', mimeType: 'text/html', fileSize: 0, orgId: 'org_vertifile', orgName: 'Vertifile', token: generateToken(), tokenCreatedAt: Date.now() });
  }
  let server;
  if (require.main === module) {
    server = app.listen(PORT, async () => {
      const stats = await db.getStats();
      const keys = await db.listApiKeys();
      const dk = keys.length > 0 ? keys[0].apiKey : null;
      logger.info({ port: PORT, docs: stats.totalDocuments, orgs: stats.totalOrganizations }, `Vertifile v4.1 | Port ${PORT}`);
      chain.init().then(c => logger.info(c ? 'Blockchain on-chain active' : 'Blockchain off-chain mode'));

      // Memory monitor — check every 60 seconds
      setInterval(() => {
        const mem = process.memoryUsage();
        const usedMB = Math.round(mem.heapUsed / 1024 / 1024);
        const totalMB = Math.round(mem.heapTotal / 1024 / 1024);
        const pct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
        if (pct > 90) {
          logger.warn({ usedMB, totalMB, pct }, 'Memory usage high');
        }
      }, 60000).unref();
    });

    // Graceful shutdown — critical for Render deployments.
    // Render sends SIGTERM before killing the process. We stop accepting
    // new connections, drain in-flight requests, flush queues, and close
    // the DB pool. If everything finishes within the timeout we exit 0;
    // otherwise we force-exit 1 so the platform knows it was unclean.
    let isShuttingDown = false;
    const SHUTDOWN_TIMEOUT_MS = 30000;

    async function gracefulShutdown(signal) {
      if (isShuttingDown) return; // prevent double-shutdown from SIGINT+SIGTERM race
      isShuttingDown = true;

      logger.info({ signal }, 'Shutting down gracefully...');

      // Flush blockchain queue before closing connections
      try { await chain.flushQueue(); } catch (e) { logger.error({ err: e }, 'Queue flush error during shutdown'); }

      if (server) {
        // Stop accepting new connections — existing ones drain naturally
        server.close(async () => {
          logger.info('HTTP server closed, no more active connections');
          try {
            await db.close();
            logger.info('Database pool closed');
          } catch (e) {
            logger.error({ err: e }, 'Error closing database pool');
          }
          process.exit(0);
        });

        // Force exit if draining takes too long
        const forceTimer = setTimeout(() => {
          logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out, forcing exit');
          process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceTimer.unref(); // do not keep the event loop alive just for this timer
      } else {
        process.exit(0);
      }
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }
}).catch(err => { logger.error({ err }, 'Database initialization failed'); process.exit(1); });

module.exports = app;
