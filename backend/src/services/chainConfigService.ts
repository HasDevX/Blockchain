import { Pool, PoolClient } from "pg";
import { getPool } from "../lib/db";
import { loadWorkerEnv } from "../config/env";
import { getChainById, SUPPORTED_CHAIN_IDS } from "../config/chains";
import { parsePositiveBigInt, resolveMaxSpan } from "../workers/adaptiveSpan";

export type Queryable = Pool | PoolClient;

export interface ChainEndpointRecord {
  id: string;
  chainId: number;
  url: string;
  label: string | null;
  isPrimary: boolean;
  enabled: boolean;
  qps: number;
  minSpan: number;
  maxSpan: number;
  weight: number;
  orderIndex: number;
  lastHealth: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
}

interface ChainEndpointRow {
  id: string;
  chain_id: number;
  url: string;
  label: string | null;
  is_primary: boolean;
  enabled: boolean;
  qps: number;
  min_span: number;
  max_span: number;
  weight: number;
  order_index: number;
  last_health: string | null;
  last_checked_at: Date | null;
  updated_at: Date;
}

export interface ChainConfigRecord {
  chainId: number;
  name: string;
  enabled: boolean;
  rpcUrl: string | null;
  rpcSource: "database" | "env" | "none";
  etherscanApiKey: string | null;
  etherscanSource: "database" | "env" | "none";
  startBlock: bigint | null;
  qps: number;
  minSpan: number;
  maxSpan: number;
  updatedAt: Date;
  endpoints: ChainEndpointRecord[];
}

interface ChainConfigRow {
  chain_id: number;
  name: string | null;
  rpc_url: string | null;
  etherscan_api_key: string | null;
  enabled: boolean | null;
  start_block: string | null;
  qps: number | null;
  min_span: number | null;
  max_span: number | null;
  updated_at: Date;
}

export interface ChainConfigUpdate {
  name?: string | null;
  enabled?: boolean;
  rpcUrl?: string | null;
  etherscanApiKey?: string | null;
  startBlock?: bigint | null;
  qps?: number;
  minSpan?: number;
  maxSpan?: number;
}

function getQueryable(queryable?: Queryable): Queryable {
  if (queryable) {
    return queryable;
  }

  return getPool();
}

function resolveDefaultName(chainId: number): string {
  const chain = getChainById(chainId);
  if (chain) {
    return chain.name;
  }

  return `Chain ${chainId}`;
}

function resolveDefaultRpcUrl(
  chainId: number,
): { value: string | null; source: "env" | "none" } {
  const env = loadWorkerEnv();
  const fallback = env.rpcUrls[chainId];

  if (fallback && fallback.trim().length > 0) {
    return { value: fallback.trim(), source: "env" };
  }

  return { value: null, source: "none" };
}

function resolveDefaultEtherscanKey(): { value: string | null; source: "env" | "none" } {
  const env = loadWorkerEnv();

  if (env.etherscanApiKey && env.etherscanApiKey.trim().length > 0) {
    return { value: env.etherscanApiKey.trim(), source: "env" };
  }

  return { value: null, source: "none" };
}

function resolveDefaultStartBlock(chainId: number): bigint | null {
  const specific = parseNonNegativeBigInt(process.env[`INDEXER_START_BLOCK_${chainId}`]);
  if (specific !== null) {
    return specific;
  }

  const generic = parseNonNegativeBigInt(process.env.INDEXER_START_BLOCK_DEFAULT);
  if (generic !== null) {
    return generic;
  }

  return null;
}

function resolveDefaultQps(chainId: number): number {
  const specific = parsePositiveInteger(process.env[`INDEXER_QPS_${chainId}`]);
  if (specific !== null) {
    return specific;
  }

  const generic = parsePositiveInteger(process.env.INDEXER_QPS);
  if (generic !== null) {
    return generic;
  }

  return 1;
}

function resolveDefaultMinSpan(chainId: number): number {
  const specific = parsePositiveBigInt(process.env[`INDEXER_MIN_SPAN_${chainId}`]);
  if (specific) {
    return Number(specific);
  }

  const generic = parsePositiveBigInt(process.env.INDEXER_MIN_SPAN_DEFAULT);
  if (generic) {
    return Number(generic);
  }

  return 8;
}

function resolveDefaultMaxSpan(chainId: number): number {
  return Number(resolveMaxSpan(chainId));
}

function parsePositiveInteger(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseNonNegativeBigInt(raw: string | undefined): bigint | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = BigInt(raw);
    if (parsed < 0n) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

function parseBigintColumn(value: string | null): bigint | null {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch (error) {
    return null;
  }
}

function buildRecord(chainId: number, row: ChainConfigRow | undefined): ChainConfigRecord {
  const name = row?.name ?? resolveDefaultName(chainId);
  const startBlock = row?.start_block
    ? parseBigintColumn(row.start_block)
    : resolveDefaultStartBlock(chainId);
  const defaultRpc = resolveDefaultRpcUrl(chainId);
  const rpcUrl = row?.rpc_url ?? defaultRpc.value;
  const rpcSource: "database" | "env" | "none" = row?.rpc_url ? "database" : defaultRpc.source;
  const defaultKey = resolveDefaultEtherscanKey();
  const etherscanApiKey = row?.etherscan_api_key ?? defaultKey.value;
  const etherscanSource: "database" | "env" | "none" = row?.etherscan_api_key
    ? "database"
    : defaultKey.source;
  const qps = row?.qps && row.qps > 0 ? row.qps : resolveDefaultQps(chainId);
  const minSpan = row?.min_span && row.min_span > 0 ? row.min_span : resolveDefaultMinSpan(chainId);
  const maxSpan =
    row?.max_span && row.max_span >= minSpan ? row.max_span : resolveDefaultMaxSpan(chainId);
  const enabled = row?.enabled ?? true;
  const updatedAt = row?.updated_at ?? new Date(0);

  return {
    chainId,
    name,
    enabled,
    rpcUrl,
    rpcSource,
    etherscanApiKey,
    etherscanSource,
    startBlock,
    qps,
    minSpan,
    maxSpan,
    updatedAt,
    endpoints: [],
  };
}

export async function fetchChainConfigs(queryable?: Queryable): Promise<ChainConfigRecord[]> {
  const client = getQueryable(queryable);
  const result = await client.query<ChainConfigRow>(
    `SELECT chain_id,
            name,
            rpc_url,
            etherscan_api_key,
            enabled,
            start_block::TEXT AS start_block,
            qps,
            min_span,
            max_span,
            updated_at
       FROM chain_configs`,
  );

  const rowMap = new Map<number, ChainConfigRow>();

  for (const row of result.rows) {
    rowMap.set(row.chain_id, row);
  }

  const chainIds = new Set<number>(SUPPORTED_CHAIN_IDS as readonly number[]);

  for (const key of rowMap.keys()) {
    chainIds.add(key);
  }

  const ordered = [...chainIds].sort((a, b) => a - b);

  return ordered.map((id) => buildRecord(id, rowMap.get(id)));
}

export async function fetchChainConfig(
  chainId: number,
  queryable?: Queryable,
): Promise<ChainConfigRecord> {
  const configs = await fetchChainConfigs(queryable);
  const base = configs.find((config) => config.chainId === chainId) ?? buildRecord(chainId, undefined);

  const endpoints = await listChainEndpoints(chainId, { includeDisabled: true }, queryable);
  return { ...base, endpoints };
}

export async function upsertChainConfig(
  chainId: number,
  updates: ChainConfigUpdate,
  queryable?: Queryable,
): Promise<ChainConfigRecord> {
  const client = getQueryable(queryable);

  const nameProvided = updates.name !== undefined;
  const nameValue = updates.name ?? resolveDefaultName(chainId);

  const rpcUrlProvided = updates.rpcUrl !== undefined;
  const rpcUrlValue = rpcUrlProvided ? normalizeNullableString(updates.rpcUrl) : null;

  const etherscanProvided = updates.etherscanApiKey !== undefined;
  const etherscanValue = etherscanProvided
    ? normalizeNullableString(updates.etherscanApiKey)
    : null;

  const enabledProvided = updates.enabled !== undefined;
  const enabledValue = updates.enabled ?? true;

  const startBlockRaw = updates.startBlock;
  const startBlockProvided = startBlockRaw !== undefined;
  const startBlockValue =
    startBlockProvided && startBlockRaw !== null ? startBlockRaw.toString() : null;

  const qpsProvided = updates.qps !== undefined;
  const qpsValue = updates.qps ?? resolveDefaultQps(chainId);

  const minSpanProvided = updates.minSpan !== undefined;
  const minSpanValue = updates.minSpan ?? resolveDefaultMinSpan(chainId);

  const maxSpanProvided = updates.maxSpan !== undefined;
  const maxSpanValue = updates.maxSpan ?? resolveDefaultMaxSpan(chainId);

  await client.query(
    `INSERT INTO chain_configs (
        chain_id,
        name,
        rpc_url,
        etherscan_api_key,
        enabled,
        start_block,
        qps,
        min_span,
        max_span,
        updated_at
      )
      VALUES ($1, $2, $4, $6, $8, $10, $12, $14, $16, NOW())
      ON CONFLICT (chain_id)
      DO UPDATE SET
        name = CASE WHEN $3 THEN $2 ELSE chain_configs.name END,
        rpc_url = CASE WHEN $5 THEN $4 ELSE chain_configs.rpc_url END,
        etherscan_api_key = CASE WHEN $7 THEN $6 ELSE chain_configs.etherscan_api_key END,
        enabled = CASE WHEN $9 THEN $8 ELSE chain_configs.enabled END,
        start_block = CASE WHEN $11 THEN $10 ELSE chain_configs.start_block END,
        qps = CASE WHEN $13 THEN $12 ELSE chain_configs.qps END,
        min_span = CASE WHEN $15 THEN $14 ELSE chain_configs.min_span END,
        max_span = CASE WHEN $17 THEN $16 ELSE chain_configs.max_span END,
        updated_at = NOW()`,
    [
      chainId,
      nameValue,
      nameProvided,
      rpcUrlValue,
      rpcUrlProvided,
      etherscanValue,
      etherscanProvided,
      enabledValue,
      enabledProvided,
      startBlockValue,
      startBlockProvided,
      qpsValue,
      qpsProvided,
      minSpanValue,
      minSpanProvided,
      maxSpanValue,
      maxSpanProvided,
    ],
  );

  return fetchChainConfig(chainId, client);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface IndexJobRecord {
  id: string;
  chainId: number;
  tokenAddress: string;
  fromBlock: bigint;
  status: "queued" | "running" | "done" | "error";
  createdAt: Date;
  error: string | null;
}

interface IndexJobRow {
  id: string;
  chain_id: number;
  token_address: string;
  from_block: string;
  status: "queued" | "running" | "done" | "error";
  created_at: Date;
  error: string | null;
}

function mapIndexJobRow(row: IndexJobRow): IndexJobRecord {
  return {
    id: row.id,
    chainId: row.chain_id,
    tokenAddress: row.token_address,
    fromBlock: BigInt(row.from_block),
    status: row.status,
    createdAt: row.created_at,
    error: row.error,
  };
}

export async function createIndexJob(
  input: { chainId: number; tokenAddress: string; fromBlock: bigint },
  queryable?: Queryable,
): Promise<IndexJobRecord> {
  const client = getQueryable(queryable);

  const result = await client.query<IndexJobRow>(
    `INSERT INTO index_jobs (chain_id, token_address, from_block, status)
     VALUES ($1, $2, $3, 'queued')
     RETURNING id, chain_id, token_address, from_block::TEXT AS from_block, status, created_at, error`,
    [input.chainId, input.tokenAddress, input.fromBlock.toString()],
  );

  return mapIndexJobRow(result.rows[0]!);
}

export async function listRecentJobs(limit = 25, queryable?: Queryable): Promise<IndexJobRecord[]> {
  const client = getQueryable(queryable);
  const result = await client.query<IndexJobRow>(
    `SELECT id,
            chain_id,
            token_address,
            from_block::TEXT AS from_block,
            status,
            created_at,
            error
       FROM index_jobs
       ORDER BY created_at DESC
       LIMIT $1`,
    [limit],
  );

  return result.rows.map(mapIndexJobRow);
}

export interface ChainConfigSummary {
  chainId: number;
  name: string;
  enabled: boolean;
  startBlock: string | null;
  qps: number;
  minSpan: number;
  maxSpan: number;
  updatedAt: string;
  rpc: {
    hasValue: boolean;
    masked: string | null;
    source: "database" | "env" | "none";
  };
  etherscan: {
    hasValue: boolean;
    masked: string | null;
    source: "database" | "env" | "none";
  };
}

function mapChainEndpointRow(row: ChainEndpointRow): ChainEndpointRecord {
  return {
    id: row.id,
    chainId: row.chain_id,
    url: row.url,
    label: row.label,
    isPrimary: row.is_primary,
    enabled: row.enabled,
    qps: row.qps,
    minSpan: row.min_span,
    maxSpan: row.max_span,
    weight: row.weight,
    orderIndex: row.order_index,
    lastHealth: row.last_health,
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
  };
}

export async function listChainEndpoints(
  chainId: number,
  options: { includeDisabled?: boolean } = {},
  queryable?: Queryable,
): Promise<ChainEndpointRecord[]> {
  const client = getQueryable(queryable);
  const includeDisabled = options.includeDisabled ?? true;

  const result = await client.query<ChainEndpointRow>(
    `SELECT id::TEXT AS id,
            chain_id,
            url,
            label,
            is_primary,
            enabled,
            qps,
            min_span,
            max_span,
            weight,
            order_index,
            last_health,
            last_checked_at,
            updated_at
       FROM public.chain_endpoints
      WHERE chain_id = $1
        ${includeDisabled ? "" : "AND enabled = TRUE"}
      ORDER BY is_primary DESC, order_index ASC, id::BIGINT ASC`,
    [chainId],
  );

  return result.rows.map(mapChainEndpointRow);
}

export async function listAllChainEndpoints(
  options: { includeDisabled?: boolean } = {},
  queryable?: Queryable,
): Promise<ChainEndpointRecord[]> {
  const client = getQueryable(queryable);
  const includeDisabled = options.includeDisabled ?? true;

  const result = await client.query<ChainEndpointRow>(
    `SELECT id::TEXT AS id,
            chain_id,
            url,
            label,
            is_primary,
            enabled,
            qps,
            min_span,
            max_span,
            weight,
            order_index,
            last_health,
            last_checked_at,
            updated_at
       FROM public.chain_endpoints
      ${includeDisabled ? "" : "WHERE enabled = TRUE"}
      ORDER BY chain_id ASC, is_primary DESC, order_index ASC, id::BIGINT ASC`,
  );

  return result.rows.map(mapChainEndpointRow);
}

export async function createChainEndpoint(
  chainId: number,
  payload: {
    url: string;
    label: string | null;
    isPrimary: boolean;
    enabled: boolean;
    qps: number;
    minSpan: number;
    maxSpan: number;
    weight: number;
    orderIndex: number;
  },
  queryable?: Queryable,
): Promise<ChainEndpointRecord> {
  const client = getQueryable(queryable);

  const result = await client.query<ChainEndpointRow>(
    `INSERT INTO public.chain_endpoints (
        chain_id,
        url,
        label,
        is_primary,
        enabled,
        qps,
        min_span,
        max_span,
        weight,
        order_index
      )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id::TEXT AS id,
               chain_id,
               url,
               label,
               is_primary,
               enabled,
               qps,
               min_span,
               max_span,
               weight,
               order_index,
               last_health,
               last_checked_at,
               updated_at`,
    [
      chainId,
      payload.url,
      payload.label,
      payload.isPrimary,
      payload.enabled,
      payload.qps,
      payload.minSpan,
      payload.maxSpan,
      payload.weight,
      payload.orderIndex,
    ],
  );

  return mapChainEndpointRow(result.rows[0]!);
}

export async function updateChainEndpoint(
  chainId: number,
  endpointId: string,
  updates: Partial<{
    url: string;
    label: string | null;
    isPrimary: boolean;
    enabled: boolean;
    qps: number;
    minSpan: number;
    maxSpan: number;
    weight: number;
    orderIndex: number;
    lastHealth: string | null;
    lastCheckedAt: Date | null;
  }>,
  queryable?: Queryable,
): Promise<ChainEndpointRecord | null> {
  const client = getQueryable(queryable);

  const assignments: string[] = [];
  const values: unknown[] = [];
  let hasUpdate = false;
  let paramIndex = 3;

  const pushAssignment = (column: string, value: unknown) => {
    hasUpdate = true;
    assignments.push(`${column} = $${paramIndex}`);
    values.push(value);
    paramIndex += 1;
  };

  if (updates.url !== undefined) {
    pushAssignment("url", updates.url);
  }

  if (updates.label !== undefined) {
    pushAssignment("label", updates.label);
  }

  if (updates.isPrimary !== undefined) {
    pushAssignment("is_primary", updates.isPrimary);
  }

  if (updates.enabled !== undefined) {
    pushAssignment("enabled", updates.enabled);
  }

  if (updates.qps !== undefined) {
    pushAssignment("qps", updates.qps);
  }

  if (updates.minSpan !== undefined) {
    pushAssignment("min_span", updates.minSpan);
  }

  if (updates.maxSpan !== undefined) {
    pushAssignment("max_span", updates.maxSpan);
  }

  if (updates.weight !== undefined) {
    pushAssignment("weight", updates.weight);
  }

  if (updates.orderIndex !== undefined) {
    pushAssignment("order_index", updates.orderIndex);
  }

  if (updates.lastHealth !== undefined) {
    pushAssignment("last_health", updates.lastHealth);
  }

  if (updates.lastCheckedAt !== undefined) {
    pushAssignment("last_checked_at", updates.lastCheckedAt);
  }

  if (!hasUpdate) {
    return getChainEndpoint(chainId, endpointId, queryable);
  }

  assignments.push("updated_at = NOW()");

  const setClause = assignments.join(",\n            ");

  const result = await client.query<ChainEndpointRow>(
    `UPDATE public.chain_endpoints
        SET ${setClause}
      WHERE chain_id = $1 AND id = $2
      RETURNING id::TEXT AS id,
                chain_id,
                url,
                label,
                is_primary,
                enabled,
                qps,
                min_span,
                max_span,
                weight,
                order_index,
                last_health,
                last_checked_at,
                updated_at`,
    [chainId, endpointId, ...values],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapChainEndpointRow(result.rows[0]!);
}

export async function disableChainEndpoint(
  chainId: number,
  endpointId: string,
  queryable?: Queryable,
): Promise<ChainEndpointRecord | null> {
  return updateChainEndpoint(chainId, endpointId, { enabled: false }, queryable);
}

export async function getChainEndpoint(
  chainId: number,
  endpointId: string,
  queryable?: Queryable,
): Promise<ChainEndpointRecord | null> {
  const client = getQueryable(queryable);

  const result = await client.query<ChainEndpointRow>(
    `SELECT id::TEXT AS id,
            chain_id,
            url,
            label,
            is_primary,
            enabled,
            qps,
            min_span,
            max_span,
            weight,
            order_index,
            last_health,
            last_checked_at,
            updated_at
       FROM public.chain_endpoints
      WHERE chain_id = $1 AND id = $2`,
    [chainId, endpointId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapChainEndpointRow(result.rows[0]!);
}

export async function findChainEndpointByUrl(
  chainId: number,
  url: string,
  queryable?: Queryable,
): Promise<ChainEndpointRecord | null> {
  const client = getQueryable(queryable);

  const result = await client.query<ChainEndpointRow>(
    `SELECT id::TEXT AS id,
            chain_id,
            url,
            label,
            is_primary,
            enabled,
            qps,
            min_span,
            max_span,
            weight,
            order_index,
            last_health,
            last_checked_at,
            updated_at
       FROM public.chain_endpoints
      WHERE chain_id = $1 AND url = $2
      ORDER BY id::BIGINT ASC
      LIMIT 1`,
    [chainId, url],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapChainEndpointRow(result.rows[0]!);
}

export async function unsetPrimaryForOtherEndpoints(
  chainId: number,
  primaryEndpointId: string,
  queryable?: Queryable,
): Promise<void> {
  const client = getQueryable(queryable);

  await client.query(
    `UPDATE public.chain_endpoints
        SET is_primary = FALSE,
            updated_at = NOW()
      WHERE chain_id = $1
        AND id <> $2::BIGINT
        AND is_primary = TRUE`,
    [chainId, primaryEndpointId],
  );
}

export function maskSecret(secret: string | null): string | null {
  if (!secret) {
    return null;
  }

  const length = secret.length;
  return `•••• (len ${length})`;
}

export function toChainConfigSummary(records: ChainConfigRecord[]): ChainConfigSummary[] {
  return records.map((record) => ({
    chainId: record.chainId,
    name: record.name,
    enabled: record.enabled,
    startBlock: record.startBlock ? record.startBlock.toString() : null,
    qps: record.qps,
    minSpan: record.minSpan,
    maxSpan: record.maxSpan,
    updatedAt: record.updatedAt.toISOString(),
    rpc: {
      hasValue: Boolean(record.rpcUrl),
      masked: maskSecret(record.rpcUrl),
      source: record.rpcSource,
    },
    etherscan: {
      hasValue: Boolean(record.etherscanApiKey),
      masked: maskSecret(record.etherscanApiKey),
      source: record.etherscanSource,
    },
  }));
}
