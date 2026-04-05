-- =============================================================================
-- Vertifile — Users & Sessions Schema Migration (001)
-- =============================================================================
--
-- The base users and sessions tables are created by db.js on startup.
-- This migration adds columns required by the authentication system that
-- were not present in the original schema.
--
-- Safe to re-run: all statements use IF NOT EXISTS or are idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Additional columns on users
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN     NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status  VARCHAR(20) DEFAULT 'none';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS selected_plan        VARCHAR(20);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN     NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;

-- Narrow the provider column for clarity (existing rows keep their values)
-- No-op if already VARCHAR(20); safe to run.
-- ALTER TYPE is not idempotent so we skip it — the column is TEXT, which is fine.

-- ---------------------------------------------------------------------------
-- 2. Indexes for auth lookups
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_email         ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_provider       ON users (provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_users_last_login     ON users (last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_subscription   ON users (subscription_status);

-- ---------------------------------------------------------------------------
-- 3. Sessions table
-- The base table is created by db.js, but connect-pg-simple expects a
-- specific schema. This ensures the table matches.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON    NOT NULL,
  expire TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- ---------------------------------------------------------------------------
-- 4. user_profiles base table (onboarding.sql adds columns to it)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_profiles (
  id         SERIAL    PRIMARY KEY,
  user_id    INTEGER   UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. Updated-at trigger
-- Automatically set updated_at on every UPDATE to the users row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();
