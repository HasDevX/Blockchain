import { Request, Response, Router } from "express";
import { getPool } from "../../lib/db";
import {
  fetchChainConfig,
  fetchChainConfigs,
  toChainConfigSummary,
  upsertChainConfig,
} from "../../services/chainConfigService";
import { invalidateChainConfigCache } from "../../services/chainConfigProvider";

export function createChainConfigsRouter(): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const configs = await fetchChainConfigs(getPool());
      res.json({ configs: toChainConfigSummary(configs) });
    } catch (error) {
      console.error("failed to fetch chain configs", error);
      res.status(500).json({ error: "chain_configs_unavailable" });
    }
  });

  router.put("/:chainId", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);

    if (chainId === null) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const validation = validateChainConfigPayload(req.body ?? {});

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    try {
      const pool = getPool();
      const current = await fetchChainConfig(chainId, pool);

      const minSpanCandidate =
        validation.updates.minSpan !== undefined ? validation.updates.minSpan : current.minSpan;
      const maxSpanCandidate =
        validation.updates.maxSpan !== undefined ? validation.updates.maxSpan : current.maxSpan;

      if (maxSpanCandidate < minSpanCandidate) {
        res.status(400).json({ error: "span_mismatch" });
        return;
      }

      const record = await upsertChainConfig(chainId, validation.updates, pool);
      invalidateChainConfigCache();
      const [summary] = toChainConfigSummary([record]);
      res.json({ config: summary });
    } catch (error) {
      console.error("failed to upsert chain config", error);
      res.status(500).json({ error: "chain_config_save_failed" });
    }
  });

  return router;
}

function parseChainId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

interface ValidationSuccess {
  ok: true;
  updates: Parameters<typeof upsertChainConfig>[1];
}

interface ValidationFailure {
  ok: false;
  error: string;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

function validateChainConfigPayload(payload: Record<string, unknown>): ValidationResult {
  const updates: Parameters<typeof upsertChainConfig>[1] = {};

  if (payload.name !== undefined) {
    if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
      return { ok: false, error: "invalid_name" };
    }
    updates.name = payload.name.trim();
  }

  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      return { ok: false, error: "invalid_enabled" };
    }
    updates.enabled = payload.enabled;
  }

  if (payload.rpcUrl !== undefined) {
    if (payload.rpcUrl !== null && typeof payload.rpcUrl !== "string") {
      return { ok: false, error: "invalid_rpc_url" };
    }
    updates.rpcUrl = payload.rpcUrl === null ? null : (payload.rpcUrl as string).trim();
  }

  if (payload.etherscanApiKey !== undefined) {
    if (payload.etherscanApiKey !== null && typeof payload.etherscanApiKey !== "string") {
      return { ok: false, error: "invalid_etherscan_key" };
    }
    updates.etherscanApiKey =
      payload.etherscanApiKey === null ? null : (payload.etherscanApiKey as string).trim();
  }

  if (payload.startBlock !== undefined) {
    if (payload.startBlock === null || `${payload.startBlock}`.trim().length === 0) {
      updates.startBlock = null;
    } else {
      try {
        const parsed = BigInt(payload.startBlock as string | number);
        if (parsed < 0n) {
          return { ok: false, error: "invalid_start_block" };
        }
        updates.startBlock = parsed;
      } catch (error) {
        return { ok: false, error: "invalid_start_block" };
      }
    }
  }

  if (payload.qps !== undefined) {
    if (!isPositiveInteger(payload.qps)) {
      return { ok: false, error: "invalid_qps" };
    }
    updates.qps = Number(payload.qps);
  }

  if (payload.minSpan !== undefined) {
    if (!isPositiveInteger(payload.minSpan)) {
      return { ok: false, error: "invalid_min_span" };
    }
    updates.minSpan = Number(payload.minSpan);
  }

  if (payload.maxSpan !== undefined) {
    if (!isPositiveInteger(payload.maxSpan)) {
      return { ok: false, error: "invalid_max_span" };
    }
    updates.maxSpan = Number(payload.maxSpan);
  }

  if (updates.minSpan !== undefined && updates.maxSpan !== undefined) {
    if (updates.maxSpan < updates.minSpan) {
      return { ok: false, error: "span_mismatch" };
    }
  }

  return { ok: true, updates };
}

function isPositiveInteger(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0;
  }

  if (typeof value === "string") {
    if (value.trim().length === 0) {
      return false;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0;
  }

  return false;
}
