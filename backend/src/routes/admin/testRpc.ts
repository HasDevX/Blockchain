import { Request, Response, Router } from "express";

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

    try {
      const payload = buildRpcPayload();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const latency = Date.now() - startedAt;

      if (response.status === 401 || response.status === 403) {
        res.json({ ok: false, error: "unauthorized" });
        return;
      }

      if (!response.ok) {
        res.json({ ok: false, error: "http_error", status: response.status });
        return;
      }

      const body = (await response.json()) as RpcResponsePayload;

      if ("error" in body && body.error) {
        res.json({ ok: false, error: "rpc_error", message: body.error.message ?? "error" });
        return;
      }

      if (!("result" in body)) {
        res.json({ ok: false, error: "rpc_error", message: "missing_result" });
        return;
      }

      const tip = body.result;

      if (!isValidHexBlock(tip)) {
        res.json({ ok: false, error: "invalid_hex" });
        return;
      }

      res.json({ ok: true, tip, latency_ms: latency } satisfies RpcTestResultSuccess);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      console.error("rpc test failed", { chainId, url, error: message });
      res.json({ ok: false, error: "network_error", message } satisfies RpcTestResultFailure);
    }
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

function buildRpcPayload() {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "eth_blockNumber",
    params: [] as const,
  };
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
