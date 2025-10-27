CREATE TABLE IF NOT EXISTS token_index_cursor (
  chain_id INTEGER NOT NULL,
  token BYTEA NOT NULL,
  from_block BIGINT,
  to_block BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token)
);

CREATE TABLE IF NOT EXISTS token_holders (
  chain_id INTEGER NOT NULL,
  token BYTEA NOT NULL,
  holder BYTEA NOT NULL,
  balance NUMERIC(78, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, token, holder)
);

CREATE INDEX IF NOT EXISTS token_holders_chain_token_idx
  ON token_holders (chain_id, token);

CREATE INDEX IF NOT EXISTS token_holders_balance_desc_idx
  ON token_holders (chain_id, token, balance DESC);
