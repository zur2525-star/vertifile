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

module.exports = router;
