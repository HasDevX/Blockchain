BEGIN;

CREATE TABLE IF NOT EXISTS chain_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chain_configs (chain_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  qps INTEGER NOT NULL DEFAULT 1 CHECK (qps > 0),
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chain_endpoints_chain_enabled_idx
  ON chain_endpoints (chain_id, enabled);

COMMIT;
