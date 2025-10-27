import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import { requireAdmin, requireAuth } from "../../middleware/auth";
import { getPool } from "../../lib/db";
import { getChainAdapter } from "../../config/chainAdapters";
import { enqueueReindex } from "../../services/tokenHolderRepository";
import { normalizeAddress } from "../../services/holderStore";

export function createAdminRouter(adminLimiter: RateLimitRequestHandler) {
  const router = Router();

  router.use(adminLimiter);
  router.use(requireAuth);
  router.use(requireAdmin);

  router.get("/settings", (req: Request, res: Response) => {
    const userEmail = req.user?.email ?? "unknown";

    res.json({
      settings: {
        maintenanceMode: false,
        lastUpdatedBy: userEmail,
        announcement: null,
      },
    });
  });

  router.head("/settings", (_req: Request, res: Response) => {
    res.status(200).end();
  });

  router.post("/reindex", async (req: Request, res: Response) => {
    const { chainId, token, fromBlock } = req.body ?? {};

    if (!Number.isFinite(chainId)) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const adapter = getChainAdapter(Number(chainId));

    if (!adapter || !adapter.supported) {
      res.status(400).json({ error: "unsupported_chain" });
      return;
    }

    if (typeof token !== "string" || token.length === 0) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    let normalizedToken: string;

    try {
      normalizedToken = normalizeAddress(token);
    } catch (error) {
      console.warn("invalid token address", error);
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    let startBlock: bigint | null = null;

    if (fromBlock !== undefined && fromBlock !== null && `${fromBlock}`.trim().length > 0) {
      try {
        startBlock = BigInt(fromBlock);
      } catch (error) {
        console.warn("invalid fromBlock", error);
        res.status(400).json({ error: "invalid_from_block" });
        return;
      }

      if (startBlock < 0n) {
        res.status(400).json({ error: "invalid_from_block" });
        return;
      }
    }

    try {
      await enqueueReindex(getPool(), Number(chainId), normalizedToken, startBlock);
    } catch (error) {
      console.error("failed to enqueue reindex", error);
      res.status(500).json({ error: "reindex_failed" });
      return;
    }

    res.status(202).json({ ok: true });
  });

  return router;
}
