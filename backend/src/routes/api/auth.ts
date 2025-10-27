import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { loadEnv } from "../../config/env";

interface LoginRequestBody {
  email?: string;
  password?: string;
}

export function createAuthRouter(loginLimiter: RateLimitRequestHandler) {
  const router = Router();

  router.post("/login", loginLimiter, (req: Request, res: Response) => {
    const body = req.body as LoginRequestBody;
    const email = body?.email?.trim();
    const password = body?.password;

    if (!email || !password) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const env = loadEnv();

    if (email.toLowerCase() !== env.adminEmail || password !== env.adminPassword) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const token = jwt.sign({ sub: "admin", email: env.adminEmail }, env.jwtSecret, {
      expiresIn: "12h",
    });

    res.json({ token });
  });

  return router;
}
