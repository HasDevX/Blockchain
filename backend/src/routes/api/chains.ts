import { Request, Response, Router } from "express";
import { CHAINS } from "../../config/chains";

export function createChainsRouter() {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({ chains: CHAINS });
  });

  return router;
}
