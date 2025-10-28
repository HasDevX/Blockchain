import { getPool } from "../lib/db";
import { RpcClient } from "../lib/rpcClient";
import {
  ChainConfigRecord,
  ChainConfigSummary,
  IndexJobRecord,
  fetchChainConfigs,
  listRecentJobs,
  toChainConfigSummary,
} from "./chainConfigService";

interface CheckpointRow {
  chain_id: number;
  last_block_scanned: string | null;
  updated_at: Date;
}

interface LatestErrorRow {
  chain_id: number;
  error: string | null;
  created_at: Date;
}

export interface ChainStatusSummary {
  chainId: number;
  name: string;
  enabled: boolean;
  qps: number;
  span: {
    min: number;
    max: number;
  };
  lastSyncedBlock: string | null;
  tipBlock: string | null;
  lagBlocks: string | null;
  workerState: "running" | "paused";
  lastError: string | null;
  rpcHealthy: boolean;
  rpcMessage: string | null;
}

export interface AdminStatusPayload {
  chains: ChainStatusSummary[];
  configs: ChainConfigSummary[];
  jobs: Array<IndexJobSummary>;
}

export interface IndexJobSummary {
  id: string;
  chainId: number;
  tokenAddress: string;
  fromBlock: string;
  status: IndexJobRecord["status"];
  createdAt: string;
  error: string | null;
}

export async function getAdminStatus(): Promise<AdminStatusPayload> {
  const pool = getPool();

  const [configs, checkpoints, errors, jobs] = await Promise.all([
    fetchChainConfigs(pool),
    fetchCheckpoints(pool),
    fetchLatestErrors(pool),
    listRecentJobs(20, pool),
  ]);

  const checkpointMap = new Map<number, CheckpointRow>();
  const errorMap = new Map<number, LatestErrorRow>();

  for (const row of checkpoints) {
    checkpointMap.set(row.chain_id, row);
  }

  for (const row of errors) {
    errorMap.set(row.chain_id, row);
  }

  const tipResults = await Promise.all(configs.map((config) => probeChainTip(config)));

  const tipMap = new Map<number, ProbeResult>();
  for (const result of tipResults) {
    tipMap.set(result.chainId, result);
  }

  const chains: ChainStatusSummary[] = configs.map((config) => {
    const checkpoint = checkpointMap.get(config.chainId);
    const tipProbe = tipMap.get(config.chainId);

    const lastSynced = resolveLastSyncedBlock(config, checkpoint);
    const tipBlock = tipProbe?.tip ?? null;
    const lag = computeLag(tipBlock, lastSynced);
    const lastError = sanitizeError(errorMap.get(config.chainId)?.error ?? null);

    return {
      chainId: config.chainId,
      name: config.name,
      enabled: config.enabled,
      qps: config.qps,
      span: {
        min: config.minSpan,
        max: config.maxSpan,
      },
      lastSyncedBlock: lastSynced,
      tipBlock,
      lagBlocks: lag,
      workerState: config.enabled ? "running" : "paused",
      lastError,
      rpcHealthy: tipProbe?.healthy ?? false,
      rpcMessage: tipProbe?.message ?? null,
    };
  });

  const configsSummary = toChainConfigSummary(configs);

  return {
    chains,
    configs: configsSummary,
    jobs: jobs.map(mapJobSummary),
  };
}

function mapJobSummary(job: IndexJobRecord): IndexJobSummary {
  return {
    id: job.id,
    chainId: job.chainId,
    tokenAddress: maskSensitiveAddress(job.tokenAddress),
    fromBlock: job.fromBlock.toString(),
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    error: sanitizeError(job.error),
  };
}

function maskSensitiveAddress(address: string): string {
  if (address.length <= 10) {
    return "••••";
  }

  return `${address.slice(0, 6)}••••${address.slice(-4)}`;
}

async function fetchCheckpoints(pool: ReturnType<typeof getPool>): Promise<CheckpointRow[]> {
  const result = await pool.query<CheckpointRow>(
    `SELECT chain_id,
            last_block_scanned::TEXT AS last_block_scanned,
            updated_at
       FROM job_checkpoints`,
  );

  return result.rows;
}

async function fetchLatestErrors(pool: ReturnType<typeof getPool>): Promise<LatestErrorRow[]> {
  const result = await pool.query<LatestErrorRow>(
    `SELECT DISTINCT ON (chain_id)
            chain_id,
            error,
            created_at
       FROM index_jobs
      WHERE status = 'error'
      ORDER BY chain_id, created_at DESC`,
  );

  return result.rows;
}

interface ProbeResult {
  chainId: number;
  tip: string | null;
  healthy: boolean;
  message: string | null;
}

async function probeChainTip(config: ChainConfigRecord): Promise<ProbeResult> {
  if (!config.rpcUrl) {
    return {
      chainId: config.chainId,
      tip: null,
      healthy: false,
      message: "RPC URL not configured",
    };
  }

  try {
    const client = new RpcClient(config.rpcUrl, { qps: config.qps });
    const tip = await client.getBlockNumber();
    return {
      chainId: config.chainId,
      tip: tip.toString(),
      healthy: true,
      message: null,
    };
  } catch (error) {
    return {
      chainId: config.chainId,
      tip: null,
      healthy: false,
      message: sanitizeError((error as Error).message ?? String(error)),
    };
  }
}

function resolveLastSyncedBlock(
  config: ChainConfigRecord,
  checkpoint: CheckpointRow | undefined,
): string | null {
  if (checkpoint?.last_block_scanned) {
    return checkpoint.last_block_scanned;
  }

  if (config.startBlock !== null) {
    return config.startBlock.toString();
  }

  return null;
}

function computeLag(tipBlock: string | null, lastSynced: string | null): string | null {
  if (!tipBlock || !lastSynced) {
    return null;
  }

  try {
    const lag = BigInt(tipBlock) - BigInt(lastSynced);
    if (lag < 0n) {
      return "0";
    }
    return lag.toString();
  } catch (error) {
    return null;
  }
}

function sanitizeError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  const trimmed = error.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length <= 200) {
    return trimmed;
  }

  return `${trimmed.slice(0, 200)}…`;
}

export function summarizeChainConfigs(records: ChainConfigRecord[]): ChainConfigSummary[] {
  return toChainConfigSummary(records);
}

export function summarizeJobs(jobs: IndexJobRecord[]): IndexJobSummary[] {
  return jobs.map(mapJobSummary);
}
