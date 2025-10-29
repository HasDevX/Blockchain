import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { loadWebEnv } from "../src/config/env";
import { getPool, shutdownPool } from "../src/lib/db";

interface PromptOptions {
  label: string;
  trim?: boolean;
}

async function prompt({ label, trim = true }: PromptOptions): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(label);
    return trim ? answer.trim() : answer;
  } finally {
    rl.close();
  }
}

function ensureEmail(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Email is required");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(normalized)) {
    throw new Error(`Invalid email address: ${value}`);
  }

  return normalized;
}

function ensurePassword(value: string): string {
  if (!value) {
    throw new Error("Password is required");
  }

  if (value.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }

  return value;
}

async function resolveCredentials(): Promise<{ email: string; password: string }> {
  const envEmail = process.env.EMAIL?.trim();
  const envPassword = process.env.PASSWORD ?? process.env.PASS ?? "";

  const email = envEmail ? ensureEmail(envEmail) : ensureEmail(await prompt({ label: "Email: " }));

  let password = envPassword;

  if (!password) {
    password = ensurePassword(await prompt({ label: "Password (input visible): ", trim: false }));
  } else {
    password = ensurePassword(envPassword);
  }

  return { email, password };
}

async function determineTargetTable(): Promise<"users" | "admin_users"> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const usersReg = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.users') AS reg",
    );

    if (usersReg.rows[0]?.reg) {
      return "users";
    }

    const adminUsersReg = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.admin_users') AS reg",
    );

    if (adminUsersReg.rows[0]?.reg) {
      console.warn("users table not found; falling back to admin_users");
      return "admin_users";
    }

    throw new Error("Neither users nor admin_users tables exist");
  } finally {
    client.release();
  }
}

async function upsertIntoUsers(email: string, passwordHash: string) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const columnResult = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
    );

    const columnSet = new Set(columnResult.rows.map((row) => row.column_name));

    if (!columnSet.has("role") || !columnSet.has("email_verified")) {
      throw new Error("users table is missing required columns role and/or email_verified");
    }

    const insertColumns = ["email", "password_hash", "role", "email_verified"];
    const valueExpressions = ["$1", "$2", "'admin'", "true"];

    const updateAssignments = [
      "password_hash = EXCLUDED.password_hash",
      "role = 'admin'",
      "email_verified = true",
    ];
    const returningColumns = ["id", "email", "role", "email_verified"];

    if (columnSet.has("updated_at")) {
      updateAssignments.push("updated_at = NOW()");
    }

    const sql = `
      INSERT INTO users (${insertColumns.join(", ")})
      VALUES (${valueExpressions.join(", ")})
      ON CONFLICT (email) DO UPDATE
        SET ${updateAssignments.join(", ")}
      RETURNING ${returningColumns.join(", ")}
    `;

    const result = await client.query(sql, [email, passwordHash]);
    const user = result.rows[0];

    console.log("Admin user upserted:", user);
  } finally {
    client.release();
  }
}

async function upsertIntoLegacyAdminUsers(email: string, passwordHash: string) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
        INSERT INTO admin_users (email, password_hash)
        VALUES ($1, $2)
        ON CONFLICT (email) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              updated_at = NOW()
        RETURNING id, email
      `,
      [email, passwordHash],
    );

    const user = result.rows[0];

    console.log("Admin user upserted (legacy table):", {
      ...user,
      role: "admin",
    });
  } finally {
    client.release();
  }
}

async function main() {
  const env = loadWebEnv();

  console.info("[create-admin] Loaded web env");

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const { email, password } = await resolveCredentials();
  const passwordHash = await bcrypt.hash(password, 12);

  const targetTable = await determineTargetTable();

  if (targetTable === "users") {
    await upsertIntoUsers(email, passwordHash);
  } else {
    await upsertIntoLegacyAdminUsers(email, passwordHash);
  }

  await shutdownPool();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdownPool().finally(() => {
    process.exit(1);
  });
});
