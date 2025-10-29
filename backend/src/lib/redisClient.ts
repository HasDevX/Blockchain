import { createClient } from "redis";
import { WebEnv } from "../config/env";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let clientPromise: Promise<RedisClient | null> | null = null;
let missingUrlWarned = false;

async function connect(redisUrl: string): Promise<RedisClient | null> {
  const redisClient = createClient({ url: redisUrl });

  redisClient.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[redis] connection error: ${message}`);
  });

  try {
    await redisClient.connect();
    console.info(`[redis] connected to ${redisUrl}`);
    return redisClient;
  } catch (error) {
    console.warn("[redis] unable to connect, falling back to memory store");
    await redisClient.disconnect().catch(() => undefined);
    return null;
  }
}

export async function getRedisClient(env: WebEnv): Promise<RedisClient | null> {
  if (!env.redisUrl) {
    if (!missingUrlWarned) {
      console.warn("[redis] REDIS_URL not set; using in-memory rate limiter");
      missingUrlWarned = true;
    }
    return null;
  }

  if (client) {
    return client;
  }

  if (!clientPromise) {
    clientPromise = connect(env.redisUrl).then((connected) => {
      client = connected;
      return connected;
    });
  }

  return clientPromise;
}
