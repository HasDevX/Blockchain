import { Pool, PoolClient } from "pg";
import { loadWorkerEnv } from "../config/env";

let pool: Pool | null = null;

function createPool(): Pool {
  const env = loadWorkerEnv();

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  return new Pool({ connectionString: env.databaseUrl });
}

export function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function shutdownPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
