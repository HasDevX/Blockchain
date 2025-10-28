import { Request, Response, Router } from "express";
import { getChainById } from "../../config/chains";
import { getAddressActivity } from "../../services/executionStore";

function coerceSingleValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

export function createAddressRouter() {
  const router = Router();

  router.get("/:address/activity", async (req: Request, res: Response) => {
    const chainIdValue = coerceSingleValue(req.query.chainId as string | string[] | undefined);

    if (!chainIdValue) {
      res.status(400).json({ error: "missing_chain" });
      return;
    }

    const chainId = Number(chainIdValue);

    if (!Number.isFinite(chainId)) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const chain = getChainById(chainId);

    if (!chain || !chain.supported) {
      res.status(400).json({ error: "unsupported_chain" });
      return;
    }

    const cursorParam =
      coerceSingleValue(req.query.cursor as string | string[] | undefined) ?? null;
    const limitParam = parseLimit(
      coerceSingleValue(req.query.limit as string | string[] | undefined),
    );

    try {
      const activity = await getAddressActivity({
        chainId: chain.id,
        address: req.params.address,
        limit: limitParam,
        cursor: cursorParam,
      });

      res.json({
        items: activity.items,
        tokenTransfers: activity.tokenTransfers,
        transactions: activity.transactions,
        nextCursor: activity.nextCursor ?? null,
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("invalid address")) {
        res.status(400).json({ error: "invalid_address" });
        return;
      }

      console.error("Failed to load address activity", error);
      res.status(500).json({ error: "address_activity_unavailable" });
    }
  });

  return router;
}
