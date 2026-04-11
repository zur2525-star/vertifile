-- =============================================================================
-- Vertifile -- Onboarding Email Tracking (002)
-- =============================================================================
--
-- Tracks the 5-email onboarding drip sequence per user.
-- Each row = one scheduled email. sent_at is set when delivered;
-- skipped is set when the condition was not met (e.g. user already uploaded).
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS onboarding_emails (
  id           SERIAL      PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_type   VARCHAR(50) NOT NULL,          -- welcome, first_doc, stamp, share, upgrade
  scheduled_at TIMESTAMPTZ NOT NULL,          -- when the email should be sent
  sent_at      TIMESTAMPTZ,                   -- NULL until sent
  skipped      BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE if condition not met
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookups: "has this email already been scheduled for this user?"
CREATE INDEX IF NOT EXISTS idx_onboarding_emails_user_type
  ON onboarding_emails (user_id, email_type);

-- For admin dashboards: "how many emails were sent in the last 24h?"
CREATE INDEX IF NOT EXISTS idx_onboarding_emails_sent_at
  ON onboarding_emails (sent_at)
  WHERE sent_at IS NOT NULL;

-- For funnel analysis: "how many were skipped by type?"
CREATE INDEX IF NOT EXISTS idx_onboarding_emails_skipped
  ON onboarding_emails (email_type, skipped)
  WHERE skipped = TRUE;
