BEGIN;

-- This boundary creates identity only. No plans, stores, entitlements or access
-- grants are created by signup, verification, login or password recovery.
CREATE TABLE IF NOT EXISTS mulch_users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  auth_provider text NOT NULL CHECK (auth_provider = 'email'),
  password_hash text,
  -- Retained nullable field for root-schema compatibility; never used for login.
  whop_subject text UNIQUE,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mulch_users_email_idx ON mulch_users (LOWER(email));

CREATE TABLE IF NOT EXISTS mulch_auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mulch_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mulch_auth_sessions_expiry_idx ON mulch_auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS mulch_auth_sessions_user_idx ON mulch_auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS mulch_auth_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mulch_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_auth_tokens_user_idx ON mulch_auth_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS mulch_auth_tokens_expiry_idx ON mulch_auth_tokens(expires_at);

-- Bucket keys are SHA-256 of action/scope/normalized account or transport IP.
-- Atomic UPSERT uses database time; counts survive process restarts/instances.
CREATE TABLE IF NOT EXISTS mulch_auth_rate_buckets (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS mulch_auth_rate_buckets_window_idx ON mulch_auth_rate_buckets(window_start);

-- Operators can periodically delete expired sessions/tokens and buckets older
-- than two days. Such cleanup is not necessary for authorization correctness.
-- Email tokens/session bearer values are NEVER persisted, only their hashes.
COMMIT;
