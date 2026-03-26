const express = require('express');
const bcrypt = require('bcrypt');
const passport = require('passport');
const { authLimiter } = require('../middleware/auth');

const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/app' }), (req, res) => res.redirect('/app'));

router.post('/register', authLimiter, async (req, res) => {
  try {
    const db = req.app.get('db');
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

router.post('/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return res.status(500).json({ success: false, error: 'Server error' });
    if (!user) return res.status(401).json({ success: false, error: info?.message || 'Invalid credentials' });
    req.login(user, (err) => {
      if (err) return res.status(500).json({ success: false, error: 'Login failed' });
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar_url } });
    });
  })(req, res, next);
});

router.post('/logout', (req, res) => { req.logout(() => res.json({ success: true })); });

// Password reset - request
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });
    const db = req.app.get('db');
    const logger = require('../services/logger');
    const user = await db.getUserByEmail(email);
    if (!user) return res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await db.saveResetToken(user.id, token, expires);
    const resetUrl = `${req.protocol}://${req.get('host')}/app?reset=${token}`;
    logger.info({ email, resetUrl }, 'Password reset requested');
    await db.log('password_reset_requested', JSON.stringify({ email }), req.ip);
    res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
  } catch(e) {
    const logger = require('../services/logger');
    logger.error({ err: e }, 'Forgot password failed');
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// Password reset - set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, error: 'Token and password required' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    const db = req.app.get('db');
    const reset = await db.getResetToken(token);
    if (!reset) return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    if (new Date(reset.expires_at) < new Date()) {
      await db.deleteResetToken(token);
      return res.status(400).json({ success: false, error: 'Reset link has expired' });
    }
    const hash = await bcrypt.hash(password, 12);
    await db.updateUserPassword(reset.user_id, hash);
    await db.deleteResetToken(token);
    await db.log('password_reset_completed', JSON.stringify({ userId: reset.user_id }), req.ip);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch(e) {
    const logger = require('../services/logger');
    logger.error({ err: e }, 'Reset password failed');
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

module.exports = router;
