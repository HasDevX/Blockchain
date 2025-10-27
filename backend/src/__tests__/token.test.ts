import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.FRONTEND_URL = "http://localhost:5173";
  process.env.REDIS_URL = "";
  app = await createApp();
});

describe("token holders endpoint", () => {
  it("requires a chainId query parameter", async () => {
    const response = await request(app).get("/api/token/0xabc123/holders");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "missing_chain" });
  });

  it("rejects unsupported chains", async () => {
    const response = await request(app)
      .get("/api/token/0xabc123/holders")
      .query({ chainId: 25 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "unsupported_chain" });
  });

  it("returns a holders payload for supported chains", async () => {
    const response = await request(app)
      .get("/api/token/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/holders")
      .query({ chainId: 137 });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items).toHaveLength(25);
    expect(response.body.nextCursor).toBe("25");
    expect(response.body.items[0]).toMatchObject({ rank: 1 });
    expect(typeof response.body.items[0].balance).toBe("string");
    expect(typeof response.body.items[0].percentage).toBe("number");
    expect(typeof response.body.items[0].address).toBe("string");
    expect(response.body.items[0].address.startsWith("0x")).toBe(true);
    expect(response.body.items[0].address).toHaveLength(42);
  });

  it("supports cursor pagination", async () => {
    const response = await request(app)
      .get("/api/token/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/holders")
      .query({ chainId: 137, cursor: 10, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ rank: 11 });
    expect(response.body.items).toHaveLength(10);
    expect(response.body.nextCursor).toBe("20");
  });
});
