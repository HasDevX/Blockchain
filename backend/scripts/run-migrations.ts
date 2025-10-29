import { readFile, readdir } from "fs/promises";
import path from "path";
import { Pool, PoolClient } from "pg";
import { loadWorkerEnv } from "../src/config/env";

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function runMigration(client: PoolClient, filePath: string, filename: string) {
  const alreadyApplied = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
    filename,
  ]);

  if (alreadyApplied.rowCount) {
    console.info(`Skipping ${filename}`);
    return;
  }

  const sql = await readFile(filePath, "utf8");

  console.info(`Applying ${filename}`);

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Migration ${filename} failed`);
    throw error;
  }
}

async function main() {
  const env = loadWorkerEnv();

  console.info("[run-migrations] Loaded worker env");

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const pool = new Pool({ connectionString: env.databaseUrl });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const migrationsDir = path.resolve(__dirname, "../migrations");
    const files = (await readdir(migrationsDir))
      .filter((file: string) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const filePath = path.join(migrationsDir, filename);
      await runMigration(client, filePath, filename);
    }

    console.info("Migrations complete");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
