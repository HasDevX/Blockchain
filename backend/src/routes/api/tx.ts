import { Request, Response, Router } from "express";
import { getChainById } from "../../config/chains";
import { getTransactionDetails, InvalidTransactionHashError } from "../../services/executionStore";

function coerceSingleValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

export function createTxRouter() {
  const router = Router();

  router.get("/:hash", async (req: Request, res: Response) => {
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

    try {
      const transaction = await getTransactionDetails(chain.id, req.params.hash);

      if (!transaction) {
        res.status(404).json({ error: "transaction_not_found" });
        return;
      }

      res.json({ transaction });
    } catch (error: unknown) {
      if (error instanceof InvalidTransactionHashError) {
        res.status(400).json({ error: "invalid_hash" });
        return;
      }

      console.error("Failed to load transaction details", error);
      res.status(500).json({ error: "transaction_unavailable" });
    }
  });

  return router;
}
