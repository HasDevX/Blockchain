export class RpcRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RpcRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
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

  constructor(private readonly url: string) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
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

    if (!response.ok) {
      throw new Error(`RPC request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;

    if ("error" in payload) {
      const retryAfter = inferRetryAfterFromCode(payload.error.code);

      if (retryAfter > 0) {
        throw new RpcRateLimitError(payload.error.message, retryAfter);
      }

      throw new Error(`RPC error ${payload.error.code}: ${payload.error.message}`);
    }

    return payload.result;
  }

  async getBlockNumber(): Promise<bigint> {
    const result = await this.call<string>("eth_blockNumber", []);
    return BigInt(result);
  }

  async getLogs(params: {
    fromBlock: bigint;
    toBlock: bigint;
    address: string;
    topics: string[];
  }): Promise<unknown[]> {
    const body = {
      fromBlock: toHex(params.fromBlock),
      toBlock: toHex(params.toBlock),
      address: params.address,
      topics: params.topics,
    };

    return this.call<unknown[]>("eth_getLogs", [body]);
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

export function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
