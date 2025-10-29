import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { WebEnv } from "../config/env";

interface MockRedisClient {
  connect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const redisClients: MockRedisClient[] = [];

let connectShouldSucceed = true;
let connectError: Error = new Error("connect failed");

const createClientMock = vi.fn(() => {
  const client = {
    connect: vi.fn(() => (connectShouldSucceed ? Promise.resolve() : Promise.reject(connectError))),
    on: vi.fn(),
    sendCommand: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve()),
  };
  redisClients.push(client);
  return client;
});

type RedisStoreOptions = {
  prefix?: string;
  sendCommand: (args: string[]) => unknown;
};

interface MockRedisStore {
  options: RedisStoreOptions;
  increment: ReturnType<typeof vi.fn>;
  decrement: ReturnType<typeof vi.fn>;
  resetKey: ReturnType<typeof vi.fn>;
  resetAll: ReturnType<typeof vi.fn>;
}

const redisStoreInstances: MockRedisStore[] = [];

const RedisStoreMock = vi.fn((options: RedisStoreOptions): MockRedisStore => {
  const store: MockRedisStore = {
    options,
    increment: vi.fn(async () => ({ totalHits: 1, resetTime: new Date(Date.now() + 60_000) })),
    decrement: vi.fn(async () => {}),
    resetKey: vi.fn(async () => {}),
    resetAll: vi.fn(async () => {}),
  };
  redisStoreInstances.push(store);
  return store;
});

type RateLimitOptions = Record<string, unknown> & { store?: unknown };

type MockRateLimitHandler = ((...args: unknown[]) => void) & {
  store?: unknown;
  options?: RateLimitOptions;
};

const rateLimitFactoryMock = vi.fn((options: RateLimitOptions): MockRateLimitHandler => {
  const handler = vi.fn((_req, _res, next) => {
    if (typeof next === "function") {
      next();
    }
  }) as MockRateLimitHandler;
  handler.store = options.store;
  handler.options = options;
  return handler;
});

vi.mock("redis", () => ({
  __esModule: true,
  createClient: createClientMock,
}));

vi.mock("rate-limit-redis", () => ({
  __esModule: true,
  default: RedisStoreMock,
}));

vi.mock("express-rate-limit", () => ({
  __esModule: true,
  default: rateLimitFactoryMock,
}));

describe("createRateLimiters", () => {
  const baseEnv: WebEnv = {
    nodeEnv: "test",
    port: 4000,
    databaseUrl: undefined,
    redisUrl: undefined,
    frontendOrigins: ["http://localhost:5173"],
    etherscanApiKey: undefined,
    rpcUrls: {},
    adminEmail: "admin@example.com",
    adminPassword: "password",
    adminPasswordHash: undefined,
    jwtSecret: "secret",
  };

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    redisClients.length = 0;
    redisStoreInstances.length = 0;
    createClientMock.mockClear();
    RedisStoreMock.mockClear();
    rateLimitFactoryMock.mockClear();
    connectShouldSucceed = true;
    connectError = new Error("connect failed");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("uses Redis store when REDIS_URL is provided", async () => {
  const env: WebEnv = { ...baseEnv, redisUrl: "redis://localhost:6379" };
    const { createRateLimiters } = await import("../middleware/rateLimit");

    const limiters = await createRateLimiters(env);

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(RedisStoreMock).toHaveBeenCalledTimes(2);
    expect(rateLimitFactoryMock).toHaveBeenCalledTimes(2);

    const loginHandler = limiters.loginLimiter as MockRateLimitHandler;
    const adminHandler = limiters.adminLimiter as MockRateLimitHandler;

    expect(loginHandler.store).toBe(redisStoreInstances[0]);
    expect(adminHandler.store).toBe(redisStoreInstances[1]);

    const storeOptions = redisStoreInstances[0].options;
    expect(typeof storeOptions.sendCommand).toBe("function");
    expect(storeOptions.prefix).toBe("rl:login");

    expect(warnSpy).not.toHaveBeenCalledWith(
      "[rate-limit] REDIS_URL not set; using in-memory limiter",
    );
  });

  it("falls back to in-memory store when REDIS_URL is missing", async () => {
  const env: WebEnv = { ...baseEnv, redisUrl: undefined };
    const { createRateLimiters } = await import("../middleware/rateLimit");

    await expect(createRateLimiters(env)).resolves.toMatchObject({
      loginLimiter: expect.any(Function),
      adminLimiter: expect.any(Function),
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(RedisStoreMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[rate-limit] REDIS_URL not set; using in-memory limiter");
  });

  it("falls back when Redis connection fails", async () => {
    connectShouldSucceed = false;
  const env: WebEnv = { ...baseEnv, redisUrl: "redis://localhost:6379" };
    const { createRateLimiters } = await import("../middleware/rateLimit");

    await expect(createRateLimiters(env)).resolves.toMatchObject({
      loginLimiter: expect.any(Function),
      adminLimiter: expect.any(Function),
    });

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(RedisStoreMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[rate-limit] REDIS_URL not set; using in-memory limiter");
  });
});
