import { Request, Response } from "express";
import rateLimitFactory, { RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";
import { AppEnv } from "../config/env";

interface RateLimiterBundle {
  loginLimiter: RateLimitRequestHandler;
  adminLimiter: RateLimitRequestHandler;
}

type RateLimitRequest = Request;
type RateLimitResponse = Response;

function handleRateLimit(_request: RateLimitRequest, response: RateLimitResponse) {
  response.status(429).json({ error: "rate_limited" });
}

type RedisClient = ReturnType<typeof createClient>;
type RedisCommandArgs = Parameters<RedisClient["sendCommand"]>[0];

let cachedClient: RedisClient | null = null;
let clientPromise: Promise<RedisClient | null> | null = null;
let missingUrlWarned = false;

async function getLimiterRedisClient(redisUrl?: string): Promise<RedisClient | null> {
  if (!redisUrl) {
    if (!missingUrlWarned) {
      console.warn("[redis] REDIS_URL not set; using in-memory rate limiter");
      missingUrlWarned = true;
    }
    return null;
  }

  if (cachedClient) {
    return cachedClient;
  }

  if (!clientPromise) {
    const client = createClient({ url: redisUrl });
    client.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[redis] limiter error", message);
    });

    clientPromise = client
      .connect()
      .then(() => {
        cachedClient = client;
        return client;
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[redis] limiter fallback to memory store", message);
        await client.disconnect().catch(() => undefined);
        return null;
      })
      .finally(() => {
        if (!cachedClient) {
          clientPromise = null;
        }
      });
  }

  const resolved = await clientPromise;
  if (!resolved) {
    clientPromise = null;
  }
  return resolved;
}

async function createRedisStore(prefix: string, redisUrl?: string) {
  const client = await getLimiterRedisClient(redisUrl);
  if (!client) {
    return undefined;
  }

  return new RedisStore({
    prefix,
    sendCommand: (args: string[]) => client.sendCommand(args as RedisCommandArgs),
  });
}

export async function createRateLimiters(env: AppEnv): Promise<RateLimiterBundle> {
  const loginStore = await createRedisStore("rl:login", env.redisUrl);
  const adminStore = await createRedisStore("rl:admin", env.redisUrl);

  const baseConfig = {
    windowMs: 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handleRateLimit,
  } satisfies Partial<Parameters<typeof rateLimitFactory>[0]>;

  function getClientIp(req: RateLimitRequest): string {
    const forwarded = req.headers["x-forwarded-for"];

    if (Array.isArray(forwarded) && forwarded.length) {
      return forwarded[0];
    }

    if (typeof forwarded === "string" && forwarded.length) {
      return forwarded.split(",")[0]?.trim() ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
    }

    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }

  const loginLimiter = rateLimitFactory({
    ...baseConfig,
    max: 5,
    keyGenerator: (req: RateLimitRequest) => getClientIp(req),
    store: loginStore,
  });

  const adminLimiter = rateLimitFactory({
    ...baseConfig,
    max: 60,
    keyGenerator: (req: RateLimitRequest) => getClientIp(req),
    store: adminStore,
  });

  return {
    loginLimiter,
    adminLimiter,
  };
}
