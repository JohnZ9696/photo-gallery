import { promises as fs } from "node:fs";
import { Prisma } from "@prisma/client";
import { fileTypeFromFile } from "file-type";
import sharp, { type Metadata } from "sharp";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { ApiError, badRequest } from "../lib/errors.js";
import { appendJournal } from "../lib/journal.js";
import { storage } from "../storage/index.js";
import {
  masterKey,
  normalizeMaster,
  planVariantWidths,
  renderVariants,
  variantKey,
} from "./variants.js";

const SUPPORTED_FORMATS = new Set(["jpg", "jpeg", "png", "webp"]);

export type IngestInput = {
  tempPath: string;
  originalName: string;
  alt: string;
  ownerId: string;
};

export type IngestOutcome = {
  photoId: string;
  masterWidth: number;
  masterHeight: number;
};

export async function allocatePhotoId(): Promise<string> {
  const counter = await prisma.counter.upsert({
    where: { name: "photo" },
    update: { value: { increment: 1 } },
    create: { name: "photo", value: 1 },
    select: { value: true },
  });
  return `p${String(counter.value).padStart(2, "0")}`;
}

async function cleanupWrittenKeys(keys: string[], photoId: string): Promise<void> {
  if (keys.length === 0) return;
  try {
    await storage.deleteMany(keys);
  } catch (error) {
    await appendJournal({
      keys,
      photoId,
      createdAt: new Date().toISOString(),
      reason: `DB/upload failure cleanup failed: ${(error as Error).message}`,
    }).catch(() => undefined);
  }
}

export async function ingestFile(input: IngestInput): Promise<IngestOutcome> {
  const detected = await fileTypeFromFile(input.tempPath).catch(() => undefined);
  if (!detected || !SUPPORTED_FORMATS.has(detected.ext)) {
    throw badRequest(
      "INVALID_IMAGE",
      "File không phải ảnh JPEG, PNG hoặc WebP hợp lệ",
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.tempPath, {
      limitInputPixels: env.MAX_PIXELS,
      failOn: "error",
    }).metadata();
  } catch {
    throw badRequest("INVALID_IMAGE", "Không thể giải mã file ảnh");
  }

  if (!metadata.width || !metadata.height) {
    throw badRequest("INVALID_IMAGE", "Ảnh không có kích thước hợp lệ");
  }
  if ((metadata.pages ?? 1) > 1) {
    throw badRequest("ANIMATED_UNSUPPORTED", "Ảnh động/animated chưa được hỗ trợ");
  }
  if (metadata.width > env.MAX_SIDE || metadata.height > env.MAX_SIDE) {
    throw badRequest(
      "TOO_LARGE_PIXELS",
      `Cạnh ảnh vượt quá giới hạn ${env.MAX_SIDE}px`,
    );
  }
  if (metadata.width * metadata.height > env.MAX_PIXELS) {
    throw badRequest(
      "TOO_LARGE_PIXELS",
      `Ảnh vượt quá giới hạn ${env.MAX_PIXELS.toLocaleString("en-US")} pixel`,
    );
  }

  let source: Buffer;
  try {
    source = await fs.readFile(input.tempPath);
  } catch {
    throw new ApiError(500, "STORAGE_ERROR", "Không đọc được file tạm");
  }

  let master;
  try {
    master = await normalizeMaster(source);
  } catch {
    throw badRequest("INVALID_IMAGE", "Không thể chuẩn hóa file ảnh");
  }

  if (master.width > env.MAX_SIDE || master.height > env.MAX_SIDE) {
    throw badRequest("TOO_LARGE_PIXELS", `Cạnh ảnh vượt quá giới hạn ${env.MAX_SIDE}px`);
  }
  if (master.width * master.height > env.MAX_PIXELS) {
    throw badRequest("TOO_LARGE_PIXELS", "Ảnh vượt quá giới hạn pixel");
  }

  const widths = planVariantWidths(master.width);
  const variants = await renderVariants(master.buffer, widths);

  const photoId = await allocatePhotoId();
  const masterStorageKey = masterKey(photoId);
  const writtenKeys: string[] = [];

  try {
    await storage.put(masterStorageKey, master.buffer, "image/webp");
    writtenKeys.push(masterStorageKey);

    const variantRows: Array<{
      version: number;
      kind: string;
      storageKey: string;
      contentType: string;
      width: number;
      height: number;
      bytes: number;
      checksum: string;
    }> = [];
    for (const variant of variants) {
      const key = variantKey(photoId, 1, variant.kind, variant.width);
      await storage.put(key, variant.buffer, "image/webp");
      writtenKeys.push(key);
      variantRows.push({
        version: 1,
        kind: variant.kind,
        storageKey: key,
        contentType: "image/webp",
        width: variant.width,
        height: variant.height,
        bytes: variant.bytes,
        checksum: variant.checksum,
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.photo.create({
          data: {
            id: photoId,
            ownerId: input.ownerId,
            alt: input.alt.slice(0, 300),
            originalName: input.originalName.slice(0, 255),
            masterKey: masterStorageKey,
            masterWidth: master.width,
            masterHeight: master.height,
            masterBytes: master.bytes,
            masterChecksum: master.checksum,
            format: detected.ext,
            currentVersion: 1,
            nextVersion: 2,
            versions: {
              create: {
                version: 1,
                paramsJson: JSON.stringify({ crop: null, rotate: 0, flipH: false }),
                status: "PUBLISHED",
                publishedAt: new Date(),
              },
            },
            variants: { create: variantRows },
          },
        });
      });
    } catch (error) {
      await cleanupWrittenKeys(writtenKeys, photoId);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new ApiError(500, "DB_ERROR", "Không lưu được metadata ảnh");
      }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      await cleanupWrittenKeys(writtenKeys, photoId);
      throw new ApiError(500, "STORAGE_ERROR", "Không ghi được file ảnh lên storage");
    }
    throw error;
  }

  return {
    photoId,
    masterWidth: master.width,
    masterHeight: master.height,
  };
}
