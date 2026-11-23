import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { storage } from "../storage/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, string> = { db: "ok", storage: "ok" };
  let status = 200;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.db = "error";
    status = 503;
  }

  try {
    await storage.ensureBucket();
  } catch {
    checks.storage = "error";
    status = 503;
  }

  res.status(status).json({
    status: status === 200 ? "ok" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});
