import { beforeEach, describe, expect, it, vi } from "vitest";

interface HolderEntry {
  chainId: number;
  token: string;
  holder: string;
  balance: bigint;
}

interface CursorEntry {
  chainId: number;
  token: string;
  fromBlock: string | null;
  toBlock: string | null;
}

class MockPool {
  private cursor: CursorEntry | null = null;
  private holders: HolderEntry[] = [];
  queries: string[] = [];

  reset() {
    this.cursor = null;
    this.holders = [];
    this.queries = [];
  }

  setCursor(entry: CursorEntry) {
    this.cursor = {
      chainId: entry.chainId,
      token: normalize(entry.token),
      fromBlock: entry.fromBlock,
      toBlock: entry.toBlock,
    };
  }

  setHolders(entries: Array<Omit<HolderEntry, "balance"> & { balance: number | bigint | string }>) {
    this.holders = entries.map((entry) => ({
      chainId: entry.chainId,
      token: normalize(entry.token),
      holder: normalize(entry.holder),
      balance: BigInt(entry.balance),
    }));
  }

  async query(text: string, params: unknown[]) {
    this.queries.push(text);

    if (text.includes("FROM token_index_cursor")) {
      return this.handleCursorQuery(params);
    }

    if (text.startsWith("SELECT SUM(balance)::TEXT")) {
      return this.handleSumQuery(params);
    }

    if (text.startsWith("SELECT COUNT(*)::TEXT")) {
      return this.handleCountQuery(params);
    }

    if (text.startsWith("SELECT holder, balance::TEXT")) {
      return this.handleHolderQuery(text, params);
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  private handleCursorQuery(params: unknown[]) {
    const chainId = params[0] as number;
    const token = bufferToHex(params[1] as Buffer);

    if (this.cursor && this.cursor.chainId === chainId && this.cursor.token === token) {
      return {
        rowCount: 1,
        rows: [
          {
            chain_id: this.cursor.chainId,
            token: Buffer.from(this.cursor.token.slice(2), "hex"),
            from_block: this.cursor.fromBlock,
            to_block: this.cursor.toBlock,
            updated_at: new Date(),
          },
        ],
      };
    }

    return { rows: [], rowCount: 0 };
  }

  private handleSumQuery(params: unknown[]) {
    const chainId = params[0] as number;
    const token = bufferToHex(params[1] as Buffer);

    const total = this.holders
      .filter((entry) => entry.chainId === chainId && entry.token === token)
      .reduce((acc, entry) => acc + entry.balance, 0n);

    return {
      rowCount: 1,
      rows: [
        {
          sum: total === 0n ? null : total.toString(),
        },
      ],
    };
  }

  private handleCountQuery(params: unknown[]) {
    const chainId = params[0] as number;
    const token = bufferToHex(params[1] as Buffer);
    const balanceCursor = BigInt(params[2] as string);
    const holderCursor = bufferToHex(params[3] as Buffer);

    const count = this.holders.filter((entry) => {
      if (entry.chainId !== chainId || entry.token !== token) {
        return false;
      }

      if (entry.balance > balanceCursor) {
        return true;
      }

      if (entry.balance === balanceCursor) {
        return entry.holder < holderCursor;
      }

      return false;
    }).length;

    return {
      rowCount: 1,
      rows: [
        {
          count: count.toString(),
        },
      ],
    };
  }

  private handleHolderQuery(text: string, params: unknown[]) {
    const chainId = params[0] as number;
    const token = bufferToHex(params[1] as Buffer);
    const limit = params[2] as number;
    const hasCursor = text.includes("balance < $4");

    let filtered = this.holders.filter(
      (entry) => entry.chainId === chainId && entry.token === token,
    );

    if (hasCursor) {
      const balanceCursor = BigInt(params[3] as string);
      const holderCursor = bufferToHex(params[4] as Buffer);
      filtered = filtered.filter((entry) => {
        if (entry.balance < balanceCursor) {
          return true;
        }

        if (entry.balance === balanceCursor) {
          return entry.holder > holderCursor;
        }

        return false;
      });
    }

    filtered.sort((a, b) => {
      if (a.balance !== b.balance) {
        return b.balance > a.balance ? 1 : -1;
      }
      return a.holder.localeCompare(b.holder);
    });

    const rows = filtered.slice(0, limit).map((entry) => ({
      holder: Buffer.from(entry.holder.slice(2), "hex"),
      balance: entry.balance.toString(),
    }));

    return { rows, rowCount: rows.length };
  }
}

function normalize(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "")}`;
}

function bufferToHex(buffer: Buffer): string {
  return `0x${buffer.toString("hex")}`;
}

describe("getTokenHolders", () => {
  const mockPool = new MockPool();
  let redisClientMock: null | { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let getRedisClientMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockPool.reset();
    mockPool.queries = [];

    redisClientMock = null;
    getRedisClientMock = vi.fn(() => Promise.resolve(redisClientMock));

    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.ADMIN_PASSWORD = "password";
    process.env.JWT_SECRET = "secret";

    vi.doMock("../lib/db", () => ({
      getPool: () => mockPool,
    }));

    vi.doMock("../lib/redisClient", () => ({
      getRedisClient: getRedisClientMock,
    }));
  });

  it("returns indexing status before any cursor is present", async () => {
    const { getTokenHolders } = await import("../services/tokenService");

    const result = await getTokenHolders({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000abc",
      cursor: null,
      limit: 5,
    });

    expect(result.status).toBe("indexing");
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns holders ordered by balance and paginates with cursor", async () => {
    mockPool.setCursor({
      chainId: 1,
      token: "0x0000000000000000000000000000000000000abc",
      fromBlock: "101",
      toBlock: "200",
    });

    mockPool.setHolders([
      {
        chainId: 1,
        token: "0x0000000000000000000000000000000000000abc",
        holder: "0x0000000000000000000000000000000000000011",
        balance: "500",
      },
      {
        chainId: 1,
        token: "0x0000000000000000000000000000000000000abc",
        holder: "0x0000000000000000000000000000000000000022",
        balance: "750",
      },
      {
        chainId: 1,
        token: "0x0000000000000000000000000000000000000abc",
        holder: "0x0000000000000000000000000000000000000033",
        balance: "250",
      },
    ]);

    const { getTokenHolders } = await import("../services/tokenService");

    const first = await getTokenHolders({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000abc",
      cursor: null,
      limit: 2,
    });

    expect(first.status).toBe("ok");
    expect(first.items.map((item) => item.holder)).toEqual([
      "0x0000000000000000000000000000000000000022",
      "0x0000000000000000000000000000000000000011",
    ]);
    expect(first.nextCursor).toBeDefined();

    const second = await getTokenHolders({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000abc",
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.holder).toBe("0x0000000000000000000000000000000000000033");
    expect(second.status).toBe("ok");
    expect(second.nextCursor).toBeUndefined();
  });

  it("rejects unsupported chains", async () => {
    const { getTokenHolders, UnsupportedChainError } = await import("../services/tokenService");

    await expect(
      getTokenHolders({ chainId: 25, address: "0xabc", cursor: null, limit: 10 }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);
  });

  it("uses Redis cache when available", async () => {
    redisClientMock = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
    };
    getRedisClientMock.mockImplementation(() => Promise.resolve(redisClientMock));

    mockPool.setCursor({
      chainId: 1,
      token: "0x0000000000000000000000000000000000000abc",
      fromBlock: "0",
      toBlock: "10",
    });

    mockPool.setHolders([
      {
        chainId: 1,
        token: "0x0000000000000000000000000000000000000abc",
        holder: "0x0000000000000000000000000000000000000011",
        balance: "100",
      },
    ]);

    const { getTokenHolders } = await import("../services/tokenService");
    const querySpy = vi.spyOn(mockPool as unknown as { query: MockPool["query"] }, "query");

    const first = await getTokenHolders({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000abc",
      cursor: null,
      limit: 10,
    });

    expect(redisClientMock?.set).toHaveBeenCalledTimes(1);
    expect(first.items).toHaveLength(1);

    querySpy.mockClear();
    redisClientMock?.get.mockResolvedValueOnce(JSON.stringify(first));

    const second = await getTokenHolders({
      chainId: 1,
      address: "0x0000000000000000000000000000000000000abc",
      cursor: null,
      limit: 10,
    });

    expect(redisClientMock?.get).toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(second).toEqual(first);
  });
});
