import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

for (const candidate of [".env", "../.env"]) {
  const file = path.resolve(process.cwd(), candidate);
  if (existsSync(file)) dotenv.config({ path: file, quiet: true });
}

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  APP_ORIGINS: z
    .string()
    .default(
      "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000",
    )
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z
    .string()
    .default("postgresql://gallery:gallery@localhost:5432/photo_gallery?schema=public"),
  SESSION_SECRET: z.string().min(32).default("local-dev-session-secret-change-me-32chars"),
  SESSION_TTL_DAYS: z.coerce.number().positive().default(7),
  COOKIE_SECURE: booleanString.default(false),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  S3_ENDPOINT: z.string().url().default("http://localhost:8333"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("photo-gallery"),
  S3_ACCESS_KEY: z.string().min(1).default("gallery"),
  S3_SECRET_KEY: z.string().min(1).default("gallery-local-secret"),
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  S3_CACHE_CONTROL: z.string().default("private, max-age=31536000, immutable"),

  MAX_UPLOAD_FILES: z.coerce.number().int().min(1).max(5).default(5),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  MAX_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  MAX_SIDE: z.coerce.number().int().positive().default(12_000),
  VARIANT_WIDTHS: z
    .string()
    .default("480,1024,1600")
    .transform((value) =>
      value
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((item) => Number.isFinite(item) && item > 0)
        .slice(0, 3),
    ),
  MIN_CROP_SIZE: z.coerce.number().int().positive().default(16),
  IMAGE_CONCURRENCY: z.coerce.number().int().positive().max(8).default(2),

  RETENTION_STAGED_MINUTES: z.coerce.number().positive().default(60),
  RETENTION_SUPERSEDED_DAYS: z.coerce.number().positive().default(7),
  RETENTION_DELETED_HOURS: z.coerce.number().positive().default(24),
  RETENTION_ORPHAN_HOURS: z.coerce.number().positive().default(24),
  RETENTION_JOURNAL_HOURS: z.coerce.number().positive().default(24),
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  dataDir: path.resolve(process.cwd(), "..", ".data"),
  webDistDir: path.resolve(process.cwd(), "..", "web", "dist"),
};

if (env.VARIANT_WIDTHS.length === 0) {
  env.VARIANT_WIDTHS = [480, 1024, 1600];
}
