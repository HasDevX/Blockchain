import { Request, Response, Router } from "express";

const CHAINS_RESPONSE = [
  { id: 1, name: "Ethereum", supported: true },
  { id: 10, name: "Optimism", supported: true },
  { id: 56, name: "BSC", supported: true },
  { id: 137, name: "Polygon", supported: true },
  { id: 42161, name: "Arbitrum One", supported: true },
  { id: 43114, name: "Avalanche C-Chain", supported: true },
  { id: 8453, name: "Base", supported: true },
  { id: 324, name: "zkSync", supported: true },
  { id: 5000, name: "Mantle", supported: true },
  { id: 25, name: "Cronos", supported: false },
] as const;

export function createChainsRouter() {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({ chains: CHAINS_RESPONSE });
  });

  return router;
}
