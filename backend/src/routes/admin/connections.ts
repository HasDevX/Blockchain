import { Request, Response, Router } from "express";
import {
  ChainEndpointRecord,
  createChainEndpoint,
  disableChainEndpoint,
  fetchChainConfigs,
  getChainEndpoint,
  listAllChainEndpoints,
  unsetPrimaryForOtherEndpoints,
  updateChainEndpoint,
} from "../../services/chainConfigService";
import { invalidateChainConfigCache } from "../../services/chainConfigProvider";

export function registerConnectionRoutes(router: Router): void {
  router.get("/connections", handleListConnections);
  router.post("/chains/:chainId/endpoints", handleCreateEndpoint);
  router.put("/chains/:chainId/endpoints/:endpointId", handleUpdateEndpoint);
  router.delete("/chains/:chainId/endpoints/:endpointId", handleDeleteEndpoint);
}

async function handleListConnections(_req: Request, res: Response) {
  try {
    const [configs, endpoints] = await Promise.all([
      fetchChainConfigs(),
      listAllChainEndpoints({ includeDisabled: true }),
    ]);

    const grouped = new Map<number, ChainEndpointRecord[]>();

    for (const endpoint of endpoints) {
      if (!grouped.has(endpoint.chainId)) {
        grouped.set(endpoint.chainId, []);
      }
      grouped.get(endpoint.chainId)!.push(endpoint);
    }

    const chains = configs.map((config) => ({
      chain_id: config.chainId,
      name: config.name,
      endpoints: (grouped.get(config.chainId) ?? []).map(serializeEndpoint),
    }));

    res.json({ chains });
  } catch (error) {
    console.error("failed to list admin connections", error);
    res.status(500).json({ error: "connections_unavailable" });
  }
}

async function handleCreateEndpoint(req: Request, res: Response) {
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

  const { value } = validation;

  try {
    const record = await createChainEndpoint(chainId, {
      url: value.url!,
      label: value.label ?? null,
      isPrimary: value.isPrimary ?? false,
      enabled: value.enabled ?? true,
      qps: value.qps ?? 1,
      minSpan: value.minSpan ?? 8,
      maxSpan: value.maxSpan ?? Math.max(value.minSpan ?? 8, 1000),
      weight: value.weight ?? 1,
      orderIndex: value.orderIndex ?? 0,
    });

    if (value.isPrimary) {
      await unsetPrimaryForOtherEndpoints(chainId, record.id);
    }

    invalidateChainConfigCache();
    res.status(201).json({ endpoint: serializeEndpoint(record) });
  } catch (error) {
    console.error("failed to create chain endpoint", error);
    res.status(500).json({ error: "chain_endpoint_create_failed" });
  }
}

async function handleUpdateEndpoint(req: Request, res: Response) {
  const chainId = parseChainId(req.params.chainId);
  const endpointId = parseEndpointId(req.params.endpointId);

  if (chainId === null) {
    res.status(400).json({ error: "invalid_chain" });
    return;
  }

  if (!endpointId) {
    res.status(400).json({ error: "invalid_endpoint" });
    return;
  }

  const validation = validateEndpointPayload(req.body ?? {}, { partial: true });

  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const updates = validation.value;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "no_updates" });
    return;
  }

  try {
    const current = await getChainEndpoint(chainId, endpointId);

    if (!current) {
      res.status(404).json({ error: "endpoint_not_found" });
      return;
    }

    const merged = {
      minSpan: updates.minSpan ?? current.minSpan,
      maxSpan: updates.maxSpan ?? current.maxSpan,
    };

    if (merged.minSpan < 1) {
      res.status(400).json({ error: "invalid_min_span" });
      return;
    }

    if (merged.maxSpan < merged.minSpan) {
      res.status(400).json({ error: "span_mismatch" });
      return;
    }

    const updated = await updateChainEndpoint(chainId, endpointId, updates);

    if (!updated) {
      res.status(404).json({ error: "endpoint_not_found" });
      return;
    }

    if (updates.isPrimary === true) {
      await unsetPrimaryForOtherEndpoints(chainId, updated.id);
    }

    invalidateChainConfigCache();
    res.json({ endpoint: serializeEndpoint(updated) });
  } catch (error) {
    console.error("failed to update chain endpoint", error);
    res.status(500).json({ error: "chain_endpoint_update_failed" });
  }
}

async function handleDeleteEndpoint(req: Request, res: Response) {
  const chainId = parseChainId(req.params.chainId);
  const endpointId = parseEndpointId(req.params.endpointId);

  if (chainId === null) {
    res.status(400).json({ error: "invalid_chain" });
    return;
  }

  if (!endpointId) {
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
}

function parseChainId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseEndpointId(raw: string | undefined): string | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  return raw.trim();
}

function serializeEndpoint(endpoint: ChainEndpointRecord) {
  return {
    id: endpoint.id,
    chain_id: endpoint.chainId,
    label: endpoint.label,
    url: endpoint.url,
    is_primary: endpoint.isPrimary,
    enabled: endpoint.enabled,
    qps: endpoint.qps,
    min_span: endpoint.minSpan,
    max_span: endpoint.maxSpan,
    weight: endpoint.weight,
    order_index: endpoint.orderIndex,
    last_health: endpoint.lastHealth,
    last_checked_at: endpoint.lastCheckedAt ? endpoint.lastCheckedAt.toISOString() : null,
    updated_at: endpoint.updatedAt.toISOString(),
  };
}

type ValidationResult =
  | { ok: true; value: EndpointPayload }
  | { ok: false; error: string };

type EndpointPayload = Partial<{
  url: string;
  label: string | null;
  isPrimary: boolean;
  enabled: boolean;
  qps: number;
  minSpan: number;
  maxSpan: number;
  weight: number;
  orderIndex: number;
}>;

function validateEndpointPayload(
  payload: Record<string, unknown>,
  options: { partial: boolean },
): ValidationResult {
  const value: EndpointPayload = {};
  const partial = options.partial;

  if (!partial || payload.url !== undefined) {
    if (typeof payload.url !== "string" || payload.url.trim().length === 0) {
      return { ok: false, error: "invalid_url" };
    }

    const normalized = payload.url.trim();

    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      return { ok: false, error: "invalid_url" };
    }

    value.url = normalized;
  }

  if (payload.label !== undefined) {
    if (payload.label === null) {
      value.label = null;
    } else if (typeof payload.label !== "string") {
      return { ok: false, error: "invalid_label" };
    } else {
      const normalized = payload.label.trim();
      if (normalized.length === 0) {
        value.label = null;
      } else if (normalized.length > 80) {
        return { ok: false, error: "invalid_label" };
      } else {
        value.label = normalized;
      }
    }
  } else if (!partial) {
    value.label = null;
  }

  if (payload.is_primary !== undefined || (!partial && payload.is_primary === undefined)) {
    if (payload.is_primary !== undefined && typeof payload.is_primary !== "boolean") {
      return { ok: false, error: "invalid_is_primary" };
    }

    if (payload.is_primary !== undefined) {
      value.isPrimary = payload.is_primary;
    } else if (!partial) {
      value.isPrimary = false;
    }
  }

  if (payload.enabled !== undefined || (!partial && payload.enabled === undefined)) {
    if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
      return { ok: false, error: "invalid_enabled" };
    }

    if (payload.enabled !== undefined) {
      value.enabled = payload.enabled;
    } else if (!partial) {
      value.enabled = true;
    }
  }

  if (payload.qps !== undefined) {
    const parsed = parseInteger(payload.qps);
    if (parsed === null || parsed < 0) {
      return { ok: false, error: "invalid_qps" };
    }
    value.qps = parsed;
  } else if (!partial) {
    value.qps = 1;
  }

  if (payload.min_span !== undefined) {
    const parsed = parseInteger(payload.min_span);
    if (parsed === null || parsed < 1) {
      return { ok: false, error: "invalid_min_span" };
    }
    value.minSpan = parsed;
  } else if (!partial) {
    value.minSpan = 8;
  }

  if (payload.max_span !== undefined) {
    const parsed = parseInteger(payload.max_span);
    if (parsed === null || parsed < 1) {
      return { ok: false, error: "invalid_max_span" };
    }
    value.maxSpan = parsed;
  } else if (!partial) {
    value.maxSpan = 1000;
  }

  if (payload.weight !== undefined) {
    const parsed = parseInteger(payload.weight);
    if (parsed === null || parsed < 1) {
      return { ok: false, error: "invalid_weight" };
    }
    value.weight = parsed;
  } else if (!partial) {
    value.weight = 1;
  }

  if (payload.order_index !== undefined) {
    const parsed = parseInteger(payload.order_index);
    if (parsed === null || parsed < 0) {
      return { ok: false, error: "invalid_order_index" };
    }
    value.orderIndex = parsed;
  } else if (!partial) {
    value.orderIndex = 0;
  }

  if (value.minSpan !== undefined && value.maxSpan !== undefined && value.maxSpan < value.minSpan) {
    return { ok: false, error: "span_mismatch" };
  }

  return { ok: true, value };
}

function parseInteger(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}
