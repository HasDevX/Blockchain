import request from "supertest";
import { describe, beforeAll, it, expect } from "vitest";
import { createApp } from "../app";
import { CHAINS } from "../config/chains";

const RAW_GIT_SHA = "ABCDEF1234567890ABCDEF1234567890ABCDEF12";
const EXPECTED_GIT_SHA = RAW_GIT_SHA.slice(0, 12).toLowerCase();

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.REDIS_URL = "";
  process.env.GIT_SHA = RAW_GIT_SHA;
  app = await createApp();
});

describe("security middleware", () => {
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
      await request(app)
        .post("/api/auth/login")
        .send({ email: "user@example.com", password: "password" });
    }

    const limitedResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password: "password" });

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body).toEqual({ error: "rate_limited" });
    expect(limitedResponse.get("ratelimit-limit")).toBeDefined();
    expect(limitedResponse.get("ratelimit-remaining")).toBeDefined();
    expect(limitedResponse.get("ratelimit-reset")).toBeDefined();
  });
});
