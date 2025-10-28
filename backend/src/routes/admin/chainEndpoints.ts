import { Request, Response, Router } from "express";
import {
  ChainEndpointRecord,
  createChainEndpoint,
  disableChainEndpoint,
  listChainEndpoints,
  maskSecret,
  updateChainEndpoint,
} from "../../services/chainConfigService";
import { invalidateChainConfigCache } from "../../services/chainConfigProvider";

export function createChainEndpointsRouter(): Router {
  const router = Router();

  router.get("/:chainId", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);

    if (chainId === null) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const reveal = req.query.reveal === "1";

    try {
      const endpoints = await listChainEndpoints(chainId, { includeDisabled: true });
      res.json({ endpoints: endpoints.map((endpoint) => serializeEndpoint(endpoint, reveal)) });
    } catch (error) {
      console.error("failed to list chain endpoints", error);
      res.status(500).json({ error: "chain_endpoints_unavailable" });
    }
  });

  router.post("/:chainId", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);

    if (chainId === null) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    const validation = validateEndpointPayload(req.body ?? {}, { partial: false });

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    if (!validation.value.label || !validation.value.url) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    try {
      const record = await createChainEndpoint(chainId, {
        label: validation.value.label,
        url: validation.value.url,
        qps: validation.value.qps ?? 1,
        weight: validation.value.weight ?? 1,
        enabled: validation.value.enabled ?? true,
      });
      invalidateChainConfigCache();
      res.status(201).json({ endpoint: serializeEndpoint(record, false) });
    } catch (error) {
      console.error("failed to create chain endpoint", error);
      res.status(500).json({ error: "chain_endpoint_create_failed" });
    }
  });

  router.put("/:chainId/:endpointId", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);
    const endpointId = req.params.endpointId;

    if (chainId === null) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    if (!endpointId || typeof endpointId !== "string") {
      res.status(400).json({ error: "invalid_endpoint" });
      return;
    }

    const validation = validateEndpointPayload(req.body ?? {}, { partial: true });

    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    if (Object.keys(validation.value).length === 0) {
      res.status(400).json({ error: "no_updates" });
      return;
    }

    try {
      const updated = await updateChainEndpoint(chainId, endpointId, validation.value);

      if (!updated) {
        res.status(404).json({ error: "endpoint_not_found" });
        return;
      }

      invalidateChainConfigCache();
      res.json({ endpoint: serializeEndpoint(updated, false) });
    } catch (error) {
      console.error("failed to update chain endpoint", error);
      res.status(500).json({ error: "chain_endpoint_update_failed" });
    }
  });

  router.delete("/:chainId/:endpointId", async (req: Request, res: Response) => {
    const chainId = parseChainId(req.params.chainId);
    const endpointId = req.params.endpointId;

    if (chainId === null) {
      res.status(400).json({ error: "invalid_chain" });
      return;
    }

    if (!endpointId || typeof endpointId !== "string") {
      res.status(400).json({ error: "invalid_endpoint" });
      return;
    }

    try {
      const disabled = await disableChainEndpoint(chainId, endpointId);

      if (!disabled) {
        res.status(404).json({ error: "endpoint_not_found" });
        return;
      }

      invalidateChainConfigCache();
      res.status(204).end();
    } catch (error) {
      console.error("failed to disable chain endpoint", error);
      res.status(500).json({ error: "chain_endpoint_disable_failed" });
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

function serializeEndpoint(endpoint: ChainEndpointRecord, reveal: boolean) {
  const displayUrl = reveal ? endpoint.url : maskSecret(endpoint.url);

  return {
    id: endpoint.id,
    chainId: endpoint.chainId,
    label: endpoint.label,
    url: displayUrl,
    masked: !reveal,
    qps: endpoint.qps,
    weight: endpoint.weight,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

interface ValidationSuccess {
  ok: true;
  value: {
    label?: string;
    url?: string;
    qps?: number;
    weight?: number;
    enabled?: boolean;
  };
}

interface ValidationFailure {
  ok: false;
  error: string;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

function validateEndpointPayload(
  payload: Record<string, unknown>,
  options: { partial: boolean },
): ValidationResult {
  const value: ValidationSuccess["value"] = {};
  const partial = options.partial;

  if (!partial || payload.label !== undefined) {
    if (typeof payload.label !== "string" || payload.label.trim().length === 0) {
      return { ok: false, error: "invalid_label" };
    }
    value.label = payload.label.trim();
  }

  if (!partial || payload.url !== undefined) {
    if (typeof payload.url !== "string" || payload.url.trim().length === 0) {
      return { ok: false, error: "invalid_url" };
    }
    value.url = payload.url.trim();
  }

  if (payload.qps !== undefined) {
    if (!isPositiveInteger(payload.qps)) {
      return { ok: false, error: "invalid_qps" };
    }
    value.qps = Number(payload.qps);
  } else if (!partial) {
    value.qps = 1;
  }

  if (payload.weight !== undefined) {
    if (!isPositiveInteger(payload.weight)) {
      return { ok: false, error: "invalid_weight" };
    }
    value.weight = Number(payload.weight);
  } else if (!partial) {
    value.weight = 1;
  }

  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      return { ok: false, error: "invalid_enabled" };
    }
    value.enabled = payload.enabled;
  } else if (!partial) {
    value.enabled = true;
  }

  return { ok: true, value };
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
