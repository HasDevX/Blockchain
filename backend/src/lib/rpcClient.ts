import { safeHexToBigInt } from "./hex";

export class RpcRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RpcRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export type RpcEndpointErrorKind = "invalid_hex" | "unauthorized";

export interface RpcEndpointErrorDetails {
  value?: string | null;
  status?: number;
}

export class RpcEndpointError extends Error {
  constructor(
    message: string,
    readonly kind: RpcEndpointErrorKind,
    readonly method: string,
    readonly details: RpcEndpointErrorDetails = {},
  ) {
    super(message);
    this.name = "RpcEndpointError";
  }
}

export interface RpcClientOptions {
  qps?: number;
  minDelayMs?: number;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

export interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: JsonRpcError;
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export class RpcClient {
  private nextId = 1;
  private readonly minDelayMs: number;
  private nextAvailableAt = 0;
  private throttlePromise: Promise<void> = Promise.resolve();
  private blockReceiptsUnsupported = false;

  constructor(
    private readonly url: string,
    options: RpcClientOptions = {},
  ) {
    const minDelayFromQps = options.qps && options.qps > 0 ? Math.ceil(1_000 / options.qps) : 0;
    const explicitDelay = options.minDelayMs ?? 0;
    this.minDelayMs = Math.max(0, Math.max(minDelayFromQps, explicitDelay));
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    await this.scheduleCall();

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    };

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (response.status === 429 || response.status === 503) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      throw new RpcRateLimitError(`RPC ${method} rate limited`, retryAfter);
    }

    if (response.status === 401 || response.status === 403) {
      throw new RpcEndpointError(
        `RPC request failed with status ${response.status}`,
        "unauthorized",
        method,
        { status: response.status },
      );
    }

    if (!response.ok) {
      throw new Error(`RPC request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;

    if ("error" in payload) {
      const retryAfter = inferRetryAfterFromCode(payload.error.code);

      if (retryAfter > 0) {
        throw new RpcRateLimitError(payload.error.message, retryAfter);
      }

      throw new RpcError(payload.error.message, payload.error.code, payload.error.data);
    }

    return payload.result;
  }

  async getBlockNumber(): Promise<bigint> {
    const result = await this.call<string>("eth_blockNumber", []);
    const parsed = safeHexToBigInt(result);

    if (parsed === null) {
      throw new RpcEndpointError(
        "eth_blockNumber returned invalid hex",
        "invalid_hex",
        "eth_blockNumber",
        { value: result },
      );
    }

    return parsed;
  }

  async getLogs(params: {
    fromBlock: bigint;
    toBlock: bigint;
    address?: string;
    topics?: Array<string | null>;
  }): Promise<unknown[]> {
    const body: Record<string, unknown> = {
      fromBlock: toHex(params.fromBlock),
      toBlock: toHex(params.toBlock),
    };

    if (params.address) {
      body.address = params.address;
    }

    if (params.topics) {
      body.topics = params.topics;
    }

    return this.call<unknown[]>("eth_getLogs", [body]);
  }

  async getBlockWithTransactions(blockNumber: bigint): Promise<RpcBlock | null> {
    const block = await this.call<RpcBlock | null>("eth_getBlockByNumber", [
      toHex(blockNumber),
      true,
    ]);
    return block;
  }

  async getTransactionReceipt(hash: string): Promise<RpcTransactionReceipt | null> {
    return this.call<RpcTransactionReceipt | null>("eth_getTransactionReceipt", [hash]);
  }

  async getBlockReceipts(blockHash: string): Promise<RpcTransactionReceipt[] | null> {
    if (this.blockReceiptsUnsupported) {
      return null;
    }

    try {
      return await this.call<RpcTransactionReceipt[] | null>("eth_getBlockReceipts", [blockHash]);
    } catch (error) {
      if (error instanceof RpcError && error.code === -32601) {
        this.blockReceiptsUnsupported = true;
        return null;
      }

      throw error;
    }
  }

  private async scheduleCall(): Promise<void> {
    if (this.minDelayMs <= 0) {
      return;
    }

    this.throttlePromise = this.throttlePromise.then(async () => {
      const now = Date.now();
      const wait = this.nextAvailableAt - now;

      if (wait > 0) {
        await sleep(wait);
      }

      const start = wait > 0 ? this.nextAvailableAt : Date.now();
      this.nextAvailableAt = start + this.minDelayMs;
    });

    await this.throttlePromise;
  }
}

function parseRetryAfter(raw: string | null): number {
  if (!raw) {
    return 1_000;
  }

  const numeric = Number(raw);

  if (Number.isFinite(numeric)) {
    return Math.max(1_000, Math.ceil(numeric * 1_000));
  }

  const parsed = Date.parse(raw);

  if (Number.isNaN(parsed)) {
    return 1_000;
  }

  const diff = parsed - Date.now();
  return diff > 0 ? diff : 1_000;
}

function inferRetryAfterFromCode(code: number): number {
  // Common getLogs throttling codes for public RPC endpoints.
  if (code === -32005 || code === -32016) {
    return 2_000;
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export interface RpcTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  nonce: string;
  gas: string;
  gasPrice?: string | null;
  input: string;
}

export interface RpcBlock {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  transactions: RpcTransaction[];
}

export interface RpcLogEntry {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
  transactionHash?: string;
  removed?: boolean;
}

export interface RpcTransactionReceipt {
  transactionHash: string;
  status?: string | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  contractAddress?: string | null;
  logs: RpcLogEntry[];
}
