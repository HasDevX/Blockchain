import bcrypt from "bcryptjs";
import { loadEnv } from "../src/config/env";
import { getEnvAdmin } from "../src/lib/auth";
import type { EnvAdminCredentials } from "../src/lib/auth";
import { getPool, shutdownPool } from "../src/lib/db";

async function resolvePasswordHash(
  admin: EnvAdminCredentials,
): Promise<{ passwordHash: string; source: string }> {
  if (admin.passwordHash) {
    return { passwordHash: admin.passwordHash, source: "env-hash" };
  }

  if (!admin.password) {
    throw new Error("Plaintext admin password is required when no bcrypt hash is provided");
  }

  const hash = await bcrypt.hash(admin.password, 12);
  return { passwordHash: hash, source: "generated" };
}

function resolveUsername(email: string): string {
  const envUsername = process.env.ADMIN_USERNAME?.trim();
  if (envUsername) {
    return envUsername.toLowerCase();
  }

  const [localPart] = email.split("@");
  return localPart.toLowerCase();
}

async function upsertAdminUser(email: string, passwordHash: string, username: string) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string }>(
      `SELECT id::text AS id
         FROM public.users
        WHERE LOWER(email) = $1
        LIMIT 1
        FOR UPDATE`,
      [email.toLowerCase()],
    );

    if (existing.rowCount) {
      await client.query(
        `UPDATE public.users
            SET email = LOWER($1),
                password_hash = $2,
                username = COALESCE($3, username),
                role = COALESCE(role, 'admin'),
                disabled_at = NULL,
                updated_at = NOW()
          WHERE id = $4`,
        [email, passwordHash, username, existing.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO public.users (email, username, password_hash, role)
         VALUES ($1, $2, $3, 'admin')`,
        [email.toLowerCase(), username, passwordHash],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const env = loadEnv();

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const envAdmin = getEnvAdmin();

  if (!envAdmin) {
    throw new Error("Admin credentials are not configured");
  }

  const username = resolveUsername(envAdmin.email);
  const { passwordHash, source } = await resolvePasswordHash(envAdmin);

  await upsertAdminUser(envAdmin.email, passwordHash, username);

  console.log(
    `[bootstrap-admin] ensured admin user ${envAdmin.email} exists (username: ${username}, password: ${source}).`,
  );
}

main()
  .catch((error) => {
    console.error("[bootstrap-admin] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownPool();
  });
