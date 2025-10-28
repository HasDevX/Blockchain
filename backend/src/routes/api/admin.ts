import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import { requireAdmin, requireAuth } from "../../middleware/auth";
import { getAdminStatus } from "../../services/adminDashboardService";
import { createChainConfigsRouter } from "../admin/chainConfigs";
import { createIndexJobsRouter } from "../admin/indexJobs";
import { createTestRpcRouter } from "../admin/testRpc";
import { registerConnectionRoutes } from "../admin/connections";

export function createAdminRouter(adminLimiter: RateLimitRequestHandler) {
  const router = Router();

  router.use(adminLimiter);
  router.use(requireAuth);
  router.use(requireAdmin);

  router.get("/settings", (req: Request, res: Response) => {
    const userEmail = req.user?.email ?? "unknown";

    res.json({
      settings: {
        maintenanceMode: false,
        lastUpdatedBy: userEmail,
        announcement: null,
      },
    });
  });

  router.head("/settings", (_req: Request, res: Response) => {
    res.status(200).end();
  });

  router.use("/chain-configs", createChainConfigsRouter());
  router.use("/index-jobs", createIndexJobsRouter());
  router.use("/test-rpc", createTestRpcRouter());
  registerConnectionRoutes(router);

  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const payload = await getAdminStatus();
      res.json(payload);
    } catch (error) {
      console.error("failed to load admin status", error);
      res.status(500).json({ error: "status_unavailable" });
    }
  });

  return router;
}
