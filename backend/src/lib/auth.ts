import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { loadEnv } from "../config/env";
import { getPool } from "./db";

export interface DbUserRecord {
  id: string;
  email: string;
  username: string | null;
  passwordHash: string;
  role: string | null;
}

export interface EnvAdminCredentials {
  email: string;
  password?: string;
  passwordHash?: string;
}

export async function dbFindUserByEmail(identifier: string): Promise<DbUserRecord | null> {
  const trimmed = identifier.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const env = loadEnv();

  if (!env.databaseUrl) {
    return null;
  }

  try {
    const pool = getPool();
    const result = await pool.query<DbUserRecord>(
      `SELECT id::text AS id, email, username, password_hash AS "passwordHash", role
         FROM public.users
        WHERE (LOWER(email) = $1 OR LOWER(username) = $1)
          AND (disabled_at IS NULL OR disabled_at > NOW())
        LIMIT 1`,
      [trimmed],
    );

    if (!result.rowCount) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.warn("failed to query users table for login lookup");
    return null;
  }
}

export function safeEq(a?: string | null, b?: string | null): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function getEnvAdmin(): EnvAdminCredentials | null {
  const env = loadEnv();
  const password = env.adminPassword?.trim();
  const passwordHash = env.adminPasswordHash?.trim();

  if (!password && !passwordHash) {
    return null;
  }

  return {
    email: env.adminEmail,
    password: password || undefined,
    passwordHash: passwordHash || undefined,
  };
}

export async function verifyPassword(candidate: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidate, hash);
  } catch (error) {
    console.warn("failed to compare password hash");
    return false;
  }
}
