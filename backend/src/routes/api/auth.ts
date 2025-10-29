import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { loadWebEnv } from "../../config/env";
import {
  checkDbPassword,
  dbFindUserByEmail,
  getDefaultPool,
  getEnvAdmin,
  safeEq,
} from "../../lib/auth";

interface LoginRequestBody {
  email?: string;
  username?: string;
  password?: string;
}

const TOKEN_EXPIRATION = "12h";

export function createAuthRouter(loginLimiter: RateLimitRequestHandler) {
  const router = Router();

  router.post("/login", loginLimiter, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LoginRequestBody;
    const identifier =
      typeof body.email === "string" && body.email.trim().length > 0
        ? body.email.trim()
        : typeof body.username === "string" && body.username.trim().length > 0
          ? body.username.trim()
          : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

  const env = loadWebEnv();
    const pool = env.databaseUrl ? getDefaultPool() : null;
    const normalizedIdentifier = identifier.toLowerCase();

    if (pool) {
      try {
        const dbUser = await dbFindUserByEmail(pool, identifier);

        if (dbUser && dbUser.passwordHash) {
          const passwordMatches = await checkDbPassword(password, dbUser.passwordHash);

          if (passwordMatches) {
            const token = jwt.sign(
              {
                sub: `user:${dbUser.id}`,
                email: dbUser.email,
                role: dbUser.role ?? "admin",
              },
              env.jwtSecret,
              { expiresIn: TOKEN_EXPIRATION },
            );

            res.json({
              token,
              user: {
                id: dbUser.id,
                email: dbUser.email,
                role: dbUser.role ?? "admin",
                source: "database" as const,
              },
            });
            return;
          }
        }
      } catch (error) {
        console.warn("login lookup failed for database user");
      }
    }

    const envAdmin = getEnvAdmin();

    if (!envAdmin) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const identifierMatches = safeEq(normalizedIdentifier, envAdmin.email.toLowerCase());
    let passwordMatches = false;

    if (envAdmin.password) {
      passwordMatches = safeEq(password, envAdmin.password) || passwordMatches;
    }

    if (!passwordMatches && envAdmin.passwordHash) {
      passwordMatches = await checkDbPassword(password, envAdmin.passwordHash);
    }

    if (!identifierMatches || !passwordMatches) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const token = jwt.sign(
      {
        sub: "admin",
        email: envAdmin.email,
        role: "admin",
      },
      env.jwtSecret,
      { expiresIn: TOKEN_EXPIRATION },
    );

    res.json({
      token,
      user: {
        id: "env-admin",
        email: envAdmin.email,
        role: "admin",
        source: "env" as const,
      },
    });
  });

  return router;
}
