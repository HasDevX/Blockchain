import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainConfigRecord, ChainEndpointRecord } from "../services/chainConfigService";

const fetchChainConfigsMock = vi.fn<[], Promise<ChainConfigRecord[]>>();
const listAllChainEndpointsMock = vi.fn<[], Promise<ChainEndpointRecord[]>>();
const getPoolMock = vi.fn();
let providerModule: typeof import("../services/chainConfigProvider");

vi.mock("../lib/db", () => ({
  getPool: getPoolMock,
}));

vi.mock("../services/chainConfigService", () => ({
  fetchChainConfigs: fetchChainConfigsMock,
  listAllChainEndpoints: listAllChainEndpointsMock,
}));

describe("chainConfigProvider", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    fetchChainConfigsMock.mockReset();
    listAllChainEndpointsMock.mockReset();
    getPoolMock.mockReturnValue({});
    providerModule = await import("../services/chainConfigProvider");
    providerModule.invalidateChainConfigCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches chain configs for repeated requests and respects invalidation", async () => {
    const { getRuntimeChainConfig, invalidateChainConfigCache } = providerModule;

    const sampleRecord: ChainConfigRecord = {
      chainId: 1,
      name: "Ethereum",
      enabled: true,
      rpcUrl: "https://rpc.test",
      rpcSource: "env",
      etherscanApiKey: null,
      etherscanSource: "env",
      startBlock: null,
      qps: 5,
      minSpan: 100,
      maxSpan: 2_000,
      updatedAt: new Date(),
      endpoints: [],
    };

    fetchChainConfigsMock.mockResolvedValue([sampleRecord]);
    listAllChainEndpointsMock.mockResolvedValue([]);

    const first = await getRuntimeChainConfig(1);
    expect(first).toEqual(sampleRecord);
    expect(fetchChainConfigsMock).toHaveBeenCalledTimes(1);

    const second = await getRuntimeChainConfig(1);
    expect(second).toEqual(sampleRecord);
    expect(fetchChainConfigsMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);

    const third = await getRuntimeChainConfig(1);
    expect(third).toEqual(sampleRecord);
    expect(fetchChainConfigsMock).toHaveBeenCalledTimes(2);

    invalidateChainConfigCache();

    const fourth = await getRuntimeChainConfig(1);
    expect(fourth).toEqual(sampleRecord);
    expect(fetchChainConfigsMock).toHaveBeenCalledTimes(3);
  });
});
