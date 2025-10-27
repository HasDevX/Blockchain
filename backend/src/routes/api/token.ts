import { Request, Response, Router } from "express";
import { getChainById } from "../../config/chains";
import {
  EtherscanUpstreamError,
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

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return String(Math.floor(parsed));
}

export function createTokenRouter() {
  const router = Router();

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

      const payload: { items: typeof holders.items; nextCursor?: string } = {
        items: holders.items,
      };

      if (holders.nextCursor) {
        payload.nextCursor = holders.nextCursor;
      }

      res.json(payload);
    } catch (error: unknown) {
      if (error instanceof UnsupportedChainError) {
        res.status(400).json({ error: "unsupported_chain" });
        return;
      }

      if (error instanceof EtherscanUpstreamError) {
        const upstream = error;
        console.error(
          JSON.stringify({
            event: "holders.vendor.error",
            vendor: "etherscan",
            chainId: upstream.chainId,
            host: upstream.host,
            httpStatus: upstream.httpStatus,
            vendorStatus: upstream.vendorStatus,
            vendorMessage: upstream.vendorMessage,
          }),
        );
        res.status(502).json({
          error: "upstream_error",
          vendor: "etherscan",
          status: upstream.vendorStatus ?? null,
          message: upstream.vendorMessage ?? null,
        });
        return;
      }

      console.error("Failed to load token holders", error);
      res.status(502).json({ error: "upstream_error", vendor: "unknown" });
    }
  });

  return router;
}
