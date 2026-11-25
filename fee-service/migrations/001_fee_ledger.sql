BEGIN;
CREATE TABLE IF NOT EXISTS mulch_schema_migrations (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mulch_fee_stores (
  id text PRIMARY KEY,
  merchant_id text NOT NULL,
  shop_domain text NOT NULL UNIQUE,
  login_email text NOT NULL,
  country text NOT NULL,
  account_id text UNIQUE,
  product_id text,
  access_verified boolean NOT NULL DEFAULT false,
  shopify_verified boolean NOT NULL DEFAULT false,
  store_review_approved boolean NOT NULL DEFAULT false,
  consent_reference text,
  consent_policy_version text,
  provider_verified boolean NOT NULL DEFAULT false,
  fee_review_required boolean NOT NULL DEFAULT false,
  lifetime_minor bigint NOT NULL DEFAULT 0 CHECK (lifetime_minor >= 0),
  earned_basis_points integer NOT NULL DEFAULT 280 CHECK (earned_basis_points IN (280,150,50)),
  pending_attempt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mulch_fee_attempts (
  id uuid PRIMARY KEY,
  store_id text NOT NULL REFERENCES mulch_fee_stores(id),
  command_key text NOT NULL,
  request_hash text NOT NULL,
  order_reference text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('quoting','prepared','submitting','unknown','pending','succeeded','failed','review')),
  quote_id text,
  quote_expires_at timestamptz,
  first_submit_at timestamptz,
  payment_id text UNIQUE,
  gross_minor bigint CHECK (gross_minor > 0),
  tax_minor bigint CHECK (tax_minor >= 0),
  fee_minor bigint CHECK (fee_minor > 0),
  actual_fee_minor bigint CHECK (actual_fee_minor >= 0),
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  basis_points integer CHECK (basis_points IN (280,150,50)),
  payload_ciphertext text,
  issue text,
  counted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, command_key)
);
CREATE INDEX IF NOT EXISTS mulch_fee_attempts_store_idx ON mulch_fee_attempts (store_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS mulch_fee_attempts_order_once_idx ON mulch_fee_attempts (store_id, order_reference) WHERE status <> 'failed';
CREATE TABLE IF NOT EXISTS mulch_fee_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  account_id text NOT NULL,
  payment_id text NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mulch_schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
