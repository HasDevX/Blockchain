import type {
  AdminSettings,
  Chain,
  HealthResponse,
  TokenHoldersPayload,
  TokenSummary,
} from "../types/api";
import { API_BASE_URL } from "./config";

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
  if (Array.isArray(payload)) {
    return payload as Chain[];
  }

  if (Array.isArray((payload as { chains?: Chain[] }).chains)) {
    return (payload as { chains: Chain[] }).chains;
  }

  return [];
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

  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  if (params.cursor) {
    searchParams.set("cursor", params.cursor);
  }

  const query = searchParams.toString();
  const path = `/tokens/${chainId}/${address}/holders${query ? `?${query}` : ""}`;

  return fetchJson<TokenHoldersPayload>(path);
}

export async function login(
  credentials: { email: string; password: string },
): Promise<{ token: string; user: { email: string; roles: string[] } }> {
  return fetchJson("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export async function fetchAdminSettings(token: string): Promise<AdminSettings> {
  return fetchJson<AdminSettings>("/admin/settings", {
    method: "GET",
    token,
  });
}
