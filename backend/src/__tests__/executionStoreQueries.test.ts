import { beforeEach, describe, expect, it, vi } from "vitest";

const TX_HASH = `0x${"aa".repeat(32)}`;
const BLOCK_HASH = `0x${"bb".repeat(32)}`;
const FROM_ADDRESS = `0x${"11".repeat(20)}`;
const TO_ADDRESS = `0x${"22".repeat(20)}`;
const LOG_ADDRESS = `0x${"33".repeat(20)}`;
const TOKEN_ADDRESS = `0x${"44".repeat(20)}`;
const TOPIC0 = `0x${"55".repeat(32)}`;
const ADDRESS_UNDER_TEST = `0x${"66".repeat(20)}`;

function bufferFromHex(hex: string): Buffer {
  return Buffer.from(hex.slice(2), "hex");
}

describe("executionStore query helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns transaction details with logs and token transfers", async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            hash: bufferFromHex(TX_HASH),
            blockNumber: "123456",
            fromAddress: bufferFromHex(FROM_ADDRESS),
            toAddress: bufferFromHex(TO_ADDRESS),
            value: "1000",
            nonce: "1",
            gas: "21000",
            gasPrice: "1000000000",
            inputData: Buffer.alloc(0),
            status: true,
            gasUsed: "21000",
            effectiveGasPrice: "1000000000",
            contractAddress: null,
            blockTimestamp: new Date("2024-01-01T00:00:00Z"),
            blockHash: bufferFromHex(BLOCK_HASH),
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            logIndex: 0,
            address: bufferFromHex(LOG_ADDRESS),
            topic0: bufferFromHex(TOPIC0),
            topic1: null,
            topic2: null,
            topic3: null,
            data: Buffer.from("ff", "hex"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            logIndex: 0,
            token: bufferFromHex(TOKEN_ADDRESS),
            fromAddress: bufferFromHex(FROM_ADDRESS),
            toAddress: bufferFromHex(TO_ADDRESS),
            value: "500",
          },
        ],
      });

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getTransactionDetails } = await import("../services/executionStore");

    const details = await getTransactionDetails(1, TX_HASH);

    expect(details).not.toBeNull();
    expect(details).toEqual({
      chainId: 1,
      hash: TX_HASH,
      blockNumber: "123456",
      blockHash: BLOCK_HASH,
      timestamp: "2024-01-01T00:00:00.000Z",
      from: FROM_ADDRESS,
      to: TO_ADDRESS,
      value: "1000",
      nonce: "1",
      gas: "21000",
      gasPrice: "1000000000",
      input: "0x",
      methodSignature: null,
      methodSelector: null,
      status: true,
      gasUsed: "21000",
      effectiveGasPrice: "1000000000",
      contractAddress: null,
      logs: [
        {
          index: 0,
          address: LOG_ADDRESS,
          topics: [TOPIC0, null, null, null],
          data: "0xff",
        },
      ],
      tokenTransfers: [
        {
          logIndex: 0,
          token: TOKEN_ADDRESS,
          from: FROM_ADDRESS,
          to: TO_ADDRESS,
          value: "500",
        },
      ],
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it("returns null when transaction is missing", async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] });

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getTransactionDetails } = await import("../services/executionStore");

    const details = await getTransactionDetails(1, TX_HASH);

    expect(details).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("decodes well-known transaction selectors", async () => {
    const inputSelector = "a9059cbb";
    const callData = Buffer.from(`${inputSelector}${"0".repeat(64)}${"0".repeat(64)}`, "hex");

    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            hash: bufferFromHex(TX_HASH),
            blockNumber: "1",
            fromAddress: bufferFromHex(FROM_ADDRESS),
            toAddress: bufferFromHex(TO_ADDRESS),
            value: "0",
            nonce: "0",
            gas: "21000",
            gasPrice: "1000000000",
            inputData: callData,
            status: true,
            gasUsed: "21000",
            effectiveGasPrice: "1000000000",
            contractAddress: null,
            blockTimestamp: null,
            blockHash: bufferFromHex(BLOCK_HASH),
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getTransactionDetails } = await import("../services/executionStore");

    const details = await getTransactionDetails(1, TX_HASH);

    expect(details).toBeDefined();
    expect(details?.input?.startsWith("0xa9059cbb")).toBe(true);
    expect(details?.methodSelector).toBe("0xa9059cbb");
    expect(details?.methodSignature).toBe("transfer(address,uint256)");
  });

  it("throws on invalid transaction hash", async () => {
    const queryMock = vi.fn();

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getTransactionDetails, InvalidTransactionHashError } = await import(
      "../services/executionStore"
    );

    await expect(getTransactionDetails(1, "0x1234")).rejects.toBeInstanceOf(
      InvalidTransactionHashError,
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns address activity with cursor pagination", async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        {
          txHash: bufferFromHex(TX_HASH),
          logIndex: 7,
          blockNumber: "300",
          timestamp: new Date("2024-02-01T10:00:00Z"),
          token: bufferFromHex(TOKEN_ADDRESS),
          fromAddress: bufferFromHex(FROM_ADDRESS),
          toAddress: bufferFromHex(ADDRESS_UNDER_TEST),
          value: "750",
          txFrom: bufferFromHex(FROM_ADDRESS),
          txTo: bufferFromHex(ADDRESS_UNDER_TEST),
          txValue: "900",
          txStatus: true,
        },
        {
          txHash: bufferFromHex(`0x${"77".repeat(32)}`),
          logIndex: 4,
          blockNumber: "299",
          timestamp: new Date("2024-02-01T09:00:00Z"),
          token: bufferFromHex(TOKEN_ADDRESS),
          fromAddress: bufferFromHex(ADDRESS_UNDER_TEST),
          toAddress: bufferFromHex(TO_ADDRESS),
          value: "125",
          txFrom: bufferFromHex(ADDRESS_UNDER_TEST),
          txTo: bufferFromHex(TO_ADDRESS),
          txValue: "250",
          txStatus: false,
        },
      ],
    });

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getAddressActivity } = await import("../services/executionStore");

    const response = await getAddressActivity({
      chainId: 1,
      address: ADDRESS_UNDER_TEST,
      limit: 2,
      cursor: null,
    });

    expect(response.items).toHaveLength(2);
    expect(response.items[0]).toEqual({
      txHash: TX_HASH,
      logIndex: 7,
      blockNumber: "300",
      timestamp: "2024-02-01T10:00:00.000Z",
      token: TOKEN_ADDRESS,
      from: FROM_ADDRESS,
      to: ADDRESS_UNDER_TEST,
      value: "750",
      direction: "in",
    });
    expect(response.items[1]).toEqual({
      txHash: `0x${"77".repeat(32)}`,
      logIndex: 4,
      blockNumber: "299",
      timestamp: "2024-02-01T09:00:00.000Z",
      token: TOKEN_ADDRESS,
      from: ADDRESS_UNDER_TEST,
      to: TO_ADDRESS,
      value: "125",
      direction: "out",
    });
    expect(response.transactions).toEqual([
      {
        hash: TX_HASH,
        blockNumber: "300",
        timestamp: "2024-02-01T10:00:00.000Z",
        from: FROM_ADDRESS,
        to: ADDRESS_UNDER_TEST,
        value: "900",
        status: true,
        tokenTransfers: [response.items[0]],
      },
      {
        hash: `0x${"77".repeat(32)}`,
        blockNumber: "299",
        timestamp: "2024-02-01T09:00:00.000Z",
        from: ADDRESS_UNDER_TEST,
        to: TO_ADDRESS,
        value: "250",
        status: false,
        tokenTransfers: [response.items[1]],
      },
    ]);
    expect(response.nextCursor).toBe("299:4");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid address input", async () => {
    const queryMock = vi.fn();

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    const { getAddressActivity } = await import("../services/executionStore");

    await expect(
      getAddressActivity({ chainId: 1, address: "0x1234", cursor: null, limit: 10 }),
    ).rejects.toThrow(/invalid address/i);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
