import { Request, Response, Router } from "express";
import { getGitSha } from "../lib/gitInfo";
import { loadEnv } from "../config/env";
import { getRedisClient } from "../lib/redisClient";

export function createHealthRouter() {
  const router = Router();
  const env = loadEnv();

  const uptimeSeconds = () => Math.floor(process.uptime());

  router.get("/health", async (_req: Request, res: Response) => {
    const services = {
      database: env.databaseUrl ? "configured" : "not_configured",
      redis: env.redisUrl ? "configured" : "memory_fallback",
    };

    if (env.redisUrl) {
      const client = await getRedisClient(env);
      services.redis = client && client.isOpen ? "connected" : "memory_fallback";
    }

    res.json({ ok: true, version: getGitSha(), uptime: uptimeSeconds(), services });
  });

  router.head("/health", (_req: Request, res: Response) => {
    res.status(200).end();
  });

  return router;
}
