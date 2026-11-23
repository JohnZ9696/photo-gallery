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

  if (env.APP_ORIGINS.includes(origin)) {
    next();
    return;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    next(new ApiError(403, "CSRF_ORIGIN_REJECTED", "Origin không được phép"));
    return;
  }

  // Same-origin requests through the Vite proxy (or a reverse proxy) keep the
  // browser-facing Host header, so compare against it as well.
  const forwardedHost = req.get("x-forwarded-host");
  const hosts = [req.get("host"), forwardedHost].filter(
    (value): value is string => Boolean(value),
  );
  const protocols = [req.get("x-forwarded-proto"), req.protocol].filter(
    (value): value is string => Boolean(value),
  );
  if (
    hosts.some((host) =>
      protocols.some((protocol) => origin === `${protocol}://${host}`),
    )
  ) {
    next();
    return;
  }

  // Local development often falls back to another Vite port (5174, 4173, LAN IP...).
  // Keep the strict allow-list for production; in development accept loopback origins.
  if (
    !env.isProduction &&
    (originUrl.hostname === "localhost" ||
      originUrl.hostname === "127.0.0.1" ||
      originUrl.hostname === "[::1]")
  ) {
    next();
    return;
  }

  next(new ApiError(403, "CSRF_ORIGIN_REJECTED", "Origin không được phép"));
}
