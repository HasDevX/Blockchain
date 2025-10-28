import { SUPPORTED_CHAIN_IDS } from "../config/chains";
import { getRpcUrl } from "../config/rpc";
import {
  RpcBlock,
  RpcClient,
  RpcClientOptions,
  RpcLogEntry,
  RpcRateLimitError,
  RpcTransactionReceipt,
} from "../lib/rpcClient";
import {
  addressToBuffer,
  aggregateTransferDeltas,
  decodeTransferLogs,
  normalizeAddress,
  TRANSFER_TOPIC,
  type RpcLog,
} from "../services/holderStore";
import {
  ExecutionBatch,
  getCheckpoint,
  HolderDelta,
  storeExecutionBatch,
  type BlockRow,
  type LogRow,
  type ReceiptRow,
  type TokenTransferRow,
  type TransactionRow,
} from "../services/executionStore";
import {
  ADAPTIVE_RETRY_DELAY_MS,
  getInitialSpan,
  isBlockRangeTooLargeError,
  MAX_SPAN_RETRIES,
  parsePositiveBigInt,
  rememberSpan,
  resolveMaxSpan,
  shrinkSpan,
} from "./adaptiveSpan";

const RETRY_BASE_MS = Math.max(parseIntegerEnv("INDEXER_BACKOFF_MS", 1_500), 100);
const DEFAULT_CONFIRMATIONS = parseIntegerEnv("CHAIN_POLLER_CONFIRMATIONS", 10);
const DEFAULT_POLL_INTERVAL_MS = parseIntegerEnv("CHAIN_POLLER_INTERVAL_MS", 5_000);

interface ChainPollerDeps {
  rpcClient?: RpcClient;
  storeBatch?: (batch: ExecutionBatch) => Promise<void>;
  getCheckpoint?: (chainId: number) => Promise<bigint | null>;
}

interface ChainPollerConfig {
  chainId: number;
  mode: "live" | "backfill";
  startBlock: bigint;
  confirmations: number;
  pollIntervalMs: number;
  targetBlock?: bigint | null;
  useCheckpoint: boolean;
}

export class ChainPoller {
  private readonly rpcClient: RpcClient;
  private readonly storeBatch: (batch: ExecutionBatch) => Promise<void>;
  private readonly getCheckpointFn: (chainId: number) => Promise<bigint | null>;
  private lastProcessed: bigint | null = null;
  private stopped = false;
  private readonly mode: "live" | "backfill";
  private readonly targetBlock: bigint | null;
  private readonly useCheckpoint: boolean;

  constructor(
    private readonly config: ChainPollerConfig,
    deps: ChainPollerDeps = {},
  ) {
    this.rpcClient =
      deps.rpcClient ?? new RpcClient(getRpcUrl(config.chainId), buildRpcClientOptions());
    this.storeBatch = deps.storeBatch ?? storeExecutionBatch;
    this.getCheckpointFn = deps.getCheckpoint ?? getCheckpoint;
    this.mode = config.mode;
    this.targetBlock = config.targetBlock ?? null;
    this.useCheckpoint = config.useCheckpoint;
  }

  stop() {
    this.stopped = true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const didWork = await this.processNextBatch();
        if (!didWork) {
          if (this.mode === "backfill") {
            this.stop();
            break;
          }
          await sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        if (error instanceof RpcRateLimitError) {
          const delay = Math.max(error.retryAfterMs, RETRY_BASE_MS);
          logRateLimit(this.config.chainId, delay, error);
          await sleep(delay);
          continue;
        }

        logError(this.config.chainId, error as Error);
        await sleep(RETRY_BASE_MS);
      }
    }
  }

  async processNextBatch(): Promise<boolean> {
    if (this.lastProcessed === null && this.useCheckpoint) {
      this.lastProcessed = await this.getCheckpointFn(this.config.chainId);
    }

    const latestBlock = await this.rpcClient.getBlockNumber();
    const confirmations = BigInt(this.config.confirmations);

    if (latestBlock < confirmations) {
      return false;
    }

    let targetBlock = latestBlock - confirmations;

    if (targetBlock < 0n) {
      targetBlock = 0n;
    }

    if (this.mode === "backfill" && this.targetBlock !== null && this.targetBlock < targetBlock) {
      targetBlock = this.targetBlock;
    }

    let startBlock = this.computeStartBlock();

    if (startBlock < this.config.startBlock) {
      startBlock = this.config.startBlock;
    }

    if (startBlock > targetBlock) {
      return false;
    }

    const remaining = targetBlock - startBlock + 1n;
    if (remaining <= 0n) {
      return false;
    }

    const maxSpan = resolveMaxSpan(this.config.chainId);
    let span = getInitialSpan(this.config.chainId, remaining, maxSpan);
    let toBlock = startBlock + span - 1n;

    if (toBlock > targetBlock) {
      toBlock = targetBlock;
      span = toBlock - startBlock + 1n;
    }

    for (let attempt = 0; attempt < MAX_SPAN_RETRIES; attempt++) {
      try {
        const batch = await this.collectBatch(startBlock, toBlock);
        const startedAt = Date.now();

        await this.storeBatch(batch);

        rememberSpan(this.config.chainId, span);
        this.lastProcessed = toBlock;

        logBatch({
          chainId: this.config.chainId,
          from: startBlock,
          to: toBlock,
          span,
          blocks: batch.blocks.length,
          transactions: batch.transactions.length,
          receipts: batch.receipts.length,
          logs: batch.logs.length,
          tokenTransfers: batch.tokenTransfers.length,
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
        span = shrinkSpan(this.config.chainId, span, remaining, maxSpan);
        toBlock = startBlock + span - 1n;

        if (toBlock > targetBlock) {
          toBlock = targetBlock;
          span = toBlock - startBlock + 1n;
        }

        logAdaptation(this.config.chainId, oldSpan, span, error as Error);

        if (span === oldSpan || attempt === MAX_SPAN_RETRIES - 1) {
          logAdaptationFailure(this.config.chainId, span, error as Error);
          throw error as Error;
        }

        if (ADAPTIVE_RETRY_DELAY_MS > 0) {
          await sleep(ADAPTIVE_RETRY_DELAY_MS);
        }
      }
    }

    return false;
  }

  private computeStartBlock(): bigint {
    if (this.lastProcessed !== null) {
      return this.lastProcessed + 1n;
    }

    return this.config.startBlock;
  }

  private async collectBatch(fromBlock: bigint, toBlock: bigint): Promise<ExecutionBatch> {
    const transferLogs = await this.fetchTransferLogs(fromBlock, toBlock);
    const transfersByToken = groupTransfersByToken(transferLogs);
    const holderDeltas = buildHolderDeltas(transfersByToken);

    const blocks: BlockRow[] = [];
    const transactions: TransactionRow[] = [];
    const receipts: ReceiptRow[] = [];
    const logs: LogRow[] = [];
    const tokenTransfers: TokenTransferRow[] = buildTokenTransferRows(
      this.config.chainId,
      transferLogs,
    );

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber++) {
      const block = await this.rpcClient.getBlockWithTransactions(blockNumber);
      if (!block) {
        continue;
      }

      const blockRow = mapBlockRow(this.config.chainId, block);
      blocks.push(blockRow);

      let blockReceipts: RpcTransactionReceipt[] | null = null;
      if (block.hash) {
        blockReceipts = await this.rpcClient.getBlockReceipts(block.hash);
      }

      for (const tx of block.transactions) {
        const txRow = mapTransactionRow(this.config.chainId, blockRow.number, tx);
        transactions.push(txRow);
      }

      const receiptList: RpcTransactionReceipt[] = [];

      if (blockReceipts && blockReceipts.length > 0) {
        receiptList.push(...blockReceipts);
      } else {
        for (const tx of block.transactions) {
          const receipt = await this.rpcClient.getTransactionReceipt(tx.hash);
          if (receipt) {
            receiptList.push(receipt);
          }
        }
      }

      for (const receipt of receiptList) {
        const receiptRow = mapReceiptRow(this.config.chainId, receipt);
        receipts.push(receiptRow);

        const logRows = mapLogRows(this.config.chainId, receipt);
        logs.push(...logRows);
      }
    }

    return {
      chainId: this.config.chainId,
      fromBlock,
      toBlock,
      blocks,
      transactions,
      receipts,
      logs,
      tokenTransfers,
      holderDeltas,
    };
  }

  private async fetchTransferLogs(fromBlock: bigint, toBlock: bigint): Promise<RpcLogEntry[]> {
    const rawLogs = (await this.rpcClient.getLogs({
      fromBlock,
      toBlock,
      topics: [TRANSFER_TOPIC],
    })) as RpcLogEntry[];

    return rawLogs.map((log) => ({
      ...log,
      address: normalizeAddress(log.address),
    }));
  }
}
function groupTransfersByToken(logs: RpcLogEntry[]): Map<string, RpcLog[]> {
  const grouped = new Map<string, RpcLog[]>();

  for (const log of logs) {
    const rpcLog: RpcLog = {
      address: log.address,
      topics: log.topics,
      data: log.data,
      removed: log.removed,
    };

    if (!grouped.has(log.address)) {
      grouped.set(log.address, []);
    }

    grouped.get(log.address)?.push(rpcLog);
  }

  return grouped;
}

function buildHolderDeltas(grouped: Map<string, RpcLog[]>): HolderDelta[] {
  const updates: HolderDelta[] = [];

  for (const [token, logs] of grouped.entries()) {
    const transfers = decodeTransferLogs(logs);
    if (transfers.length === 0) {
      continue;
    }

    const deltas = aggregateTransferDeltas(transfers);
    if (deltas.size === 0) {
      continue;
    }

    updates.push({ token, deltas });
  }

  return updates;
}

function buildTokenTransferRows(chainId: number, logs: RpcLogEntry[]): TokenTransferRow[] {
  const rows: TokenTransferRow[] = [];

  for (const log of logs) {
    if (!log.transactionHash || log.logIndex === undefined || log.logIndex === null) {
      continue;
    }

    const rpcLog: RpcLog = {
      address: log.address,
      topics: log.topics,
      data: log.data,
      removed: log.removed,
    };

    const [transfer] = decodeTransferLogs([rpcLog]);
    if (!transfer) {
      continue;
    }

    rows.push({
      chainId,
      txHash: requireBuffer(log.transactionHash),
      logIndex: hexToNumber(log.logIndex),
      token: addressToBuffer(log.address),
      from: addressToBuffer(transfer.from),
      to: addressToBuffer(transfer.to),
      value: transfer.value.toString(),
    });
  }

  return rows;
}

function mapBlockRow(chainId: number, block: RpcBlock): BlockRow {
  return {
    chainId,
    number: BigInt(block.number),
    hash: requireBuffer(block.hash),
    parentHash: requireBuffer(block.parentHash),
    timestamp: hexToDate(block.timestamp),
  };
}

function mapTransactionRow(
  chainId: number,
  blockNumber: bigint,
  tx: RpcBlock["transactions"][number],
): TransactionRow {
  return {
    chainId,
    hash: requireBuffer(tx.hash),
    blockNumber,
    from: addressToBuffer(normalizeAddress(tx.from)),
    to: tx.to ? addressToBuffer(normalizeAddress(tx.to)) : null,
    value: hexToBigIntString(tx.value) ?? "0",
    nonce: hexToBigIntString(tx.nonce) ?? "0",
    gas: hexToBigIntString(tx.gas),
    gasPrice: tx.gasPrice ? hexToBigIntString(tx.gasPrice) : null,
    input: bufferFromHex(tx.input),
  };
}

function mapReceiptRow(chainId: number, receipt: RpcTransactionReceipt): ReceiptRow {
  return {
    chainId,
    txHash: requireBuffer(receipt.transactionHash),
    status: hexToBoolean(receipt.status),
    gasUsed: receipt.gasUsed ? hexToBigIntString(receipt.gasUsed) : null,
    effectiveGasPrice: receipt.effectiveGasPrice
      ? hexToBigIntString(receipt.effectiveGasPrice)
      : null,
    contractAddress: receipt.contractAddress
      ? addressToBuffer(normalizeAddress(receipt.contractAddress))
      : null,
  };
}

function mapLogRows(chainId: number, receipt: RpcTransactionReceipt): LogRow[] {
  const rows: LogRow[] = [];

  for (const log of receipt.logs) {
    if (log.transactionHash === undefined || log.logIndex === undefined) {
      continue;
    }

    const topics = [...log.topics, null, null, null].slice(0, 4);

    rows.push({
      chainId,
      txHash: requireBuffer(log.transactionHash ?? receipt.transactionHash),
      logIndex: hexToNumber(log.logIndex),
      address: addressToBuffer(normalizeAddress(log.address)),
      topic0: topics[0] ? requireBuffer(topics[0]) : null,
      topic1: topics[1] ? requireBuffer(topics[1]) : null,
      topic2: topics[2] ? requireBuffer(topics[2]) : null,
      topic3: topics[3] ? requireBuffer(topics[3]) : null,
      data: bufferFromHex(log.data),
    });
  }

  return rows;
}

function requireBuffer(hex: string): Buffer {
  const result = bufferFromHex(hex);
  if (!result) {
    throw new Error(`invalid hex value: ${hex}`);
  }

  return result;
}

function bufferFromHex(hex: string | null | undefined): Buffer | null {
  if (!hex) {
    return null;
  }

  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0) {
    return Buffer.alloc(0);
  }

  if (normalized.length % 2 !== 0) {
    return Buffer.from(`0${normalized}`, "hex");
  }

  return Buffer.from(normalized, "hex");
}

function hexToBigIntString(hex: string | null | undefined): string | null {
  if (!hex) {
    return null;
  }

  return BigInt(hex).toString();
}

function hexToBoolean(hex: string | null | undefined): boolean | null {
  if (hex === null || hex === undefined) {
    return null;
  }

  return BigInt(hex) === 1n;
}

function hexToNumber(hex: string | null | undefined): number {
  if (!hex) {
    return 0;
  }

  return Number(BigInt(hex));
}

function hexToDate(hex: string): Date {
  const seconds = Number(BigInt(hex));
  return new Date(seconds * 1_000);
}

function parseIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function buildRpcClientOptions(): RpcClientOptions | undefined {
  const qps = parseIntegerEnv("INDEXER_QPS", 0);
  const minDelay = parseIntegerEnv("INDEXER_RPC_MIN_DELAY_MS", 0);
  const options: RpcClientOptions = {};

  if (qps > 0) {
    options.qps = qps;
  }

  if (minDelay > 0) {
    options.minDelayMs = minDelay;
  }

  if (options.qps || options.minDelayMs) {
    return options;
  }

  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logBatch(details: {
  chainId: number;
  from: bigint;
  to: bigint;
  span: bigint;
  blocks: number;
  transactions: number;
  receipts: number;
  logs: number;
  tokenTransfers: number;
  durationMs: number;
}) {
  console.log(
    JSON.stringify({
      event: "chain.poller.batch",
      chainId: details.chainId,
      from: details.from.toString(),
      to: details.to.toString(),
      span: details.span.toString(),
      blocks: details.blocks,
      transactions: details.transactions,
      receipts: details.receipts,
      logs: details.logs,
      tokenTransfers: details.tokenTransfers,
      ms: details.durationMs,
    }),
  );
}

function logAdaptation(chainId: number, oldSpan: bigint, newSpan: bigint, error: Error) {
  console.log(
    JSON.stringify({
      event: "chain.poller.adapt",
      chainId,
      reason: "block_range_too_large",
      oldSpan: oldSpan.toString(),
      newSpan: newSpan.toString(),
      message: error.message,
    }),
  );
}

function logAdaptationFailure(chainId: number, span: bigint, error: Error) {
  console.warn(
    JSON.stringify({
      event: "chain.poller.adapt",
      chainId,
      reason: "max_retries",
      span: span.toString(),
      message: error.message,
    }),
  );
}

function logRateLimit(chainId: number, delay: number, error: Error) {
  console.warn(
    JSON.stringify({
      event: "chain.poller.rate_limit",
      chainId,
      delayMs: delay,
      message: error.message,
    }),
  );
}

function logError(chainId: number, error: Error) {
  console.error(
    JSON.stringify({
      event: "chain.poller.error",
      chainId,
      message: error.message,
    }),
  );
}

function buildPollerConfig(chainId: number): ChainPollerConfig {
  const startOverride = parsePositiveBigInt(process.env[`CHAIN_POLLER_START_${chainId}`]);
  const confirmationsOverride = parseIntegerEnv(
    `CHAIN_POLLER_CONFIRMATIONS_${chainId}`,
    DEFAULT_CONFIRMATIONS,
  );
  const intervalOverride = parseIntegerEnv(
    `CHAIN_POLLER_INTERVAL_MS_${chainId}`,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const modeEnv = (
    process.env[`CHAIN_POLLER_MODE_${chainId}`] ??
    process.env.CHAIN_POLLER_MODE ??
    "live"
  ).toLowerCase();
  const mode: "live" | "backfill" = modeEnv === "backfill" ? "backfill" : "live";
  const targetOverride = parsePositiveBigInt(process.env[`CHAIN_POLLER_TARGET_${chainId}`]);
  const useCheckpoint = mode === "live";

  return {
    chainId,
    mode,
    startBlock: startOverride ?? 0n,
    confirmations: confirmationsOverride,
    pollIntervalMs: intervalOverride,
    targetBlock: mode === "backfill" ? (targetOverride ?? null) : null,
    useCheckpoint,
  };
}

function resolveTargetChainIds(): number[] {
  const ids = new Set<number>();
  const single = process.env.CHAIN_POLLER_CHAIN_ID ?? process.env.CHAIN_ID;
  const multi = process.env.CHAIN_POLLER_CHAIN_IDS;

  if (single) {
    const parsed = Number(single);
    if (!Number.isInteger(parsed)) {
      throw new Error(`CHAIN_POLLER_CHAIN_ID must be an integer, got '${single}'`);
    }

    if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(parsed)) {
      throw new Error(`CHAIN_POLLER_CHAIN_ID ${parsed} is not supported`);
    }

    ids.add(parsed);
  }

  if (multi) {
    const parts = multi
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    for (const part of parts) {
      const parsed = Number(part);
      if (!Number.isInteger(parsed)) {
        throw new Error(`CHAIN_POLLER_CHAIN_IDS must contain integers, got '${part}'`);
      }

      if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(parsed)) {
        throw new Error(`CHAIN_POLLER_CHAIN_IDS entry ${parsed} is not supported`);
      }

      ids.add(parsed);
    }
  }

  if (ids.size === 0) {
    return [...SUPPORTED_CHAIN_IDS];
  }

  return [...ids].sort((a, b) => a - b);
}

const pollers: ChainPoller[] = [];

async function startPollers() {
  const chainIds = resolveTargetChainIds();

  if (chainIds.length === 0) {
    console.warn("No chain IDs configured for chain poller; exiting");
    return;
  }

  for (const chainId of chainIds) {
    const config = buildPollerConfig(chainId);
    const poller = new ChainPoller(config);
    pollers.push(poller);
    void poller.run();
  }
}

function stopPollers(reason: string) {
  for (const poller of pollers) {
    poller.stop();
  }

  console.log(JSON.stringify({ event: "chain.poller.stop", reason }));
}

interface ParsedCliConfig extends ChainPollerConfig {}

function parseCliArgs(args: string[]): ParsedCliConfig {
  const parsed: {
    chainId?: number;
    mode?: "live" | "backfill";
    from?: bigint;
    to?: bigint | null;
    confirmations?: number;
    pollIntervalMs?: number;
    noCheckpoint?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const token = args[i];

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument '${token}'. Use --help for usage.`);
    }

    const key = token.slice(2);

    if (key === "no-checkpoint") {
      parsed.noCheckpoint = true;
      continue;
    }

    i += 1;
    const value = args[i];

    if (!value) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case "chainId": {
        const chainId = Number.parseInt(value, 10);
        if (!Number.isInteger(chainId) || chainId <= 0) {
          throw new Error(`Invalid chainId '${value}'.`);
        }
        parsed.chainId = chainId;
        break;
      }
      case "mode": {
        const modeValue = value.toLowerCase();
        if (modeValue !== "live" && modeValue !== "backfill") {
          throw new Error(`Invalid mode '${value}'. Expected 'live' or 'backfill'.`);
        }
        parsed.mode = modeValue as "live" | "backfill";
        break;
      }
      case "from": {
        parsed.from = parseBlockArg(value, "from");
        break;
      }
      case "to": {
        parsed.to = parseBlockArg(value, "to");
        break;
      }
      case "confirmations": {
        const confirmations = Number.parseInt(value, 10);
        if (!Number.isInteger(confirmations) || confirmations < 0) {
          throw new Error(`Invalid confirmations '${value}'.`);
        }
        parsed.confirmations = confirmations;
        break;
      }
      case "pollInterval": {
        const pollInterval = Number.parseInt(value, 10);
        if (!Number.isInteger(pollInterval) || pollInterval <= 0) {
          throw new Error(`Invalid pollInterval '${value}'.`);
        }
        parsed.pollIntervalMs = pollInterval;
        break;
      }
      default:
        throw new Error(`Unknown argument '--${key}'. Use --help for usage.`);
    }
  }

  if (parsed.chainId === undefined) {
    throw new Error("--chainId is required.");
  }

  const mode = parsed.mode ?? "live";
  const startBlock = parsed.from ?? 0n;

  if (mode === "backfill" && parsed.from === undefined) {
    throw new Error("--from is required when mode is backfill.");
  }

  if (parsed.to !== undefined && parsed.from !== undefined && parsed.to !== null) {
    if (parsed.to < parsed.from) {
      throw new Error("--to must be greater than or equal to --from.");
    }
  }

  const confirmations = parsed.confirmations ?? DEFAULT_CONFIRMATIONS;
  const pollIntervalMs = parsed.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const targetBlock = parsed.to ?? null;
  const useCheckpoint = mode === "live" && !parsed.noCheckpoint && parsed.from === undefined;

  return {
    chainId: parsed.chainId,
    mode,
    startBlock,
    confirmations,
    pollIntervalMs,
    targetBlock,
    useCheckpoint,
  };
}

function parseBlockArg(value: string, flag: string): bigint {
  try {
    if (value.startsWith("0x") || value.startsWith("0X")) {
      const parsed = BigInt(value);
      if (parsed < 0n) {
        throw new Error("negative");
      }
      return parsed;
    }

    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error("negative");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid value '${value}' for --${flag}. Expected integer block number.`);
  }
}

function printCliUsage(): void {
  console.log(`Usage: node dist/workers/chainPoller.js --chainId <id> --mode <live|backfill> [options]

Options:
  --chainId <id>           Numeric chain ID (required)
  --mode <live|backfill>   Run in live tail mode (default) or one-off backfill
  --from <block>           Starting block number (required for backfill)
  --to <block>             Optional end block (inclusive) for backfill
  --confirmations <n>      Block confirmations to wait before processing (default ${DEFAULT_CONFIRMATIONS})
  --pollInterval <ms>      Sleep duration between live polling cycles (default ${DEFAULT_POLL_INTERVAL_MS})
  --no-checkpoint          Ignore stored checkpoint (live mode only)
  --help                   Show this help message
`);
}

async function runCli(shouldAutostart: boolean): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printCliUsage();
    return;
  }

  if (args.length === 0) {
    if (shouldAutostart) {
      await startPollers();
      return;
    }

    printCliUsage();
    throw new Error("No arguments provided.");
  }

  let cliConfig: ParsedCliConfig;

  try {
    cliConfig = parseCliArgs(args);
  } catch (error) {
    printCliUsage();
    throw error;
  }

  const poller = new ChainPoller(cliConfig);
  pollers.push(poller);
  await poller.run();

  if (cliConfig.mode === "backfill") {
    console.log(
      JSON.stringify({
        event: "chain.poller.complete",
        chainId: cliConfig.chainId,
        from: cliConfig.startBlock.toString(),
        to: cliConfig.targetBlock ? cliConfig.targetBlock.toString() : undefined,
      }),
    );
  }
}

const shouldAutostart =
  process.env.CHAIN_POLLER_SKIP_AUTOSTART !== "true" &&
  process.env.NODE_ENV !== "test" &&
  process.env.VITEST !== "true";

if (require.main === module) {
  runCli(shouldAutostart).catch((error) => {
    console.error("chain poller CLI failed", error);
    process.exit(1);
  });
} else if (shouldAutostart) {
  startPollers().catch((error) => {
    console.error("chain poller failed", error);
    process.exit(1);
  });
}

process.on("SIGINT", () => {
  stopPollers("sigint");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopPollers("sigterm");
  process.exit(0);
});
