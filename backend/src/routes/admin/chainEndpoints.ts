import { Router } from "express";
import { registerConnectionRoutes } from "./connections";

export function createChainEndpointsRouter(): Router {
  const router = Router();
  registerConnectionRoutes(router);
  return router;
}
