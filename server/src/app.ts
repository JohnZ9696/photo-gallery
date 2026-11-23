import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { attachUser, verifyOrigin } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { ApiError } from "./lib/errors.js";
import { healthRouter } from "./routes/health.js";
import { mediaRouter } from "./routes/media.js";
import { photosRouter } from "./routes/photos.js";

const logger = pino({
  level: env.isProduction ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
    ],
    censor: "[REDACTED]",
  },
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(verifyOrigin);
  app.use(attachUser);

  app.use("/api/auth", authRouter);
  app.use("/api/photos", photosRouter);
  app.use("/api/health", healthRouter);
  app.use("/media", mediaRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "API không tồn tại" } });
  });

  app.use("/media", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy ảnh" } });
  });

  if (existsSync(env.webDistDir)) {
    app.use(express.static(env.webDistDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      res.sendFile(path.join(env.webDistDir, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.json({
        name: "Photo Gallery API",
        message: "Web dev server chạy ở http://localhost:5173",
        health: "/api/health",
      });
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }

    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    const maybeHttp = error as { status?: number; type?: string; message?: string };
    if (maybeHttp?.type === "entity.parse.failed") {
      res.status(400).json({
        error: { code: "INVALID_JSON", message: "JSON không hợp lệ" },
      });
      return;
    }

    (req.log ?? logger).error({ err: error }, "Unhandled request error");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Đã xảy ra lỗi máy chủ" },
    });
  });

  return app;
}
