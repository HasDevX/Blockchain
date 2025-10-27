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
