import { Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import { authenticateRequest } from "../../middleware/auth";
import { createAdminRouter } from "./admin";
import { createAuthRouter } from "./auth";
import { createChainsRouter } from "./chains";
import { createTokensRouter } from "./tokens";

interface ApiRouterOptions {
  loginLimiter: RateLimitRequestHandler;
  adminLimiter: RateLimitRequestHandler;
}

export function createApiRouter({ loginLimiter, adminLimiter }: ApiRouterOptions) {
  const router = Router();

  router.use(authenticateRequest);

  router.use("/chains", createChainsRouter());
  router.use("/auth", createAuthRouter(loginLimiter));
  router.use("/tokens", createTokensRouter());
  router.use("/admin", createAdminRouter(adminLimiter));

  return router;
}
