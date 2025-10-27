import { Request, Response, Router } from "express";
import { RateLimitRequestHandler } from "express-rate-limit";

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
      res.status(400).json({ error: "invalid_credentials" });
      return;
    }

    const isAdmin = email.toLowerCase() === "admin@explorertoken.dev";

    res.json({
      token: isAdmin ? "admin-dev-token" : "user-dev-token",
      user: {
        email,
        roles: isAdmin ? ["admin"] : ["user"],
      },
    });
  });

  return router;
}
