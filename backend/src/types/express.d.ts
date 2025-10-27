import { Request } from "express";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      roles: string[];
    }

    interface Request {
      user?: User;
    }
  }
}

export type AuthenticatedRequest = Request & { user: Express.User };
