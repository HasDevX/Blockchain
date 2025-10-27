import { Request, Response, Router } from "express";
import { getGitSha } from "../lib/gitInfo";

export function createHealthRouter() {
  const router = Router();

  const uptimeSeconds = () => Math.floor(process.uptime());

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, version: getGitSha(), uptime: uptimeSeconds() });
  });

  router.head("/health", (_req: Request, res: Response) => {
    res.status(200).end();
  });

  return router;
}
