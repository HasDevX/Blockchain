import express from "express";
import helmet from "helmet";
import { loadEnv } from "./config/env";
import { createStrictCors } from "./middleware/strictCors";
import { createRateLimiters } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { createApiRouter } from "./routes/api";
import { createHealthRouter } from "./routes/health";

const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
};

export async function createApp() {
  const env = loadEnv();
  const app = express();

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
  app.use(createStrictCors(env));

  const rateLimiters = await createRateLimiters(env);

  app.use(createHealthRouter());
  app.use("/api", createApiRouter(rateLimiters));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
