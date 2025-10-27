import dotenv from "dotenv";

dotenv.config();

type NullableString = string | null | undefined;

const DEFAULT_FRONTEND = "https://haswork.dev";

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
}

let cachedEnv: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const { NODE_ENV, PORT, DATABASE_URL, REDIS_URL, FRONTEND_URL, ETHERSCAN_API_KEY } = process.env;

  cachedEnv = {
    nodeEnv: NODE_ENV ?? "development",
    port: PORT ? Number(PORT) : 4000,
    databaseUrl: DATABASE_URL,
    redisUrl: REDIS_URL,
    frontendOrigins: parseOrigins(FRONTEND_URL),
    etherscanApiKey: ETHERSCAN_API_KEY,
  };

  return cachedEnv;
}
