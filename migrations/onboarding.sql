-- =============================================================================
-- Vertifile — Onboarding & Subscription Schema Migration
-- =============================================================================

-- Run in order. All ALTER TABLE statements use IF NOT EXISTS (Postgres 9.6+)
-- so the file is safe to re-run.

-- -----------------------------------------------------------------------------
-- 1. verification_codes
-- Stores short-lived 6-digit codes for email verification.
-- Linked to users.id; for pre-signup flows store NULL and match by email.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  code       VARCHAR(6)  NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ   NOT NULL,              -- NOW() + INTERVAL '10 minutes'
  attempts   INTEGER     NOT NULL DEFAULT 0,    -- max 5
  used       BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id
  ON verification_codes (user_id);

CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at
  ON verification_codes (expires_at);           -- used for cleanup jobs

-- -----------------------------------------------------------------------------
-- 2. onboarding_state
-- Persists wizard progress per user so sessions are resumable.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS onboarding_state (
  id             SERIAL    PRIMARY KEY,
  user_id        INTEGER   UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_step   INTEGER   NOT NULL DEFAULT 1,
  selections     JSONB     NOT NULL DEFAULT '{}',  -- all step answers
  stamp_config   JSONB     NOT NULL DEFAULT '{}',  -- stamp customization
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,                        -- NULL until /onboarding/complete
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_state_user_id
  ON onboarding_state (user_id);

-- -----------------------------------------------------------------------------
-- 3. ALTER TABLE user_profiles
-- Wizard answers are written here on /onboarding/complete.
-- -----------------------------------------------------------------------------

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS user_type               VARCHAR(20),          -- individual, business, organization
  ADD COLUMN IF NOT EXISTS industry                VARCHAR(20),          -- legal, healthcare, education, finance, hr, government, other
  ADD COLUMN IF NOT EXISTS industry_other          VARCHAR(100),         -- free-text when industry = 'other'
  ADD COLUMN IF NOT EXISTS document_types          TEXT[],               -- array of selected doc type keys
  ADD COLUMN IF NOT EXISTS estimated_volume        VARCHAR(20),          -- under_50, 50_500, 500_5000, over_5000
  ADD COLUMN IF NOT EXISTS selected_plan           VARCHAR(20),          -- pro, pro_plus, enterprise
  ADD COLUMN IF NOT EXISTS plan_selected_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- 4. subscriptions
-- Created when the user selects a plan; activated on first successful payment.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   SERIAL    PRIMARY KEY,
  user_id              INTEGER   UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                 VARCHAR(20)  NOT NULL,               -- pro, pro_plus, enterprise
  status               VARCHAR(20)  NOT NULL DEFAULT 'pending',
  --   pending   — plan chosen, no payment yet
  --   active    — payment succeeded
  --   trial     — 14-day free trial in progress
  --   cancelled — user cancelled (access until period end)
  --   expired   — trial or paid period ended
  price_cents          INTEGER,                             -- 2900 / 7900 / NULL for enterprise
  billing_cycle        VARCHAR(10)  NOT NULL DEFAULT 'monthly', -- monthly, annual
  payment_provider     VARCHAR(20),                         -- stripe, paypal
  payment_provider_id  VARCHAR(100),                        -- Stripe subscription ID / PayPal agreement ID
  trial_ends_at        TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at         TIMESTAMPTZ,                           -- first successful payment
  cancelled_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);

-- -----------------------------------------------------------------------------
-- 5. stamp_configs
-- Stores per-user stamp appearance set during Step 4 of the wizard.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stamp_configs (
  id           SERIAL    PRIMARY KEY,
  user_id      INTEGER   UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accent_color VARCHAR(7)   NOT NULL DEFAULT '#7c3aed',
  wave_color   VARCHAR(7)   NOT NULL DEFAULT '#06b6d4',
  logo_url     VARCHAR(500),
  stamp_size   VARCHAR(10)  NOT NULL DEFAULT 'medium',  -- small, medium, large
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. ALTER TABLE users
-- Denormalised subscription columns for fast session reads (avoid JOIN on every
-- request). Kept in sync by the webhook handler and subscription service.
-- -----------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status    VARCHAR(20),  -- mirrors subscriptions.status
  ADD COLUMN IF NOT EXISTS selected_plan          VARCHAR(20),  -- mirrors subscriptions.plan
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,  -- mirrors subscriptions.activated_at
  ADD COLUMN IF NOT EXISTS onboarding_completed   BOOLEAN NOT NULL DEFAULT FALSE;
