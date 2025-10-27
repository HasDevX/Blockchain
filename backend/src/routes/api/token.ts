import { Request, Response, Router } from "express";
import { getChainById } from "../../config/chains";
import { getTokenHolders } from "../../services/tokenService";

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

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return String(Math.floor(parsed));
}

export function createTokenRouter() {
  const router = Router();

  router.get("/:address/holders", (req: Request, res: Response) => {
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

    const holders = getTokenHolders(chain.id, req.params.address.toLowerCase(), cursor, limit);

    if (!holders) {
      res.status(404).json({ error: "token_not_found" });
      return;
    }

    res.json({
      items: holders.items,
      nextCursor: holders.nextCursor,
    });
  });

  return router;
}
