import type { Photo, PhotoVariant, Prisma, User } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { forbidden, notFound } from "../lib/errors.js";
import { storage } from "../storage/index.js";
import { photoPrefix } from "./variants.js";

export type PhotoDto = {
  id: string;
  alt: string;
  width: number;
  height: number;
  currentVersion: number;
  owner: { id: string; displayName: string };
  canEdit: boolean;
  variants: Array<{
    kind: string;
    width: number;
    height: number;
    url: string;
    contentType: string;
  }>;
  createdAt: string;
};

type PhotoWithOwner = Photo & { owner: Pick<User, "id" | "displayName"> };
type PhotoWithRelations = PhotoWithOwner & { variants: PhotoVariant[] };

export function toPhotoDto(photo: PhotoWithRelations, viewerId: string): PhotoDto {
  const variants = photo.variants
    .filter((variant) => variant.version === photo.currentVersion && !variant.cleanedAt)
    .sort((a, b) => a.width - b.width)
    .map((variant) => ({
      kind: variant.kind,
      width: variant.width,
      height: variant.height,
      url: `/media/${photo.id}/v/${variant.version}/${variant.kind}`,
      contentType: variant.contentType,
    }));

  return {
    id: photo.id,
    alt: photo.alt,
    width: photo.masterWidth,
    height: photo.masterHeight,
    currentVersion: photo.currentVersion,
    owner: { id: photo.owner.id, displayName: photo.owner.displayName },
    canEdit: photo.ownerId === viewerId,
    variants,
    createdAt: photo.createdAt.toISOString(),
  };
}

export async function getPhotoDto(photoId: string, viewerId: string): Promise<PhotoDto> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    include: {
      owner: { select: { id: true, displayName: true } },
      variants: true,
    },
  });
  if (!photo || photo.status !== "READY") {
    throw notFound("Không tìm thấy ảnh");
  }
  return toPhotoDto(photo, viewerId);
}

export async function getOwnedReadyPhoto(photoId: string, userId: string) {
  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo || photo.status !== "READY") {
    throw notFound("Không tìm thấy ảnh");
  }
  if (photo.ownerId !== userId) {
    throw forbidden("Chỉ chủ sở hữu ảnh mới được thay đổi ảnh này");
  }
  return photo;
}

function encodeCursor(photo: Pick<Photo, "id" | "createdAt">): string {
  return Buffer.from(`${photo.createdAt.toISOString()}|${photo.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf("|");
    if (separator <= 0) return null;
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listPhotos(options: {
  viewerId: string;
  scope: "all" | "mine";
  cursor?: string;
  limit: number;
}): Promise<{ items: PhotoDto[]; nextCursor: string | null }> {
  const decoded = options.cursor ? decodeCursor(options.cursor) : null;

  const where: Prisma.PhotoWhereInput = {
    status: "READY",
    ...(options.scope === "mine" ? { ownerId: options.viewerId } : {}),
  };

  if (decoded) {
    where.OR = [
      { createdAt: { lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { lt: decoded.id } },
    ];
  }

  const photos = await prisma.photo.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    include: {
      owner: { select: { id: true, displayName: true } },
      variants: true,
    },
  });

  const hasMore = photos.length > options.limit;
  const page = hasMore ? photos.slice(0, options.limit) : photos;
  return {
    items: page.map((photo) => toPhotoDto(photo, options.viewerId)),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function deletePhoto(
  photoId: string,
  userId: string,
): Promise<{ deleted: boolean; pending: boolean }> {
  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo || photo.status === "PURGED") {
    throw notFound("Không tìm thấy ảnh");
  }
  if (photo.ownerId !== userId) {
    throw forbidden("Chỉ chủ sở hữu ảnh mới được xóa ảnh này");
  }

  await prisma.photo.update({
    where: { id: photoId },
    data: { status: "DELETED", deletedAt: new Date() },
  });

  await prisma.cleanupJob
    .create({
      data: {
        type: "DELETED_PHOTO",
        photoId,
        prefix: photoPrefix(photoId),
        runAfter: new Date(),
      },
    })
    .catch(() => undefined);

  try {
    await purgeDeletedPhoto(photoId);
    return { deleted: true, pending: false };
  } catch (error) {
    await prisma.cleanupJob
      .updateMany({
        where: { type: "DELETED_PHOTO", photoId, status: "PENDING" },
        data: { lastError: (error as Error).message },
      })
      .catch(() => undefined);
    return { deleted: true, pending: true };
  }
}

export async function purgeDeletedPhoto(photoId: string): Promise<void> {
  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) {
    await prisma.cleanupJob.updateMany({
      where: { type: "DELETED_PHOTO", photoId, status: { not: "DONE" } },
      data: { status: "DONE" },
    });
    return;
  }

  if (photo.status === "READY") {
    await prisma.photo.update({
      where: { id: photoId },
      data: { status: "DELETED", deletedAt: new Date() },
    });
  }

  await storage.deletePrefix(photoPrefix(photoId));

  await prisma.photo.delete({ where: { id: photoId } });

  await prisma.cleanupJob.updateMany({
    where: { type: "DELETED_PHOTO", photoId, status: { not: "DONE" } },
    data: { status: "DONE" },
  });
}
