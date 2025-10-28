import request from "supertest";
import jwt, { JwtPayload } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { describe, beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import type { SpyInstance } from "vitest";
import type { Pool } from "pg";
import { CHAINS } from "../config/chains";
import type { DbUserRecord } from "../lib/auth";

const RAW_GIT_SHA = "ABCDEF1234567890ABCDEF1234567890ABCDEF12";
const EXPECTED_GIT_SHA = RAW_GIT_SHA.slice(0, 12).toLowerCase();
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "super-secret";
const JWT_SECRET = "test-secret-key";

type AppFactory = (typeof import("../app"))["createApp"];

let createApp: AppFactory;
let app: Awaited<ReturnType<AppFactory>>;
let authModule: typeof import("../lib/auth");
let dbFindUserSpy: SpyInstance<[Pool, string], Promise<DbUserRecord | null>>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.REDIS_URL = "";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  process.env.GIT_SHA = RAW_GIT_SHA;
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.JWT_SECRET = JWT_SECRET;
  ({ createApp } = await import("../app"));
  authModule = await import("../lib/auth");
  app = await createApp();
});

beforeEach(() => {
  dbFindUserSpy = vi.spyOn(authModule, "dbFindUserByEmail");
  dbFindUserSpy.mockResolvedValue(null);
});

afterEach(() => {
  dbFindUserSpy.mockRestore();
});

describe("security middleware", () => {
  function loginFromIp(ip: string) {
    return request(app).post("/api/auth/login").set("x-forwarded-for", ip);
  }

  it("rejects unauthenticated HEAD admin request with 401", async () => {
    const response = await request(app).head("/api/admin/settings");
    expect(response.status).toBe(401);
    expect(response.get("content-type")).toContain("application/json");
    const expectedLength = Buffer.byteLength(JSON.stringify({ error: "unauthorized" }));
    expect(Number(response.get("content-length"))).toBe(expectedLength);
  });

  it("rejects unauthenticated GET admin request with JSON body", async () => {
    const response = await request(app).get("/api/admin/settings");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("rejects login with invalid credentials", async () => {
    const response = await loginFromIp("10.0.0.10")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid_credentials" });
  });

  it("allows HEAD admin request with valid token", async () => {
    const loginResponse = await loginFromIp("10.0.0.11")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(loginResponse.status).toBe(200);
    expect(typeof loginResponse.body.token).toBe("string");
    expect(loginResponse.body.user).toMatchObject({ email: ADMIN_EMAIL });

    const response = await request(app)
      .head("/api/admin/settings")
      .set("authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.status).toBe(200);
  });

  it("logs in admin with correct credentials", async () => {
    const response = await loginFromIp("10.0.0.12")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("token");
    expect(response.body).toHaveProperty("user");

    const payload = jwt.verify(response.body.token, JWT_SECRET) as JwtPayload;
    expect(payload.sub).toBe("admin");
    expect(payload.email).toBe(ADMIN_EMAIL);
  });

  it("logs in with form-encoded payload", async () => {
    const response = await loginFromIp("10.0.0.13")
      .type("form")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("token");
    expect(response.body.user).toMatchObject({ email: ADMIN_EMAIL });
  });

  it("logs in database user with bcrypt password", async () => {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const dbUser: DbUserRecord = {
      id: "11111111-1111-1111-1111-111111111111",
      email: ADMIN_EMAIL,
      passwordHash,
      role: "super-admin",
      disabledAt: null,
    };

    dbFindUserSpy.mockResolvedValueOnce(dbUser);

    const response = await loginFromIp("10.0.0.14")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(
      expect.objectContaining({
        id: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        source: "database",
      }),
    );

    const payload = jwt.verify(response.body.token, JWT_SECRET) as JwtPayload;
    expect(payload.sub).toBe(`user:${dbUser.id}`);
    expect(payload.email).toBe(dbUser.email);
    expect(payload.role).toBe(dbUser.role);
  });

  it("accepts username field for database login", async () => {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const dbUser: DbUserRecord = {
      id: "22222222-2222-2222-2222-222222222222",
      email: ADMIN_EMAIL,
      passwordHash,
      role: null,
      disabledAt: null,
    };

    dbFindUserSpy.mockResolvedValueOnce(dbUser);

    const response = await loginFromIp("10.0.0.15")
      .send({ username: "primary-admin", password: ADMIN_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: dbUser.id,
      email: dbUser.email,
      source: "database",
    });
    expect(dbFindUserSpy).toHaveBeenCalledWith(expect.anything(), "primary-admin");
  });

  it("returns configured chain list", async () => {
    const response = await request(app).get("/api/chains");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      chains: CHAINS.map(({ id, name, supported }) => ({ id, name, supported })),
    });
  });

  it("exposes health endpoints", async () => {
    const rootResponse = await request(app).get("/health");
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.body.ok).toBe(true);
    expect(rootResponse.body.version).toMatch(/^[0-9a-f]{7,12}$/);
    expect(rootResponse.body.version).toBe(EXPECTED_GIT_SHA);
    expect(typeof rootResponse.body.uptime).toBe("number");

    const apiResponse = await request(app).get("/api/health");
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.ok).toBe(true);
    expect(apiResponse.body.version).toMatch(/^[0-9a-f]{7,12}$/);
    expect(apiResponse.body.version).toBe(EXPECTED_GIT_SHA);
    expect(typeof apiResponse.body.uptime).toBe("number");
  });

  it("rate limits login endpoint after burst", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await loginFromIp("10.0.0.200")
        .send({ email: ADMIN_EMAIL, password: "wrong-password" });
    }

    const limitedResponse = await loginFromIp("10.0.0.200")
      .send({ email: ADMIN_EMAIL, password: "wrong-password" });

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body).toEqual({ error: "rate_limited" });
    expect(limitedResponse.get("ratelimit-limit")).toBeDefined();
    expect(limitedResponse.get("ratelimit-remaining")).toBeDefined();
    expect(limitedResponse.get("ratelimit-reset")).toBeDefined();
  });
});
