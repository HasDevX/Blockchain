CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chain_configs (
  chain_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rpc_url TEXT,
  etherscan_api_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_block BIGINT,
  qps INTEGER NOT NULL DEFAULT 1 CHECK (qps > 0),
  min_span INTEGER NOT NULL DEFAULT 8 CHECK (min_span > 0),
  max_span INTEGER NOT NULL DEFAULT 1000 CHECK (max_span >= min_span),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS index_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id INTEGER NOT NULL REFERENCES chain_configs (chain_id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  from_block BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error TEXT
);

CREATE INDEX IF NOT EXISTS index_jobs_chain_status_idx
  ON index_jobs (chain_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
