import express from "express";
import helmet from "helmet";
import { loadWebEnv } from "./config/env";
import { createStrictCors } from "./middleware/strictCors";
import { createRateLimiters } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { createApiRouter } from "./routes/api";
import { createHealthRouter } from "./routes/health";
import { getGitSha } from "./lib/gitInfo";

const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
};

export async function createApp() {
  const env = loadWebEnv();
  const app = express();

  getGitSha();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: CSP_DIRECTIVES,
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  const rateLimiters = await createRateLimiters(env);

  const healthRouter = createHealthRouter();
  app.use(healthRouter);
  app.use("/api", healthRouter);
  app.use("/api", createStrictCors(env), createApiRouter(rateLimiters));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
