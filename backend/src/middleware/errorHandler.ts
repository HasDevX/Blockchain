import { NextFunction, Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (err instanceof Error && err.message === "Not allowed by CORS") {
    res.status(403).json({ error: "cors_not_allowed" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "internal_error" });
}
