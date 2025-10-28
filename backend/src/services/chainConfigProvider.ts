import { getPool } from "../lib/db";
import type { ChainConfigRecord, ChainEndpointRecord } from "./chainConfigService";
import { fetchChainConfigs, listAllChainEndpoints } from "./chainConfigService";

const CACHE_TTL_MS = 30_000;

let cache: {
  expiresAt: number;
  configs: ChainConfigRecord[];
} | null = null;

let loadingPromise: Promise<ChainConfigRecord[]> | null = null;

async function loadConfigs(): Promise<ChainConfigRecord[]> {
  const pool = getPool();
  const [configs, endpoints] = await Promise.all([
    fetchChainConfigs(pool),
    listAllChainEndpoints({ includeDisabled: false }, pool),
  ]);

  const grouped = groupEndpoints(endpoints);

  return configs.map((config) => ({
    ...config,
    endpoints: grouped.get(config.chainId) ?? [],
  }));
}

async function resolveConfigs(): Promise<ChainConfigRecord[]> {
  const now = Date.now();

  if (cache && cache.expiresAt > now) {
    return cache.configs;
  }

  if (!loadingPromise) {
    loadingPromise = loadConfigs().finally(() => {
      loadingPromise = null;
    });
  }

  const configs = await loadingPromise;
  cache = {
    configs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return configs;
}

export async function getRuntimeChainConfig(chainId: number): Promise<ChainConfigRecord> {
  const configs = await resolveConfigs();
  const match = configs.find((config) => config.chainId === chainId);

  if (match) {
    return match;
  }

  // Fallback: reload single chain without cache to ensure we capture new records immediately.
  const freshConfigs = await loadConfigs();
  cache = {
    configs: freshConfigs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  const freshMatch = freshConfigs.find((config) => config.chainId === chainId);

  if (!freshMatch) {
    throw new Error(`Chain configuration not found for chain ${chainId}`);
  }

  return freshMatch;
}

export async function getRuntimeChainConfigs(): Promise<ChainConfigRecord[]> {
  return resolveConfigs();
}

export function invalidateChainConfigCache(): void {
  cache = null;
}

function groupEndpoints(endpoints: ChainEndpointRecord[]): Map<number, ChainEndpointRecord[]> {
  const map = new Map<number, ChainEndpointRecord[]>();

  for (const endpoint of endpoints) {
    const existing = map.get(endpoint.chainId);

    if (existing) {
      existing.push(endpoint);
    } else {
      map.set(endpoint.chainId, [endpoint]);
    }
  }

  return map;
}
