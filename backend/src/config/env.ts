import dotenv from "dotenv";
import { SUPPORTED_CHAIN_IDS } from "./chains";

dotenv.config();

type NullableString = string | null | undefined;

const DEFAULT_FRONTEND = "https://haswork.dev";
const DEFAULT_ADMIN_EMAIL = "admin@haswork.dev";

function parseOrigins(raw: NullableString): string[] {
  if (!raw) {
    return [DEFAULT_FRONTEND];
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  frontendOrigins: string[];
  etherscanApiKey?: string;
  rpcUrls: Record<number, string>;
  adminEmail: string;
  adminPassword?: string;
  adminPasswordHash?: string;
  jwtSecret: string;
}

let cachedEnv: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const {
    NODE_ENV,
    PORT,
    DATABASE_URL,
    REDIS_URL,
    FRONTEND_URL,
    ETHERSCAN_API_KEY,
  } = process.env;

  const adminEmail =
    pickFirstDefined("ADMIN_EMAIL", "AUTH_ADMIN_EMAIL", "DASHBOARD_ADMIN_EMAIL")?.toLowerCase() ??
    DEFAULT_ADMIN_EMAIL;
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

  const jwtSecret =
    normalizeOptional(pickFirstDefined("JWT_SECRET", "AUTH_JWT_SECRET", "DASHBOARD_JWT_SECRET")) ??
    "dev-secret";

  cachedEnv = {
    nodeEnv: NODE_ENV ?? "development",
    port: PORT ? Number(PORT) : 4000,
    databaseUrl: DATABASE_URL,
    redisUrl: REDIS_URL,
    frontendOrigins: parseOrigins(FRONTEND_URL),
    etherscanApiKey: ETHERSCAN_API_KEY,
    rpcUrls: buildRpcUrlMap(),
    adminEmail,
    adminPassword,
    adminPasswordHash,
    jwtSecret,
  };

  return cachedEnv;
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
