import request from "supertest";
import { describe, beforeAll, it, expect } from "vitest";
import { createApp } from "../app";

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.REDIS_URL = "";
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
      chains: [
        { id: 1, name: "Ethereum", supported: true },
        { id: 10, name: "Optimism", supported: true },
        { id: 56, name: "BSC", supported: true },
        { id: 137, name: "Polygon", supported: true },
        { id: 42161, name: "Arbitrum One", supported: true },
        { id: 43114, name: "Avalanche C-Chain", supported: true },
        { id: 8453, name: "Base", supported: true },
        { id: 324, name: "zkSync", supported: true },
        { id: 5000, name: "Mantle", supported: true },
        { id: 25, name: "Cronos", supported: false },
      ],
    });
  });

  it("exposes health endpoints", async () => {
    const rootResponse = await request(app).get("/health");
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.body.ok).toBe(true);
    expect(rootResponse.body.version).toMatch(/^[0-9a-f]{7,12}$/);
    expect(typeof rootResponse.body.uptime).toBe("number");

    const apiResponse = await request(app).get("/api/health");
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.body.ok).toBe(true);
    expect(apiResponse.body.version).toMatch(/^[0-9a-f]{7,12}$/);
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
  });
});
