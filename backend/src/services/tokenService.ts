import type { Pool } from "pg";
import { CHAINS, getChainById } from "../config/chains";
import { getChainAdapter } from "../config/chainAdapters";
import { loadWebEnv } from "../config/env";
import { getPool } from "../lib/db";
import { getRedisClient } from "../lib/redisClient";
import { EtherscanClient } from "../vendors/etherscanClient";
import { addressToBuffer, bufferToAddress, normalizeAddress } from "./holderStore";
import { getTokenCursor } from "./tokenHolderRepository";

const env = loadWebEnv();
const etherscanClient = new EtherscanClient(env.etherscanApiKey);

export interface TokenSummary {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  totalSupply: string;
  holdersCount: number;
  supported: boolean;
  explorerUrl: string;
}

export interface TokenHolder {
  rank: number;
  holder: string;
  balance: string;
  pct: number;
}

export interface TokenHoldersResponse {
  items: TokenHolder[];
  nextCursor?: string;
  status: "ok" | "indexing";
}

export interface TokenChainCoverageEntry {
  chainId: number;
  supported: boolean;
  status: "ok" | "indexing";
  fromBlock: string | null;
  toBlock: string | null;
  updatedAt: string | null;
  lastTransferBlock: string | null;
  lastTransferAt: string | null;
  transferCount: number;
}

export interface GetTokenHoldersParams {
  chainId: number;
  address: string;
  cursor?: string | null;
  limit?: number;
}

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Chain ${chainId} is not supported`);
    this.name = "UnsupportedChainError";
  }
}

interface HolderCursor {
  balance: bigint;
  holder: string;
}

interface HolderRow {
  holder: Buffer;
  balance: string;
}

function clampLimit(raw?: number): number {
  if (!Number.isFinite(raw ?? NaN)) {
    return 25;
  }

  const value = Math.floor(raw as number);

  if (value < 1) {
    return 1;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

function decodeCursor(raw?: string | null): HolderCursor | null {
  if (!raw) {
    return null;
  }

  const [balancePart, holderPart] = raw.split(":");

  if (!balancePart || !holderPart) {
    return null;
  }

  try {
    const balance = BigInt(balancePart);
    const holder = normalizeAddress(holderPart);
    return { balance, holder };
  } catch (error) {
    console.warn("failed to decode holders cursor", error);
    return null;
  }
}

function encodeCursor(cursor: HolderCursor): string {
  return `${cursor.balance.toString(10)}:${cursor.holder.toLowerCase()}`;
}

async function countPrecedingRows(
  pool: Pool,
  chainId: number,
  tokenBuffer: Buffer,
  cursor: HolderCursor,
): Promise<bigint> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM token_holders
     WHERE chain_id = $1 AND token = $2
       AND (balance > $3::NUMERIC OR (balance = $3::NUMERIC AND holder < $4::BYTEA))`,
    [chainId, tokenBuffer, cursor.balance.toString(), addressToBuffer(cursor.holder)],
  );

  return BigInt(result.rows[0]?.count ?? "0");
}

async function fetchTotalSupply(
  pool: Pool,
  chainId: number,
  tokenBuffer: Buffer,
): Promise<bigint | null> {
  const result = await pool.query<{ sum: string | null }>(
    `SELECT SUM(balance)::TEXT AS sum
     FROM token_holders
     WHERE chain_id = $1 AND token = $2`,
    [chainId, tokenBuffer],
  );

  const value = result.rows[0]?.sum;
  return value ? BigInt(value) : null;
}

function mapHolderRow(
  row: HolderRow,
  baseRank: bigint,
  index: number,
  totalSupply: bigint | null,
): TokenHolder {
  const balanceBigInt = BigInt(row.balance);
  const rank = Number(baseRank + BigInt(index) + 1n);

  let pct = 0;

  if (totalSupply && totalSupply > 0n) {
    const scaled = (balanceBigInt * 100_000n) / totalSupply;
    pct = Number(scaled) / 1_000;
  }

  return {
    rank,
    holder: bufferToAddress(row.holder),
    balance: row.balance,
    pct,
  };
}

export async function getTokenSummary(
  chainId: number,
  tokenAddress: string,
): Promise<TokenSummary | null> {
  const chain = getChainById(chainId);

  if (!chain) {
    return null;
  }

  const checksumAddress = tokenAddress.toLowerCase();

  const vendorInfo = await etherscanClient.getTokenInfo(chainId, checksumAddress);

  return {
    chainId,
    address: checksumAddress,
    name: vendorInfo?.name ?? `Sample Token (${chain.shortName})`,
    symbol: vendorInfo?.symbol ?? `${chain.shortName}T`,
    priceUsd: 1.23,
    totalSupply: vendorInfo?.totalSupply ?? "1000000000000000000000000",
    holdersCount: 1284,
    supported: chain.supported,
    explorerUrl: chain.explorerUrl,
  };
}

export async function getTokenHolders({
  chainId,
  address,
  cursor,
  limit,
}: GetTokenHoldersParams): Promise<TokenHoldersResponse> {
  const adapter = getChainAdapter(chainId);

  if (!adapter || !adapter.supported) {
    throw new UnsupportedChainError(chainId);
  }

  const normalizedAddress = normalizeAddress(address);
  const normalizedLimit = clampLimit(limit);
  const cursorData = decodeCursor(cursor ?? null);
  const tokenBuffer = addressToBuffer(normalizedAddress);
  const pool = getPool();
  const cacheCursorKey = cursor ?? "__origin__";
  const cacheKey = `holders:${chainId}:${normalizedAddress}:${cacheCursorKey}:${normalizedLimit}`;
  const redisClient = await getRedisClient(env);

  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as TokenHoldersResponse;
        return parsed;
      }
    } catch (error) {
      console.warn("failed to read holders cache", error);
    }
  }

  const cursorRow = await getTokenCursor(pool, chainId, normalizedAddress);
  const status: "ok" | "indexing" = cursorRow && cursorRow.toBlock !== null ? "ok" : "indexing";

  const params: unknown[] = [chainId, tokenBuffer, normalizedLimit];
  let cursorClause = "";

  if (cursorData) {
    params.push(cursorData.balance.toString(), addressToBuffer(cursorData.holder));
    cursorClause = "AND (balance < $4::NUMERIC OR (balance = $4::NUMERIC AND holder > $5::BYTEA))";
  }

  const result = await pool.query<HolderRow>(
    `SELECT holder, balance::TEXT AS balance
     FROM token_holders
     WHERE chain_id = $1 AND token = $2
     ${cursorClause}
     ORDER BY balance DESC, holder ASC
     LIMIT $3`,
    params,
  );

  let baseRank = 0n;

  if (cursorData) {
    baseRank = await countPrecedingRows(pool, chainId, tokenBuffer, cursorData);
  }

  const totalSupply = await fetchTotalSupply(pool, chainId, tokenBuffer);

  const items = result.rows.map((row, index) => mapHolderRow(row, baseRank, index, totalSupply));

  const nextCursor =
    items.length === normalizedLimit
      ? encodeCursor({
          balance: BigInt(items[items.length - 1]?.balance ?? "0"),
          holder: items[items.length - 1]?.holder ?? normalizedAddress,
        })
      : undefined;

  const response: TokenHoldersResponse = {
    items,
    nextCursor,
    status,
  };

  if (redisClient) {
    try {
      await redisClient.set(cacheKey, JSON.stringify(response), {
        EX: 45,
      });
    } catch (error) {
      console.warn("failed to write holders cache", error);
    }
  }

  return response;
}

export function listChains() {
  return CHAINS;
}

export async function getTokenChainCoverage(address: string): Promise<TokenChainCoverageEntry[]> {
  const normalizedAddress = normalizeAddress(address);
  const tokenBuffer = addressToBuffer(normalizedAddress);
  const pool = getPool();

  const cursorRows = await pool.query<{
    chain_id: number;
    from_block: string | null;
    to_block: string | null;
    updated_at: Date;
  }>(
    `SELECT chain_id, from_block::TEXT AS from_block, to_block::TEXT AS to_block, updated_at
     FROM token_index_cursor
     WHERE token = $1
     ORDER BY chain_id ASC`,
    [tokenBuffer],
  );

  const transferRows = await pool.query<{
    chain_id: number;
    transfers: string;
    last_block: string | null;
    last_timestamp: Date | null;
  }>(
    `SELECT
       tt.chain_id,
       COUNT(*)::TEXT AS transfers,
       MAX(tx.block_number)::TEXT AS last_block,
       MAX(bl."timestamp") AS last_timestamp
     FROM token_transfers tt
     JOIN transactions tx
       ON tx.chain_id = tt.chain_id AND tx.hash = tt.tx_hash
     LEFT JOIN blocks bl
       ON bl.chain_id = tx.chain_id AND bl.number = tx.block_number
     WHERE tt.token = $1
     GROUP BY tt.chain_id`,
    [tokenBuffer],
  );

  const transferMap = new Map<
    number,
    { transfers: number; lastBlock: string | null; lastTimestamp: Date | null }
  >();

  for (const row of transferRows.rows) {
    transferMap.set(row.chain_id, {
      transfers: Number(row.transfers),
      lastBlock: row.last_block,
      lastTimestamp: row.last_timestamp,
    });
  }

  const coverageMap = new Map<number, TokenChainCoverageEntry>();

  for (const row of cursorRows.rows) {
    const chain = getChainById(row.chain_id);
    const transferInfo = transferMap.get(row.chain_id);

    coverageMap.set(row.chain_id, {
      chainId: row.chain_id,
      supported: chain?.supported ?? false,
      status: row.to_block ? "ok" : "indexing",
      fromBlock: row.from_block,
      toBlock: row.to_block,
      updatedAt: row.updated_at.toISOString(),
      lastTransferBlock: transferInfo?.lastBlock ?? null,
      lastTransferAt: transferInfo?.lastTimestamp ? transferInfo.lastTimestamp.toISOString() : null,
      transferCount: transferInfo?.transfers ?? 0,
    });
  }

  for (const [chainId, info] of transferMap.entries()) {
    if (coverageMap.has(chainId)) {
      continue;
    }

    const chain = getChainById(chainId);

    coverageMap.set(chainId, {
      chainId,
      supported: chain?.supported ?? false,
      status: "indexing",
      fromBlock: null,
      toBlock: null,
      updatedAt: null,
      lastTransferBlock: info.lastBlock,
      lastTransferAt: info.lastTimestamp ? info.lastTimestamp.toISOString() : null,
      transferCount: info.transfers,
    });
  }

  return Array.from(coverageMap.values()).sort((a, b) => a.chainId - b.chainId);
}
