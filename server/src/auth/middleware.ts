import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ApiError, unauthorized } from "../lib/errors.js";
import { resolveSession } from "./session.js";

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const resolved = await resolveSession(req);
    if (resolved) {
      req.user = resolved.user;
      req.sessionId = resolved.sessionId;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

export function verifyOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  // Native clients / curl do not send Origin. Browsers do; SameSite=Lax is the primary defense.
  if (!origin) {
    next();
    return;
  }
  if (!env.APP_ORIGINS.includes(origin)) {
    next(new ApiError(403, "CSRF_ORIGIN_REJECTED", "Origin không được phép"));
    return;
  }
  next();
}
