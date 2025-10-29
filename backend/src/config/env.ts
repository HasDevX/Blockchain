import { SUPPORTED_CHAIN_IDS } from "./chains";

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const dotenv = require("dotenv") as typeof import("dotenv");
  if (typeof dotenv?.config === "function") {
    dotenv.config();
  }
} catch (error) {
  // dotenv is optional in production environments.
}

type NullableString = string | null | undefined;

const DEFAULT_FRONTEND = "https://haswork.dev";

interface CommonEnv {
  nodeEnv: string;
  databaseUrl?: string;
  redisUrl?: string;
  etherscanApiKey?: string;
  rpcUrls: Record<number, string>;
}

export interface WebEnv extends CommonEnv {
  port: number;
  frontendOrigins: string[];
  adminEmail: string;
  adminPassword?: string;
  adminPasswordHash?: string;
  jwtSecret: string;
}

export interface WorkerEnv extends CommonEnv {}

let cachedCommon: CommonEnv | null = null;
let cachedWeb: WebEnv | null = null;
let cachedWorker: WorkerEnv | null = null;

function loadCommonEnv(): CommonEnv {
  if (cachedCommon) {
    return cachedCommon;
  }

  const { NODE_ENV, DATABASE_URL, REDIS_URL, ETHERSCAN_API_KEY } = process.env;

  cachedCommon = {
    nodeEnv: NODE_ENV ?? "development",
    databaseUrl: normalizeOptional(DATABASE_URL),
    redisUrl: normalizeOptional(REDIS_URL),
    etherscanApiKey: normalizeOptional(ETHERSCAN_API_KEY),
    rpcUrls: buildRpcUrlMap(),
  };

  return cachedCommon;
}

export function loadWebEnv(): WebEnv {
  if (cachedWeb) {
    return cachedWeb;
  }

  const common = loadCommonEnv();
  const adminEmailRaw = pickFirstDefined(
    "ADMIN_EMAIL",
    "AUTH_ADMIN_EMAIL",
    "DASHBOARD_ADMIN_EMAIL",
  );

  if (!adminEmailRaw) {
    throw new Error("ADMIN_EMAIL is required for the web server");
  }

  const adminEmail = adminEmailRaw.toLowerCase();
  const adminPassword = normalizeOptional(
    pickFirstDefined("ADMIN_PASSWORD", "AUTH_ADMIN_PASSWORD", "DASHBOARD_ADMIN_PASSWORD"),
  );
  const adminPasswordHash = normalizeOptional(
    pickFirstDefined(
      "ADMIN_PASSWORD_BCRYPT_HASH",
      "AUTH_ADMIN_PASSWORD_BCRYPT_HASH",
      "DASHBOARD_ADMIN_PASSWORD_BCRYPT_HASH",
    ),
  );

  if (!adminPassword && !adminPasswordHash) {
    throw new Error("ADMIN_PASSWORD or ADMIN_PASSWORD_BCRYPT_HASH is required for the web server");
  }

  const jwtSecret =
    normalizeOptional(pickFirstDefined("JWT_SECRET", "AUTH_JWT_SECRET", "DASHBOARD_JWT_SECRET")) ??
    "dev-secret";

  cachedWeb = {
    ...common,
    port: parsePort(process.env.PORT),
    frontendOrigins: parseOrigins(process.env.FRONTEND_URL),
    adminEmail,
    adminPassword,
    adminPasswordHash,
    jwtSecret,
  };

  return cachedWeb;
}

export function loadWorkerEnv(): WorkerEnv {
  if (cachedWorker) {
    return cachedWorker;
  }

  const common = loadCommonEnv();
  cachedWorker = { ...common };
  return cachedWorker;
}

function parseOrigins(raw: NullableString): string[] {
  if (!raw) {
    return [DEFAULT_FRONTEND];
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://cloudflare-eth.com",
  10: "https://mainnet.optimism.io",
  56: "https://bsc-dataseed.binance.org",
  137: "https://polygon-rpc.com",
  42161: "https://arb1.arbitrum.io/rpc",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  8453: "https://mainnet.base.org",
  324: "https://mainnet.era.zksync.io",
  5000: "https://rpc.mantle.xyz",
};

function buildRpcUrlMap(): Record<number, string> {
  const map: Record<number, string> = {};

  for (const chainId of SUPPORTED_CHAIN_IDS) {
    const envKey = `RPC_${chainId}`;
    const override = process.env[envKey];
    map[chainId] = override && override.trim().length > 0 ? override : DEFAULT_RPC_URLS[chainId];
  }

  return map;
}

function parsePort(raw?: string | null): number {
  if (!raw) {
    return 4000;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
}

function normalizeOptional(value: NullableString): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickFirstDefined(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];

    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
