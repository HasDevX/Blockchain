CREATE TABLE IF NOT EXISTS blocks (
  chain_id INTEGER NOT NULL,
  number BIGINT NOT NULL,
  hash BYTEA NOT NULL,
  parent_hash BYTEA NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, number),
  UNIQUE (chain_id, hash)
);

CREATE INDEX IF NOT EXISTS blocks_timestamp_idx
  ON blocks (chain_id, "timestamp" DESC);

CREATE TABLE IF NOT EXISTS transactions (
  chain_id INTEGER NOT NULL,
  hash BYTEA NOT NULL,
  block_number BIGINT NOT NULL,
  "from" BYTEA NOT NULL,
  "to" BYTEA,
  value NUMERIC(78, 0) NOT NULL DEFAULT 0,
  nonce NUMERIC(78, 0),
  gas NUMERIC(78, 0),
  gas_price NUMERIC(78, 0),
  input BYTEA,
  PRIMARY KEY (chain_id, hash),
  FOREIGN KEY (chain_id, block_number)
    REFERENCES blocks (chain_id, number)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS transactions_block_idx
  ON transactions (chain_id, block_number);
CREATE INDEX IF NOT EXISTS transactions_from_idx
  ON transactions (chain_id, "from");
CREATE INDEX IF NOT EXISTS transactions_to_idx
  ON transactions (chain_id, "to");

CREATE TABLE IF NOT EXISTS receipts (
  chain_id INTEGER NOT NULL,
  tx_hash BYTEA NOT NULL,
  status BOOLEAN,
  gas_used NUMERIC(78, 0),
  effective_gas_price NUMERIC(78, 0),
  contract_address BYTEA,
  PRIMARY KEY (chain_id, tx_hash),
  FOREIGN KEY (chain_id, tx_hash)
    REFERENCES transactions (chain_id, hash)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs (
  chain_id INTEGER NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INTEGER NOT NULL,
  address BYTEA NOT NULL,
  topic0 BYTEA,
  topic1 BYTEA,
  topic2 BYTEA,
  topic3 BYTEA,
  data BYTEA,
  PRIMARY KEY (chain_id, tx_hash, log_index),
  FOREIGN KEY (chain_id, tx_hash)
    REFERENCES transactions (chain_id, hash)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS logs_address_idx
  ON logs (chain_id, address);

CREATE INDEX IF NOT EXISTS logs_topic0_idx
  ON logs (chain_id, topic0);

CREATE INDEX IF NOT EXISTS logs_topic1_idx
  ON logs (chain_id, topic1);

CREATE INDEX IF NOT EXISTS logs_topic2_idx
  ON logs (chain_id, topic2);

CREATE INDEX IF NOT EXISTS logs_topic3_idx
  ON logs (chain_id, topic3);

CREATE TABLE IF NOT EXISTS token_transfers (
  chain_id INTEGER NOT NULL,
  tx_hash BYTEA NOT NULL,
  log_index INTEGER NOT NULL,
  token BYTEA NOT NULL,
  "from" BYTEA NOT NULL,
  "to" BYTEA NOT NULL,
  value NUMERIC(78, 0) NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, tx_hash, log_index),
  FOREIGN KEY (chain_id, tx_hash, log_index)
    REFERENCES logs (chain_id, tx_hash, log_index)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS token_transfers_token_idx
  ON token_transfers (chain_id, token);
CREATE INDEX IF NOT EXISTS token_transfers_to_idx
  ON token_transfers (chain_id, "to");
CREATE INDEX IF NOT EXISTS token_transfers_from_idx
  ON token_transfers (chain_id, "from");
