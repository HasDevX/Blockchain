import { Request, Response, Router } from "express";
import { getChainById } from "../../config/chains";
import { normalizeAddress } from "../../services/holderStore";
import {
  getTokenChainCoverage,
  getTokenHolders,
  UnsupportedChainError,
} from "../../services/tokenService";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function coerceSingleValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

function parseLimit(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  const normalized = Math.floor(parsed);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_LIMIT) {
    return MAX_LIMIT;
  }

  return normalized;
}

function sanitizeCursor(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const [balancePart, holderPart] = trimmed.split(":");

  if (!balancePart || !holderPart) {
    return null;
  }

  if (!/^[0-9]+$/.test(balancePart)) {
    return null;
  }

  try {
    const normalizedHolder = normalizeAddress(holderPart);
    return `${balancePart}:${normalizedHolder}`;
  } catch (error) {
    console.warn("invalid cursor holder", error);
    return null;
  }
}

export function createTokenRouter() {
  const router = Router();

  router.get("/:address/chains", async (req: Request, res: Response) => {
    try {
      const chains = await getTokenChainCoverage(req.params.address);
      res.json({ chains });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("invalid address")) {
        res.status(400).json({ error: "invalid_address" });
        return;
      }

      console.error("Failed to load token chain coverage", error);
      res.status(500).json({ error: "token_chains_unavailable" });
    }
  });

  router.get("/:address/holders", async (req: Request, res: Response) => {
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

    const limitParam = coerceSingleValue(req.query.limit as string | string[] | undefined);
    const cursorParam = coerceSingleValue(req.query.cursor as string | string[] | undefined);

    const limit = parseLimit(limitParam);
    const cursor = sanitizeCursor(cursorParam);

    try {
      const holders = await getTokenHolders({
        chainId: chain.id,
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
    } catch (error: unknown) {
      if (error instanceof UnsupportedChainError) {
        res.status(400).json({ error: "unsupported_chain" });
        return;
      }

      console.error("Failed to load token holders", error);
      res.status(500).json({ error: "holders_unavailable" });
    }
  });

  return router;
}
