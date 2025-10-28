import { Request, Response, Router } from "express";
import { RpcClient, toHex } from "../../lib/rpcClient";

export function createTestRpcRouter(): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";

    if (!url) {
      res.status(400).json({ ok: false, error: "invalid_url" });
      return;
    }

    try {
      const client = new RpcClient(url);
      const tip = await client.getBlockNumber();
      res.json({ ok: true, tip: toHex(tip) });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      console.error("rpc test failed", error);
      res.status(400).json({ ok: false, error: "rpc_error", message });
    }
  });

  return router;
}
