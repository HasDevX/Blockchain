import cors, { CorsOptions } from "cors";
import { RequestHandler } from "express";
import { AppEnv } from "../config/env";

export function createStrictCors(env: AppEnv): RequestHandler {
  const allowedOrigins = new Set(env.frontendOrigins);

  const options: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.has(origin));
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    optionsSuccessStatus: 204,
  };

  return cors(options);
}
