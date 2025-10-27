import { CHAINS, getChainById } from "../config/chains";
import { getChainAdapter, type ChainAdapterConfig } from "../config/chainAdapters";
import { loadEnv } from "../config/env";
import { getRedisClient } from "../lib/redisClient";
import { EtherscanClient } from "../vendors/etherscanClient";

const env = loadEnv();
const etherscanClient = new EtherscanClient(env.etherscanApiKey);

export interface TokenSummary {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  totalSupply: string;
  holdersCount: number;
  supported: boolean;
  explorerUrl: string;
}

export interface TokenHolder {
  rank: number;
  holder: string;
  balance: string;
  pct: number;
}

export interface TokenHoldersResponse {
  items: TokenHolder[];
  nextCursor?: string;
}

export interface GetTokenHoldersParams {
  chainId: number;
  address: string;
  cursor?: string | null;
  limit?: number;
}

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Chain ${chainId} is not supported`);
    this.name = "UnsupportedChainError";
  }
}

const HOLDERS_CACHE_PREFIX = "holders";
const CACHE_TTL_MIN_SECONDS = 30;
const CACHE_TTL_MAX_SECONDS = 60;
const MAX_VENDOR_RETRIES = 2;

const chainRequestQueues = new Map<number, Promise<unknown>>();
const chainNextAllowedAt = new Map<number, number>();

const redisClientPromise: Promise<Awaited<ReturnType<typeof getRedisClient>>> = getRedisClient(env);

type Fetcher<T> = () => Promise<T>;

type RedisClient = Exclude<Awaited<typeof redisClientPromise>, null>;

interface EtherscanTokenHolderDto {
  TokenHolderAddress: string;
  TokenHolderQuantity: string;
  TokenHolderRank?: string;
  TokenHolderPercentage?: string;
}

interface EtherscanTokenHolderResponse {
  status: string;
  message: string;
  result?: EtherscanTokenHolderDto[] | string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampLimit(raw?: number): number {
  if (!Number.isFinite(raw ?? NaN)) {
    return 25;
  }

  const value = Math.floor(raw as number);
  if (value < 1) {
    return 1;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

function parseCursor(raw?: string | null): number {
  if (!raw) {
    return 1;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.floor(parsed);
}

async function resolveRedisClient(): Promise<RedisClient | null> {
  return redisClientPromise;
}

async function withRateBudget<T>(adapter: ChainAdapterConfig, task: Fetcher<T>): Promise<T> {
  const previous = chainRequestQueues.get(adapter.chainId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      await enforceRateBudget(adapter);
      return task();
    });

  chainRequestQueues.set(
    adapter.chainId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function enforceRateBudget(adapter: ChainAdapterConfig) {
  const minIntervalMs = Math.ceil(1000 / adapter.rateBudget.requestsPerSecond);
  const now = Date.now();
  const nextAllowed = chainNextAllowedAt.get(adapter.chainId) ?? now;
  const waitMs = Math.max(0, nextAllowed - now);

  if (waitMs > 0) {
    const jitter = Math.floor(Math.random() * 75);
    const totalWait = waitMs + jitter;
    console.warn(
      JSON.stringify({
        event: "holders.rate_limit.wait",
        chainId: adapter.chainId,
        waitMs,
        jitterMs: jitter,
        vendor: adapter.vendor,
      }),
    );
    await delay(totalWait);
  }

  chainNextAllowedAt.set(adapter.chainId, Date.now() + minIntervalMs);
}

async function fetchWithRetry(
  adapter: ChainAdapterConfig,
  url: URL,
  attempt = 0,
): Promise<Response> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_VENDOR_RETRIES) {
    const backoff = 500 * (attempt + 1) + Math.floor(Math.random() * 300);
    console.warn(
      JSON.stringify({
        event: "holders.vendor.retry",
        chainId: adapter.chainId,
        status: response.status,
        attempt: attempt + 1,
        backoffMs: backoff,
      }),
    );
    await delay(backoff);
    return fetchWithRetry(adapter, url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Vendor request failed with status ${response.status}`);
  }

  return response;
}

function normalizeEtherscanPayload(
  dtoList: EtherscanTokenHolderDto[] | undefined,
  page: number,
  limit: number,
): TokenHoldersResponse {
  if (!Array.isArray(dtoList) || dtoList.length === 0) {
    return { items: [] };
  }

  const baseRank = (page - 1) * limit;
  const items: TokenHolder[] = dtoList.map((dto, index) => {
    const rank = dto.TokenHolderRank ? Number(dto.TokenHolderRank) : baseRank + index + 1;
    const pctValue = dto.TokenHolderPercentage ? Number(dto.TokenHolderPercentage) : 0;

    return {
      rank: Number.isFinite(rank) ? rank : baseRank + index + 1,
      holder: dto.TokenHolderAddress,
      balance: dto.TokenHolderQuantity,
      pct: Number.isFinite(pctValue) ? pctValue : 0,
    };
  });

  return {
    items,
    nextCursor: items.length === limit ? String(page + 1) : undefined,
  };
}

async function requestEtherscanTokenHolders(
  adapter: ChainAdapterConfig,
  address: string,
  page: number,
  limit: number,
): Promise<TokenHoldersResponse> {
  const apiKey = process.env[adapter.apiKeyEnv];
  const url = new URL(adapter.baseUrl);
  const params = new URLSearchParams({
    module: "token",
    action: "tokenholderlist",
    contractaddress: address,
    page: String(page),
    offset: String(limit),
    sort: "desc",
  });

  if (apiKey) {
    params.set("apikey", apiKey);
  }

  url.search = params.toString();

  const response = await fetchWithRetry(adapter, url);
  const body = (await response.json()) as EtherscanTokenHolderResponse;

  if (body.status !== "1" && body.message?.toLowerCase().includes("no tokens found")) {
    return { items: [] };
  }

  if (!Array.isArray(body.result)) {
    if ((body.result as string | undefined)?.toLowerCase().includes("no records")) {
      return { items: [] };
    }

    throw new Error(`Unexpected vendor payload: ${body.message ?? "unknown error"}`);
  }

  return normalizeEtherscanPayload(body.result, page, limit);
}

async function fetchTokenHoldersFromVendor(
  adapter: ChainAdapterConfig,
  address: string,
  page: number,
  limit: number,
): Promise<TokenHoldersResponse> {
  switch (adapter.vendor) {
    case "etherscan":
      return requestEtherscanTokenHolders(adapter, address, page, limit);
    default:
      throw new Error(`Unsupported vendor ${adapter.vendor}`);
  }
}

function buildCacheKey(chainId: number, address: string, cursor: number, limit: number): string {
  return `${HOLDERS_CACHE_PREFIX}:${chainId}:${address}:${cursor}:${limit}`;
}

export async function getTokenSummary(
  chainId: number,
  tokenAddress: string,
): Promise<TokenSummary | null> {
  const chain = getChainById(chainId);

  if (!chain) {
    return null;
  }

  const checksumAddress = tokenAddress.toLowerCase();

  const vendorInfo = await etherscanClient.getTokenInfo(chainId, checksumAddress);

  return {
    chainId,
    address: checksumAddress,
    name: vendorInfo?.name ?? `Sample Token (${chain.shortName})`,
    symbol: vendorInfo?.symbol ?? `${chain.shortName}T`,
    priceUsd: 1.23,
    totalSupply: vendorInfo?.totalSupply ?? "1000000000000000000000000",
    holdersCount: 1284,
    supported: chain.supported,
    explorerUrl: chain.explorerUrl,
  };
}

export async function getTokenHolders({
  chainId,
  address,
  cursor,
  limit,
}: GetTokenHoldersParams): Promise<TokenHoldersResponse> {
  const adapter = getChainAdapter(chainId);

  if (!adapter || !adapter.supported) {
    throw new UnsupportedChainError(chainId);
  }

  const normalizedAddress = address.trim().toLowerCase();
  const normalizedLimit = clampLimit(limit);
  const page = parseCursor(cursor);
  const cacheKey = buildCacheKey(chainId, normalizedAddress, page, normalizedLimit);

  const redis = await resolveRedisClient();

  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as TokenHoldersResponse;
    }
  }

  const result = await withRateBudget(adapter, () =>
    fetchTokenHoldersFromVendor(adapter, normalizedAddress, page, normalizedLimit),
  );

  if (redis) {
    const ttl =
      CACHE_TTL_MIN_SECONDS +
      Math.floor(Math.random() * (CACHE_TTL_MAX_SECONDS - CACHE_TTL_MIN_SECONDS + 1));
    await redis.set(cacheKey, JSON.stringify(result), { EX: ttl });
  }

  return result;
}

export function listChains() {
  return CHAINS;
}
