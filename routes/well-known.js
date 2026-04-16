/**
 * /.well-known/ routes for Vertifile public key publication.
 *
 * These endpoints allow any third party to fetch Vertifile's Ed25519
 * public key(s) and verify PVF documents offline — without ever calling
 * /api/verify. This is the "architecturally trust-minimized" part of
 * the Phase 2D rollout.
 *
 * In Phase 2A (current), these endpoints return 404 if no primary key
 * is configured. Once Phase 2A boots with ED25519_PRIVATE_KEY_PEM set,
 * the endpoints serve the public key immediately — but the app is not
 * yet SIGNING with it, so there are no docs to verify. That's fine.
 */

'use strict';

const express = require('express');
const keyManager = require('../services/key-manager');
const logger = require('../services/logger');

const router = express.Router();

// 1 hour cache — public keys change rarely (only on rotation).
// Short enough that rotation propagates within a day, long enough to
// avoid DoS via endpoint hammering.
const CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

// CORS wide-open — these are public cryptographic material, meant to be
// fetched by any verifier.
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Cache-Control', CACHE_CONTROL);
}

// GET /.well-known/vertifile-pubkey.pem
router.get('/vertifile-pubkey.pem', async (req, res) => {
  try {
    setCorsHeaders(res);
    const pem = await keyManager.getPrimaryPublicKeyPem();
    if (!pem) {
      return res.status(404).type('text/plain').send('No active Ed25519 key configured');
    }
    res.type('application/x-pem-file');
    res.send(pem);
  } catch (e) {
    logger.warn({ err: e.message }, '[well-known] pubkey.pem error');
    res.status(500).type('text/plain').send('Internal error');
  }
});

// GET /.well-known/vertifile-jwks.json
router.get('/vertifile-jwks.json', async (req, res) => {
  try {
    setCorsHeaders(res);
    const keys = await keyManager.listActivePublicKeys();
    res.type('application/json');
    res.json({ keys });
  } catch (e) {
    logger.warn({ err: e.message }, '[well-known] jwks.json error');
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /.well-known/security.txt
// RFC 9116 — machine-readable security policy disclosure.
// Served from the static file on disk so the content stays in one place.
router.get('/security.txt', (req, res) => {
  const filePath = require('path').join(__dirname, '..', 'public', '.well-known', 'security.txt');
  res.type('text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  res.sendFile(filePath, (err) => {
    if (err) {
      logger.warn({ err: err.message }, '[well-known] security.txt not found');
      res.status(404).type('text/plain').send('Not found');
    }
  });
});

// OPTIONS preflight
router.options('/vertifile-pubkey.pem', (req, res) => {
  setCorsHeaders(res);
  res.status(204).end();
});
router.options('/vertifile-jwks.json', (req, res) => {
  setCorsHeaders(res);
  res.status(204).end();
});

module.exports = router;
