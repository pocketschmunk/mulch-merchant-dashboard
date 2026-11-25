BEGIN;
CREATE TABLE IF NOT EXISTS mulch_entitlements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES mulch_users(id),
  provider_membership_id text NOT NULL UNIQUE,
  provider_member_id text NOT NULL,
  provider_user_id text NOT NULL,
  provider_account_id text NOT NULL,
  provider_variant_id text NOT NULL,
  payment_id text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('standard','premium')),
  status text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  store_id uuid UNIQUE,
  paid_until timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  verification_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_entitlements_owner_idx ON mulch_entitlements(user_id);
CREATE TABLE IF NOT EXISTS mulch_billing_checks (
  user_id uuid PRIMARY KEY REFERENCES mulch_users(id),
  checked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  message text NOT NULL
);
COMMIT;
