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
    delete process.env.ETHERSCAN_API_KEY;
  });

  it("normalizes polygon holders using the etherscan adapter", async () => {
    process.env.ETHERSCAN_API_KEY = "shared-key";
    process.env.POLYGONSCAN_API_KEY = "polygon-override";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
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
    const [urlArg, optionsArg] = fetchMock.mock.calls[0] ?? [];
    const requestUrl = new URL(urlArg as string);
    const headers = (optionsArg as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;

    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://api.polygonscan.com/api/v2/token/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/holders",
    );
    expect(requestUrl.searchParams.get("chainId")).toBe("137");
    expect(requestUrl.searchParams.get("page")).toBe("1");
    expect(requestUrl.searchParams.get("pageSize")).toBe("2");
    expect(requestUrl.searchParams.get("sort")).toBe("desc");
    expect(requestUrl.searchParams.has("apikey")).toBe(false);
    expect(headers).toMatchObject({
      Accept: "application/json",
      "X-API-Key": "polygon-override",
    });

    expect(result.items).toEqual([
      { rank: 1, holder: "0xholder1", balance: "5000", pct: 50.12 },
      { rank: 2, holder: "0xholder2", balance: "4000", pct: 40.01 },
    ]);
    expect(result.nextCursor).toBe("2");
  });

  it("falls back to shared etherscan key when no override exists", async () => {
    process.env.ETHERSCAN_API_KEY = "shared-only-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: "1",
        message: "OK",
        result: [
          {
            TokenHolderAddress: "0xholder",
            TokenHolderQuantity: "123",
          },
        ],
      }),
    } as unknown as Response);

    const { getTokenHolders } = await import("../services/tokenService");

    await getTokenHolders({
      chainId: 1,
      address: "0x123",
      cursor: null,
      limit: 25,
    });

    const [, optionsArg] = fetchMock.mock.calls[0] ?? [];
    const headers = (optionsArg as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;

    expect(headers).toMatchObject({ "X-API-Key": "shared-only-key" });
  });

  it("normalizes v2-style holder payloads from data.items", async () => {
    process.env.ETHERSCAN_API_KEY = "shared-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: "1",
        message: "OK",
        data: {
          items: [
            {
              TokenHolderAddress: "0xholder1",
              TokenHolderQuantity: "999",
              TokenHolderPercentage: "12.5",
            },
            {
              TokenHolderAddress: "0xholder2",
              TokenHolderQuantity: "500",
            },
          ],
          nextPageToken: "cursor-2",
        },
      }),
    } as unknown as Response);

    const { getTokenHolders } = await import("../services/tokenService");

    const result = await getTokenHolders({
      chainId: 1,
      address: "0xabc",
      cursor: null,
      limit: 25,
    });

    expect(result.items).toEqual([
      { rank: 1, holder: "0xholder1", balance: "999", pct: 12.5 },
      { rank: 2, holder: "0xholder2", balance: "500", pct: 0 },
    ]);
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("returns empty items when vendor reports no data", async () => {
    process.env.ETHERSCAN_API_KEY = "shared-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: "0",
        message: "No data found",
      }),
    } as unknown as Response);

    const { getTokenHolders } = await import("../services/tokenService");

    const result = await getTokenHolders({
      chainId: 1,
      address: "0xabc",
      cursor: null,
      limit: 10,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it("rejects Cronos requests with an UnsupportedChainError", async () => {
    const { getTokenHolders, UnsupportedChainError } = await import("../services/tokenService");

    await expect(
      getTokenHolders({ chainId: 25, address: "0xabc", cursor: null, limit: 10 }),
    ).rejects.toBeInstanceOf(UnsupportedChainError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves cached results on subsequent requests", async () => {
    process.env.ETHERSCAN_API_KEY = "shared-key";

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
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
