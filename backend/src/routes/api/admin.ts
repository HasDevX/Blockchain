import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import { requireAdmin, requireAuth } from "../../middleware/auth";

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

  return router;
}
