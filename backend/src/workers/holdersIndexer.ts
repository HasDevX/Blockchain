import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { getPool, withTransaction } from "../lib/db";
import { getRpcUrl } from "../config/rpc";
import { RpcClient, RpcClientOptions, RpcRateLimitError } from "../lib/rpcClient";
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
import {
  ADAPTIVE_RETRY_DELAY_MS,
  getInitialSpan,
  isBlockRangeTooLargeError,
  MAX_SPAN_RETRIES,
  rememberSpan,
  resetSpanHints as resetSpanHintsInternal,
  resolveMaxSpan,
  shrinkSpan,
} from "./adaptiveSpan";

export const resetSpanHints = resetSpanHintsInternal;

const INITIAL_LOOKBACK_BLOCKS = 50_000n;
const SCHEDULE_EXPRESSION = process.env.HOLDERS_INDEXER_CRON ?? "*/5 * * * * *";
const RETRY_BASE_MS = (() => {
  const raw = process.env.INDEXER_BACKOFF_MS;
  if (!raw) {
    return 1_500;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1_500;
})();
const RPC_CLIENT_OPTIONS = buildRpcClientOptions();

interface IndexStats {
  chainId: number;
  token: string;
  fromBlock: bigint;
  toBlock: bigint;
  span: bigint;
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

export async function processCursor(cursor: TokenCursor): Promise<boolean> {
  const rpcUrl = getRpcUrl(cursor.chainId);
  const rpcClient = new RpcClient(rpcUrl, RPC_CLIENT_OPTIONS);

  const latestBlock = await rpcClient.getBlockNumber();
  const startBlock = computeStartBlock(cursor, latestBlock);

  if (startBlock === null || latestBlock < startBlock) {
    return false;
  }

  const remaining = latestBlock - startBlock + 1n;

  if (remaining <= 0n) {
    return false;
  }

  const normalizedToken = normalizeAddress(cursor.token);
  const maxSpan = resolveMaxSpan(cursor.chainId);
  let span = getInitialSpan(cursor.chainId, remaining, maxSpan);
  let toBlock = startBlock + span - 1n;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < MAX_SPAN_RETRIES; attempt++) {
    try {
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

      rememberSpan(cursor.chainId, span);

      reportProgress({
        chainId: cursor.chainId,
        token: normalizedToken,
        fromBlock: startBlock,
        toBlock,
        span,
        logs: rawLogs.length,
        transfers: transfers.length,
        durationMs: Date.now() - startedAt,
      });

      return true;
    } catch (error) {
      if (error instanceof RpcRateLimitError) {
        throw error;
      }

      if (!isBlockRangeTooLargeError(error)) {
        throw error as Error;
      }

      const oldSpan = span;
      const newSpan = shrinkSpan(cursor.chainId, span, remaining, maxSpan);

      if (newSpan < oldSpan) {
        logSpanAdaptation(cursor.chainId, normalizedToken, oldSpan, newSpan);
      }

      if (newSpan === oldSpan || attempt === MAX_SPAN_RETRIES - 1) {
        logSpanAdaptationFailure(cursor.chainId, normalizedToken, span, error as Error);
        throw error as Error;
      }

      span = newSpan;
      toBlock = startBlock + span - 1n;

      if (ADAPTIVE_RETRY_DELAY_MS > 0) {
        await sleep(ADAPTIVE_RETRY_DELAY_MS);
      }
    }
  }

  return false;
}

function buildRpcClientOptions(): RpcClientOptions {
  const qpsRaw = process.env.INDEXER_QPS;
  const minDelayRaw = process.env.INDEXER_RPC_MIN_DELAY_MS;
  const options: RpcClientOptions = {};

  if (qpsRaw) {
    const parsed = Number.parseInt(qpsRaw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      options.qps = parsed;
    }
  }

  if (minDelayRaw) {
    const parsed = Number.parseInt(minDelayRaw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      options.minDelayMs = parsed;
    }
  }

  return options;
}

function logSpanAdaptation(chainId: number, token: string, oldSpan: bigint, newSpan: bigint): void {
  console.log(
    JSON.stringify({
      event: "holders.index.adapt",
      chainId,
      token,
      reason: "block_range_too_large",
      oldSpan: oldSpan.toString(),
      newSpan: newSpan.toString(),
    }),
  );
}

function logSpanAdaptationFailure(
  chainId: number,
  token: string,
  span: bigint,
  error: Error,
): void {
  console.warn(
    JSON.stringify({
      event: "holders.index.adapt",
      chainId,
      token,
      reason: "max_retries",
      span: span.toString(),
      message: error.message,
    }),
  );
}

function reportProgress(stats: IndexStats) {
  console.log(
    JSON.stringify({
      event: "holders.index",
      chainId: stats.chainId,
      token: stats.token,
      from: stats.fromBlock.toString(),
      to: stats.toBlock.toString(),
      span: stats.span.toString(),
      logs: stats.logs,
      transfers: stats.transfers,
      ms: stats.durationMs,
    }),
  );

  console.log(
    `metric holders_batch chain_id=${stats.chainId} token=${stats.token} from_block=${stats.fromBlock.toString()} to_block=${stats.toBlock.toString()} span=${stats.span.toString()} logs=${stats.logs} transfers=${stats.transfers} ms=${stats.durationMs}`,
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

if (process.env.HOLDERS_INDEXER_SKIP_AUTOSTART !== "true") {
  startScheduler().catch((error) => {
    console.error("holders indexer failed", error);
    process.exit(1);
  });
}

process.on("SIGINT", () => {
  stopScheduler("sigint");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopScheduler("sigterm");
  process.exit(0);
});
