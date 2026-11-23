import { z } from "zod";
import sharp from "sharp";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { sha256 } from "../lib/checksum.js";
import { ApiError, conflict, unprocessable } from "../lib/errors.js";
import { storage } from "../storage/index.js";
import { getOwnedReadyPhoto, getPhotoDto, type PhotoDto } from "./photos.js";
import {
  planVariantWidths,
  variantKey,
  versionPrefix,
  type RenderedVariant,
} from "./variants.js";

export const editParamsSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    crop: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
      })
      .strict()
      .nullable()
      .optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    flipH: z.boolean().default(false),
  })
  .strict();

export const restoreSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type EditParams = z.infer<typeof editParamsSchema>;

type Crop = NonNullable<EditParams["crop"]>;

function validateCrop(crop: Crop | null | undefined, width: number, height: number): Crop | null {
  if (!crop) return null;
  if (crop.width < env.MIN_CROP_SIZE || crop.height < env.MIN_CROP_SIZE) {
    throw unprocessable(
      "INVALID_CROP",
      `Crop phải có kích thước tối thiểu ${env.MIN_CROP_SIZE}x${env.MIN_CROP_SIZE}px`,
    );
  }
  if (crop.x + crop.width > width || crop.y + crop.height > height) {
    throw unprocessable("INVALID_CROP", "Crop vượt ra ngoài biên ảnh gốc");
  }
  if (crop.x < 0 || crop.y < 0) {
    throw unprocessable("INVALID_CROP", "Crop không được có tọa độ âm");
  }
  return crop;
}

function outputSize(crop: Crop | null, masterWidth: number, masterHeight: number, rotate: number) {
  const width = crop?.width ?? masterWidth;
  const height = crop?.height ?? masterHeight;
  if (rotate === 90 || rotate === 270) return { width: height, height: width };
  return { width, height };
}

async function renderEditedVariants(
  masterBuffer: Buffer,
  crop: Crop | null,
  rotate: number,
  flipH: boolean,
  widths: number[],
): Promise<RenderedVariant[]> {
  const variants: RenderedVariant[] = [];

  for (let index = 0; index < widths.length; index += 1) {
    let pipeline = sharp(masterBuffer, {
      limitInputPixels: env.MAX_PIXELS,
      failOn: "error",
      sequentialRead: true,
    });

    if (crop) {
      pipeline = pipeline.extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
      });
    }
    if (rotate !== 0) pipeline = pipeline.rotate(rotate);
    if (flipH) pipeline = pipeline.flop();

    const width = widths[index];
    const { data, info } = await pipeline
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    variants.push({
      kind: index === 0 ? "thumb" : index === 1 ? "medium" : "large",
      width: info.width,
      height: info.height,
      bytes: data.length,
      checksum: sha256(data),
      buffer: data,
    });
  }

  return variants;
}

async function failVersion(photoId: string, version: number, reason: string): Promise<void> {
  const prefix = versionPrefix(photoId, version);
  try {
    await storage.deletePrefix(prefix);
    await prisma.photoVersion
      .update({
        where: { photoId_version: { photoId, version } },
        data: { status: "PURGED" },
      })
      .catch(() => undefined);
    await prisma.photoVariant
      .updateMany({
        where: { photoId, version },
        data: { cleanedAt: new Date() },
      })
      .catch(() => undefined);
  } catch (error) {
    await prisma.photoVersion
      .update({
        where: { photoId_version: { photoId, version } },
        data: { status: "FAILED" },
      })
      .catch(() => undefined);
    await prisma.cleanupJob
      .create({
        data: {
          type: "STAGED_VERSION",
          photoId,
          version,
          prefix,
          runAfter: new Date(),
          lastError: `${reason}: ${(error as Error).message}`,
        },
      })
      .catch(() => undefined);
  }
}

export async function editPhoto(
  photoId: string,
  userId: string,
  params: EditParams,
  options: { restore?: boolean } = {},
): Promise<PhotoDto> {
  const photo = await getOwnedReadyPhoto(photoId, userId);
  if (photo.currentVersion !== params.expectedVersion) {
    throw conflict("VERSION_CONFLICT", "Ảnh đã được chỉnh sửa ở phiên khác", {
      currentVersion: photo.currentVersion,
    });
  }

  const crop = validateCrop(params.crop, photo.masterWidth, photo.masterHeight);
  const output = outputSize(crop, photo.masterWidth, photo.masterHeight, params.rotate);
  if (output.width * output.height > env.MAX_PIXELS) {
    throw unprocessable("TOO_LARGE_PIXELS", "Kích thước sau chỉnh sửa vượt giới hạn pixel");
  }

  const canonical = JSON.stringify({
    crop: crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : null,
    rotate: params.rotate,
    flipH: params.flipH,
  });

  const version = await prisma.$transaction(async (tx) => {
    const updated = await tx.photo.update({
      where: { id: photoId },
      data: { nextVersion: { increment: 1 } },
      select: { nextVersion: true },
    });
    const allocated = updated.nextVersion - 1;
    await tx.photoVersion.create({
      data: {
        photoId,
        version: allocated,
        paramsJson: canonical,
        status: "STAGED",
      },
    });
    return allocated;
  });

  if (!photo.masterKey) {
    await failVersion(photoId, version, "Thiếu masterKey");
    throw new ApiError(409, "MASTER_MISSING", "Ảnh không còn bản gốc chuẩn hóa");
  }

  let masterBuffer: Buffer;
  try {
    masterBuffer = await storage.getBuffer(photo.masterKey);
  } catch {
    await failVersion(photoId, version, "Không đọc được master");
    throw new ApiError(502, "STORAGE_ERROR", "Không đọc được bản gốc từ storage");
  }

  const widths = planVariantWidths(output.width);
  let variants: RenderedVariant[];
  try {
    variants = options.restore
      ? await renderEditedVariants(masterBuffer, null, 0, false, widths)
      : await renderEditedVariants(
          masterBuffer,
          crop,
          params.rotate,
          params.flipH,
          widths,
        );
  } catch {
    await failVersion(photoId, version, "Render lỗi");
    throw new ApiError(500, "EDIT_RENDER_FAILED", "Không thể render ảnh sau chỉnh sửa");
  }

  const uploadedKeys: string[] = [];
  try {
    for (const variant of variants) {
      const key = variantKey(photoId, version, variant.kind, variant.width);
      await storage.put(key, variant.buffer, "image/webp");
      uploadedKeys.push(key);
    }

    await prisma.$transaction(async (tx) => {
      await tx.photoVariant.createMany({
        data: variants.map((variant) => ({
          photoId,
          version,
          kind: variant.kind,
          storageKey: variantKey(photoId, version, variant.kind, variant.width),
          contentType: "image/webp",
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes,
          checksum: variant.checksum,
        })),
      });

      const published = await tx.photo.updateMany({
        where: {
          id: photoId,
          status: "READY",
          currentVersion: params.expectedVersion,
        },
        data: { currentVersion: version },
      });
      if (published.count !== 1) {
        throw new PublishConflict();
      }

      await tx.photoVersion.update({
        where: { photoId_version: { photoId, version } },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });

      await tx.photoVersion.updateMany({
        where: {
          photoId,
          status: "PUBLISHED",
          version: { not: version },
        },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
    });
  } catch (error) {
    await failVersion(photoId, version, "Publish lỗi");
    if (error instanceof PublishConflict) {
      const current = await prisma.photo.findUnique({
        where: { id: photoId },
        select: { currentVersion: true },
      });
      throw conflict("VERSION_CONFLICT", "Ảnh đã được chỉnh sửa ở phiên khác", {
        currentVersion: current?.currentVersion ?? params.expectedVersion,
      });
    }
    if (uploadedKeys.length > 0) {
      await storage.deleteMany(uploadedKeys).catch(() => undefined);
    }
    throw new ApiError(500, "DB_ERROR", "Không công bố được phiên bản chỉnh sửa");
  }

  return getPhotoDto(photoId, userId);
}

class PublishConflict extends Error {}

export async function restorePhoto(
  photoId: string,
  userId: string,
  expectedVersion: number,
): Promise<PhotoDto> {
  return editPhoto(
    photoId,
    userId,
    {
      expectedVersion,
      crop: null,
      rotate: 0,
      flipH: false,
    },
    { restore: true },
  );
}
