import type { PhotoVariant } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { notFound } from "../lib/errors.js";

export const existingKinds = new Set(["thumb", "medium", "large"]);

export async function getPublishedVariant(
  photoId: string,
  version: number,
  kind: string,
): Promise<{ variant: PhotoVariant; cacheControl: string }> {
  if (!existingKinds.has(kind)) {
    throw notFound("Không tìm thấy variant");
  }

  const variant = await prisma.photoVariant.findUnique({
    where: {
      photoId_version_kind: { photoId, version, kind },
    },
    include: {
      photo: { select: { status: true } },
    },
  });

  if (!variant || variant.cleanedAt || variant.photo.status !== "READY") {
    throw notFound("Không tìm thấy ảnh");
  }

  return {
    variant,
    cacheControl: "private, max-age=31536000, immutable",
  };
}

export async function getMasterForStream(photoId: string): Promise<{
  masterKey: string;
  masterBytes: number;
  masterChecksum: string;
}> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      status: true,
      masterKey: true,
      masterBytes: true,
      masterChecksum: true,
    },
  });

  if (!photo || photo.status !== "READY" || !photo.masterKey) {
    throw notFound("Không tìm thấy bản gốc");
  }

  return {
    masterKey: photo.masterKey,
    masterBytes: photo.masterBytes,
    masterChecksum: photo.masterChecksum,
  };
}
