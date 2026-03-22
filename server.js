const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const db = require('./db');
const chain = require('./blockchain');
const { createAuthenticateApiKey } = require('./middleware/auth');
const { signHash, generateToken } = require('./services/pvf-generator');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const gatewayRoutes = require('./routes/gateway');
const webhookRoutes = require('./routes/webhooks');
const pageRoutes = require('./routes/pages');

const app = express();
const PORT = process.env.PORT || 3002;

// Session secret — persistent across restarts
const SESSION_SECRET_FILE = path.join(__dirname, 'data', '.session_secret');
function loadOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
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
  } catch (e) { console.error('[SECURITY] Could not persist session secret:', e.message); }
  return s;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.set('db', db);
app.set('chain', chain);
app.set('upload', upload);
app.set('authenticateApiKey', createAuthenticateApiKey(db));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"], imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.vertifile.com"], frameSrc: ["'none'"],
    }
  }, crossOriginEmbedderPolicy: false
}));

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`, `https://localhost:${PORT}`, 'https://vertifile.com', 'https://www.vertifile.com', 'https://vertifile.onrender.com'];

app.use(cors({
  origin: (origin, cb) => { if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true); else cb(new Error('Not allowed by CORS')); },
  methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Secret'], credentials: true, maxAge: 86400
}));
app.use((req, res, next) => { express.json({ limit: '1mb' })(req, res, (err) => { if (err) return res.status(400).json({ success: false, error: 'Invalid JSON body' }); next(); }); });
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'], maxAge: '7d',
  setHeaders: (res, fp) => { if (fp.endsWith('.html')) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); } }
}));

app.use(session({
  store: new PgSession({ pool: db._db, tableName: 'sessions' }), secret: loadOrCreateSessionSecret(),
  resave: false, saveUninitialized: false, proxy: true,
  cookie: { secure: !!(process.env.RENDER || process.env.NODE_ENV === 'production'), httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => { try { done(null, await db.getUserById(id)); } catch(e) { done(e); } });

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await db.getUserByEmail(email.toLowerCase().trim());
    if (!user) return done(null, false, { message: 'Invalid email or password' });
    if (!user.password_hash) return done(null, false, { message: 'Please use Google or Microsoft to sign in' });
    if (!(await bcrypt.compare(password, user.password_hash))) return done(null, false, { message: 'Invalid email or password' });
    done(null, user);
  } catch(e) { done(e); }
}));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await db.getUserByProviderId('google', profile.id);
      if (!user) user = await db.createUser({ email: profile.emails[0].value, name: profile.displayName, provider: 'google', providerId: profile.id, avatarUrl: profile.photos?.[0]?.value || null });
      done(null, user);
    } catch(e) { done(e); }
  }));
}

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { success: false, error: 'Too many requests, try again later' }, standardHeaders: true, legacyHeaders: false }));

// Mount routes
app.use('/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gateway', gatewayRoutes);
app.use('/api/webhooks', webhookRoutes);
app.post('/api/keys/create', (req, res, next) => { req.url = '/keys-legacy/create'; adminRoutes(req, res, next); });
app.get('/api/keys', (req, res, next) => { req.url = '/keys-legacy'; adminRoutes(req, res, next); });
app.use('/', pageRoutes);

// Global error handler
app.use(async (err, req, res, next) => {
  console.error('[ERROR]', err.message);
  await db.log('server_error', { path: req.path, method: req.method, error: err.message, ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown' });
  if (err.message === 'Not allowed by CORS') return res.status(403).json({ success: false, error: 'CORS: Origin not allowed' });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Bootstrap
db._ready.then(async () => {
  await db.migrateFromJson();
  const existingKeys = await db.listApiKeys();
  if (existingKeys.length === 0) {
    const defaultKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
    await db.createApiKey({ apiKey: defaultKey, orgId: 'org_default', orgName: 'Vertifile Demo', plan: 'professional', rateLimit: 100 });
    console.log('  Default API key created: ' + defaultKey);
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
      console.log(`\n  Vertifile v4.1 | Port ${PORT} | ${stats.totalDocuments} docs | ${stats.totalOrganizations} keys`);
      console.log(`  http://localhost:${PORT} | API: ${dk ? dk.substring(0, 24) + '...' : 'none'}\n`);
      chain.init().then(c => console.log(c ? '[BLOCKCHAIN] On-chain active' : '[BLOCKCHAIN] Off-chain mode'));
    });

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    function gracefulShutdown() {
      console.log('[SERVER] Shutting down gracefully...');
      // Flush any pending blockchain registrations
      chain.flushQueue().catch(e => console.error('[SERVER] Queue flush error:', e.message));
      if (server) {
        server.close(async () => {
          console.log('[SERVER] HTTP connections closed');
          try { await db.close(); } catch(e) {}
          console.log('[SERVER] Database pool closed');
          process.exit(0);
        });
        // Force close after 10 seconds
        setTimeout(() => {
          console.error('[SERVER] Forced shutdown after timeout');
          process.exit(1);
        }, 10000);
      } else {
        process.exit(0);
      }
    }
  }
}).catch(err => { console.error('[FATAL] Database initialization failed:', err); process.exit(1); });

module.exports = app;
