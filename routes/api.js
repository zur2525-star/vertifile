const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { signupLimiter, getClientIP } = require('../middleware/auth');
const logger = require('../services/logger');
const { sendEmail, sendContactConfirmationEmail } = require('../services/email');
const { validatePassword } = require('../services/password-validator');
const { escapeHtml } = require('../templates/pvf');
const { handleCreatePvf, verifySignature, generateToken, HMAC_SECRET } = require('../services/pvf-generator');
const { buildOverrideScriptInnerText } = require('../services/stamp-override');
const signing = require('../services/signing');
const keyManager = require('../services/key-manager');

const router = express.Router();

// Phase 3C — tracks when the active-primary cache was last invalidated via
// the admin endpoint. Surfaced in /health/deep for operator observability.
let cacheLastInvalidatedAt = null;

// ===== OpenAPI Spec =====
router.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/api/openapi.json'));
});

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

// Rate limiter — demo
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 per hour per IP
  message: { success: false, error: 'Demo limit reached (5/hour). Sign up for unlimited access at /signup' },
  standardHeaders: true,
  legacyHeaders: false
});

// Daily signup tracking per IP
const _dailySignups = new Map(); // IP -> { count, resetAt }

// Periodic cleanup of expired daily signup entries (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _dailySignups) {
    if (entry.resetAt <= now) _dailySignups.delete(ip);
  }
}, 30 * 60 * 1000).unref();

// ================================================================
// API: SIGNUP
// ================================================================
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    let { orgName, contactName, email, useCase, password } = req.body;

    if (!orgName || !contactName || !email || !password) {
      return res.status(400).json({ success: false, error: 'orgName, contactName, email, and password are required' });
    }

    // Full password strength validation
    const pwResult = validatePassword(password, email);
    if (!pwResult.valid) {
      return res.status(400).json({ success: false, error: 'Password does not meet requirements', details: pwResult.errors });
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

    // Sanitize inputs
    orgName = escapeHtml(orgName).substring(0, 100);
    contactName = escapeHtml(contactName).substring(0, 100);

    // Generate org ID and API key
    const orgId = 'org_' + orgName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30) + '_' + crypto.randomBytes(4).toString('hex');
    const apiKey = 'vf_live_' + crypto.randomBytes(20).toString('hex');

    const selectedPlan = 'pro';
    const rateLimitVal = 100;

    await db.createApiKey({
      apiKey,
      orgId,
      orgName,
      plan: selectedPlan,
      rateLimit: rateLimitVal
    });

    await db.log('signup', {
      orgId,
      orgName,
      contactName,
      email,
      useCase: useCase || 'not specified',
      plan: selectedPlan,
      ip: getClientIP(req)
    });

    logger.info({ event: 'signup', orgName, plan: selectedPlan, email }, `New org: ${orgName}`);

    // --- Create user account so they can log in to /app ---
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists. Please log in instead.' });
    }

    const BCRYPT_ROUNDS = 12;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await db.createUser({
      email,
      name: contactName,
      passwordHash,
      provider: 'email',
    });

    await db.log('user_registered', { userId: user.id, ip: getClientIP(req), provider: 'email', orgId });

    // Create session so user is logged in immediately
    req.login(user, (loginErr) => {
      if (loginErr) {
        logger.warn({ err: loginErr }, 'Auto-login after signup failed');
        // Still return success — they got their API key, they can log in manually
        return res.json({
          success: true,
          apiKey,
          orgId,
          orgName,
          plan: selectedPlan,
          rateLimit: rateLimitVal,
          message: 'Save this API key — it will not be shown again.'
        });
      }

      req.session.createdAt = Date.now();

      res.json({
        success: true,
        apiKey,
        orgId,
        orgName,
        plan: selectedPlan,
        rateLimit: rateLimitVal,
        redirect: '/app',
        message: 'Account created. Save this API key — it will not be shown again.'
      });
    });

  } catch (error) {
    logger.error({ err: error, event: 'signup_error' }, 'Signup failed');
    res.status(500).json({ success: false, error: 'Signup failed. Please try again.' });
  }
});

// ================================================================
// API: DEMO — public PVF creation
// ================================================================
router.post('/demo/create-pvf', demoLimiter, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, (req, res) => {
  req.org = { orgId: 'org_demo', orgName: 'Demo User' };
  req.apiKey = 'demo';
  handleCreatePvf(req, res);
});

// ================================================================
// API: CREATE PVF — requires API key authentication
// ================================================================
router.post('/create-pvf', createLimiter, (req, res, next) => {
  const authenticateApiKey = req.app.get('authenticateApiKey');
  authenticateApiKey(req, res, next);
}, (req, res, next) => {
  const upload = req.app.get('upload');
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, (req, res) => handleCreatePvf(req, res));

// ================================================================
// API: VERIFY
// ================================================================
router.post('/verify', verifyLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const chain = req.app.get('chain');
    const { hash, signature, content, recipientHash, created, orgId, codeIntegrity, ed25519Signature, ed25519KeyId } = req.body;

    let lookupHash = hash;

    // Legacy support: if content object sent, compute hash
    if (!lookupHash && content) {
      lookupHash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    }

    if (!lookupHash) {
      return res.status(400).json({ success: false, verified: false, error: 'Missing hash' });
    }

    // Validate hash format
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
        logger.warn({ event: 'verify_fail', reason: 'signature_mismatch', hash: lookupHash.substring(0, 16) }, 'Signature mismatch');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'invalid_signature' });
        return res.json({ success: true, verified: false, reason: 'invalid_signature' });
      }

      // ============================================================
      // PHASE 2C — Ed25519 verification + no-downgrade enforcement
      //
      // Behavior matrix:
      //   doc.ed25519_signature  | client ed25519Signature | result
      //   ---------------------- | ----------------------- | ------
      //   NULL  (legacy / no key)| absent                  | OK — HMAC-only path (signedBy='hmac')
      //   NULL  (legacy / no key)| present                 | REJECT — forge-by-claim defense ('ed25519_unexpected')
      //   PRESENT (dual-signed)  | absent                  | REJECT — no-downgrade ('ed25519_required')
      //   PRESENT (dual-signed)  | present + verifies      | OK — dual-verified (signedBy='both')
      //   PRESENT (dual-signed)  | present + invalid       | REJECT ('ed25519_invalid')
      //
      // The Ed25519 payload is reconstructed from the DB row, NEVER from
      // client-supplied fields. This is the no-downgrade defense: the
      // verifier never trusts the client about orgId / createdAt /
      // recipientHash / codeIntegrity. The exact payload format MUST
      // match Phase 2B (services/pvf-pipeline.js:243-249) byte-for-byte
      // or crypto.verify() returns false.
      //
      // The mapped doc fields are: doc.timestamp (← created_at),
      // doc.orgId, doc.recipientHash, doc.ed25519_signature,
      // doc.ed25519_key_id (see db.js mapDocRow).
      // ============================================================
      // Phase 2C Fix #2 (Ori): reject inconsistent rows up front.
      // A row with one-of-two ed25519 columns set indicates data corruption
      // or a botched migration. Falling through to the else branch would
      // silently downgrade the doc to HMAC-only, which is a security risk.
      if (!!doc.ed25519_signature !== !!doc.ed25519_key_id) {
        logger.warn({ event: 'verify_fail', reason: 'ed25519_inconsistent', hash: lookupHash.substring(0, 16) }, 'Half-dual-signed row');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'ed25519_inconsistent' });
        return res.json({ success: true, verified: false, reason: 'ed25519_inconsistent' });
      }

      let signedBy = 'hmac';
      if (doc.ed25519_signature && doc.ed25519_key_id) {
        // Doc is dual-signed — client MUST submit a matching Ed25519 signature.
        if (!ed25519Signature || !ed25519KeyId) {
          logger.warn({ event: 'verify_fail', reason: 'ed25519_required', hash: lookupHash.substring(0, 16) }, 'Ed25519 required but missing');
          await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'ed25519_required' });
          return res.json({ success: true, verified: false, reason: 'ed25519_required' });
        }

        // Phase 2C Fix #1 (Avi): hard-bind the client's keyId to the DB row.
        // As-written, the code is not exploitable (an attacker can't find a
        // (signature, keyId) pair where the sig verifies under a different key
        // without breaking Ed25519), but the wrong-keyId surface is a future-bug
        // magnet. Defense in depth.
        if (ed25519KeyId !== doc.ed25519_key_id) {
          logger.warn({ event: 'verify_fail', reason: 'ed25519_key_mismatch', hash: lookupHash.substring(0, 16) }, 'Ed25519 keyId mismatch');
          await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'ed25519_key_mismatch' });
          return res.json({ success: true, verified: false, reason: 'ed25519_key_mismatch' });
        }

        // Reconstruct the EXACT payload that Phase 2B signed (DB-only, never client).
        // codeIntegrity is intentionally empty — see services/pvf-pipeline.js:248.
        const expectedPayload = signing.buildSigningPayload({
          hash: doc.hash,
          orgId: doc.orgId,
          createdAt: doc.timestamp,
          recipientHash: doc.recipientHash || '',
          codeIntegrity: ''
        });

        let ed25519Ok = false;
        try {
          ed25519Ok = await signing.verifyEd25519(expectedPayload, ed25519Signature, ed25519KeyId);
        } catch (e) {
          ed25519Ok = false;
        }
        if (!ed25519Ok) {
          logger.warn({ event: 'verify_fail', reason: 'ed25519_invalid', hash: lookupHash.substring(0, 16) }, 'Ed25519 signature invalid');
          await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'ed25519_invalid' });
          return res.json({ success: true, verified: false, reason: 'ed25519_invalid' });
        }
        signedBy = 'both';
      } else if (ed25519Signature) {
        // Doc was NOT dual-signed but client claims an Ed25519 signature exists.
        // Reject — protects against forge-by-claim attacks.
        logger.warn({ event: 'verify_fail', reason: 'ed25519_unexpected', hash: lookupHash.substring(0, 16) }, 'Ed25519 supplied for unsigned doc');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'ed25519_unexpected' });
        return res.json({ success: true, verified: false, reason: 'ed25519_unexpected' });
      }

      // Code integrity check — with dual-hash fallback for Layer 2 overrides
      //
      // OLD documents (created before the data-vf-stamp-override marker
      // was added to the client-side hasher) will include the injected
      // override script in their client-side hash. The stored
      // doc.code_integrity only covers the original script. To verify
      // those documents we recompute the expected hash on the fly:
      //   expectedHash = sha256(originalScriptText + overrideScriptText)
      // where overrideScriptText is rebuilt deterministically from the
      // owner's current stamp_config (same logic used by injectStampConfig).
      //
      // NEW documents get the :not([data-vf-stamp-override]) selector
      // on the client, so their codeIntegrity never includes the override
      // and the first equality check passes. The fallback path only
      // runs when the first check fails AND the document owner has an
      // active, non-empty stamp_config.
      let integrityOk = true;
      let effectiveCodeIntegrity = codeIntegrity; // what we feed into the chained token below
      if (codeIntegrity && doc.code_integrity) {
        if (codeIntegrity !== doc.code_integrity) {
          integrityOk = false;
          try {
            // Look up the owner's current stamp config. Use cache to avoid
            // a DB round trip on every verify; fall back to DB on miss.
            const cache = req.app.get('stampCache');
            let ownerUserId = doc.user_id;
            if (!ownerUserId && typeof doc.orgId === 'string' && doc.orgId.startsWith('user_')) {
              ownerUserId = doc.orgId.slice('user_'.length);
            }
            if (ownerUserId) {
              let cfg = cache && cache._get ? cache._get(ownerUserId) : null;
              if (!cfg) {
                const result = await db.getUserStampConfig(ownerUserId);
                cfg = result?.config || {};
                if (cache && cache._set) cache._set(ownerUserId, cfg);
              }
              if (cfg && Object.keys(cfg).length > 0) {
                // Rebuild the override script inner text deterministically.
                const overrideInner = buildOverrideScriptInnerText(cfg);
                if (overrideInner) {
                  // Extract the ORIGINAL script textContent from pvf_content.
                  // Doc generation stores exactly one <script>...</script>
                  // tag before the override is injected, and code_integrity
                  // was computed as sha256(that script's textContent).
                  // Use the same regex pvf-generator.js uses for consistency.
                  const pvf = await db.getPvfContent(doc.shareId || doc.share_id);
                  if (pvf) {
                    const m = pvf.match(/<script>([\s\S]*?)<\/script>/);
                    if (m) {
                      const originalScript = m[1];
                      // Sanity guard: the stored original must still hash
                      // to doc.code_integrity. If not, the PVF blob was
                      // tampered with server-side — hard fail.
                      const originalHash = crypto.createHash('sha256').update(originalScript).digest('hex');
                      if (originalHash === doc.code_integrity) {
                        const expectedWithOverride = crypto.createHash('sha256')
                          .update(originalScript + overrideInner)
                          .digest('hex');
                        if (crypto.timingSafeEqual(
                          Buffer.from(codeIntegrity, 'hex'),
                          Buffer.from(expectedWithOverride, 'hex')
                        )) {
                          integrityOk = true;
                          // Chained token was computed over doc.code_integrity
                          // at creation time. Use that, not the client's
                          // override-inclusive hash, for the chain check.
                          effectiveCodeIntegrity = doc.code_integrity;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            // fall through to code_tampered
            integrityOk = false;
          }

          if (!integrityOk) {
            logger.warn({ event: 'verify_fail', reason: 'code_tampered', hash: lookupHash.substring(0, 16) }, 'Code integrity mismatch');
            await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'code_tampered' });
            return res.json({ success: true, verified: false, reason: 'code_tampered' });
          }
        }

        // Chained token verification — use effectiveCodeIntegrity so the
        // chain check still matches what was stored at document creation,
        // even when the client submitted an override-inclusive hash.
        if (doc.chained_token) {
          const expectedChain = crypto.createHmac('sha256', HMAC_SECRET)
            .update(lookupHash + (signature || doc.signature) + doc.orgId + effectiveCodeIntegrity)
            .digest('hex');
          const chainValid = crypto.timingSafeEqual(
            Buffer.from(doc.chained_token, 'hex'),
            Buffer.from(expectedChain, 'hex')
          );
          if (!chainValid) {
            logger.warn({ event: 'verify_fail', reason: 'chain_broken', hash: lookupHash.substring(0, 16) }, 'Chained token mismatch');
            await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'chain_broken' });
            return res.json({ success: true, verified: false, reason: 'chain_broken' });
          }
        }
      }

      // Recipient binding check
      if (doc.recipientHash && recipientHash && doc.recipientHash !== recipientHash) {
        logger.warn({ event: 'verify_fail', reason: 'recipient_mismatch', hash: lookupHash.substring(0, 16) }, 'Recipient mismatch');
        await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'recipient_mismatch' });
        return res.json({ success: true, verified: false, reason: 'recipient_mismatch' });
      }

      const newToken = generateToken();
      await db.updateDocumentToken(lookupHash, newToken);

      logger.info({ event: 'verify_ok', hash: lookupHash.substring(0, 16) }, 'Document verified');
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
        signedBy,                 // Phase 2C: 'hmac' (legacy) | 'both' (dual-signed)
        blockchain: blockchainProof
      });
    } else {
      logger.warn({ event: 'verify_fail', reason: 'not_found', hash: lookupHash.substring(0, 16) }, 'Document not found');
      await db.log('verify_attempt', { hash: lookupHash, ip: getClientIP(req), result: 'not_found' });
      res.json({ success: true, verified: false, hash: lookupHash });
    }
  } catch (error) {
    logger.error({ err: error.message, stack: error.stack, event: 'verify_internal_error' }, '[verify] handler crashed');
    res.status(500).json({ success: false, verified: false, error: 'Verification error' });
  }
});

// ================================================================
// PHASE 2D — Stateless public verification (Audit Mode)
// ================================================================
// GET /api/verify-public — pure cryptographic signature verification.
//
// This endpoint NEVER touches the documents table. It takes a signature,
// a key id, and the canonical payload that was signed, and verifies the
// math against the public key Vertifile published for that key id. A
// caller can therefore verify a signature for a document Vertifile has
// never seen, as long as the signing key is one Vertifile published —
// turning Vertifile from a closed system into a trust-minimized
// cryptographic protocol.
//
// The "fingerprint" returned is sha256(public_key_pem) hex. The first 16
// chars of that fingerprint equal the keyId by convention; the full 64
// chars are the trust-anchor a human can compare against an out-of-band
// source (the JWKS / well-known endpoint, a published transparency log).
//
// Inputs are query parameters so the endpoint is cacheable, GET-shareable,
// and trivially callable from curl. All four are required:
//   hash       — hex sha256 (64 chars), the document hash that was signed
//   signature  — base64url Ed25519 signature (≤100 chars)
//   keyId      — 16 lowercase hex chars
//   payload    — canonical pipe-separated string (≤4096 chars):
//                hash|orgId|createdAt|recipientHash|codeIntegrity
// ================================================================
router.get('/verify-public', verifyLimiter, async (req, res) => {
  try {
    const { hash, signature, keyId, payload } = req.query;

    // ---- Input validation -----------------------------------------------
    // All four params are required, in the documented format. We return a
    // structured error so callers can programmatically tell what went wrong
    // without having to parse a free-form string.
    if (typeof hash !== 'string' || !hash) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'hash' });
    }
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'hash' });
    }

    if (typeof signature !== 'string' || !signature) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'signature' });
    }
    // Ed25519 signatures are exactly 64 bytes, which encodes to exactly 86 chars
    // in unpadded base64url (base64url omits padding by spec). The strict length +
    // charset regex catches every malformed signature before any crypto runs.
    if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'signature' });
    }

    if (typeof keyId !== 'string' || !keyId) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'keyId' });
    }
    if (!/^[a-f0-9]{16}$/.test(keyId)) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'keyId' });
    }

    if (typeof payload !== 'string' || !payload) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'payload' });
    }
    // Real payloads from buildSigningPayload are bounded by:
    //   hash (64) + '|' + orgId (~64) + '|' + iso (24) + '|' + rcpt (64) + '|' + ci (0)
    // ≈ 220 chars in practice. 512 is a generous upper bound that still defends
    // against CPU-DoS via oversized inputs.
    if (payload.length > 512) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'payload' });
    }

    // Soft consistency check: the first '|'-separated component of the
    // payload must equal the supplied hash. This protects callers from
    // confusing themselves (verifying a signature against a payload that
    // doesn't match the hash they think they're checking). It is NOT a
    // security check — the cryptographic verification below is the security
    // boundary — but it catches an entire class of integration mistakes.
    //
    // The canonical payload must begin with "<hash>|" — a leading hash
    // followed by the '|' separator. startsWith is byte-tight and catches
    // payloads that contain no separator at all (e.g. a bare hash), which
    // split('|', 1) would silently accept.
    if (!payload.startsWith(hash + '|')) {
      return res.status(400).json({ valid: false, error: 'invalid_input', detail: 'payload_hash_mismatch' });
    }

    // ---- Resolve the public key + fingerprint ---------------------------
    // No documents-table touch. The PEM comes from key-manager's cache or
    // from the ed25519_keys table on a cache miss.
    const pem = await keyManager.getPublicKeyPemById(keyId);
    if (!pem) {
      logger.warn({ event: 'verify_public_unknown_key', keyId: keyId.slice(0, 8) + '...' }, '[verify-public] unknown key');
      return res.json({ valid: false, error: 'unknown_key', keyId });
    }

    const fingerprint = crypto.createHash('sha256').update(pem).digest('hex');

    // ---- Verify the signature -------------------------------------------
    let ok = false;
    try {
      ok = await signing.verifyEd25519(payload, signature, keyId);
    } catch (e) {
      ok = false;
    }

    if (!ok) {
      logger.warn({ event: 'verify_public_invalid_sig', keyId: keyId.slice(0, 8) + '...' }, '[verify-public] signature invalid');
      return res.json({
        valid: false,
        error: 'invalid_signature',
        keyId,
        // fingerprint intentionally omitted to prevent keyId enumeration oracle
        // (unknown_key can't return one because we have no PEM to hash; for
        // shape-consistency across failure branches, invalid_signature also
        // omits it. The fingerprint is only returned on valid:true.)
        algorithm: 'Ed25519'
      });
    }

    logger.info({ event: 'verify_public_ok', keyId: keyId.slice(0, 8) + '...' }, '[verify-public] verified');
    return res.json({
      valid: true,
      keyId,
      fingerprint,
      algorithm: 'Ed25519',
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error.message, stack: error.stack, event: 'verify_public_internal_error' }, '[verify-public] handler crashed');
    return res.status(500).json({ valid: false, error: 'internal_error' });
  }
});

// OPTIONS preflight for /api/verify-public — matches the pattern used by
// routes/well-known.js. Needed for browser-based verifiers that send any
// non-simple header (though we don't require any today).
router.options('/verify-public', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

// ===== API: Token Refresh (heartbeat) =====
router.post('/token/refresh', verifyLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { hash } = req.body;

    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).json({ success: false, error: 'Invalid hash' });
    }

    const doc = await db.getDocument(hash);
    if (!doc) return res.json({ success: false, error: 'Not found' });

    if (doc.tokenCreatedAt && (Date.now() - doc.tokenCreatedAt) < 240000) {
      return res.json({ success: true, token: doc.token, expiresIn: 300, cached: true });
    }

    const newToken = generateToken();
    await db.updateDocumentToken(hash, newToken);
    res.json({ success: true, token: newToken, expiresIn: 30 });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error' });
  }
});

// ===== API: URI Status =====
// Public endpoint — returns operational status of all critical service URIs.
// Useful for uptime monitors, status pages, and integration health checks.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { success: false, error: 'Too many status requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/status', statusLimiter, async (req, res) => {
  const db = req.app.get('db');
  const chain = req.app.get('chain');
  const timestamp = new Date().toISOString();

  // Check database
  let dbStatus = { status: 'down', responseMs: null };
  try {
    const dbHealth = await db.healthCheck();
    dbStatus = {
      status: dbHealth.ok ? 'operational' : 'degraded',
      responseMs: dbHealth.responseMs
    };
  } catch (_) {
    dbStatus = { status: 'down', responseMs: null };
  }

  // Check blockchain
  let blockchainStatus = 'disabled';
  try {
    blockchainStatus = chain.isConnected() ? 'operational' : 'disabled';
  } catch (_) {
    blockchainStatus = 'error';
  }

  // Check Ed25519 signing
  let signingStatus = 'disabled';
  try {
    const primaryKeyId = keyManager.getPrimaryKeyId();
    signingStatus = primaryKeyId ? 'operational' : 'disabled';
  } catch (_) {
    signingStatus = 'error';
  }

  // Determine overall status
  const overall = dbStatus.status === 'operational' ? 'operational'
    : dbStatus.status === 'degraded' ? 'degraded'
    : 'partial_outage';

  // Critical URIs and their statuses
  const uris = {
    'POST /api/create-pvf': dbStatus.status === 'operational' ? 'operational' : 'degraded',
    'POST /api/verify': dbStatus.status === 'operational' ? 'operational' : 'degraded',
    'GET  /api/verify-public': dbStatus.status === 'operational' ? 'operational' : 'degraded',
    'GET  /api/health': 'operational',
    'GET  /api/health/deep': dbStatus.status === 'operational' ? 'operational' : 'degraded',
    'POST /api/token/refresh': dbStatus.status === 'operational' ? 'operational' : 'degraded',
    'POST /api/demo/create-pvf': dbStatus.status === 'operational' ? 'operational' : 'degraded'
  };

  res.json({
    status: overall,
    service: 'Vertifile',
    version: '4.5.0',
    timestamp,
    uptime: process.uptime(),
    components: {
      database: dbStatus,
      blockchain: blockchainStatus,
      signing: signingStatus
    },
    endpoints: uris
  });
});

// ===== API: Health =====
const _pkgVersion = require('../package.json').version;
router.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Vertifile',
    version: _pkgVersion,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

router.get('/health/deep', async (req, res) => {
  try {
    const db = req.app.get('db');
    const chain = req.app.get('chain');
    const stats = await db.getStats();
    // Phase 3A observability — key lifecycle state distribution. Best-effort:
    // if countEd25519KeysByState is unavailable for any reason, we still want
    // the rest of /health/deep to return a useful payload.
    let ed25519KeysByState = null;
    try {
      ed25519KeysByState = await db.countEd25519KeysByState();
    } catch (_) { /* leave null, don't fail the whole health check */ }
    // Phase 3B observability — which key slots did this process load at
    // boot? Exposed so the rotation command's pre-flight check can verify
    // the running app has picked up the new key BEFORE flipping the DB
    // state. Shape: { primary: keyId|null, next: keyId|null }. Best-effort
    // — if getLoadedSlots is unavailable (pre-3B build) leave null.
    let ed25519LoadedSlots = null;
    try {
      if (typeof keyManager.getLoadedSlots === 'function') {
        ed25519LoadedSlots = keyManager.getLoadedSlots();
      }
    } catch (_) { /* leave null, don't fail the whole health check */ }
    // Phase 3B Ori R3 — what is this process CURRENTLY signing with?
    // Resolved via the DB's state='active' row → slot-match, not via the
    // static env-var _primary slot. During a wet-drill rotation, the
    // operator needs ONE field they can poll with `curl /api/health/deep
    // | jq .ed25519_signing_key_id` to see the rotation taking effect
    // across the fleet within 30s (one 30s cache TTL per process).
    // Best-effort: never fail the health endpoint if getActivePrimary
    // throws — report null and let the operator investigate.
    let ed25519SigningKeyId = null;
    try {
      const activeSlot = await keyManager.getActivePrimary();
      ed25519SigningKeyId = activeSlot ? activeSlot.keyId : null;
    } catch (_) {
      ed25519SigningKeyId = null;
    }
    // Memory usage metrics
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);

    res.json({
      status: 'online',
      service: 'Vertifile',
      version: '4.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      documents: stats.totalDocuments,
      organizations: stats.totalOrganizations,
      blockchain: chain.isConnected() ? 'connected' : 'off-chain',
      memory: {
        heap_used_mb: heapUsedMB,
        heap_total_mb: heapTotalMB,
        heap_percent: heapPercent,
        rss_mb: rssMB
      },
      db_pool: {
        total: db._db.totalCount,
        idle: db._db.idleCount,
        waiting: db._db.waitingCount
      },
      node_version: process.version,
      // Phase 2E observability — lets operators / uptime probes confirm the
      // fail-closed enforcement state without grepping logs. See Ori's cutover
      // smoke test: `curl /api/health/deep | jq '.phase2e_active'`.
      phase2e_active: process.env.ED25519_REQUIRED === '1' && keyManager.getPrimaryKeyId() !== null,
      primary_key_id: keyManager.getPrimaryKeyId() || null,
      // Phase 3A observability — state machine distribution for the
      // ed25519_keys table. Gives on-call a fast view of whether any
      // rotations are in flight and how many keys are in each lifecycle
      // state. Shape: { pending, active, grace, expired } all as integers.
      ed25519_keys_by_state: ed25519KeysByState,
      // Phase 3B observability — which key slots this process has loaded
      // in memory. The rotation command's pre-flight reads this field to
      // verify the running app picked up the new key BEFORE committing
      // the DB state flip. Shape: { primary: keyId|null, next: keyId|null }.
      ed25519_loaded_slots: ed25519LoadedSlots,
      // Phase 3B Ori R3 observability — what this process is CURRENTLY
      // using to sign (resolved via DB state, not env vars). Updates
      // within 30s of a rotation (the active-primary cache TTL). This is
      // the canonical field to poll during a rotation wet drill to
      // verify the fleet has picked up the new key.
      ed25519_signing_key_id: ed25519SigningKeyId,
      // Phase 3C observability — when was the active-primary cache last
      // invalidated via /api/admin/cache/invalidate-keys? null if never.
      cache_last_invalidated: cacheLastInvalidatedAt
    });
  } catch(e) { res.status(500).json({ status: 'error', error: 'Health check failed' }); }
});

// ===== Prometheus metrics endpoint =====
router.get('/metrics', (req, res) => {
  const mem = process.memoryUsage();
  const pool = req.app.get('db')._db;
  const uptime = process.uptime();

  const lines = [
    '# HELP nodejs_heap_bytes_used Current heap used in bytes',
    '# TYPE nodejs_heap_bytes_used gauge',
    'nodejs_heap_bytes_used ' + mem.heapUsed,
    '',
    '# HELP nodejs_heap_bytes_total Total heap size in bytes',
    '# TYPE nodejs_heap_bytes_total gauge',
    'nodejs_heap_bytes_total ' + mem.heapTotal,
    '',
    '# HELP nodejs_rss_bytes Resident set size in bytes',
    '# TYPE nodejs_rss_bytes gauge',
    'nodejs_rss_bytes ' + mem.rss,
    '',
    '# HELP nodejs_uptime_seconds Process uptime in seconds',
    '# TYPE nodejs_uptime_seconds gauge',
    'nodejs_uptime_seconds ' + Math.round(uptime),
    '',
    '# HELP pg_pool_total Total connections in pool',
    '# TYPE pg_pool_total gauge',
    'pg_pool_total ' + pool.totalCount,
    '',
    '# HELP pg_pool_idle Idle connections in pool',
    '# TYPE pg_pool_idle gauge',
    'pg_pool_idle ' + pool.idleCount,
    '',
    '# HELP pg_pool_waiting Waiting queries in pool',
    '# TYPE pg_pool_waiting gauge',
    'pg_pool_waiting ' + pool.waitingCount,
  ];

  res.type('text/plain; version=0.0.4; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\n') + '\n');
});

// ===== Phase 3C: Admin cache invalidation =====
// POST /api/admin/cache/invalidate-keys
// Forces the key-manager active-primary cache to expire so all subsequent
// signing calls in this process resolve against the DB immediately. Used
// after a rotation to eliminate the 30s cache-tail window.
router.post('/admin/cache/invalidate-keys', (req, res, next) => {
  const fn = req.app.get('authenticateAdmin');
  if (fn) return fn(req, res, next);
  return res.status(500).json({ success: false, error: 'Admin auth not configured' });
}, async (req, res) => {
  try {
    keyManager.invalidateActivePrimaryCache();
    cacheLastInvalidatedAt = new Date().toISOString();
    const active = await keyManager.getActivePrimary();
    const activeKeyId = active ? active.keyId : null;
    res.json({
      success: true,
      invalidated: true,
      activeKeyId,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    logger.error({ err: e }, '[api] cache invalidate-keys error');
    res.status(500).json({ success: false, error: 'Cache invalidation failed' });
  }
});

// ===== API: Docs =====
router.get('/docs', (req, res) => {
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
        'GET /api/verify-public': {
          description: 'Stateless public Ed25519 verification (Audit Mode) — verifies signature math against the published public key. Does NOT touch the documents table. Third parties can verify any Vertifile document without an API call by fetching /.well-known/vertifile-pubkey.pem and running the math themselves; this endpoint is a convenience for those who prefer a HTTP call.',
          auth: 'None',
          query: '?hash=<hex64>&signature=<base64url86>&keyId=<hex16>&payload=<hash|orgId|createdAt|recipientHash|codeIntegrity>',
          response: '{ valid, keyId, fingerprint?, algorithm: "Ed25519", verifiedAt?, error? }'
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
          body: '{ orgName, plan: "pro"|"business"|"enterprise" }'
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
router.get('/org/stats', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const stats = await db.getOrgStats(req.org.orgId);
    res.json({ success: true, orgId: req.org.orgId, orgName: req.org.orgName, ...stats });
  } catch (e) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.get('/org/documents', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const docs = await db.getDocumentsByOrg(req.org.orgId, { limit, offset });
    const total = await db.getDocumentCount(req.org.orgId);
    res.json({ success: true, documents: docs, total, limit, offset });
  } catch (e) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.get('/org/profile', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
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
        brandColor: branding.brand_color || null,
        waveColor: branding.wave_color || null
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/org/branding', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { customIcon, brandColor, waveColor } = req.body;

    if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      return res.status(400).json({ success: false, error: 'Invalid color format. Use hex (#RRGGBB)' });
    }
    if (waveColor && !/^#[0-9a-fA-F]{6}$/.test(waveColor)) {
      return res.status(400).json({ success: false, error: 'Invalid wave color format. Use hex (#RRGGBB)' });
    }

    if (customIcon) {
      const iconSize = Buffer.byteLength(customIcon, 'utf8');
      if (iconSize > 700 * 1024) {
        return res.status(400).json({ success: false, error: 'Icon too large. Maximum 512KB image file.' });
      }
      if (!customIcon.startsWith('data:image/') && !customIcon.startsWith('<svg')) {
        return res.status(400).json({ success: false, error: 'Icon must be SVG or image data URI' });
      }
    }

    await db.updateBranding(req.org.orgId, { customIcon, brandColor, waveColor });
    await db.log('branding_updated', { orgId: req.org.orgId, hasIcon: !!customIcon, color: brandColor, waveColor });

    res.json({ success: true, message: 'Branding updated' });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/org/branding', createLimiter, (req, res, next) => {
  req.app.get('authenticateApiKey')(req, res, next);
}, async (req, res) => {
  try {
    const db = req.app.get('db');
    const branding = await db.getBranding(req.org.orgId);
    res.json({
      success: true,
      customIcon: branding.custom_icon || null,
      brandColor: branding.brand_color || null,
      waveColor: branding.wave_color || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ================================================================
// CONTACT FORM
// ================================================================
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, message: { error: 'Too many submissions' } });

router.post('/contact', contactLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
    const { name, email, organization, orgType, message } = req.body;
    if (!name || !email || !organization) {
      return res.status(400).json({ success: false, error: 'Name, email, and organization are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }
    await db.log('contact_form', { name, email, organization, orgType: orgType || 'not specified', message: message || '', ip: getClientIP(req) });

    // Send notification email to admin
    const adminEmail = (process.env.ADMIN_EMAILS || '').split(',')[0].trim();
    const contactHtml = `<h2>New Contact Form Submission</h2>
<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Organization:</strong> ${escapeHtml(organization)}</p>
<p><strong>Type:</strong> ${escapeHtml(orgType || 'not specified')}</p>
<p><strong>Message:</strong></p>
<p>${escapeHtml(message || 'No message provided')}</p>`;
    if (adminEmail) {
      sendEmail(adminEmail, 'Vertifile Contact: ' + escapeHtml(organization), contactHtml).catch(() => {});
    }

    // Send confirmation email to the person who submitted the form (best effort)
    sendContactConfirmationEmail(email, name).catch(() => {});

    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: 'Failed to submit contact form' }); }
});

module.exports = router;
