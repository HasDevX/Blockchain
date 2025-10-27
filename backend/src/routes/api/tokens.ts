import { Request, Response, Router } from "express";
import {
  getTokenHolders,
  getTokenSummary,
  UnsupportedChainError,
} from "../../services/tokenService";

function parseChainId(param: string): number | null {
  const chainId = Number(param);
  if (Number.isNaN(chainId)) {
    return null;
  }

  return chainId;
}

export function createTokensRouter() {
  const router = Router();

  router.get("/:chainId/:address", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);

    if (!chainId) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const token = await getTokenSummary(chainId, req.params.address);

    if (!token) {
      res.status(404).json({ error: "token_not_found" });
      return;
    }

    res.json({ token });
  });

  router.get("/:chainId/:address/holders", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);

    if (!chainId) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const limitParam = req.query.limit as string | undefined;
    const cursor = (req.query.cursor as string | undefined) ?? null;
    const limit = Math.max(1, Math.min(100, limitParam ? Number(limitParam) : 25));

    try {
      const holders = await getTokenHolders({
        chainId,
        address: req.params.address,
        cursor,
        limit,
      });

      const payload: { items: typeof holders.items; nextCursor: string | null; status: string } = {
        items: holders.items,
        nextCursor: holders.nextCursor ?? null,
        status: holders.status,
      };

      res.json(payload);
    } catch (error) {
      if (error instanceof UnsupportedChainError) {
        res.status(400).json({ error: "unsupported_chain" });
        return;
      }

      console.error("Failed to fetch token holders", error);
      res.status(500).json({ error: "holders_unavailable" });
    }
  });

  return router;
}
