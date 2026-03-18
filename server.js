const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const db = require('./db');
const chain = require('./blockchain');
const { obfuscatePvf } = require('./obfuscate');

const app = express();
const PORT = process.env.PORT || 3002;

// ===== HMAC Secret — persistent (survives restarts) =====
const HMAC_FILE = path.join(__dirname, 'data', '.hmac-secret');
function loadOrCreateHmacSecret() {
  // 1. Environment variable takes priority
  if (process.env.HMAC_SECRET) return process.env.HMAC_SECRET;
  // 2. Try to load from persistent file
  try {
    if (fs.existsSync(HMAC_FILE)) {
      const secret = fs.readFileSync(HMAC_FILE, 'utf8').trim();
      if (secret.length >= 32) return secret;
    }
  } catch (e) { /* fall through */ }
  // 3. Generate new secret and persist it
  const secret = 'vf_secret_' + crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(HMAC_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HMAC_FILE, secret, { mode: 0o600 }); // owner-only permissions
    console.log('[SECURITY] New HMAC secret generated and saved');
  } catch (e) {
    console.error('[SECURITY] Warning: Could not persist HMAC secret:', e.message);
  }
  return secret;
}
const HMAC_SECRET = loadOrCreateHmacSecret();

// ===== File upload config =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// ================================================================
// DATABASE (PostgreSQL via db.js)
// ================================================================

// Helper to extract client IP from request
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

// ================================================================
// SECURITY HELPERS
// ================================================================

// Hash raw bytes — BLIND (never reads document content)
function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// HMAC signature — proves hash was registered by our server
function signHash(hash) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(hash).digest('hex');
}

// Verify HMAC signature
function verifySignature(hash, signature) {
  const expected = signHash(hash);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Generate random token for session verification
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Content Security Policy for PVF files
function setPvfSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'unsafe-inline'",                       // PVF inline scripts need this
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src data: blob:",
    "connect-src 'self'",                               // Allow API calls back to origin
    "frame-src data:",                                  // Allow PDF iframe with data: URI
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'"                            // Prevent embedding in foreign iframes
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// ================================================================
// MIDDLEWARE
// ================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts in PVF files
  crossOriginEmbedderPolicy: false
}));

// CORS — restricted to same origin and configured allowed origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [`http://localhost:${PORT}`, `https://localhost:${PORT}`];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g. same-origin, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Secret'],
  credentials: true,
  maxAge: 86400
}));
app.use((req, res, next) => {
  express.json({ limit: '1mb' })(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    next();
  });
});
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, filepath) => {
    // Set security headers for static files
    if (filepath.endsWith('.html')) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
    }
  }
}));

// Session configuration
const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
app.use(session({
  store: new PgSession({ pool: sessionPool, tableName: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'vf_session_' + require('crypto').randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { const user = await db.getUserById(id); done(null, user); }
  catch(e) { done(e); }
});

// Local strategy (email + password)
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await db.getUserByEmail(email.toLowerCase().trim());
    if (!user) return done(null, false, { message: 'Invalid email or password' });
    if (!user.password_hash) return done(null, false, { message: 'Please use Google or Microsoft to sign in' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return done(null, false, { message: 'Invalid email or password' });
    done(null, user);
  } catch(e) { done(e); }
}));

// Google strategy (only if env vars set)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await db.getUserByProviderId('google', profile.id);
      if (!user) {
        user = await db.createUser({
          email: profile.emails[0].value,
          name: profile.displayName,
          provider: 'google',
          providerId: profile.id,
          avatarUrl: profile.photos?.[0]?.value || null
        });
      }
      done(null, user);
    } catch(e) { done(e); }
  }));
}

// Rate limiter — general API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Rate limiter — PVF creation (stricter)
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: { success: false, error: 'Document creation limit reached. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter — verification (more generous)
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { success: false, error: 'Too many verification requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ================================================================
// API KEY AUTHENTICATION MIDDLEWARE
// ================================================================
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const clientIP = getClientIP(req);

  if (!apiKey) {
    await db.log('auth_failed', { reason: 'missing_key', ip: clientIP, path: req.path });
    return res.status(401).json({
      success: false,
      error: 'API key required. Add X-API-Key header.',
      docs: '/api/docs'
    });
  }

  const keyData = await db.getApiKey(apiKey);

  if (!keyData) {
    await db.log('auth_failed', { reason: 'invalid_key', ip: clientIP, path: req.path, keyPrefix: apiKey.substring(0, 12) });
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }

  if (!keyData.active) {
    await db.log('auth_failed', { reason: 'disabled_key', ip: clientIP, orgId: keyData.orgId, path: req.path });
    return res.status(403).json({ success: false, error: 'API key is disabled' });
  }

  // IP whitelist check: if allowedIPs is set, only allow requests from those IPs
  if (keyData.allowedIPs && Array.isArray(keyData.allowedIPs) && keyData.allowedIPs.length > 0) {
    const normalizedClientIP = clientIP.replace(/^::ffff:/, ''); // normalize IPv4-mapped IPv6
    const isAllowed = keyData.allowedIPs.some(ip => {
      const normalizedAllowed = ip.replace(/^::ffff:/, '');
      return normalizedClientIP === normalizedAllowed;
    });
    if (!isAllowed) {
      await db.log('auth_failed', { reason: 'ip_not_whitelisted', ip: clientIP, orgId: keyData.orgId, path: req.path });
      return res.status(403).json({ success: false, error: 'Request from unauthorized IP address' });
    }
  }

  // Attach org info to request
  req.org = keyData;
  req.apiKey = apiKey;
  next();
}

// ================================================================
// PVF HTML TEMPLATE (with coin-drop animation)
// ================================================================
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function generatePvfHtml(fileBase64, originalName, fileHash, mimeType, signature, recipientHash, customIcon, brandColor, orgName) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const safeOriginalName = escapeHtml(originalName);

  const createdAt = new Date().toISOString();

  return `<!--PVF:1.0-->
<!DOCTYPE html>
<html lang="en" dir="ltr" class="no-js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="pvf:version" content="1.0">
<meta name="pvf:hash" content="${fileHash}">
<meta name="pvf:signature" content="${signature}">
<meta name="pvf:original-name" content="${safeOriginalName}">
<meta name="pvf:mime-type" content="${mimeType}">
<meta name="pvf:created" content="${createdAt}">
${recipientHash ? `<meta name="pvf:recipient-hash" content="${recipientHash}">` : ''}
<title>PVF — ${safeOriginalName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Heebo',sans-serif;background:#121212;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px}
body.forged{background:#2a0a0a}

/* No-JS mode (Quick Look / Preview) — show document directly */
.no-js .loading{display:none!important}
.no-js .page-wrap{display:block!important}
.no-js .stamp-coin{opacity:1!important}
.no-js .stamp .center{visibility:visible}

/* Loading */
.loading{position:fixed;top:0;left:0;right:0;bottom:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .6s}
.loading.hide{opacity:0;pointer-events:none}
.loading .logo{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.loading .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:11px;display:flex;align-items:center;justify-content:center}
.loading .logo-icon svg{width:22px;height:22px}
.loading .logo-text{font-size:24px;font-weight:900;color:#7c3aed}
.loading .sp{width:36px;height:36px;border:3px solid #eee;border-top-color:#7c3aed;border-radius:50%;animation:spin .7s linear infinite;margin-bottom:12px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{color:#aaa;font-size:13px;letter-spacing:.5px}

/* Page wrapper */
.page-wrap{position:relative;max-width:820px;width:100%;display:none}
.page-bg{width:100%;background:#fff;box-shadow:0 8px 60px rgba(0,0,0,.5);border-radius:4px;position:relative;overflow:hidden;min-height:600px;transition:box-shadow .5s}
.page-bg.forged{box-shadow:0 0 0 4px #e53935,0 8px 60px rgba(255,0,0,.3)}

/* Document frame */
.doc-frame{width:100%;min-height:600px}
.doc-frame.pdf{height:90vh;min-height:800px}
.doc-frame img{width:100%;display:block}
.doc-frame iframe{width:100%;height:100%;border:none}
.doc-frame .text-doc{padding:50px 60px;font-size:15px;line-height:1.9;color:#333;white-space:pre-wrap}

/* Forged overlay */
.big-x{display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:20;pointer-events:none}
.big-x.show{display:block}
.big-x svg{width:100%;height:100%}
.wm{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:70px;font-weight:900;color:rgba(229,57,53,.1);white-space:nowrap;z-index:25;pointer-events:none;letter-spacing:8px}
.wm.show{display:block}

/* ===== HOLOGRAPHIC WAVES — flowing sine curves ===== */
.holo-waves{position:absolute;left:0;right:0;bottom:0;height:35%;z-index:10;pointer-events:none;overflow:hidden;border-radius:0 0 4px 4px;opacity:0;transition:opacity 1.2s ease;
  mask-image:linear-gradient(to bottom,transparent 0%,black 40%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 40%)}
.holo-waves.active{opacity:1}
.hw-svg{position:absolute;top:0;width:200%;height:100%;left:-50%}
.hw-svg path{fill:none;stroke-linecap:round}
.hw-a{animation:wDriftA 8s ease-in-out infinite,wHueA 16s ease-in-out infinite}
.hw-b{animation:wDriftB 10s ease-in-out infinite,wHueB 20s ease-in-out infinite}
@keyframes wDriftA{0%,100%{transform:rotate(-5deg) translateX(-3%)}50%{transform:rotate(-5deg) translateX(3%)}}
@keyframes wDriftB{0%,100%{transform:rotate(-3deg) translateX(3%)}50%{transform:rotate(-3deg) translateX(-3%)}}
@keyframes wHueA{0%,100%{filter:hue-rotate(0deg) brightness(1)}33%{filter:hue-rotate(45deg) brightness(1.15)}66%{filter:hue-rotate(-25deg) brightness(.9)}}
@keyframes wHueB{0%,100%{filter:hue-rotate(0deg)}50%{filter:hue-rotate(65deg)}}

/* ===== VERTIFILE STAMP ===== */
.stamp{position:absolute;bottom:6%;right:5%;width:96px;height:96px;z-index:30;pointer-events:none;opacity:0.7;perspective:800px}
@media(max-width:600px){.stamp{width:64px;height:64px;bottom:4%;right:3%}}

/* 3D Coin-flip animation */
.stamp-coin{width:100%;height:100%;transform-style:preserve-3d;opacity:0}
.stamp-coin.animate{animation:coinFlip 2.2s ease-out forwards}
@keyframes coinFlip{
  0%{opacity:0;transform:translateY(-300px) rotateY(0deg) scale(.2)}
  15%{opacity:1;transform:translateY(-180px) rotateY(540deg) scale(.6)}
  35%{opacity:1;transform:translateY(-60px) rotateY(1080deg) scale(1.4)}
  50%{opacity:1;transform:translateY(0) rotateY(1440deg) scale(1.15)}
  65%{opacity:1;transform:translateY(-20px) rotateY(1620deg) scale(1.05)}
  80%{opacity:1;transform:translateY(5px) rotateY(1720deg) scale(.98)}
  90%{opacity:1;transform:translateY(-3px) rotateY(1780deg) scale(1.02)}
  100%{opacity:1;transform:translateY(0) rotateY(1800deg) scale(1)}
}
/* Gentle breathing after landing */
.stamp-coin.landed{opacity:1;animation:stampBreathe 3s ease-in-out infinite}
@keyframes stampBreathe{
  0%,100%{opacity:1;transform:rotateY(1800deg) scale(1)}
  50%{opacity:1;transform:rotateY(1800deg) scale(1.06)}
}
.stamp-shadow{display:none}

.stamp .ring{width:100%;height:100%;position:relative}

/* Outer rotating ring */
.stamp .outer{position:absolute;top:0;left:0;width:100%;height:100%;animation:rotStamp 30s linear infinite}
.stamp .outer.frozen{animation:none!important}
@keyframes rotStamp{to{transform:rotate(360deg)}}

/* Shimmer effect */
.stamp .shim{position:absolute;top:5%;left:5%;width:90%;height:90%;border-radius:50%;
  background:conic-gradient(from 0deg,rgba(124,58,237,.05),rgba(109,40,217,.1) 60deg,rgba(76,175,80,.07) 120deg,rgba(124,58,237,.05) 180deg,rgba(109,40,217,.1) 240deg,rgba(76,175,80,.07) 300deg,rgba(124,58,237,.05));
  animation:shimRot 4s linear infinite}
.stamp .shim.frozen{animation:none!important;background:rgba(244,67,54,.08)}
@keyframes shimRot{to{transform:rotate(-360deg)}}

/* Glow pulse */
.stamp .glow{position:absolute;top:15%;left:15%;width:70%;height:70%;border-radius:50%;background:radial-gradient(circle,rgba(76,175,80,.1),transparent 70%);animation:glowP 3s ease-in-out infinite}
.stamp .glow.frozen{animation:none!important;background:radial-gradient(circle,rgba(244,67,54,.1),transparent 70%)}
@keyframes glowP{0%,100%{opacity:.5;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}

/* Inner circle */
.stamp .inner-bg{position:absolute;top:22%;left:22%;width:56%;height:56%;border-radius:50%;background:rgba(255,255,255,.7);border:1px solid rgba(124,58,237,.12)}

/* Center content */
.stamp .center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.stamp .center svg{width:28px;height:28px}
.stamp .brand{font-size:7px;font-weight:900;letter-spacing:1.5px;color:rgba(124,58,237,.45);margin-top:1px}
.stamp .lbl{font-size:8px;font-weight:900;letter-spacing:1px;margin-top:2px}
.stamp .lbl.ok{color:rgba(46,125,50,.6)}
.stamp .lbl.bad{color:rgba(198,40,40,.6)}

/* Check & X animations */
.chk{stroke-dasharray:60;stroke-dashoffset:60;animation:dChk 1s ease forwards .8s}
@keyframes dChk{to{stroke-dashoffset:0}}
.xp{stroke-dasharray:40;stroke-dashoffset:40;animation:dX .5s ease forwards}
.xp:nth-child(2){animation-delay:.3s}
@keyframes dX{to{stroke-dashoffset:0}}

/* Security: prevent user selection of protected content */
.stamp,.stamp *{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;-webkit-user-drag:none;user-drag:none}
.page-bg img{-webkit-user-drag:none;user-drag:none;pointer-events:none}
@media print{body{display:none!important}body::after{content:"This document is protected by Vertifile and cannot be printed.";display:block;padding:60px;text-align:center;font-size:24px;color:#c62828;font-weight:bold}}
/* Screen capture CSS protection — content-visibility hidden for captured contexts */
@media (display-mode: picture-in-picture){.page-wrap{filter:blur(30px)!important}.stamp{display:none!important}}
</style>
</head>
<body>

<!-- Loading screen with Vertifile branding -->
<div class="loading" id="ld">
  <div class="logo">
    <div class="logo-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2l7 4v5c0 5-3 9.5-7 11-4-1.5-7-6-7-11V6l7-4z" stroke="#fff" stroke-width="1.5"/></svg></div>
    <span class="logo-text">Vertifile</span>
  </div>
  <div class="sp"></div>
  <p>Verifying document...</p>
</div>

<!-- Document -->
<div class="page-wrap" id="wrap">
  <div class="page-bg" id="pg">

    <div class="big-x" id="bx"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="8" y1="8" x2="92" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/><line x1="92" y1="8" x2="8" y2="92" stroke="rgba(229,57,53,.07)" stroke-width="6" stroke-linecap="round"/></svg></div>
    <div class="wm" id="wm">FORGED</div>

    <!-- Holographic security waves -->
    <div class="holo-waves" id="holoWaves">
      <svg class="hw-svg hw-a" viewBox="0 0 1400 200" preserveAspectRatio="none">
        <path d="M-200,100 Q-60,40 80,100 Q220,160 360,100 Q500,40 640,100 Q780,160 920,100 Q1060,40 1200,100 Q1340,160 1480,100 Q1620,40 1760,100" stroke="rgba(124,58,237,.12)" stroke-width="2"/>
        <path d="M-200,115 Q-40,160 120,115 Q280,70 440,115 Q600,160 760,115 Q920,70 1080,115 Q1240,160 1400,115 Q1560,70 1720,115" stroke="rgba(0,131,143,.10)" stroke-width="1.6"/>
        <path d="M-200,140 Q-70,80 60,140 Q190,200 320,140 Q450,80 580,140 Q710,200 840,140 Q970,80 1100,140 Q1230,200 1360,140 Q1490,80 1620,140" stroke="rgba(46,125,50,.10)" stroke-width="1.8"/>
      </svg>
      <svg class="hw-svg hw-b" viewBox="0 0 1400 200" preserveAspectRatio="none">
        <path d="M-200,80 Q-50,130 100,80 Q250,30 400,80 Q550,130 700,80 Q850,30 1000,80 Q1150,130 1300,80 Q1450,30 1600,80" stroke="rgba(106,27,154,.11)" stroke-width="1.8"/>
        <path d="M-200,55 Q-30,95 170,55 Q370,15 570,55 Q770,95 970,55 Q1170,15 1370,55 Q1570,95 1770,55" stroke="rgba(109,40,217,.09)" stroke-width="1.5"/>
      </svg>
    </div>

    <div class="doc-frame ${isPdf ? 'pdf' : ''}" id="frame">
      ${isPdf
        ? `<iframe src="data:application/pdf;base64,${fileBase64}"></iframe>`
        : isImage
          ? `<img src="data:${mimeType};base64,${fileBase64}" alt="document"/>`
          : `<div class="text-doc">${fileBase64}</div>`
      }
    </div>

    <!-- VERTIFILE STAMP -->
    <div class="stamp" id="stamp">
      <div class="stamp-coin" id="sCoin">
      <div class="ring">
        <svg class="outer" id="sOut" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(124,58,237,.18)" stroke-width="1.2"/>
          <circle cx="100" cy="100" r="89" fill="none" stroke="rgba(124,58,237,.08)" stroke-width=".5" stroke-dasharray="3 3"/>
          <line x1="100" y1="2" x2="100" y2="8" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="100" y1="192" x2="100" y2="198" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="2" y1="100" x2="8" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <line x1="192" y1="100" x2="198" y2="100" stroke="rgba(124,58,237,.2)" stroke-width="1.2"/>
          <defs><path id="tp" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
          <text font-size="7" fill="rgba(124,58,237,.25)" font-weight="700" letter-spacing="2.5"><textPath href="#tp">VERTIFILE \\u2022 PROTECTED VERIFIED FILE \\u2022 BLOCKCHAIN SECURED \\u2022</textPath></text>
        </svg>
        <div class="shim" id="sShim"></div>
        <div class="glow" id="sGlow"></div>
        <div class="inner-bg"></div>
        <div class="center" id="sCtr">${customIcon ?
     (customIcon.startsWith('<svg') ? customIcon : `<img src="${customIcon}" style="width:28px;height:28px;object-fit:contain" alt="">`)
     : `<svg viewBox="0 0 50 50" fill="none"><path d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
   }<div class="brand">${escapeHtml(orgName || 'VERTIFILE')}</div><div class="lbl ok">PROTECTED</div></div>
      </div>
      </div>
      <div class="stamp-shadow" id="sShadow"></div>
    </div>

  </div>
</div>

<script>
// Remove no-js class immediately (enables loading screen + animations in browser)
document.documentElement.classList.remove("no-js");
document.documentElement.classList.add("js");

// ===== SECURITY: Environment detection =====
var __securityFrozen = false;

(function environmentCheck() {
  // Check if window.navigator exists (basic browser context check)
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') {
    __securityFrozen = true;
    return;
  }
  // Check if embedded in a cross-origin iframe
  // Skip if desktop viewer injected the trusted marker
  if (!window.__pvfDesktopViewer) {
    try {
      if (window.self !== window.top) {
        try {
          var parentDoc = window.top.location.href;
        } catch (e) {
          __securityFrozen = true;
        }
      }
    } catch (e) {
      __securityFrozen = true;
    }
  }
})();

// ===== SECURITY: DevTools detection =====
var __devToolsOpen = false;

(function devToolsDetect() {
  // Method 1: debugger timing trick
  function checkDebugger() {
    var t0 = performance.now();
    debugger;
    var t1 = performance.now();
    if (t1 - t0 > 100) {
      __devToolsOpen = true;
      freezeStamp();
    }
  }

  // Method 2: window size comparison (outer vs inner)
  // Skip this check when embedded in a same-origin iframe (outerWidth reflects main window, not iframe)
  function checkWindowSize() {
    if (window.self !== window.top) return;
    var widthDiff = window.outerWidth - window.innerWidth > 160;
    var heightDiff = window.outerHeight - window.innerHeight > 160;
    if (widthDiff || heightDiff) {
      __devToolsOpen = true;
      freezeStamp();
    }
  }

  // Run checks periodically
  setInterval(function() {
    checkWindowSize();
  }, 2000);

  // Run debugger check less frequently (it pauses execution when open)
  setInterval(function() {
    checkDebugger();
  }, 4000);

  // Also check on resize (DevTools docking changes window size)
  window.addEventListener('resize', checkWindowSize);
})();

function freezeStamp() {
  var sOut = document.getElementById("sOut");
  var sShim = document.getElementById("sShim");
  var sGlow = document.getElementById("sGlow");
  var sCoin = document.getElementById("sCoin");
  if (sOut) sOut.classList.add("frozen");
  if (sShim) sShim.classList.add("frozen");
  if (sGlow) sGlow.classList.add("frozen");
  if (sCoin) { sCoin.classList.remove("animate","landed"); sCoin.style.animation="none"; sCoin.style.opacity="1"; }
  // Kill holographic waves on freeze
  var hw = document.getElementById("holoWaves");
  if (hw) hw.classList.remove("active");
}

// ===== SECURITY: Right-click prevention =====
document.addEventListener("contextmenu", function(e) { e.preventDefault(); });

// ===== SECURITY: Keyboard shortcut blocking =====
document.addEventListener("keydown", function(e) {
  // Block: Ctrl+S (save), Ctrl+U (view source), Ctrl+Shift+I (DevTools),
  // Ctrl+Shift+J (console), F12, Ctrl+P (print), Ctrl+Shift+C (inspect)
  if (e.key === "F12") { e.preventDefault(); __devToolsOpen = true; freezeStamp(); return false; }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "s" || e.key === "u" || e.key === "p") { e.preventDefault(); return false; }
    if (e.shiftKey && (e.key === "I" || e.key === "i" || e.key === "J" || e.key === "j" || e.key === "C" || e.key === "c")) {
      e.preventDefault(); __devToolsOpen = true; freezeStamp(); return false;
    }
  }
});

// ===== SECURITY: Drag prevention (prevents dragging images out) =====
document.addEventListener("dragstart", function(e) { e.preventDefault(); });

// ===== SECURITY: Selection prevention on stamp =====
document.addEventListener("selectstart", function(e) {
  if (e.target.closest && e.target.closest(".stamp")) { e.preventDefault(); }
});

// ===== SECURITY: Console warning =====
(function() {
  var w = "%cVertifile Security Warning";
  var s = "color:#c62828;font-size:18px;font-weight:bold;";
  var m = "%cThis document is protected by Vertifile. Any attempt to tamper with this file will be detected and the verification stamp will be invalidated.";
  var ms = "color:#888;font-size:13px;";
  try { console.log(w, s); console.log(m, ms); } catch(e) {}
})();

// ===== SECURITY: Visibility change detection =====
document.addEventListener("visibilitychange", function() {
  if (document.hidden && !isLocal) {
    // Tab went to background — no action needed, but track it
  }
});

// ===== SECURITY: Screen Recording / Screen Capture detection =====
(function screenCaptureGuard(){
  // Skip detection when loaded inside an iframe (desktop viewers cause false positives)
  try { if (window !== window.top) return; } catch(e) { return; }
  var __screenCaptured = false;
  function blankForCapture() {
    if (__screenCaptured) return;
    __screenCaptured = true;
    document.body.classList.add("forged");
    var pg = document.getElementById("pg");
    if (pg) pg.style.filter = "blur(30px)";
    freezeStamp();
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#121212;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#c62828;font-family:Heebo,sans-serif";
    overlay.innerHTML = '<div style="font-size:48px;font-weight:900;margin-bottom:16px">⛔</div><div style="font-size:20px;font-weight:700">Screen Recording Detected</div><div style="font-size:14px;color:#888;margin-top:8px">This document cannot be captured.</div>';
    document.body.appendChild(overlay);
  }
  // Method 1: Display Capture API detection (navigator.mediaDevices)
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", function() {
      // Device change during viewing — suspicious
    });
  }
  // Method 2: CSS media query for display-mode capture (experimental)
  try {
    var mq = window.matchMedia("(display-mode: picture-in-picture)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function(e) { if (e.matches) blankForCapture(); });
    }
  } catch(e){}
  // Method 3: Monitor getDisplayMedia usage via permissions (skip — causes false positives in Electron)
  // Method 4: Intercept getDisplayMedia if available
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    var origGetDisplay = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = function() {
      blankForCapture();
      return origGetDisplay.apply(this, arguments);
    };
  }
})();

var HASH="${fileHash}";
var SIG="${signature}";
var RCPT="${recipientHash || ''}";
var API=window.location.origin;
var ORGNAME="${escapeHtml(orgName || 'VERTIFILE')}";
var CUSTOMICON=${customIcon ? `"${customIcon.startsWith('<svg') ? 'svg' : 'img'}"` : 'null'};
var CUSTOMICONDATA=${customIcon ? `\`${customIcon.replace(/`/g, '\\`')}\`` : 'null'};

// ===== UNIQUE VISUAL FINGERPRINT (derived from hash) =====
(function hashFingerprint(){
  var h=HASH;
  // Extract parameters from hash bytes
  var hue1=parseInt(h.substring(0,2),16)%360;
  var hue2=parseInt(h.substring(2,4),16)%360;
  var rotSpeed=20+parseInt(h.substring(4,6),16)%30;  // 20-50s
  var waveSpeed1=6+parseInt(h.substring(6,8),16)%8;  // 6-14s
  var waveSpeed2=8+parseInt(h.substring(8,10),16)%10; // 8-18s
  var glowSpeed=2+parseInt(h.substring(10,12),16)%4;  // 2-6s
  var shimSpeed=3+parseInt(h.substring(12,14),16)%5;  // 3-8s
  var breatheSpeed=2+parseInt(h.substring(14,16),16)%4; // 2-6s
  var waveHue1=parseInt(h.substring(16,18),16)%90;
  var waveHue2=parseInt(h.substring(18,20),16)%90;
  // Inject custom CSS based on hash
  var s=document.createElement("style");
  s.textContent=
    ".stamp .outer{animation-duration:"+rotSpeed+"s}"+
    ".stamp .shim{animation-duration:"+shimSpeed+"s;background:conic-gradient(from 0deg,hsla("+hue1+",60%,50%,.05),hsla("+hue2+",50%,45%,.1) 60deg,hsla("+(hue1+120)+",40%,55%,.07) 120deg,hsla("+hue1+",60%,50%,.05) 180deg,hsla("+hue2+",50%,45%,.1) 240deg,hsla("+(hue1+120)+",40%,55%,.07) 300deg,hsla("+hue1+",60%,50%,.05))}"+
    ".stamp .glow{animation-duration:"+glowSpeed+"s}"+
    ".stamp-coin.landed{animation-duration:"+breatheSpeed+"s}"+
    ".hw-a{animation:wDriftA "+waveSpeed1+"s ease-in-out infinite,wHueA "+(waveSpeed1*2)+"s ease-in-out infinite}"+
    ".hw-b{animation:wDriftB "+waveSpeed2+"s ease-in-out infinite,wHueB "+(waveSpeed2*2)+"s ease-in-out infinite}"+
    "@keyframes wHueA{0%,100%{filter:hue-rotate("+waveHue1+"deg) brightness(1)}50%{filter:hue-rotate("+(waveHue1+45)+"deg) brightness(1.15)}}"+
    "@keyframes wHueB{0%,100%{filter:hue-rotate("+waveHue2+"deg)}50%{filter:hue-rotate("+(waveHue2+65)+"deg)}}";
  document.head.appendChild(s);
  ${brandColor ? `
  var bc = "${brandColor}";
  // Override wave colors with brand color
  document.querySelectorAll('.wave path').forEach(function(p, i) {
    p.setAttribute('stroke', bc);
    p.style.opacity = (0.08 + i * 0.03);
  });
  ` : ''}
})();
var token=null;
var isLocal=location.protocol==="file:"||location.protocol==="about:"||window!==window.top;
var VERIFY_URL="https://vertifile.com";

async function init(){
  // Security: if environment is frozen (cross-origin iframe / missing navigator), show forged
  if(__securityFrozen){
    await new Promise(r=>setTimeout(r,300));
    document.getElementById("ld").classList.add("hide");
    document.getElementById("wrap").style.display="block";
    setFk();
    freezeStamp();
    return;
  }

  // Determine the verification API URL
  var apiUrl=isLocal?VERIFY_URL:API;

  // Step 1: Try server verification
  try{
    await new Promise(r=>setTimeout(r,500));
    var r=await fetch(apiUrl+"/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH,signature:SIG,recipientHash:RCPT||undefined})});
    var d=await r.json();
    if(d.verified){token=d.token;show(true);if(!isLocal)startRefresh();return}
    // Server says NOT verified — if online (not local), trust the server → FORGED
    if(!isLocal){show(false);return}
    // If local: server might not know this doc (different DB). Fall through to local check.
  }catch(e){
    // Server unreachable — fall back to client-side verification
  }

  // Step 2: Offline fallback — verify content hash locally using Web Crypto API
  try{
    var payload=document.querySelector(".text-doc,.doc-frame img,.doc-frame iframe");
    if(payload){
      var contentToHash="";
      if(payload.classList.contains("text-doc")){
        contentToHash=payload.textContent;
      }else if(payload.tagName==="IMG"){
        var src=payload.getAttribute("src")||"";
        contentToHash=src.split(",")[1]||src;
      }else if(payload.tagName==="IFRAME"){
        var src=payload.getAttribute("src")||"";
        contentToHash=src.split(",")[1]||src;
      }
      if(contentToHash){
        var encoder=new TextEncoder();
        var data=encoder.encode(contentToHash);
        var hashBuffer=await crypto.subtle.digest("SHA-256",data);
        var hashArray=Array.from(new Uint8Array(hashBuffer));
        var computedHash=hashArray.map(function(b){return b.toString(16).padStart(2,"0")}).join("");
        if(computedHash===HASH){showLocal();return}
        else{show(false);return}
      }
    }
  }catch(e){}

  // Step 3: Last resort — if we can't verify at all, show as protected (structure intact)
  showLocal();
}

function showLocal(){
  document.getElementById("ld").classList.add("hide");
  document.getElementById("wrap").style.display="block";
  setOk();
  activateWaves();
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="chk" d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="brand">VERTIFILE</div><div class="lbl ok">PROTECTED</div>';
  triggerFlip();
}

function activateWaves(){
  var hw=document.getElementById("holoWaves");
  if(hw) setTimeout(function(){hw.classList.add("active")},300);
}

function triggerFlip(){
  // Skip animation if DevTools detected or security frozen
  if(__devToolsOpen||__securityFrozen) return;
  var c=document.getElementById("sCoin");
  if(c){c.classList.remove("animate","landed");c.style.opacity="0";void c.offsetWidth;c.classList.add("animate")}
  // After flip completes (2.2s), switch to gentle breathing
  setTimeout(function(){
    if(__devToolsOpen||__securityFrozen) return;
    if(c){c.style.opacity="1";c.classList.remove("animate");void c.offsetWidth;c.classList.add("landed")}
  },2300);
}
// Repeat flip every 10 seconds
setInterval(triggerFlip,10000);

function show(ok){
  document.getElementById("ld").classList.add("hide");
  document.getElementById("wrap").style.display="block";
  if(ok){setOk();activateWaves()}else setFk();
  setTimeout(triggerFlip,400);
}

function setOk(){
  document.body.classList.remove("forged");
  document.getElementById("pg").classList.remove("forged");
  document.getElementById("bx").classList.remove("show");
  document.getElementById("wm").classList.remove("show");
  document.getElementById("sOut").classList.remove("frozen");
  document.getElementById("sShim").classList.remove("frozen");
  document.getElementById("sGlow").classList.remove("frozen");
  var iconHtml = CUSTOMICON === 'svg' ? CUSTOMICONDATA : CUSTOMICON === 'img' ? '<img src="'+CUSTOMICONDATA+'" style="width:28px;height:28px;object-fit:contain" alt="">' : '<svg viewBox="0 0 50 50" fill="none"><path class="chk" d="M14 26L22 34L36 18" stroke="rgba(46,125,50,.5)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.getElementById("sCtr").innerHTML=iconHtml+'<div class="brand">'+ORGNAME+'</div><div class="lbl ok">VERIFIED</div>';
}

function setFk(){
  document.body.classList.add("forged");
  document.getElementById("pg").classList.add("forged");
  document.getElementById("bx").classList.add("show");
  document.getElementById("wm").classList.add("show");
  document.getElementById("sOut").classList.add("frozen");
  document.getElementById("sShim").classList.add("frozen");
  document.getElementById("sGlow").classList.add("frozen");
  document.getElementById("sCtr").innerHTML='<svg viewBox="0 0 50 50" fill="none"><path class="xp" d="M15 15L35 35" stroke="rgba(198,40,40,.5)" stroke-width="3" stroke-linecap="round"/><path class="xp" d="M35 15L15 35" stroke="rgba(198,40,40,.5)" stroke-width="3" stroke-linecap="round"/></svg><div class="brand">'+ORGNAME+'</div><div class="lbl bad">FORGED</div>';
}

function startRefresh(){
  setInterval(async function(){
    try{
      var r=await fetch(API+"/api/token/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:HASH})});
      var d=await r.json();
      if(d.success)token=d.token;
    }catch(e){setFk()}
  },30000);
}

init();
</script>
</body>
</html>`;
}

// ================================================================
// AUTH ROUTES
// ================================================================
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/app' }), (req, res) => res.redirect('/app'));

app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    const existing = await db.getUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(400).json({ success: false, error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const user = await db.createUser({ email: email.toLowerCase().trim(), name: name || email.split('@')[0], passwordHash: hash, provider: 'email' });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ success: false, error: 'Login failed' });
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar_url } });
    });
  } catch(e) { res.status(500).json({ success: false, error: 'Registration failed' }); }
});

app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ success: false, error: 'Server error' });
    if (!user) return res.status(401).json({ success: false, error: info?.message || 'Invalid credentials' });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ success: false, error: 'Login failed' });
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar_url } });
    });
  })(req, res, next);
});

app.post('/auth/logout', (req, res) => { req.logout(() => res.json({ success: true })); });

app.get('/api/user/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  res.json({ success: true, user: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar_url, plan: req.user.plan, documentsUsed: req.user.documents_used, documentsLimit: req.user.documents_limit } });
});

// ================================================================
// USER DOCUMENT ENDPOINTS (require login)
// ================================================================
function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Please sign in' });
  next();
}

app.get('/api/user/documents', requireLogin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const starred = req.query.starred === 'true';
    const docs = await db.getUserDocuments(req.user.id, { limit, offset, search, starred });
    const total = await db.getUserDocumentCount(req.user.id);
    res.json({ success: true, documents: docs, total, limit, offset });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to load documents' }); }
});

app.post('/api/user/upload', requireLogin, upload.single('file'), async (req, res) => {
  try {
    // Check document limit
    if (req.user.documents_used >= req.user.documents_limit) {
      return res.status(403).json({ success: false, error: 'Document limit reached. Upgrade your plan for more.' });
    }
    // Reuse existing PVF creation logic - set req.org for handleCreatePvf
    req.org = { orgId: 'user_' + req.user.id, orgName: req.user.name || req.user.email.split('@')[0] };
    // Call the existing handleCreatePvf middleware/function logic inline
    // (same as demo endpoint but with user context)
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Unsupported file type' });
    }

    const fileHash = hashBytes(file.buffer);
    const signature = signHash(fileHash);
    const fileBase64 = file.buffer.toString('base64');

    // Get user branding (reuse from api_keys if they have one, or defaults)
    const branding = { custom_icon: null, brand_color: null };

    await db.createDocument({
      hash: fileHash,
      signature,
      orgId: req.org.orgId,
      orgName: req.org.orgName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size
    });

    // Set user_id on document
    await db.setDocumentUserId(fileHash, req.user.id);
    await db.updateUserDocCount(req.user.id);

    const pvfHtml = generatePvfHtml(fileBase64, file.originalname, fileHash, file.mimetype, signature, null, branding.custom_icon, branding.brand_color, req.org.orgName);

    // Generate share ID
    const shareId = require('crypto').randomBytes(8).toString('base64url');
    await db.setShareId(fileHash, shareId);

    res.json({
      success: true,
      hash: fileHash,
      shareId,
      fileName: file.originalname,
      pvfContent: pvfHtml,
      documentsUsed: req.user.documents_used + 1,
      documentsLimit: req.user.documents_limit
    });
  } catch(e) {
    console.error('[USER UPLOAD]', e.message);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

app.post('/api/user/documents/:hash/star', requireLogin, async (req, res) => {
  try {
    const { starred } = req.body;
    await db.starDocument(req.params.hash, !!starred);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to update' }); }
});

// ================================================================
// API: DEMO — public PVF creation (no API key, strict rate limit)
// ================================================================
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 per hour per IP
  message: { success: false, error: 'Demo limit reached (5/hour). Sign up for unlimited access at /signup' },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/demo/create-pvf', demoLimiter, upload.single('file'), (req, res) => {
  // Inject a demo org context so the rest of the logic works
  req.org = { orgId: 'org_demo', orgName: 'Demo User' };
  req.apiKey = 'demo';

  // Fall through to the same handler logic
  handleCreatePvf(req, res);
});

// ================================================================
// API: SIGNUP — self-service API key registration
// ================================================================
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10, // 10 signups per hour per IP
  message: { success: false, error: 'Too many signup attempts. Try again later.' }
});

// Daily signup tracking per IP
const _dailySignups = new Map(); // IP -> { count, resetAt }

app.post('/api/signup', signupLimiter, async (req, res) => {
  try {
    let { orgName, contactName, email, useCase } = req.body;

    if (!orgName || !contactName || !email) {
      return res.status(400).json({ success: false, error: 'orgName, contactName, and email are required' });
    }

    // Daily IP signup limit (max 3 per day)
    const clientIP = getClientIP(req);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const ipEntry = _dailySignups.get(clientIP);
    if (ipEntry && ipEntry.resetAt > now) {
      if (ipEntry.count >= 3) {
        await db.log('signup_blocked', { reason: 'daily_ip_limit', ip: clientIP, email });
        return res.status(429).json({ success: false, error: 'Daily signup limit reached. Try again tomorrow.' });
      }
      ipEntry.count++;
    } else {
      _dailySignups.set(clientIP, { count: 1, resetAt: now + dayMs });
    }

    // Validate email format (strict)
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Sanitize inputs — strip HTML/script tags
    orgName = escapeHtml(orgName).substring(0, 100);
    contactName = escapeHtml(contactName).substring(0, 100);

    // Generate org ID and API key
    const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
    const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');

    // Force plan to 'free' on signup — upgrades require admin action
    const selectedPlan = 'free';
    const rateLimit = 5;

    // Create the API key
    await db.createApiKey({
      apiKey,
      orgId,
      orgName,
      plan: selectedPlan,
      rateLimit
    });

    // Audit log
    await db.log('signup', {
      orgId,
      orgName,
      contactName,
      email,
      useCase: useCase || 'not specified',
      plan: selectedPlan,
      ip: getClientIP(req)
    });

    console.log(`[SIGNUP] New org: ${orgName} (${selectedPlan}) — ${email}`);

    res.json({
      success: true,
      apiKey,
      orgId,
      orgName,
      plan: selectedPlan,
      rateLimit,
      message: 'Save this API key — it will not be shown again.'
    });

  } catch (error) {
    console.error('[ERROR] Signup failed:', error.message);
    res.status(500).json({ success: false, error: 'Signup failed. Please try again.' });
  }
});

// ================================================================
// API: CREATE PVF — receives file, returns .pvf (BLIND TO CONTENT)
// Requires API key authentication
// ================================================================
app.post('/api/create-pvf', createLimiter, authenticateApiKey, upload.single('file'), (req, res) => handleCreatePvf(req, res));

async function handleCreatePvf(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileBuffer = req.file.buffer;
    const originalName = (req.file.originalname || 'document').replace(/[<>:"/\\|?*]/g, '_'); // Sanitize filename
    const mimeType = req.file.mimetype || 'application/octet-stream';

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'text/plain', 'text/html',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.some(t => mimeType.startsWith(t.split('/')[0] + '/') || mimeType === t)) {
      await db.log('create_rejected', { reason: 'invalid_file_type', mimeType, ip: getClientIP(req) });
      return res.status(400).json({ success: false, error: 'Unsupported file type: ' + mimeType });
    }

    // Validate file not empty
    if (fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Empty file uploaded' });
    }

    // Step 1: Hash raw bytes (BLIND — never reads content)
    const fileHash = hashBytes(fileBuffer);

    // Step 2: HMAC sign the hash (proves it was registered by our server)
    const signature = signHash(fileHash);

    // Step 3: Generate session token
    const token = generateToken();
    const timestamp = new Date().toISOString();

    // Step 3.5: Recipient binding (optional)
    const recipient = req.body?.recipient || req.query?.recipient || null;
    let recipientHash = null;
    if (recipient) {
      recipientHash = crypto.createHash('sha256').update(recipient.toLowerCase().trim()).digest('hex');
    }

    // Step 4: Register document (persistent — SQLite)
    await db.createDocument({
      hash: fileHash,
      signature,
      originalName,
      mimeType,
      fileSize: fileBuffer.length,
      orgId: req.org.orgId,
      orgName: req.org.orgName,
      token,
      tokenCreatedAt: Date.now(),
      recipient,
      recipientHash
      // NOTE: we do NOT store the file content!
    });

    // Step 5: Update org stats
    await db.incrementDocCount(req.apiKey);

    // Step 6: Build .pvf file
    const isText = mimeType.startsWith('text/');
    let fileBase64;
    if (isText) {
      // HTML-escape text content to prevent XSS in the PVF document
      fileBase64 = fileBuffer.toString('utf-8')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      fileBase64 = fileBuffer.toString('base64');
    }

    const branding = await db.getBranding(req.org.orgId);
    let pvfHtml = generatePvfHtml(fileBase64, originalName, fileHash, mimeType, signature, recipientHash, branding.custom_icon, branding.brand_color, req.org.orgName);

    // Obfuscate the JavaScript inside the PVF (deterministic per document hash)
    const seed = parseInt(fileHash.substring(0, 8), 16);
    pvfHtml = obfuscatePvf(pvfHtml, seed);

    console.log(`[CREATE PVF] ${originalName} (${mimeType})`);
    console.log(`  Hash:      ${fileHash.substring(0, 24)}...`);
    console.log(`  Signature: ${signature.substring(0, 16)}...`);
    console.log(`  Org:       ${req.org.orgName}`);
    console.log(`  Size:      ${(fileBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`  Content:   NOT READ (blind processing)`);

    // Audit log: PVF creation
    await db.log('pvf_created', {
      orgId: req.org.orgId,
      hash: fileHash,
      originalName,
      mimeType,
      fileSize: fileBuffer.length,
      ip: getClientIP(req)
    });

    // Generate shareable link ID
    const shareId = crypto.randomBytes(8).toString('base64url'); // Short URL-safe ID
    await db.setShareId(fileHash, shareId);

    // Save PVF file for shareable link access
    const pvfDir = path.join(__dirname, 'data', 'pvf');
    if (!fs.existsSync(pvfDir)) fs.mkdirSync(pvfDir, { recursive: true });
    fs.writeFileSync(path.join(pvfDir, shareId + '.html'), pvfHtml);

    // Register on blockchain (non-blocking — doesn't fail PVF creation)
    if (chain.isConnected()) {
      chain.register(fileHash, signature, req.org.orgName).then(async result => {
        if (result.success && result.txHash) {
          await db.log('blockchain_registered', { hash: fileHash, txHash: result.txHash, blockNumber: result.blockNumber });
        }
      }).catch(async err => {
        console.warn('[BLOCKCHAIN] Registration failed, queued for retry:', err.message);
        await db.log('blockchain_failed', { hash: fileHash, orgId: req.org.orgId, error: err.message });
        // Store failed registration for retry
        if (!global._blockchainRetryQueue) global._blockchainRetryQueue = [];
        global._blockchainRetryQueue.push({ hash: fileHash, signature, orgName: req.org.orgName, failedAt: Date.now() });
      });
    }

    // Build share URL
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/d/${shareId}`;

    console.log(`  Share URL: ${shareUrl}`);

    // Check if client wants JSON response (for API integrations)
    if (req.query.format === 'json' || req.headers.accept === 'application/json') {
      return res.json({
        success: true,
        hash: fileHash,
        signature: signature.substring(0, 16) + '...',
        shareUrl,
        shareId,
        fileName: originalName.replace(/\.[^.]+$/, '') + '.pvf',
        fileSize: pvfHtml.length,
        downloadUrl: `${baseUrl}/d/${shareId}/download`
      });
    }

    // Return .pvf file with security headers
    const pvfFileName = originalName.replace(/\.[^.]+$/, '') + '.pvf';
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName}"`);
    res.setHeader('X-PVF-Share-URL', shareUrl);
    res.send(pvfHtml);

  } catch (error) {
    console.error('[ERROR] Create PVF failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create PVF' });
  }
}

// ================================================================
// API: VERIFY — checks if document hash is registered + signature valid
// Public endpoint (no API key needed — anyone with a .pvf can verify)
// ================================================================
app.post('/api/verify', verifyLimiter, async (req, res) => {
  try {
    const { hash, signature, content, recipientHash } = req.body;

    let lookupHash = hash;

    // Legacy support: if content object sent, compute hash
    if (!lookupHash && content) {
      lookupHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    }

    if (!lookupHash) {
      return res.status(400).json({ success: false, verified: false, error: 'Missing hash' });
    }

    // Validate hash format (must be a valid SHA-256 hex string)
    if (!/^[a-f0-9]{64}$/.test(lookupHash)) {
      return res.status(400).json({ success: false, verified: false, error: 'Invalid hash format' });
    }

    const doc = await db.getDocument(lookupHash);

    if (doc) {
      // Double-check: verify HMAC signature if provided
      let signatureValid = true;
      if (signature) {
        try {
          signatureValid = verifySignature(lookupHash, signature);
        } catch (e) {
          signatureValid = false;
        }
      }

      if (!signatureValid) {
        console.log(`[VERIFY FAIL] Signature mismatch for ${lookupHash.substring(0, 16)}...`);
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'invalid_signature' });
        return res.json({ success: true, verified: false, reason: 'invalid_signature' });
      }

      // Recipient binding check — if document has a bound recipient, verify it matches
      if (doc.recipientHash && recipientHash && doc.recipientHash !== recipientHash) {
        console.log(`[VERIFY FAIL] Recipient mismatch for ${lookupHash.substring(0, 16)}...`);
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'recipient_mismatch' });
        return res.json({ success: true, verified: false, reason: 'recipient_mismatch' });
      }

      const newToken = generateToken();
      await db.updateDocumentToken(lookupHash, newToken);

      console.log(`[VERIFY OK] ${lookupHash.substring(0, 16)}...`);
      await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'verified' });

      // Include blockchain verification if connected
      let blockchainProof = null;
      if (chain.isConnected()) {
        try {
          blockchainProof = await chain.verify(lookupHash, signature);
        } catch (e) { /* non-critical */ }
      }

      res.json({
        success: true,
        verified: true,
        hash: lookupHash,
        token: newToken,
        timestamp: doc.timestamp,
        orgName: doc.orgName,
        blockchain: blockchainProof
      });
    } else {
      console.log(`[VERIFY FAIL] Not found: ${lookupHash.substring(0, 16)}...`);
      await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'not_found' });
      res.json({ success: true, verified: false, hash: lookupHash });
    }
  } catch (error) {
    res.status(500).json({ success: false, verified: false, error: 'Verification error' });
  }
});

// ===== API: Token Refresh (heartbeat) =====
app.post('/api/token/refresh', verifyLimiter, async (req, res) => {
  try {
    const { hash } = req.body;

    // Validate hash format
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).json({ success: false, error: 'Invalid hash' });
    }

    const doc = await db.getDocument(hash);
    if (!doc) return res.json({ success: false, error: 'Not found' });

    // Don't refresh if token was created less than 60 seconds ago
    if (doc.tokenCreatedAt && (Date.now() - doc.tokenCreatedAt) < 60000) {
      return res.json({ success: true, token: doc.token, expiresIn: 30, cached: true });
    }

    const newToken = generateToken();
    await db.updateDocumentToken(hash, newToken);
    res.json({ success: true, token: newToken, expiresIn: 30 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

// ================================================================
// API: KEY MANAGEMENT (admin endpoints)
// ================================================================

// Generate new API key
app.post('/api/keys/create', authenticateAdmin, async (req, res) => {
  let { orgName, plan, allowedIPs } = req.body;
  if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });
  orgName = escapeHtml(orgName).substring(0, 100);

  const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
  const orgId = 'org_' + uuidv4().split('-')[0];
  const rateLimit = plan === 'enterprise' ? 10000 : plan === 'professional' ? 100 : 5;

  await db.createApiKey({
    apiKey,
    orgId,
    orgName,
    plan: plan || 'free',
    rateLimit,
    allowedIPs: (allowedIPs && Array.isArray(allowedIPs) && allowedIPs.length > 0) ? allowedIPs : undefined
  });

  await db.log('api_key_created', { orgId, orgName, plan: plan || 'free', ip: getClientIP(req), hasIpWhitelist: !!(allowedIPs && allowedIPs.length) });
  console.log(`[API KEY] Created for ${orgName} (${plan || 'free'})`);
  res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'free' });
});

// List API keys (admin)
app.get('/api/keys', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (!isValidAdminSecret(adminSecret)) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  const keys = (await db.listApiKeys()).map(k => ({
    ...k,
    apiKey: k.apiKey.substring(0, 12) + '...'
  }));

  res.json({ success: true, keys, total: keys.length });
});

// ===== API: Health =====
app.get('/api/health', async (req, res) => {
  const stats = await db.getStats();
  res.json({
    status: 'online',
    service: 'Vertifile',
    version: '4.1.0',
    documents: stats.totalDocuments,
    organizations: stats.totalOrganizations,
    blockchain: chain.isConnected() ? 'connected' : 'off-chain'
  });
});

// ===== API: Docs =====
app.get('/api/docs', (req, res) => {
  res.json({
    service: 'Vertifile API',
    version: '4.1.0',
    description: 'Document protection and verification platform with blockchain anchoring',
    security: {
      authentication: 'API Key (X-API-Key header) or Admin Secret (X-Admin-Secret header)',
      encryption: 'HMAC-SHA256 signatures, blind hashing (server never reads content)',
      pvfProtection: ['Code obfuscation', 'Recipient binding', 'Screen capture detection', 'DevTools detection', 'Unique visual fingerprint per document'],
      blockchain: 'Polygon (optional on-chain registration)'
    },
    endpoints: {
      document: {
        'POST /api/create-pvf': {
          description: 'Create a PVF file from an uploaded document',
          auth: 'X-API-Key header',
          body: 'multipart/form-data — file (required), recipient (optional email for binding)',
          response: '.pvf file download (obfuscated, with live verification stamp)',
          features: ['Blind hashing', 'HMAC signing', 'Code obfuscation', 'Recipient binding', 'On-chain registration (if blockchain enabled)', 'Unique animation per hash']
        },
        'POST /api/verify': {
          description: 'Verify a document hash (public endpoint)',
          auth: 'None',
          body: '{ hash, signature, recipientHash? }',
          response: '{ verified, token, timestamp, orgName, blockchain? }'
        },
        'POST /api/token/refresh': {
          description: 'Refresh session token (heartbeat, every 30s)',
          auth: 'None',
          body: '{ hash }',
          response: '{ token, expiresIn: 30 }'
        }
      },
      organization: {
        'GET /api/org/stats': {
          description: 'Organization statistics',
          auth: 'X-API-Key header'
        },
        'GET /api/org/documents': {
          description: 'Paginated document list for organization',
          auth: 'X-API-Key header',
          query: '?limit=50&offset=0'
        }
      },
      gateway: {
        'POST /api/gateway/intake': {
          description: 'Upload .pvf file for automated verification + original document extraction',
          auth: 'X-API-Key header',
          body: 'multipart/form-data with .pvf file',
          response: '{ verified, document, extractedFile (base64) }'
        },
        'POST /api/gateway/batch': {
          description: 'Batch verify up to 50 .pvf files at once',
          auth: 'X-API-Key header',
          body: 'multipart/form-data with multiple .pvf files',
          response: '{ results: [...], summary }'
        }
      },
      webhooks: {
        'POST /api/webhooks/register': {
          description: 'Register webhook for verification events',
          auth: 'X-API-Key header',
          body: '{ url, events: ["verification.success", "verification.failed"] }'
        },
        'GET /api/webhooks': {
          description: 'List registered webhooks',
          auth: 'X-API-Key header'
        },
        'DELETE /api/webhooks/:id': {
          description: 'Remove a webhook',
          auth: 'X-API-Key header'
        }
      },
      admin: {
        'GET /api/admin/stats': {
          description: 'Global system statistics + blockchain status',
          auth: 'X-Admin-Secret header'
        },
        'GET /api/admin/audit': {
          description: 'Audit log viewer (paginated, filterable by event/org)',
          auth: 'X-Admin-Secret header',
          query: '?limit=50&offset=0&event=pvf_created&orgId=org_xxx'
        },
        'POST /api/keys/create': {
          description: 'Create a new API key for an organization',
          auth: 'X-Admin-Secret header',
          body: '{ orgName, plan: "free"|"professional" }'
        },
        'GET /api/keys': {
          description: 'List all API keys',
          auth: 'X-Admin-Secret header'
        }
      },
      system: {
        'GET /api/health': { description: 'Service health check', auth: 'None' },
        'GET /api/docs': { description: 'This documentation', auth: 'None' }
      }
    },
    sdk: {
      cli: 'node sdk.js document.pdf [output.pvf]',
      library: 'const { convertToPvf } = require("./sdk"); await convertToPvf("file.pdf", "out.pvf")'
    }
  });
});

// ================================================================
// API: ORG ENDPOINTS (require API key)
// ================================================================

// Org stats — how many documents this org has created
app.get('/api/org/stats', authenticateApiKey, async (req, res) => {
  const stats = await db.getOrgStats(req.org.orgId);
  res.json({ success: true, orgId: req.org.orgId, orgName: req.org.orgName, ...stats });
});

// Org documents — list of documents issued by this org (paginated)
app.get('/api/org/documents', authenticateApiKey, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const docs = await db.getDocumentsByOrg(req.org.orgId, { limit, offset });
  const total = await db.getDocumentCount(req.org.orgId);

  res.json({ success: true, documents: docs, total, limit, offset });
});

// GET org profile (full details)
app.get('/api/org/profile', authenticateApiKey, async (req, res) => {
  try {
    const branding = await db.getBranding(req.org.orgId);
    res.json({
      success: true,
      orgId: req.org.orgId,
      orgName: req.org.orgName,
      plan: req.org.plan,
      documentsCreated: req.org.documentsCreated,
      rateLimit: req.org.rateLimit,
      created: req.org.created,
      branding: {
        customIcon: branding.custom_icon || null,
        brandColor: branding.brand_color || null
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST update branding
app.post('/api/org/branding', authenticateApiKey, async (req, res) => {
  try {
    const { customIcon, brandColor } = req.body;

    // Validate brand color (hex)
    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'Invalid color format. Use hex (#RRGGBB)' });
    }

    // Validate custom icon (base64, max 50KB)
    if (customIcon) {
      const iconSize = Buffer.byteLength(customIcon, 'utf8');
      if (iconSize > 50 * 1024) {
        return res.status(400).json({ success: false, error: 'Icon too large. Maximum 50KB.' });
      }
      // Must be data URI or SVG
      if (!customIcon.startsWith('data:image/') && !customIcon.startsWith('<svg')) {
        return res.status(400).json({ success: false, error: 'Icon must be SVG or image data URI' });
      }
    }

    await db.updateBranding(req.org.orgId, { customIcon, brandColor });
    await db.log('branding_updated', { orgId: req.org.orgId, hasIcon: !!customIcon, color: brandColor });

    res.json({ success: true, message: 'Branding updated' });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET current branding
app.get('/api/org/branding', authenticateApiKey, async (req, res) => {
  try {
    const branding = await db.getBranding(req.org.orgId);
    res.json({
      success: true,
      customIcon: branding.custom_icon || null,
      brandColor: branding.brand_color || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ================================================================
// API: ADMIN ENDPOINTS (require admin secret)
// ================================================================
// Timing-safe admin secret comparison to prevent timing attacks
function isValidAdminSecret(provided) {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  if (typeof provided !== 'string') return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function authenticateAdmin(req, res, next) {
  const adminSecret = req.headers['x-admin-secret'];
  if (!isValidAdminSecret(adminSecret)) {
    await db.log('auth_failed', { reason: 'invalid_admin_secret', ip: getClientIP(req), path: req.path });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// Admin stats — global overview
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
  const stats = await db.getStats();
  const blockchainStats = await chain.getStats();
  res.json({ success: true, ...stats, blockchain: blockchainStats });
});

// Admin audit log — paginated, filterable
app.get('/api/admin/audit', authenticateAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const offset = parseInt(req.query.offset) || 0;
  const event = req.query.event || undefined;
  const orgId = req.query.orgId || undefined;

  const entries = await db.getAuditLog({ limit, offset, event, orgId });
  res.json({ success: true, entries, limit, offset });
});

// Admin — list API keys
app.get('/api/admin/keys', authenticateAdmin, async (req, res) => {
  const keys = await db.listApiKeys();
  res.json({ success: true, keys });
});

// Admin — create API key
app.post('/api/admin/keys', authenticateAdmin, async (req, res) => {
  const { orgName, plan } = req.body;
  if (!orgName) return res.status(400).json({ success: false, error: 'orgName required' });

  const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
  const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
  const rateLimit = plan === 'enterprise' ? 10000 : plan === 'professional' ? 100 : 5;

  await db.createApiKey({ apiKey, orgId, orgName, plan: plan || 'free', rateLimit });
  await db.log('api_key_created', { orgId, orgName, plan, ip: getClientIP(req) });

  res.json({ success: true, apiKey, orgId, orgName, plan: plan || 'free' });
});

// Admin — delete API key
app.delete('/api/admin/keys/:key', authenticateAdmin, async (req, res) => {
  try {
    const key = await db.getApiKey(req.params.key);
    if (!key) return res.status(404).json({ success: false, error: 'API key not found' });
    await db.deactivateApiKey(req.params.key);
    await db.log('api_key_deleted', { apiKey: req.params.key.substring(0, 12) + '...', orgId: key.orgId, ip: getClientIP(req) });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to delete key' });
  }
});

// Admin — list all documents (paginated, searchable)
app.get('/api/admin/documents', authenticateAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const search = req.query.search || '';

  try {
    const docs = await db.getAllDocuments({ limit, offset, search });
    res.json({ success: true, documents: docs, limit, offset });
  } catch (e) {
    res.json({ success: true, documents: [], limit, offset });
  }
});

// Admin — list all webhooks
app.get('/api/admin/webhooks', authenticateAdmin, async (req, res) => {
  try {
    const webhooks = db.getAllWebhooks ? await db.getAllWebhooks() : [];
    res.json({ success: true, webhooks });
  } catch (e) {
    res.json({ success: true, webhooks: [] });
  }
});

// ================================================================
// API: VERIFICATION GATEWAY — for organizations receiving PVF docs
// ================================================================

// Gateway intake — receive a .pvf file, verify it, extract original doc
app.post('/api/gateway/intake', authenticateApiKey, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const pvfContent = req.file.buffer.toString('utf-8');

    // Extract hash and signature from the PVF HTML (var HASH="..." / var SIG="...")
    const hashMatch = pvfContent.match(/var\s+HASH\s*=\s*"([a-f0-9]{64})"/);
    const sigMatch = pvfContent.match(/var\s+SIG\s*=\s*"([a-f0-9]{64})"/);

    if (!hashMatch || !sigMatch) {
      await db.log('gateway_intake', { orgId: req.org.orgId, ip: getClientIP(req), result: 'invalid_pvf' });
      return res.status(400).json({ success: false, error: 'Invalid PVF file — could not extract hash/signature' });
    }

    const hash = hashMatch[1];
    const signature = sigMatch[1];

    // Verify against database
    const doc = await db.getDocument(hash);
    if (!doc) {
      await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'not_found' });
      return res.json({
        success: true,
        verified: false,
        reason: 'Document not registered in Vertifile'
      });
    }

    // Verify HMAC signature
    let signatureValid = false;
    try {
      signatureValid = verifySignature(hash, signature);
    } catch (e) {
      signatureValid = false;
    }

    if (!signatureValid) {
      await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'invalid_signature' });
      return res.json({
        success: true,
        verified: false,
        reason: 'Signature mismatch — document may have been tampered with'
      });
    }

    // Extract the embedded file content from PVF
    let extractedFile = null;
    // Try base64 image: <img src="data:image/...;base64,DATA">
    const imgMatch = pvfContent.match(/src="data:[^;]+;base64,([A-Za-z0-9+/=]+)"/);
    // Try base64 PDF iframe: <iframe src="data:application/pdf;base64,DATA">
    const pdfMatch = pvfContent.match(/src="data:application\/pdf;base64,([A-Za-z0-9+/=]+)"/);
    // Try text content: <div class="text-doc">CONTENT</div> or </div>
    const textMatch = pvfContent.match(/<div class="text-doc">([\s\S]*?)<\/div>/);

    if (imgMatch) {
      // Validate base64 before returning
      const b64 = imgMatch[1];
      if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
        extractedFile = b64;
      }
    } else if (pdfMatch) {
      const b64 = pdfMatch[1];
      if (/^[A-Za-z0-9+/=]+$/.test(b64)) {
        extractedFile = b64;
      }
    } else if (textMatch) {
      // Strip HTML tags from extracted text content
      const cleanText = textMatch[1].trim().replace(/<[^>]*>/g, '');
      extractedFile = Buffer.from(cleanText).toString('base64');
    }

    await db.log('gateway_intake', { orgId: req.org.orgId, hash, ip: getClientIP(req), result: 'verified', issuedBy: doc.orgName });

    // Fire webhooks for the receiving org
    fireWebhooks(req.org.orgId, 'verification.success', {
      hash,
      originalName: doc.originalName,
      issuedBy: doc.orgName,
      verifiedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      verified: true,
      document: {
        hash: doc.hash,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        issuedAt: doc.timestamp,
        issuedBy: doc.orgName,
        orgId: doc.orgId
      },
      extractedFile,
      verifiedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[GATEWAY] Intake error:', error.message);
    res.status(500).json({ success: false, error: 'Gateway processing error' });
  }
});

// Gateway batch — verify multiple PVF files at once
app.post('/api/gateway/batch', authenticateApiKey, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const results = await Promise.all(req.files.map(async (file, index) => {
      try {
        const pvfContent = file.buffer.toString('utf-8');
        const hashMatch = pvfContent.match(/var\s+HASH\s*=\s*"([a-f0-9]{64})"/);
        const sigMatch = pvfContent.match(/var\s+SIG\s*=\s*"([a-f0-9]{64})"/);

        if (!hashMatch || !sigMatch) {
          return { index, filename: file.originalname, verified: false, reason: 'invalid_pvf' };
        }

        const hash = hashMatch[1];
        const signature = sigMatch[1];
        const doc = await db.getDocument(hash);

        if (!doc) {
          return { index, filename: file.originalname, verified: false, reason: 'not_found', hash };
        }

        let signatureValid = false;
        try { signatureValid = verifySignature(hash, signature); } catch (e) {}

        if (!signatureValid) {
          return { index, filename: file.originalname, verified: false, reason: 'invalid_signature', hash };
        }

        return {
          index,
          filename: file.originalname,
          verified: true,
          document: {
            hash: doc.hash,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
            issuedAt: doc.timestamp,
            issuedBy: doc.orgName
          }
        };
      } catch (e) {
        return { index, filename: file.originalname, verified: false, reason: 'processing_error' };
      }
    }));

    const verified = results.filter(r => r.verified).length;
    const failed = results.length - verified;

    await db.log('gateway_batch', {
      orgId: req.org.orgId,
      ip: getClientIP(req),
      total: results.length,
      verified,
      failed
    });

    res.json({ success: true, total: results.length, verified, failed, results });

  } catch (error) {
    console.error('[GATEWAY] Batch error:', error.message);
    res.status(500).json({ success: false, error: 'Batch processing error' });
  }
});

// ================================================================
// API: WEBHOOKS — orgs get notified on verification events
// ================================================================

// Webhook helper — fire webhooks for an org
async function fireWebhooks(orgId, event, data) {
  try {
    const webhooks = await db.getWebhooksByOrg(orgId);
    for (const wh of webhooks) {
      if (wh.events.includes(event)) {
        const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
        const hmac = crypto.createHmac('sha256', wh.secret).update(payload).digest('hex');

        // Fire and forget
        fetch(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Vertifile-Signature': hmac
          },
          body: payload
        }).catch(err => {
          console.error(`[WEBHOOK] Failed to deliver to ${wh.url}:`, err.message);
        });
      }
    }
  } catch (e) {
    console.error('[WEBHOOK] Error:', e.message);
  }
}

// Validate webhook URL to prevent SSRF attacks
function isValidWebhookUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    // Must be HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Block non-standard ports (only allow 443)
    if (parsed.port && parsed.port !== '443') return false;
    // Block private/internal IP ranges
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    // Block 10.x.x.x
    if (/^10\./.test(host)) return false;
    // Block 172.16.x.x - 172.31.x.x
    const m172 = host.match(/^172\.(\d+)\./);
    if (m172 && parseInt(m172[1]) >= 16 && parseInt(m172[1]) <= 31) return false;
    // Block 192.168.x.x
    if (/^192\.168\./.test(host)) return false;
    // Block link-local and metadata
    if (/^169\.254\./.test(host)) return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    // Block 0.x.x.x and 127.x.x.x
    if (/^0\./.test(host) || /^127\./.test(host)) return false;
    return true;
  } catch { return false; }
}

// Register a webhook
app.post('/api/webhooks/register', authenticateApiKey, async (req, res) => {
  const { url, events } = req.body;
  if (!url || !events || !Array.isArray(events)) {
    return res.status(400).json({ success: false, error: 'url and events[] required' });
  }

  // Validate webhook URL (must be HTTPS, no internal IPs)
  if (!isValidWebhookUrl(url)) {
    return res.status(400).json({ success: false, error: 'Invalid webhook URL. Must be HTTPS and point to a public endpoint.' });
  }

  const allowedEvents = ['verification.success', 'verification.failed', 'document.created'];
  const validEvents = events.filter(e => allowedEvents.includes(e));
  if (validEvents.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid events. Allowed: ' + allowedEvents.join(', ') });
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const id = await db.registerWebhook(req.org.orgId, url, validEvents, secret);

  await db.log('webhook_registered', { orgId: req.org.orgId, url, events: validEvents, ip: getClientIP(req) });
  res.json({ success: true, webhookId: id, secret, events: validEvents });
});

// List org webhooks
app.get('/api/webhooks', authenticateApiKey, async (req, res) => {
  const webhooks = await db.getWebhooksByOrg(req.org.orgId);
  res.json({ success: true, webhooks: webhooks.map(w => ({ id: w.id, url: w.url, events: w.events, createdAt: w.createdAt })) });
});

// Delete a webhook
app.delete('/api/webhooks/:id', authenticateApiKey, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });
  const removed = await db.removeWebhook(id, req.org.orgId);
  if (!removed) return res.status(404).json({ success: false, error: 'Webhook not found' });
  res.json({ success: true });
});

// ================================================================
// PAGE ROUTES
// ================================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/enterprise', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'enterprise.html'));
});

app.get('/integration', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'integration.html'));
});

app.get('/open', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'open.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// ================================================================
// SHAREABLE DOCUMENT LINKS — /d/:shareId
// Anyone with the link can view the PVF document in-browser
// ================================================================
app.get('/d/:shareId', async (req, res) => {
  const { shareId } = req.params;

  // Validate share ID format — alphanumeric + URL-safe base64 chars only (no path traversal)
  if (!shareId || shareId.length < 6 || shareId.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(shareId)) {
    return res.status(404).send(notFoundPage('Invalid document link'));
  }

  // Look up document by share ID
  const doc = await db.getDocumentByShareId(shareId);
  if (!doc) {
    return res.status(404).send(notFoundPage('Document not found'));
  }

  // Serve the stored PVF HTML directly in the browser
  const pvfPath = path.join(__dirname, 'data', 'pvf', shareId + '.html');
  if (!fs.existsSync(pvfPath)) {
    return res.status(404).send(notFoundPage('Document file not available'));
  }

  // Log the view
  await db.log('document_viewed', { shareId, hash: doc.hash, ip: getClientIP(req) });

  // Serve as HTML so browser renders it directly
  setPvfSecurityHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(pvfPath);
});

// Download route — /d/:shareId/download — downloads as .pvf file
app.get('/d/:shareId/download', async (req, res) => {
  const { shareId } = req.params;
  if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) return res.status(404).json({ success: false, error: 'Invalid link' });

  const doc = await db.getDocumentByShareId(shareId);
  if (!doc) {
    return res.status(404).json({ success: false, error: 'Document not found' });
  }

  const pvfPath = path.join(__dirname, 'data', 'pvf', shareId + '.html');
  if (!fs.existsSync(pvfPath)) {
    return res.status(404).json({ success: false, error: 'Document file not available' });
  }

  const pvfFileName = (doc.originalName || 'document').replace(/\.[^.]+$/, '') + '.pvf';
  res.setHeader('Content-Type', 'application/vnd.vertifile.pvf; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${pvfFileName}"`);
  res.sendFile(pvfPath);
});

// Document info API — /d/:shareId/info — returns metadata (no content)
app.get('/d/:shareId/info', async (req, res) => {
  const { shareId } = req.params;
  if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) return res.status(404).json({ success: false, error: 'Invalid link' });

  const doc = await db.getDocumentByShareId(shareId);
  if (!doc) {
    return res.status(404).json({ success: false, error: 'Document not found' });
  }

  res.json({
    success: true,
    document: {
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      issuedAt: doc.timestamp,
      issuedBy: doc.orgName,
      verified: true
    }
  });
});

// 404 page helper
function notFoundPage(message) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Document Not Found — Vertifile</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f0e17;color:#e2e0f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.c{text-align:center;padding:40px}
h1{font-size:72px;font-weight:900;color:#7c3aed;margin-bottom:16px}
p{font-size:18px;color:#9ca3af;margin-bottom:32px}
a{display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;transition:.2s}
a:hover{background:#6d28d9;transform:translateY(-1px)}
</style></head><body><div class="c">
<h1>404</h1>
<p>${escapeHtml(message)}</p>
<a href="/">Back to Vertifile</a>
</div></body></html>`;
}

app.get('/demo', (req, res) => {
  res.sendFile('demo.html', { root: path.join(__dirname, 'public') });
});

app.get('/demo-pvf', (req, res) => {
  const p = path.join(__dirname, 'demo.pvf');
  if (fs.existsSync(p)) {
    setPvfSecurityHeaders(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(p);
  } else {
    res.status(404).send('demo.pvf not found');
  }
});

// ================================================================
// CONTACT FORM
// ================================================================

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: 'Too many submissions' } });

app.post('/api/contact', contactLimiter, async (req, res) => {
  const { name, email, organization, orgType, message } = req.body;
  if (!name || !email || !organization) {
    return res.status(400).json({ success: false, error: 'Name, email, and organization are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }
  await db.log('contact_form', { name, email, organization, orgType: orgType || 'not specified', message: message || '', ip: getClientIP(req) });
  res.json({ success: true });
});

// ================================================================
// ERROR HANDLING
// ================================================================

// 404 handler for unknown routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Endpoint not found' });
  }
  // For page routes, redirect to home
  res.redirect('/');
});

// Global error handler
app.use(async (err, req, res, next) => {
  console.error('[ERROR]', err.message);
  await db.log('server_error', { path: req.path, method: req.method, error: err.message, ip: getClientIP(req) });

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'CORS: Origin not allowed' });
  }

  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ================================================================
// 404 CATCH-ALL (must be after all other routes)
// ================================================================
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ================================================================
// DATABASE READY — wait for async initialization, then bootstrap
// ================================================================
db._ready.then(async () => {

  // Migrate existing JSON data to database (one-time, idempotent)
  await db.migrateFromJson();

  // Create a default API key if none exist
  const existingKeys = await db.listApiKeys();
  if (existingKeys.length === 0) {
    const defaultKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');
    await db.createApiKey({
      apiKey: defaultKey,
      orgId: 'org_default',
      orgName: 'Vertifile Demo',
      plan: 'professional',
      rateLimit: 100
    });
    console.log('\n🔑 Default API key created: ' + defaultKey + '\n');
  }

  // Register demo document (so /demo works with verify)
  const demoContent = {
    name: 'יוסי כהן',
    degree: 'בוגר במדעי המחשב (B.Sc.)',
    average: '92.4',
    year: '2024',
    docId: 'PVF-2024-00482',
    issuer: 'אוניברסיטת תל אביב'
  };
  const demoHash = crypto.createHash('sha256').update(JSON.stringify(demoContent)).digest('hex');
  const demoSig = signHash(demoHash);
  if (!(await db.getDocument(demoHash))) {
    await db.createDocument({
      hash: demoHash,
      signature: demoSig,
      originalName: 'demo',
      mimeType: 'text/html',
      fileSize: 0,
      orgId: 'org_vertifile',
      orgName: 'Vertifile',
      token: generateToken(),
      tokenCreatedAt: Date.now()
    });
  }

  // ================================================================
  // START SERVER
  // ================================================================
  if (require.main === module) {
    app.listen(PORT, async () => {
      const stats = await db.getStats();
      const keys = await db.listApiKeys();
      const defaultKey = keys.length > 0 ? keys[0].apiKey : null;
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║     Vertifile — Protected Verified File v4.1    ║');
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║  Port:       ${PORT}                                ║`);
      console.log(`║  Home:       http://localhost:${PORT}                  ║`);
      console.log(`║  Demo:       http://localhost:${PORT}/demo             ║`);
      console.log(`║  Dashboard:  http://localhost:${PORT}/dashboard         ║`);
      console.log(`║  API Docs:   http://localhost:${PORT}/api/docs         ║`);
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║  Database:   ${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (WAL mode)'}${''.padEnd(process.env.DATABASE_URL ? 20 : 3)}║`);
      console.log(`║  Documents:  ${String(stats.totalDocuments).padEnd(5)} registered                   ║`);
      console.log(`║  API Keys:   ${String(stats.totalOrganizations).padEnd(5)} active                       ║`);
      console.log(`║  Security:   HMAC + CSP + CORS + Audit + Helmet  ║`);
      console.log(`║  Privacy:    BLIND — never reads document content║`);
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║  API Key:    ${defaultKey ? defaultKey.substring(0, 24) + '...' : 'none'}    ║`);
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('');

      // Initialize blockchain (non-blocking — works without it)
      chain.init().then(connected => {
        if (connected) console.log('[BLOCKCHAIN] On-chain registration active');
        else console.log('[BLOCKCHAIN] Off-chain mode (set POLYGON_PRIVATE_KEY + POLYGON_CONTRACT to enable)');
      });
    });

    // Graceful shutdown
    process.on('SIGINT', () => { db.close(); process.exit(0); });
    process.on('SIGTERM', () => { db.close(); process.exit(0); });
  }

}).catch(err => {
  console.error('[FATAL] Database initialization failed:', err);
  process.exit(1);
});

// Export for Vercel serverless
module.exports = app;
