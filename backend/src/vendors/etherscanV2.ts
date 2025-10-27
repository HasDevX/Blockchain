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

export interface EtherscanTokenHolderDto {
  TokenHolderAddress: string;
  TokenHolderQuantity: string;
  TokenHolderRank?: string;
  TokenHolderPercentage?: string;
}

export interface EtherscanTokenHolderData {
  items?: EtherscanTokenHolderDto[];
  result?: EtherscanTokenHolderDto[];
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

  constructor(params: {
    chainId: number;
    host: string;
    httpStatus: number;
    vendorStatus?: string;
    vendorMessage?: string;
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

function createRequestUrl(host: string, address: string, page: number, limit: number) {
  const url = new URL(`https://${host}/api`);
  const params = new URLSearchParams({
    module: "token",
    action: "tokenholderlist",
    contractaddress: address,
    page: String(page),
    offset: String(limit),
    sort: "desc",
  });

  url.search = params.toString();
  return url;
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
    const host = getHostForChain(chainId);
    const apiKey = getApiKeyForChain(chainId);
    const url = createRequestUrl(host, address, page, limit);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    let response: Response;

    try {
      response = await fetchWithRetry(chainId, url, headers);
    } catch (error) {
      throw new EtherscanUpstreamError({
        chainId,
        host,
        httpStatus: 0,
        vendorMessage: (error as Error)?.message ?? "request failed",
        cause: error,
      });
    }

    try {
      const payload = (await response.json()) as EtherscanTokenHolderResponse;

      return {
        host,
        httpStatus: response.status,
        payload,
      };
    } catch (error) {
      throw new EtherscanUpstreamError({
        chainId,
        host,
        httpStatus: response.status,
        vendorMessage: "invalid_json",
        cause: error,
      });
    }
  }
}
