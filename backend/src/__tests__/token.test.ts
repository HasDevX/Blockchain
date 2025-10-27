import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisStore = new Map<string, string>();
const redisClientMock = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return "OK";
  }),
};
const getRedisClientMock = vi.fn(async () => redisClientMock);

vi.mock("../lib/redisClient", () => ({
  getRedisClient: getRedisClientMock,
}));

describe("getTokenHolders", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    redisStore.clear();
    redisClientMock.get.mockClear();
    redisClientMock.set.mockClear();
    getRedisClientMock.mockClear();

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POLYGONSCAN_API_KEY;
  });

  it("normalizes polygon holders using the etherscan adapter", async () => {
    process.env.POLYGONSCAN_API_KEY = "polygon-test-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "1",
        message: "OK",
        result: [
          {
            TokenHolderAddress: "0xholder1",
            TokenHolderQuantity: "5000",
            TokenHolderRank: "1",
            TokenHolderPercentage: "50.12",
          },
          {
            TokenHolderAddress: "0xholder2",
            TokenHolderQuantity: "4000",
            TokenHolderRank: "2",
            TokenHolderPercentage: "40.01",
          },
        ],
      }),
    } as unknown as Response);

    const { getTokenHolders } = await import("../services/tokenService");

    const result = await getTokenHolders({
      chainId: 137,
      address: "0xABCDEFabcdefabcdefabcdefabcdefabcdefABCD",
      limit: 2,
      cursor: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestUrl.origin + requestUrl.pathname).toBe("https://api.polygonscan.com/api");
    expect(requestUrl.searchParams.get("contractaddress")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
    expect(requestUrl.searchParams.get("page")).toBe("1");
    expect(requestUrl.searchParams.get("offset")).toBe("2");
    expect(requestUrl.searchParams.get("apikey")).toBe("polygon-test-key");

    expect(result.items).toEqual([
      { rank: 1, holder: "0xholder1", balance: "5000", pct: 50.12 },
      { rank: 2, holder: "0xholder2", balance: "4000", pct: 40.01 },
    ]);
    expect(result.nextCursor).toBe("2");
  });

  it("rejects Cronos requests with an UnsupportedChainError", async () => {
    const { getTokenHolders, UnsupportedChainError } = await import("../services/tokenService");

    await expect(
      getTokenHolders({ chainId: 25, address: "0xabc", cursor: null, limit: 10 }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves cached results on subsequent requests", async () => {
    process.env.POLYGONSCAN_API_KEY = "polygon-test-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "1",
        message: "OK",
        result: [
          {
            TokenHolderAddress: "0xholder1",
            TokenHolderQuantity: "5000",
            TokenHolderRank: "1",
            TokenHolderPercentage: "50.12",
          },
        ],
      }),
    } as unknown as Response);

    const { getTokenHolders } = await import("../services/tokenService");

    const first = await getTokenHolders({
      chainId: 137,
      address: "0xabc",
      cursor: null,
      limit: 25,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redisClientMock.set).toHaveBeenCalled();

    fetchMock.mockClear();

    const second = await getTokenHolders({
      chainId: 137,
      address: "0xabc",
      cursor: null,
      limit: 25,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    expect(redisClientMock.get).toHaveBeenCalledTimes(2);
  });
});
