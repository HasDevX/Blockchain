import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { getPool, withTransaction } from "../lib/db";
import { getRpcUrl } from "../config/rpc";
import { RpcClient, RpcRateLimitError } from "../lib/rpcClient";
import {
  aggregateTransferDeltas,
  applyHolderDeltas,
  decodeTransferLogs,
  normalizeAddress,
  TRANSFER_TOPIC,
  type RpcLog,
} from "../services/holderStore";
import {
  listTrackedTokens,
  updateTokenCursor,
  type TokenCursor,
} from "../services/tokenHolderRepository";

const DEFAULT_BLOCK_CHUNK = BigInt(process.env.HOLDERS_INDEXER_CHUNK ?? "5000");
const INITIAL_LOOKBACK_BLOCKS = 50_000n;
const SCHEDULE_EXPRESSION = process.env.HOLDERS_INDEXER_CRON ?? "*/5 * * * * *";
const RETRY_BASE_MS = 1_500;

interface IndexStats {
  chainId: number;
  token: string;
  fromBlock: bigint;
  toBlock: bigint;
  logs: number;
  transfers: number;
  durationMs: number;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function computeStartBlock(cursor: TokenCursor, latestBlock: bigint): bigint | null {
  if (cursor.fromBlock !== null) {
    return cursor.fromBlock;
  }

  if (cursor.toBlock !== null) {
    return cursor.toBlock + 1n;
  }

  const lookback = INITIAL_LOOKBACK_BLOCKS > 0n ? INITIAL_LOOKBACK_BLOCKS : 50_000n;
  const fallbackStart = latestBlock > lookback ? latestBlock - lookback : 0n;
  return fallbackStart;
}

async function processCursor(cursor: TokenCursor): Promise<boolean> {
  const rpcUrl = getRpcUrl(cursor.chainId);
  const rpcClient = new RpcClient(rpcUrl);

  const latestBlock = await rpcClient.getBlockNumber();
  const startBlock = computeStartBlock(cursor, latestBlock);

  if (startBlock === null) {
    return false;
  }

  if (latestBlock < startBlock) {
    return false;
  }

  const chunkSize = DEFAULT_BLOCK_CHUNK > 0n ? DEFAULT_BLOCK_CHUNK : 5_000n;
  const chunkEnd = startBlock + chunkSize - 1n;
  const toBlock = chunkEnd > latestBlock ? latestBlock : chunkEnd;

  if (toBlock < startBlock) {
    return false;
  }

  const normalizedToken = normalizeAddress(cursor.token);
  const startedAt = Date.now();
  const rawLogs = (await rpcClient.getLogs({
    fromBlock: startBlock,
    toBlock,
    address: normalizedToken,
    topics: [TRANSFER_TOPIC],
  })) as RpcLog[];

  const transfers = decodeTransferLogs(rawLogs);
  const deltas = aggregateTransferDeltas(transfers);

  await withTransaction(async (client) => {
    await applyHolderDeltas(client, cursor.chainId, normalizedToken, deltas);

    const nextFromBlock = toBlock + 1n;
    await updateTokenCursor(client, cursor.chainId, normalizedToken, nextFromBlock, toBlock);
  });

  reportProgress({
    chainId: cursor.chainId,
    token: normalizedToken,
    fromBlock: startBlock,
    toBlock,
    logs: rawLogs.length,
    transfers: transfers.length,
    durationMs: Date.now() - startedAt,
  });

  return true;
}

function reportProgress(stats: IndexStats) {
  console.log(
    JSON.stringify({
      event: "holders.indexer.progress",
      chainId: stats.chainId,
      token: stats.token,
      fromBlock: stats.fromBlock.toString(),
      toBlock: stats.toBlock.toString(),
      logs: stats.logs,
      transfers: stats.transfers,
      ms: stats.durationMs,
    }),
  );

  console.log(
    `metric holders_batch chain_id=${stats.chainId} token=${stats.token} from_block=${stats.fromBlock.toString()} to_block=${stats.toBlock.toString()} logs=${stats.logs} transfers=${stats.transfers} ms=${stats.durationMs}`,
  );
}

function reportRateLimit(cursor: TokenCursor, delay: number, error: Error) {
  console.warn(
    JSON.stringify({
      event: "holders.indexer.rate_limit",
      chainId: cursor.chainId,
      token: normalizeAddress(cursor.token),
      delayMs: delay,
      message: error.message,
    }),
  );
}

function reportError(cursor: TokenCursor, error: Error) {
  console.error(
    JSON.stringify({
      event: "holders.indexer.error",
      chainId: cursor.chainId,
      token: normalizeAddress(cursor.token),
      message: error.message,
    }),
  );
}

async function runOnce(): Promise<boolean> {
  const pool = getPool();
  const cursors = await listTrackedTokens(pool);
  let didWork = false;

  for (const cursor of cursors) {
    try {
      const processed = await processCursor(cursor);
      didWork = didWork || processed;
    } catch (error) {
      if (error instanceof RpcRateLimitError) {
        const delay = Math.max(error.retryAfterMs, RETRY_BASE_MS);
        reportRateLimit(cursor, delay, error);
        await sleep(delay);
        continue;
      }

      reportError(cursor, error as Error);
      await sleep(RETRY_BASE_MS);
    }
  }

  return didWork;
}

const runOnceOnly = process.env.HOLDERS_INDEXER_ONCE === "true";

let isTickRunning = false;
let job: ScheduledTask | null = null;

async function tick() {
  if (isTickRunning) {
    return;
  }

  isTickRunning = true;

  try {
    const didWork = await runOnce();
    if (runOnceOnly && !didWork) {
      console.log("holders indexer completed single run");
    }
  } catch (error) {
    console.error("holders indexer tick failed", error);
  } finally {
    isTickRunning = false;
  }
}

function stopScheduler(reason: string) {
  if (job) {
    job.stop();
    job = null;
  }

  console.log(JSON.stringify({ event: "holders.indexer.stop", reason }));
}

async function startScheduler() {
  if (runOnceOnly) {
    await tick();
    return;
  }

  const scheduleExpression = cron.validate(SCHEDULE_EXPRESSION)
    ? SCHEDULE_EXPRESSION
    : "*/5 * * * * *";

  if (!cron.validate(SCHEDULE_EXPRESSION)) {
    console.warn(
      `Invalid HOLDERS_INDEXER_CRON expression "${SCHEDULE_EXPRESSION}"; falling back to */5 * * * * *`,
    );
  }

  job = cron.schedule(scheduleExpression, () => {
    void tick();
  });
}

startScheduler().catch((error) => {
  console.error("holders indexer failed", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  stopScheduler("sigint");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopScheduler("sigterm");
  process.exit(0);
});
