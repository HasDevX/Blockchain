import { getChainAdapter } from "../config/chainAdapters";

const CHAIN_HOSTS: Record<number, string> = {
  1: "api.etherscan.io",
  10: "api-optimistic.etherscan.io",
  56: "api.bscscan.com",
  137: "api.polygonscan.com",
  42161: "api.arbiscan.io",
  43114: "api.snowtrace.io",
  8453: "api.basescan.org",
  324: "api.zksync.io",
  5000: "api.mantlescan.xyz",
};

const MAX_RETRIES = 2;
const DEFAULT_RETRY_AFTER_SECONDS = 1;

interface HoldersRequestStrategy {
  path: string;
  limitParams: string[];
}

const HOLDER_PATH_STRATEGIES: readonly HoldersRequestStrategy[] = [
  {
    path: "/api/v2/token/holders",
    limitParams: ["pagesize", "pageSize", "limit"],
  },
  {
    path: "/api/v2/token/holderlist",
    limitParams: ["pagesize", "pageSize", "offset", "limit"],
  },
];

export interface EtherscanTokenHolderDto {
  TokenHolderAddress: string;
  TokenHolderQuantity: string;
  TokenHolderRank?: string;
  TokenHolderPercentage?: string;
}

export interface EtherscanTokenHolderData {
  items?: EtherscanTokenHolderDto[];
  result?: EtherscanTokenHolderDto[];
  cursor?: string;
  nextPageToken?: string;
  next_page_token?: string;
  page?: number | string;
  currentPage?: number | string;
  current_page?: number | string;
  hasMore?: boolean;
  has_more?: boolean;
  totalPages?: number | string;
  total_pages?: number | string;
  [key: string]: unknown;
}

export interface EtherscanTokenHolderResponse {
  status?: string;
  message?: string;
  result?: EtherscanTokenHolderDto[] | string;
  data?: EtherscanTokenHolderData;
}

export interface EtherscanVendorResult {
  host: string;
  httpStatus: number;
  payload: EtherscanTokenHolderResponse;
}

export class EtherscanUpstreamError extends Error {
  readonly chainId: number;
  readonly host: string;
  readonly httpStatus: number;
  readonly vendorStatus?: string;
  readonly vendorMessage?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    chainId: number;
    host: string;
    httpStatus: number;
    vendorStatus?: string;
    vendorMessage?: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(
      `Etherscan upstream error (chain ${params.chainId}, status ${params.httpStatus}): ${
        params.vendorMessage ?? "unknown"
      }`,
    );
    this.name = "EtherscanUpstreamError";
    this.chainId = params.chainId;
    this.host = params.host;
    this.httpStatus = params.httpStatus;
    this.vendorStatus = params.vendorStatus;
    this.vendorMessage = params.vendorMessage;
    this.retryAfterSeconds = params.retryAfterSeconds;
    if (params.cause !== undefined) {
      // @ts-expect-error cause is available in newer runtimes; ignore if unsupported
      this.cause = params.cause;
    }
  }
}

export function getHostForChain(chainId: number): string {
  const host = CHAIN_HOSTS[chainId];

  if (!host) {
    throw new Error(`Etherscan host not configured for chain ${chainId}`);
  }

  return host;
}

export function getApiKeyForChain(chainId: number): string | undefined {
  const adapter = getChainAdapter(chainId);

  if (adapter) {
    const override = process.env[adapter.apiKeyEnv];
    if (override) {
      return override;
    }
  }

  return process.env.ETHERSCAN_API_KEY;
}

interface BuildHoldersRequestParams {
  chainId: number;
  address: string;
  page: number;
  pageSize: number;
  sort: "asc" | "desc";
}

interface HoldersRequest {
  host: string;
  path: string;
  query: string;
}

export function buildHoldersRequests({
  chainId,
  address,
  page,
  pageSize,
  sort,
}: BuildHoldersRequestParams): HoldersRequest[] {
  const host = getHostForChain(chainId);
  const lowercasedAddress = address.toLowerCase();
  const baseParams: Record<string, string> = {
    contractaddress: lowercasedAddress,
    page: String(page),
    sort,
  };

  return HOLDER_PATH_STRATEGIES.map((strategy) => {
    const params = new URLSearchParams(baseParams);
    for (const limitParam of strategy.limitParams) {
      params.set(limitParam, String(pageSize));
    }

    return {
      host,
      path: strategy.path,
      query: params.toString(),
    };
  });
}

export function buildHoldersRequest(params: BuildHoldersRequestParams): HoldersRequest {
  const [first] = buildHoldersRequests(params);

  if (!first) {
    throw new Error("No holders request strategies configured");
  }

  return first;
}

async function fetchWithRetry(
  chainId: number,
  url: URL,
  headers: Record<string, string>,
  attempt = 0,
): Promise<Response> {
  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
  });

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    const backoff = 500 * (attempt + 1) + Math.floor(Math.random() * 300);
    console.warn(
      JSON.stringify({
        event: "holders.vendor.retry",
        chainId,
        status: response.status,
        attempt: attempt + 1,
        backoffMs: backoff,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, backoff));
    return fetchWithRetry(chainId, url, headers, attempt + 1);
  }

  return response;
}

export class EtherscanV2Client {
  async getTokenHolders(
    chainId: number,
    address: string,
    page: number,
    limit: number,
  ): Promise<EtherscanVendorResult> {
    const requests = buildHoldersRequests({
      chainId,
      address,
      page,
      pageSize: limit,
      sort: "desc",
    });
    const apiKey = getApiKeyForChain(chainId);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    let lastNotFoundError: EtherscanUpstreamError | undefined;

    for (const [index, request] of requests.entries()) {
      try {
        return await this.executeTokenHoldersRequest(chainId, request, headers);
      } catch (error) {
        if (error instanceof EtherscanUpstreamError && error.httpStatus === 404) {
          lastNotFoundError = error;
          console.warn(
            JSON.stringify({
              event: "holders.vendor.fallback",
              chainId,
              host: request.host,
              path: `${request.path}?${request.query}`,
              attempt: index + 1,
              totalStrategies: requests.length,
            }),
          );
          continue;
        }

        throw error;
      }
    }

    if (lastNotFoundError) {
      throw lastNotFoundError;
    }

    const fallbackHost = requests[0]?.host ?? getHostForChain(chainId);
    throw new EtherscanUpstreamError({
      chainId,
      host: fallbackHost,
      httpStatus: 404,
      vendorMessage: "not_found",
    });
  }

  private async executeTokenHoldersRequest(
    chainId: number,
    request: HoldersRequest,
    headers: Record<string, string>,
  ): Promise<EtherscanVendorResult> {
    const requestUrl = new URL(`https://${request.host}${request.path}`);
    requestUrl.search = request.query;

    console.debug(
      JSON.stringify({
        event: "holders.vendor.request",
        host: request.host,
        path: `${request.path}?${request.query}`,
        chainId,
      }),
    );

    let response: Response;

    try {
      response = await fetchWithRetry(chainId, requestUrl, headers);
    } catch (error) {
      throw new EtherscanUpstreamError({
        chainId,
        host: request.host,
        httpStatus: 0,
        vendorMessage: (error as Error)?.message ?? "request failed",
        cause: error,
      });
    }

    let payload: EtherscanTokenHolderResponse | undefined;

    try {
      payload = (await response.json()) as EtherscanTokenHolderResponse;
    } catch (error) {
      if (response.ok) {
        throw new EtherscanUpstreamError({
          chainId,
          host: request.host,
          httpStatus: response.status,
          vendorMessage: "invalid_json",
          cause: error,
        });
      }
    }

    const vendorStatus = payload?.status;
    const vendorMessage = extractVendorMessage(payload);
    const retryAfterHeader = getRetryAfterHeaderValue(response.headers);

    if (response.status === 404) {
      throw new EtherscanUpstreamError({
        chainId,
        host: request.host,
        httpStatus: 404,
        vendorStatus,
        vendorMessage: vendorMessage ?? "not_found",
      });
    }

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterHeader(retryAfterHeader);
      throw new EtherscanUpstreamError({
        chainId,
        host: request.host,
        httpStatus: 429,
        vendorStatus,
        vendorMessage: vendorMessage ?? "rate_limited",
        retryAfterSeconds,
      });
    }

    if (response.status >= 400) {
      throw new EtherscanUpstreamError({
        chainId,
        host: request.host,
        httpStatus: response.status,
        vendorStatus,
        vendorMessage: vendorMessage ?? `http_error_${response.status}`,
      });
    }

    if (!payload) {
      throw new EtherscanUpstreamError({
        chainId,
        host: request.host,
        httpStatus: response.status,
        vendorMessage: "empty_response",
      });
    }

    return {
      host: request.host,
      httpStatus: response.status,
      payload,
    };
  }
}

function parseRetryAfterHeader(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }

  const numeric = Number(headerValue);

  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.ceil(numeric));
  }

  const parsedDate = Date.parse(headerValue);
  if (!Number.isNaN(parsedDate)) {
    const diffMs = parsedDate - Date.now();
    if (diffMs <= 0) {
      return DEFAULT_RETRY_AFTER_SECONDS;
    }

    return Math.ceil(diffMs / 1000);
  }

  return DEFAULT_RETRY_AFTER_SECONDS;
}

function getRetryAfterHeaderValue(headers: Response["headers"] | undefined): string | null {
  if (!headers) {
    return null;
  }

  if (typeof headers.get === "function") {
    return headers.get("retry-after");
  }

  const candidate = (headers as unknown as Record<string, string | undefined>)["retry-after"];
  return candidate ?? null;
}

function extractVendorMessage(
  payload: EtherscanTokenHolderResponse | undefined,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }

  if (typeof payload.result === "string" && payload.result.trim().length > 0) {
    return payload.result;
  }

  return undefined;
}
