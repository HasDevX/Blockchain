import { NextFunction, Request, RequestHandler, Response } from "express";

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
  const token = parseAuthHeader(req.headers.authorization);

  if (token) {
    if (token === "admin-dev-token") {
      req.user = {
        id: "admin",
        email: "admin@explorertoken.dev",
        roles: ["admin"],
      };
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(UNAUTHORIZED_STATUS).json({ error: "unauthorized" });
    return;
  }

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
