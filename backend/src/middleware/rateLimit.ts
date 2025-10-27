import { Request, Response } from "express";
import rateLimitFactory, { RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { AppEnv } from "../config/env";
import { getRedisClient } from "../lib/redisClient";

interface RateLimiterBundle {
  loginLimiter: RateLimitRequestHandler;
  adminLimiter: RateLimitRequestHandler;
}

type RateLimitRequest = Request;
type RateLimitResponse = Response;

function handleRateLimit(_request: RateLimitRequest, response: RateLimitResponse) {
  response.status(429).json({ error: "rate_limited" });
}

export async function createRateLimiters(env: AppEnv): Promise<RateLimiterBundle> {
  const redisClient = await getRedisClient(env);

  const createStore = (prefix: string) => {
    if (!redisClient) {
      return undefined;
    }

    return new RedisStore({
      prefix,
      sendCommand: (args: string[]) => redisClient.sendCommand(args as unknown as Parameters<typeof redisClient.sendCommand>[0]),
    });
  };

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
    store: createStore("rl:login"),
  });

  const adminLimiter = rateLimitFactory({
    ...baseConfig,
    max: 60,
    keyGenerator: (req: RateLimitRequest) => getClientIp(req),
    store: createStore("rl:admin"),
  });

  return {
    loginLimiter,
    adminLimiter,
  };
}
