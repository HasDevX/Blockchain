import { Request, Response, Router } from "express";
import { getChainAdapter } from "../../config/chainAdapters";
import { withTransaction } from "../../lib/db";
import { normalizeAddress } from "../../services/holderStore";
import { createIndexJob } from "../../services/chainConfigService";
import { enqueueReindex } from "../../services/tokenHolderRepository";
import { summarizeJobs } from "../../services/adminDashboardService";

export function createIndexJobsRouter(): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const { chainId, tokenAddress, fromBlock } = req.body ?? {};

    if (!Number.isInteger(chainId)) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const adapter = getChainAdapter(Number(chainId));

    if (!adapter || !adapter.supported) {
      res.status(400).json({ error: "unsupported_chain" });
      return;
    }

    if (typeof tokenAddress !== "string" || tokenAddress.trim().length === 0) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    let normalizedToken: string;

    try {
      normalizedToken = normalizeAddress(tokenAddress);
    } catch (error) {
      console.warn("invalid token address", error);
      res.status(400).json({ error: "invalid_token" });
      return;
    }

    if (fromBlock === undefined || fromBlock === null || `${fromBlock}`.trim().length === 0) {
      res.status(400).json({ error: "invalid_from_block" });
      return;
    }

    let parsedFrom: bigint;

    try {
      parsedFrom = BigInt(fromBlock);
    } catch (error) {
      console.warn("invalid fromBlock", error);
      res.status(400).json({ error: "invalid_from_block" });
      return;
    }

    if (parsedFrom < 0n) {
      res.status(400).json({ error: "invalid_from_block" });
      return;
    }

    try {
      const job = await withTransaction(async (client) => {
        await enqueueReindex(client, Number(chainId), normalizedToken, parsedFrom);
        return createIndexJob(
          {
            chainId: Number(chainId),
            tokenAddress: normalizedToken,
            fromBlock: parsedFrom,
          },
          client,
        );
      });

      res.status(201).json({ job: summarizeJobs([job])[0] });
    } catch (error) {
      console.error("failed to enqueue index job", error);
      res.status(500).json({ error: "index_job_failed" });
    }
  });

  return router;
}
