import type {
  AdminSettings,
  AddressActivityResponse,
  Chain,
  HealthResponse,
  TokenChainCoverageEntry,
  TokenHoldersPayload,
  TokenSummary,
  TransactionDetails,
} from "../types/api";
import { API_BASE_URL } from "./config";
import { mergeChainMetadata } from "./chainMetadata";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ChainResponse = { chains: Chain[] } | Chain[];

type RequestOptions = RequestInit & { token?: string };

function buildUrl(pathname: string): string {
  const trimmedBase = API_BASE_URL.replace(/\/$/, "");
  const trimmedPath = pathname.replace(/^\//, "");
  return `${trimmedBase}/${trimmedPath}`;
}

async function fetchJson<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  const { token, headers, ...rest } = options;

  const response = await fetch(buildUrl(pathname), {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...rest,
  });

  const contentType = response.headers.get("content-type");
  const isJson = contentType?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(response.statusText, response.status, body);
  }

  return body as T;
}

function normalizeChains(payload: ChainResponse): Chain[] {
  const rawList: Array<Partial<Chain> & { id: number; supported?: boolean }> = Array.isArray(
    payload,
  )
    ? (payload as Array<Partial<Chain> & { id: number; supported?: boolean }>)
    : Array.isArray((payload as { chains?: Chain[] }).chains)
      ? (payload as { chains: Array<Partial<Chain> & { id: number; supported?: boolean }> }).chains
      : [];

  return mergeChainMetadata(rawList);
}

export async function fetchChains(): Promise<Chain[]> {
  const payload = await fetchJson<ChainResponse>("/chains");
  return normalizeChains(payload);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/health");
}

export async function fetchToken(chainId: number, address: string): Promise<TokenSummary> {
  const payload = await fetchJson<{ token: TokenSummary }>(`/tokens/${chainId}/${address}`);
  return payload.token;
}

export async function fetchTokenHolders(
  chainId: number,
  address: string,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<TokenHoldersPayload> {
  const searchParams = new URLSearchParams();

  searchParams.set("chainId", String(chainId));

  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  if (params.cursor) {
    searchParams.set("cursor", params.cursor);
  }

  const query = searchParams.toString();
  const normalizedAddress = address.toLowerCase();
  const path = `/token/${normalizedAddress}/holders${query ? `?${query}` : ""}`;

  return fetchJson<TokenHoldersPayload>(path);
}

export async function fetchTransaction(chainId: number, hash: string): Promise<TransactionDetails> {
  const normalizedHash = hash.toLowerCase();
  const searchParams = new URLSearchParams();
  searchParams.set("chainId", String(chainId));
  const payload = await fetchJson<{ transaction: TransactionDetails }>(
    `/tx/${encodeURIComponent(normalizedHash)}?${searchParams.toString()}`,
  );
  return payload.transaction;
}

export async function fetchAddressActivity(
  chainId: number,
  address: string,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<AddressActivityResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("chainId", String(chainId));

  if (params.cursor) {
    searchParams.set("cursor", params.cursor);
  }

  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  return fetchJson<AddressActivityResponse>(
    `/address/${encodeURIComponent(address.toLowerCase())}/activity?${searchParams.toString()}`,
  );
}

export async function fetchTokenChainCoverage(address: string): Promise<TokenChainCoverageEntry[]> {
  const response = await fetchJson<{ chains: TokenChainCoverageEntry[] }>(
    `/token/${encodeURIComponent(address.toLowerCase())}/chains`,
  );
  return response.chains;
}

export async function login(credentials: {
  email: string;
  password: string;
}): Promise<{ token: string; user: { email: string; roles: string[] } }> {
  return fetchJson("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export async function fetchAdminSettings(token?: string | null): Promise<AdminSettings> {
  try {
    return await fetchJson<AdminSettings>("/admin/settings", {
      method: "GET",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && token) {
      return fetchJson<AdminSettings>("/admin/settings", {
        method: "GET",
        token,
      });
    }

    throw error;
  }
}
