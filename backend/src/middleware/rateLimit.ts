import { Request, Response } from "express";
import rateLimitFactory, { RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";
import { WebEnv } from "../config/env";

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
let redisClient: RedisClient | null = null;
let connectingPromise: Promise<RedisClient | null> | null = null;
let fallbackWarned = false;

async function getRedisClient(url?: string): Promise<RedisClient | null> {
  if (!url) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (!connectingPromise) {
    const client = createClient({ url });
    client.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[redis] limiter error:", message);
    });

    connectingPromise = client
      .connect()
      .then(() => {
        console.info("[redis] connected to", url);
        redisClient = client;
        return client;
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[redis] limiter connect failed:", message);
        await client.disconnect().catch(() => undefined);
        return null;
      });
  }

  const connected = await connectingPromise;
  return connected;
}

async function createRedisStore(prefix: string, redisUrl?: string) {
  const client = await getRedisClient(redisUrl);

  if (!client) {
    if (!fallbackWarned) {
      console.warn("[rate-limit] REDIS_URL not set; using in-memory limiter");
      fallbackWarned = true;
    }
    return undefined;
  }

  type RedisSendCommandArg = Parameters<RedisClient["sendCommand"]>[0];

  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => client.sendCommand(args as unknown as RedisSendCommandArg),
  });
}

export async function createRateLimiters(env: WebEnv): Promise<RateLimiterBundle> {
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
