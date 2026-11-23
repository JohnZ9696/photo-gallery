import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { retention } from "./config/retention.js";
import { prisma } from "./db/prisma.js";
import { runCleanup } from "./services/cleanup.js";
import { storage } from "./storage/index.js";

const logger = console;

async function ensureStorageWithRetry(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await storage.ensureBucket();
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Storage chưa sẵn sàng (lần ${attempt}/15), thử lại sau 2s...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function prepareRuntime(): Promise<void> {
  await fs.mkdir(env.dataDir, { recursive: true });
  await fs.rm(path.join(env.dataDir, "tmp"), { recursive: true, force: true });
  await fs.mkdir(path.join(env.dataDir, "tmp"), { recursive: true });
}

async function main(): Promise<void> {
  await prepareRuntime();
  await prisma.$connect();
  await ensureStorageWithRetry();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`Photo Gallery API listening on http://localhost:${env.PORT}`);
  });

  const cleanup = async (reason: string) => {
    try {
      const summary = await runCleanup({ all: true });
      if (
        summary.stagedVersions ||
        summary.supersededVersions ||
        summary.deletedPhotos ||
        summary.orphanObjects ||
        summary.journalKeys ||
        summary.jobs ||
        summary.sessions ||
        summary.errors.length
      ) {
        console.log(`Cleanup (${reason})`, summary);
      }
    } catch (error) {
      console.error("Cleanup failed", error);
    }
  };

  const startupTimer = setTimeout(() => void cleanup("startup"), 3000);
  const interval = setInterval(
    () => void cleanup("interval"),
    Math.max(retention.cleanupIntervalMs, 60_000),
  );

  const shutdown = async (signal: string) => {
    console.log(`Nhận ${signal}, đang dừng server...`);
    clearTimeout(startupTimer);
    clearInterval(interval);
    server.close(async () => {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info(`Env ${env.NODE_ENV}; storage ${env.S3_ENDPOINT}, bucket ${env.S3_BUCKET}`);
}

main().catch(async (error) => {
  console.error("Không thể khởi động server", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
