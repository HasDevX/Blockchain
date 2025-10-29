import { Request, Response, Router } from "express";
import {
  findChainEndpointByUrl,
  getChainEndpoint,
  updateChainEndpoint,
} from "../../services/chainConfigService";

interface RpcTestResultSuccess {
  ok: true;
  tip: string;
  latency_ms: number;
}

interface RpcTestResultFailure {
  ok: false;
  error: string;
  message?: string;
  status?: number;
}

export function createTestRpcRouter(): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const chainIdRaw = req.body?.chainId;
    const chainId = typeof chainIdRaw === "number" ? chainIdRaw : parseChainId(chainIdRaw);
    const endpointId = parseEndpointId(req.body?.endpointId);
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";

    if (!url) {
      res.status(400).json({ ok: false, error: "invalid_url" });
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      res.status(400).json({ ok: false, error: "invalid_url" });
      return;
    }

    const startedAt = Date.now();
    let outcome: RpcTestResultSuccess | RpcTestResultFailure | null = null;
    let latency = 0;

    try {
      const payload = buildRpcPayload();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      latency = Date.now() - startedAt;

      if (response.status === 401 || response.status === 403) {
        outcome = { ok: false, error: "unauthorized" } satisfies RpcTestResultFailure;
      } else if (!response.ok) {
        outcome = {
          ok: false,
          error: "http_error",
          status: response.status,
        } satisfies RpcTestResultFailure;
      } else {
        const body = (await response.json()) as RpcResponsePayload;

        if ("error" in body && body.error) {
          outcome = {
            ok: false,
            error: "rpc_error",
            message: body.error.message ?? "error",
          } satisfies RpcTestResultFailure;
        } else if (!("result" in body)) {
          outcome = {
            ok: false,
            error: "rpc_error",
            message: "missing_result",
          } satisfies RpcTestResultFailure;
        } else {
          const tip = body.result;

          if (!isValidHexBlock(tip)) {
            outcome = { ok: false, error: "invalid_hex" } satisfies RpcTestResultFailure;
          } else {
            outcome = { ok: true, tip, latency_ms: latency } satisfies RpcTestResultSuccess;
          }
        }
      }
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      console.error("rpc test failed", { chainId, url, error: message });
      outcome = {
        ok: false,
        error: "timeout",
        message,
      } satisfies RpcTestResultFailure;
    }

    if (!outcome) {
      outcome = { ok: false, error: "rpc_error", message: "unknown_outcome" };
    }

    if (chainId !== null) {
      await recordEndpointHealth({ chainId, endpointId, url, outcome }).catch((error: unknown) => {
        const message = (error as Error).message ?? String(error);
        console.error("failed to record rpc test health", { chainId, endpointId, url, error: message });
      });
    }

    res.json(outcome);
  });

  return router;
}

function parseChainId(raw: unknown): number | null {
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function parseEndpointId(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof raw === "number" && Number.isInteger(raw)) {
    return String(raw);
  }

  return null;
}

async function recordEndpointHealth(params: {
  chainId: number;
  endpointId: string | null;
  url: string;
  outcome: RpcTestResultSuccess | RpcTestResultFailure;
}): Promise<void> {
  const { chainId, endpointId, url, outcome } = params;

  let record = endpointId ? await getChainEndpoint(chainId, endpointId) : null;

  if (!record) {
    record = await findChainEndpointByUrl(chainId, url);
  }

  if (!record) {
    return;
  }

  const lastHealth = outcome.ok ? formatSuccessHealth(outcome) : formatFailureHealth(outcome);

  await updateChainEndpoint(chainId, record.id, {
    lastHealth,
    lastCheckedAt: new Date(),
  });
}

function buildRpcPayload() {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "eth_blockNumber",
    params: [] as const,
  };
}

function formatSuccessHealth(outcome: RpcTestResultSuccess): string {
  return `tip ${outcome.tip}`;
}

function formatFailureHealth(outcome: RpcTestResultFailure): string {
  switch (outcome.error) {
    case "http_error": {
      const status = outcome.status ? `:${outcome.status}` : "";
      return `http_error${status}`;
    }
    case "rpc_error": {
      const message = outcome.message ? `:${truncateHealthMessage(outcome.message)}` : "";
      return `rpc_error${message}`;
    }
    default:
      return outcome.error;
  }
}

function truncateHealthMessage(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }

  return `${trimmed.slice(0, 57)}…`;
}

type RpcResponsePayload =
  | {
      jsonrpc: "2.0";
      id: number;
      result: string;
    }
  | {
      jsonrpc: "2.0";
      id: number;
      error?: {
        code?: number;
        message?: string;
      };
    };

function isValidHexBlock(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!value.startsWith("0x")) {
    return false;
  }

  if (value.length <= 2) {
    return false;
  }

  return /^[0-9a-fA-F]+$/.test(value.slice(2));
}
