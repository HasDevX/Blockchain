import { CHAINS, getChainById } from "../config/chains";
import { getChainAdapter, type ChainAdapterConfig } from "../config/chainAdapters";
import { loadEnv } from "../config/env";
import { getRedisClient } from "../lib/redisClient";
import { EtherscanClient } from "../vendors/etherscanClient";
import {
  EtherscanUpstreamError,
  EtherscanV2Client,
  type EtherscanTokenHolderData,
  type EtherscanTokenHolderDto,
  type EtherscanVendorResult,
} from "../vendors/etherscanV2";

const env = loadEnv();
const etherscanClient = new EtherscanClient(env.etherscanApiKey);
const etherscanV2Client = new EtherscanV2Client();

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
const chainRequestQueues = new Map<number, Promise<unknown>>();
const chainNextAllowedAt = new Map<number, number>();

const redisClientPromise: Promise<Awaited<ReturnType<typeof getRedisClient>>> = getRedisClient(env);

type Fetcher<T> = () => Promise<T>;

type RedisClient = Exclude<Awaited<typeof redisClientPromise>, null>;

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

async function fetchTokenHoldersFromVendor(
  adapter: ChainAdapterConfig,
  address: string,
  page: number,
  limit: number,
): Promise<TokenHoldersResponse> {
  switch (adapter.vendor) {
    case "etherscan": {
      const vendorResult = await etherscanV2Client.getTokenHolders(
        adapter.chainId,
        address,
        page,
        limit,
      );

      return transformEtherscanResponse(vendorResult, adapter.chainId, page, limit);
    }
    default:
      throw new Error(`Unsupported vendor ${adapter.vendor}`);
  }
}

function extractHolderList(result: EtherscanVendorResult): EtherscanTokenHolderDto[] | undefined {
  if (Array.isArray(result.payload.result)) {
    return result.payload.result;
  }

  const data = result.payload.data;

  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items as EtherscanTokenHolderDto[];
    }

    const nestedResult = (data as { result?: unknown }).result;
    if (Array.isArray(nestedResult)) {
      return nestedResult as EtherscanTokenHolderDto[];
    }
  }

  return undefined;
}

function isNoRecordsMessage(message?: string) {
  const lower = message?.toLowerCase() ?? "";
  return lower.includes("no tokens") || lower.includes("no records") || lower.includes("no data");
}

function transformEtherscanResponse(
  vendorResult: EtherscanVendorResult,
  chainId: number,
  page: number,
  limit: number,
): TokenHoldersResponse {
  const vendorStatus = vendorResult.payload.status;
  const vendorMessage = vendorResult.payload.message;
  const fallbackResultMessage =
    typeof vendorResult.payload.result === "string" ? vendorResult.payload.result : undefined;

  const holderList = extractHolderList(vendorResult);

  if (holderList) {
    const normalized = normalizeEtherscanPayload(holderList, page, limit);
    const vendorCursor = extractNextCursorFromData(
      vendorResult.payload.data,
      page,
      limit,
      normalized.items.length,
    );

    return {
      items: normalized.items,
      nextCursor: vendorCursor ?? normalized.nextCursor,
    };
  }

  if (isNoRecordsMessage(vendorMessage) || isNoRecordsMessage(fallbackResultMessage)) {
    return { items: [] };
  }

  if (
    isInvalidApiKeyMessage(vendorMessage) ||
    isInvalidApiKeyMessage(fallbackResultMessage) ||
    isDeprecatedMessage(vendorMessage) ||
    isDeprecatedMessage(fallbackResultMessage) ||
    (vendorStatus && vendorStatus !== "1")
  ) {
    throw new EtherscanUpstreamError({
      chainId,
      host: vendorResult.host,
      httpStatus: vendorResult.httpStatus,
      vendorStatus,
      vendorMessage: vendorMessage ?? fallbackResultMessage ?? "unknown vendor error",
    });
  }

  throw new EtherscanUpstreamError({
    chainId,
    host: vendorResult.host,
    httpStatus: vendorResult.httpStatus,
    vendorStatus,
    vendorMessage: vendorMessage ?? fallbackResultMessage ?? "unknown vendor error",
  });
}

function extractNextCursorFromData(
  data: EtherscanTokenHolderData | undefined,
  currentPage: number,
  limit: number,
  itemCount: number,
): string | undefined {
  if (!data) {
    return itemCount === limit ? String(currentPage + 1) : undefined;
  }

  const directCursor =
    asString(data.cursor) ??
    asString(data.nextPageToken) ??
    asString(data.next_page_token) ??
    asString((data as Record<string, unknown>).nextCursor);

  if (directCursor) {
    return directCursor;
  }

  const pagination = (data as Record<string, unknown>).pagination;
  if (pagination && typeof pagination === "object") {
    const paginationCursor =
      asString((pagination as Record<string, unknown>).cursor) ??
      asString((pagination as Record<string, unknown>).nextCursor) ??
      asString((pagination as Record<string, unknown>).nextPageToken) ??
      asString((pagination as Record<string, unknown>).next_page_token);

    if (paginationCursor) {
      return paginationCursor;
    }

    const paginationHasMore = asBoolean(
      (pagination as Record<string, unknown>).hasMore ??
        (pagination as Record<string, unknown>).has_more,
    );
    const paginationPage = asNumber(
      (pagination as Record<string, unknown>).page ??
        (pagination as Record<string, unknown>).currentPage ??
        (pagination as Record<string, unknown>).current_page,
    );

    if (paginationHasMore === true && typeof paginationPage === "number") {
      return String(paginationPage + 1);
    }
  }

  const hasMore =
    asBoolean(data.hasMore) ??
    asBoolean(data.has_more) ??
    asBoolean((data as Record<string, unknown>).more);

  const pageValue = asNumber(data.page ?? data.currentPage ?? data.current_page);
  const totalPages = asNumber(data.totalPages ?? data.total_pages);

  if (hasMore === true && typeof pageValue === "number") {
    return String(pageValue + 1);
  }

  if (typeof pageValue === "number" && typeof totalPages === "number" && totalPages > pageValue) {
    return String(pageValue + 1);
  }

  return itemCount === limit ? String(currentPage + 1) : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
  }

  return undefined;
}

function isInvalidApiKeyMessage(message?: string) {
  const lower = message?.toLowerCase() ?? "";
  return lower.includes("invalid api key");
}

function isDeprecatedMessage(message?: string) {
  const lower = message?.toLowerCase() ?? "";
  return lower.includes("deprecated") || lower.includes("v1");
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

export { EtherscanUpstreamError } from "../vendors/etherscanV2";
