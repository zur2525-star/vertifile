// Middleware: block access if the user does not have an active subscription.
// Attach after requireLogin — assumes req.user is populated by Passport.
//
// Allowed statuses: 'active', 'trial'
// Everything else (pending, cancelled, expired, missing) → 403

function requireSubscription(req, res, next) {
  if (!req.user) {
    // Should not reach here without requireLogin, but guard defensively
    return res.status(401).json({ success: false, error: 'Please sign in' });
  }

  const status = req.user.subscription_status;

  if (status === 'active' || status === 'trial') {
    return next();
  }

  return res.status(403).json({
    error: 'subscription_required',
    plan: req.user.selected_plan || null,
    message: 'Activate your plan to start protecting documents'
  });
}

module.exports = requireSubscription;
