import { createClient } from "redis";
import { AppEnv } from "../config/env";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let clientPromise: Promise<RedisClient | null> | null = null;

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

export async function getRedisClient(env: AppEnv): Promise<RedisClient | null> {
  if (!env.redisUrl) {
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
