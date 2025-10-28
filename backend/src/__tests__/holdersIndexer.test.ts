import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenCursor } from "../services/tokenHolderRepository";

const getBlockNumberMock = vi.fn<[], Promise<bigint>>();
const getLogsMock = vi.fn();
const applyHolderDeltasMock = vi.fn();
const updateTokenCursorMock = vi.fn();
const getRuntimeChainConfigMock = vi.fn(async () => ({
  chainId: 1,
  name: "Ethereum",
  enabled: true,
  rpcUrl: "https://rpc.test",
  rpcSource: "env" as const,
  etherscanApiKey: null,
  etherscanSource: "none" as const,
  startBlock: null,
  qps: 10,
  minSpan: 1_000,
  maxSpan: 4_000,
  updatedAt: new Date(),
}));

vi.mock("../services/chainConfigProvider", () => ({
  getRuntimeChainConfig: getRuntimeChainConfigMock,
}));

vi.mock("../lib/db", () => ({
  withTransaction: vi.fn(async (fn: (client: unknown) => Promise<void> | void) => {
    await fn({});
  }),
  getPool: vi.fn(),
}));

vi.mock("../services/holderStore", () => ({
  aggregateTransferDeltas: vi.fn(() => []),
  applyHolderDeltas: applyHolderDeltasMock,
  decodeTransferLogs: vi.fn(() => []),
  normalizeAddress: (address: string) => address.toLowerCase(),
  TRANSFER_TOPIC: "0xdd",
}));

vi.mock("../services/tokenHolderRepository", () => ({
  updateTokenCursor: updateTokenCursorMock,
}));

vi.mock("../lib/rpcClient", () => {
  class MockRpcRateLimitError extends Error {
    readonly retryAfterMs: number;

    constructor(message: string, retryAfterMs = 0) {
      super(message);
      this.name = "RpcRateLimitError";
      this.retryAfterMs = retryAfterMs;
    }
  }

  return {
    RpcClient: vi.fn(() => ({
      getBlockNumber: getBlockNumberMock,
      getLogs: getLogsMock,
    })),
    RpcRateLimitError: MockRpcRateLimitError,
  };
});

let processCursor: (cursor: TokenCursor) => Promise<boolean>;
let resetSpanHints: () => void;

describe("holders indexer adaptive span", () => {
  beforeEach(async () => {
    vi.resetModules();
    getBlockNumberMock.mockReset();
    getLogsMock.mockReset();
    applyHolderDeltasMock.mockReset();
    updateTokenCursorMock.mockReset();
    getRuntimeChainConfigMock.mockClear();

    process.env.HOLDERS_INDEXER_SKIP_AUTOSTART = "true";
    process.env.INDEXER_MAX_SPAN_DEFAULT = "2000";
    process.env.INDEXER_MAX_SPAN_1 = "4000";

    const module = await import("../workers/holdersIndexer");
    processCursor = module.processCursor;
    resetSpanHints = module.resetSpanHints;
    resetSpanHints();
  });

  afterEach(() => {
    delete process.env.HOLDERS_INDEXER_SKIP_AUTOSTART;
    delete process.env.INDEXER_MAX_SPAN_DEFAULT;
    delete process.env.INDEXER_MAX_SPAN_1;
  });

  it("halves spans on block range errors and logs adaptations", async () => {
    const cursor: TokenCursor = {
      chainId: 1,
      token: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      fromBlock: 100_000n,
      toBlock: null,
      updatedAt: new Date(),
    };

    getBlockNumberMock.mockResolvedValue(103_999n);

    const makeBlockRangeError = () => {
      const error = new Error("RPC error -32062: Block range is too large");
      (error as Error & { code?: number }).code = -32062;
      throw error;
    };

    getLogsMock.mockImplementationOnce(() => makeBlockRangeError());
    getLogsMock.mockImplementationOnce(() => makeBlockRangeError());
    getLogsMock.mockResolvedValueOnce([]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const processed = await processCursor(cursor);

    expect(processed).toBe(true);
    expect(getLogsMock).toHaveBeenCalledTimes(3);

    const spansTried = getLogsMock.mock.calls.map(([params]) => {
      const from = BigInt(params.fromBlock);
      const to = BigInt(params.toBlock);
      return to - from + 1n;
    });
    expect(spansTried).toEqual([4_000n, 2_000n, 1_000n]);

    const parsedLogs = logSpy.mock.calls
      .map(([entry]) => {
        try {
          return JSON.parse(String(entry));
        } catch (error) {
          return null;
        }
      })
      .filter((payload): payload is Record<string, unknown> => !!payload && "event" in payload);

    const adaptEvents = parsedLogs.filter((payload) => payload.event === "holders.index.adapt");
    expect(adaptEvents).toEqual([
      expect.objectContaining({ oldSpan: "4000", newSpan: "2000" }),
      expect.objectContaining({ oldSpan: "2000", newSpan: "1000" }),
    ]);

    const batchEvent = parsedLogs.find((payload) => payload.event === "holders.index");
    expect(batchEvent).toMatchObject({
      chainId: 1,
      token: cursor.token.toLowerCase(),
      span: "1000",
    });

    expect(updateTokenCursorMock).toHaveBeenCalledWith(
      expect.anything(),
      1,
      cursor.token.toLowerCase(),
      101_000n,
      100_999n,
    );

    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
