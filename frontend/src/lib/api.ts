import type {
  AdminConnectionChain,
  AdminConnectionEndpoint,
  AdminConnectionsResponse,
  AdminRpcTestResult,
  AdminRpcTestFailure,
  AdminRpcTestSuccess,
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

type RawAdminConnectionEndpoint = {
  id: string;
  chain_id: number;
  label: string | null;
  url: string;
  is_primary: boolean;
  enabled: boolean;
  qps: number;
  min_span: number;
  max_span: number;
  weight: number;
  order_index: number;
  last_health: string | null;
  last_checked_at: string | null;
  updated_at: string;
};

type RawAdminConnectionChain = {
  chain_id: number;
  name: string;
  endpoints: RawAdminConnectionEndpoint[];
};

type RawAdminConnectionsResponse = {
  chains: RawAdminConnectionChain[];
};

type RawAdminRpcTestResult =
  | ({ ok: true; latency_ms: number; tip: string } & Record<string, unknown>)
  | ({ ok: false; error: string; message?: string; status?: number } & Record<string, unknown>);

export interface AdminEndpointCreatePayload {
  url: string;
  label?: string | null;
  isPrimary?: boolean;
  enabled?: boolean;
  qps?: number;
  minSpan?: number;
  maxSpan?: number;
  weight?: number;
  orderIndex?: number;
}

export type AdminEndpointUpdatePayload = Partial<AdminEndpointCreatePayload>;

export interface AdminRpcTestPayload {
  url: string;
  chainId?: number | null;
  endpointId?: string | null;
}

export async function fetchAdminConnections(
  token?: string | null,
): Promise<AdminConnectionsResponse> {
  const request = (tokenOverride?: string | null) =>
    fetchJson<RawAdminConnectionsResponse>("/admin/connections", {
      method: "GET",
      ...(tokenOverride ? { token: tokenOverride } : {}),
    }).then(normalizeAdminConnections);

  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && token) {
      return request(token);
    }
    throw error;
  }
}

export async function createAdminEndpoint(
  chainId: number,
  payload: AdminEndpointCreatePayload,
  token?: string | null,
): Promise<AdminConnectionEndpoint> {
  const body = buildEndpointRequestBody(payload);
  const response = await fetchJson<{ endpoint: RawAdminConnectionEndpoint }>(
    `/admin/chains/${chainId}/endpoints`,
    {
      method: "POST",
      body: JSON.stringify(body),
      ...(token ? { token } : {}),
    },
  );

  return normalizeAdminEndpoint(response.endpoint);
}

export async function updateAdminEndpoint(
  chainId: number,
  endpointId: string,
  payload: AdminEndpointUpdatePayload,
  token?: string | null,
): Promise<AdminConnectionEndpoint> {
  const body = buildEndpointRequestBody(payload);
  const response = await fetchJson<{ endpoint: RawAdminConnectionEndpoint }>(
    `/admin/chains/${chainId}/endpoints/${endpointId}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      ...(token ? { token } : {}),
    },
  );

  return normalizeAdminEndpoint(response.endpoint);
}

export async function disableAdminEndpoint(
  chainId: number,
  endpointId: string,
  token?: string | null,
): Promise<void> {
  await fetchJson<void>(`/admin/chains/${chainId}/endpoints/${endpointId}`, {
    method: "DELETE",
    ...(token ? { token } : {}),
  });
}

export async function testAdminRpc(
  payload: AdminRpcTestPayload,
  token?: string | null,
): Promise<AdminRpcTestResult> {
  const response = await fetchJson<RawAdminRpcTestResult>("/admin/test-rpc", {
    method: "POST",
    body: JSON.stringify(buildRpcTestRequestBody(payload)),
    ...(token ? { token } : {}),
  });

  return normalizeAdminRpcTestResult(response);
}

function normalizeAdminConnections(payload: RawAdminConnectionsResponse): AdminConnectionsResponse {
  return {
    chains: payload.chains.map((chain) => normalizeAdminChain(chain)),
  };
}

function normalizeAdminChain(chain: RawAdminConnectionChain): AdminConnectionChain {
  return {
    chainId: chain.chain_id,
    name: chain.name,
    endpoints: chain.endpoints.map((endpoint) => normalizeAdminEndpoint(endpoint)),
  };
}

function normalizeAdminEndpoint(endpoint: RawAdminConnectionEndpoint): AdminConnectionEndpoint {
  return {
    id: endpoint.id,
    chainId: endpoint.chain_id,
    label: endpoint.label ?? null,
    url: endpoint.url,
    isPrimary: endpoint.is_primary,
    enabled: endpoint.enabled,
    qps: endpoint.qps,
    minSpan: endpoint.min_span,
    maxSpan: endpoint.max_span,
    weight: endpoint.weight,
    orderIndex: endpoint.order_index,
    lastHealth: endpoint.last_health ?? null,
    lastCheckedAt: endpoint.last_checked_at ?? null,
    updatedAt: endpoint.updated_at,
  };
}

function normalizeAdminRpcTestResult(result: RawAdminRpcTestResult): AdminRpcTestResult {
  if (result.ok) {
    return {
      ok: true,
      tip: result.tip,
      latencyMs: result.latency_ms,
    } satisfies AdminRpcTestSuccess;
  }

  return {
    ok: false,
    error: result.error,
    message: "message" in result ? result.message : undefined,
    status: "status" in result ? result.status : undefined,
  } satisfies AdminRpcTestFailure;
}

function buildEndpointRequestBody(
  payload: AdminEndpointUpdatePayload | AdminEndpointCreatePayload,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (payload.url !== undefined) {
    body.url = payload.url;
  }

  if (payload.isPrimary !== undefined) {
    body.is_primary = payload.isPrimary;
  }

  if (payload.label !== undefined) {
    body.label = payload.label;
  }

  if (payload.enabled !== undefined) {
    body.enabled = payload.enabled;
  }

  if (payload.qps !== undefined) {
    body.qps = payload.qps;
  }

  if (payload.minSpan !== undefined) {
    body.min_span = payload.minSpan;
  }

  if (payload.maxSpan !== undefined) {
    body.max_span = payload.maxSpan;
  }

  if (payload.weight !== undefined) {
    body.weight = payload.weight;
  }

  if (payload.orderIndex !== undefined) {
    body.order_index = payload.orderIndex;
  }

  return body;
}

function buildRpcTestRequestBody(payload: AdminRpcTestPayload) {
  const body: Record<string, unknown> = {
    url: payload.url,
  };

  if (payload.chainId !== undefined && payload.chainId !== null) {
    body.chainId = payload.chainId;
  }

  if (payload.endpointId !== undefined && payload.endpointId !== null) {
    body.endpointId = payload.endpointId;
  }

  return body;
}
