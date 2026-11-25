BEGIN;
-- Explicit installation only: 000_auth, parent 001_entitlements, fee ledger, 002.
CREATE TABLE IF NOT EXISTS mulch_app_stores (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES mulch_users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  shop_domain text NOT NULL UNIQUE CHECK (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_app_stores_owner_idx ON mulch_app_stores(owner_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mulch_entitlements_store_fk' AND conrelid='mulch_entitlements'::regclass) THEN
    ALTER TABLE mulch_entitlements ADD CONSTRAINT mulch_entitlements_store_fk FOREIGN KEY (store_id) REFERENCES mulch_app_stores(id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS mulch_app_resources (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES mulch_app_stores(id),
  kind text NOT NULL CHECK (kind IN ('checkout-design','thank-you','offer','discount','buy-link','survey','experiment','general','shipping','integration','subscription-rule','portal','recovery','cancel-flow')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','configured','active','paused')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config)='object' AND octet_length(config::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_app_resources_store_kind_idx ON mulch_app_resources(store_id,kind,created_at);
CREATE TABLE IF NOT EXISTS mulch_app_consents (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES mulch_app_stores(id),
  user_id uuid NOT NULL REFERENCES mulch_users(id),
  policy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id,user_id,policy_version)
);
-- Historical operator notes do NOT prove provider connection, review approval or
-- SaaS entitlement. There is no browser/operator endpoint to create these rows.
CREATE TABLE IF NOT EXISTS mulch_app_attestations (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES mulch_app_stores(id),
  kind text NOT NULL CHECK(kind IN ('shopify','billing','review','product')),
  reference text NOT NULL UNIQUE,
  source text NOT NULL CHECK(source='operator-reviewed'),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at > observed_at),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_app_attestations_current_idx ON mulch_app_attestations(store_id,kind,observed_at DESC);
-- Reserved for server-ingested Shopify facts. No product-ingestion API exists.
CREATE TABLE IF NOT EXISTS mulch_app_products (
  store_id uuid NOT NULL REFERENCES mulch_app_stores(id),
  id text NOT NULL CHECK(id ~ '^gid://shopify/Product/[0-9]+$'),
  title text NOT NULL,
  verified_at timestamptz NOT NULL,
  PRIMARY KEY(store_id,id)
);
CREATE TABLE IF NOT EXISTS mulch_app_audit (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES mulch_app_stores(id),
  actor_id uuid REFERENCES mulch_users(id),
  action text NOT NULL,
  resource_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mulch_app_audit_store_idx ON mulch_app_audit(store_id,created_at DESC);
INSERT INTO mulch_schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
