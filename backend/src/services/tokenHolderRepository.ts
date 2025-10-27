import { Pool, PoolClient } from "pg";
import { addressToBuffer, bufferToAddress, normalizeAddress } from "./holderStore";

export interface TokenCursor {
  chainId: number;
  token: string;
  fromBlock: bigint | null;
  toBlock: bigint | null;
  updatedAt: Date;
}

export type Queryable = Pool | PoolClient;

function mapCursorRow(row: {
  chain_id: number;
  token: Buffer;
  from_block: string | null;
  to_block: string | null;
  updated_at: Date;
}): TokenCursor {
  return {
    chainId: row.chain_id,
    token: bufferToAddress(row.token),
    fromBlock: row.from_block ? BigInt(row.from_block) : null,
    toBlock: row.to_block ? BigInt(row.to_block) : null,
    updatedAt: row.updated_at,
  };
}

export async function listTrackedTokens(queryable: Queryable): Promise<TokenCursor[]> {
  const result = await queryable.query(
    `SELECT chain_id, token, from_block::TEXT AS from_block, to_block::TEXT AS to_block, updated_at
     FROM token_index_cursor
     ORDER BY updated_at ASC`,
  );

  return result.rows.map(mapCursorRow);
}

export async function getTokenCursor(
  queryable: Queryable,
  chainId: number,
  tokenAddress: string,
): Promise<TokenCursor | null> {
  const normalized = normalizeAddress(tokenAddress);
  const tokenBuffer = addressToBuffer(normalized);

  const result = await queryable.query(
    `SELECT chain_id, token, from_block::TEXT AS from_block, to_block::TEXT AS to_block, updated_at
     FROM token_index_cursor
     WHERE chain_id = $1 AND token = $2`,
    [chainId, tokenBuffer],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapCursorRow(result.rows[0]);
}

export async function updateTokenCursor(
  queryable: Queryable,
  chainId: number,
  tokenAddress: string,
  nextFromBlock: bigint,
  processedToBlock: bigint,
): Promise<void> {
  const normalized = normalizeAddress(tokenAddress);
  const tokenBuffer = addressToBuffer(normalized);

  await queryable.query(
    `INSERT INTO token_index_cursor (chain_id, token, from_block, to_block, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (chain_id, token)
     DO UPDATE
       SET from_block = EXCLUDED.from_block,
           to_block = EXCLUDED.to_block,
           updated_at = NOW()`,
    [chainId, tokenBuffer, nextFromBlock.toString(), processedToBlock.toString()],
  );
}

export async function enqueueReindex(
  queryable: Queryable,
  chainId: number,
  tokenAddress: string,
  fromBlock?: bigint | null,
): Promise<void> {
  const normalized = normalizeAddress(tokenAddress);
  const tokenBuffer = addressToBuffer(normalized);
  const fromBlockValue =
    fromBlock !== undefined && fromBlock !== null ? fromBlock.toString() : null;

  await queryable.query(
    `INSERT INTO token_index_cursor (chain_id, token, from_block, to_block, updated_at)
     VALUES ($1, $2, $3, NULL, NOW())
     ON CONFLICT (chain_id, token)
     DO UPDATE
       SET from_block = EXCLUDED.from_block,
           to_block = NULL,
           updated_at = NOW()`,
    [chainId, tokenBuffer, fromBlockValue],
  );
}
