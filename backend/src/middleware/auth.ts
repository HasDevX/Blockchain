import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { loadWebEnv } from "../config/env";

const UNAUTHORIZED_STATUS = 401;
const TOKEN_PREFIX = "bearer ";

function parseAuthHeader(headerValue?: string): string | null {
  if (!headerValue) {
    return null;
  }

  const normalized = headerValue.toLowerCase();
  if (!normalized.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  return headerValue.slice(TOKEN_PREFIX.length).trim();
}

export function authenticateRequest(req: Request, _res: Response, next: NextFunction) {
  const user = resolveAdminUser(req.headers.authorization);

  if (user) {
    req.user = user;
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = resolveAdminUser(req.headers.authorization);

  if (!user) {
    res.status(UNAUTHORIZED_STATUS).json({ error: "unauthorized" });
    return;
  }

  req.user = user;
  next();
}

export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user || !user.roles.includes("admin")) {
    res.status(UNAUTHORIZED_STATUS).json({ error: "forbidden" });
    return;
  }

  next();
};

function resolveAdminUser(headerValue?: string): Express.User | null {
  const rawToken = parseAuthHeader(headerValue);

  if (!rawToken) {
    return null;
  }

  const env = loadWebEnv();

  try {
    const payload = jwt.verify(rawToken, env.jwtSecret) as JwtPayload & { email?: string };

    if (payload.sub !== "admin") {
      return null;
    }

    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : env.adminEmail;

    return {
      id: "admin",
      email,
      roles: ["admin"],
    };
  } catch {
    return null;
  }
}
