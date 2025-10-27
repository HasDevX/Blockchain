import { Request, Response, Router } from "express";
import { CHAINS } from "../../config/chains";

const CHAINS_RESPONSE = CHAINS.map(({ id, name, supported }) => ({ id, name, supported }));

export function createChainsRouter() {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({ chains: CHAINS_RESPONSE });
  });

  return router;
}
