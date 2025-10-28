import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_ADDRESS = `0x${"99".repeat(20)}`;

beforeEach(() => {
  vi.resetModules();
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "password";
  process.env.JWT_SECRET = "secret";
});

describe("token chain coverage", () => {
  it("merges cursor and transfer data across chains", async () => {
    const cursorTimestamp = new Date("2024-03-01T00:00:00Z");
    const indexingTimestamp = new Date("2024-03-02T00:00:00Z");
    const lastTransferOne = new Date("2024-03-03T00:00:00Z");
    const lastTransferTwo = new Date("2024-03-04T00:00:00Z");

    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          {
            chain_id: 1,
            from_block: "1000",
            to_block: "2000",
            updated_at: cursorTimestamp,
          },
          {
            chain_id: 137,
            from_block: null,
            to_block: null,
            updated_at: indexingTimestamp,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            chain_id: 1,
            transfers: "5",
            last_block: "2000",
            last_timestamp: lastTransferOne,
          },
          {
            chain_id: 8453,
            transfers: "3",
            last_block: "1500",
            last_timestamp: lastTransferTwo,
          },
        ],
      });

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    vi.doMock("../lib/redisClient", () => ({
      getRedisClient: vi.fn().mockResolvedValue(null),
    }));

    const { getTokenChainCoverage } = await import("../services/tokenService");

    const coverage = await getTokenChainCoverage(TOKEN_ADDRESS);

    expect(coverage).toEqual([
      {
        chainId: 1,
        supported: true,
        status: "ok",
        fromBlock: "1000",
        toBlock: "2000",
        updatedAt: cursorTimestamp.toISOString(),
        lastTransferBlock: "2000",
        lastTransferAt: lastTransferOne.toISOString(),
        transferCount: 5,
      },
      {
        chainId: 137,
        supported: true,
        status: "indexing",
        fromBlock: null,
        toBlock: null,
        updatedAt: indexingTimestamp.toISOString(),
        lastTransferBlock: null,
        lastTransferAt: null,
        transferCount: 0,
      },
      {
        chainId: 8453,
        supported: true,
        status: "indexing",
        fromBlock: null,
        toBlock: null,
        updatedAt: null,
        lastTransferBlock: "1500",
        lastTransferAt: lastTransferTwo.toISOString(),
        transferCount: 3,
      },
    ]);

    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid token addresses", async () => {
    const queryMock = vi.fn();

    vi.doMock("../lib/db", () => ({
      getPool: () => ({ query: queryMock }),
      withTransaction: vi.fn(),
    }));

    vi.doMock("../lib/redisClient", () => ({
      getRedisClient: vi.fn().mockResolvedValue(null),
    }));

    const { getTokenChainCoverage } = await import("../services/tokenService");

    await expect(getTokenChainCoverage("0x1234")).rejects.toThrow(/invalid address/i);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
