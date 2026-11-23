import { prisma } from "../db/prisma.js";
import { retention } from "../config/retention.js";
import { readJournal, writeJournal, type JournalEntry } from "../lib/journal.js";
import { storage } from "../storage/index.js";
import { purgeDeletedPhoto } from "./photos.js";
import { versionPrefix } from "./variants.js";
import { cleanupExpiredSessions } from "../auth/session.js";

export type CleanupSummary = {
  stagedVersions: number;
  supersededVersions: number;
  deletedPhotos: number;
  orphanObjects: number;
  journalKeys: number;
  sessions: number;
  jobs: number;
  errors: string[];
};

function emptySummary(): CleanupSummary {
  return {
    stagedVersions: 0,
    supersededVersions: 0,
    deletedPhotos: 0,
    orphanObjects: 0,
    journalKeys: 0,
    sessions: 0,
    jobs: 0,
    errors: [],
  };
}

async function markVersionPurged(photoId: string, version: number): Promise<void> {
  await prisma.photoVariant.updateMany({
    where: { photoId, version },
    data: { cleanedAt: new Date() },
  });
  await prisma.photoVersion.update({
    where: { photoId_version: { photoId, version } },
    data: { status: "PURGED" },
  });
}

export async function cleanupStagedVersions(summary: CleanupSummary): Promise<void> {
  const cutoff = new Date(Date.now() - retention.stagedVersionMs);
  const versions = await prisma.photoVersion.findMany({
    where: { status: { in: ["STAGED", "FAILED"] }, createdAt: { lt: cutoff } },
    take: 100,
  });

  for (const version of versions) {
    try {
      await storage.deletePrefix(versionPrefix(version.photoId, version.version));
      await markVersionPurged(version.photoId, version.version);
      summary.stagedVersions += 1;
    } catch (error) {
      summary.errors.push(
        `staged ${version.photoId}/v${version.version}: ${(error as Error).message}`,
      );
    }
  }
}

export async function cleanupSupersededVersions(summary: CleanupSummary): Promise<void> {
  const cutoff = new Date(Date.now() - retention.supersededVersionMs);
  const versions = await prisma.photoVersion.findMany({
    where: {
      status: "SUPERSEDED",
      supersededAt: { lt: cutoff },
    },
    take: 100,
  });

  for (const version of versions) {
    try {
      await storage.deletePrefix(versionPrefix(version.photoId, version.version));
      await markVersionPurged(version.photoId, version.version);
      summary.supersededVersions += 1;
    } catch (error) {
      summary.errors.push(
        `superseded ${version.photoId}/v${version.version}: ${(error as Error).message}`,
      );
    }
  }
}

export async function cleanupDeletedPhotos(summary: CleanupSummary): Promise<void> {
  const cutoff = new Date(Date.now() - retention.deletedPhotoMs);
  const photos = await prisma.photo.findMany({
    where: { status: "DELETED", deletedAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  });

  for (const photo of photos) {
    try {
      await purgeDeletedPhoto(photo.id);
      summary.deletedPhotos += 1;
    } catch (error) {
      summary.errors.push(`deleted ${photo.id}: ${(error as Error).message}`);
    }
  }
}

export async function cleanupJobs(summary: CleanupSummary): Promise<void> {
  const jobs = await prisma.cleanupJob.findMany({
    where: { status: "PENDING", runAfter: { lte: new Date() } },
    take: 50,
    orderBy: { runAfter: "asc" },
  });

  for (const job of jobs) {
    try {
      if (job.type === "DELETED_PHOTO" && job.photoId) {
        await purgeDeletedPhoto(job.photoId);
      } else if (job.type === "STAGED_VERSION" && job.photoId && job.version) {
        await storage.deletePrefix(
          job.prefix ?? versionPrefix(job.photoId, job.version),
        );
        await markVersionPurged(job.photoId, job.version);
      } else if (job.type === "SUPERSEDED_VERSION" && job.photoId && job.version) {
        await storage.deletePrefix(
          job.prefix ?? versionPrefix(job.photoId, job.version),
        );
        await markVersionPurged(job.photoId, job.version);
      } else if (job.type === "ORPHAN_OBJECT" && job.storageKey) {
        await storage.delete(job.storageKey);
      } else if (job.type === "JOURNAL_KEYS" && job.storageKey) {
        await storage.delete(job.storageKey);
      }

      await prisma.cleanupJob.update({
        where: { id: job.id },
        data: { status: "DONE" },
      });
      summary.jobs += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const delayMs = Math.min(attempts * 60_000, 5 * 60_000);
      await prisma.cleanupJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: (error as Error).message,
          runAfter: new Date(Date.now() + delayMs),
          status: attempts > 10 ? "DEAD" : "PENDING",
        },
      });
      summary.errors.push(`job ${job.id}: ${(error as Error).message}`);
    }
  }
}

export async function cleanupJournal(summary: CleanupSummary): Promise<void> {
  const entries = await readJournal();
  if (entries.length === 0) return;
  const remaining: JournalEntry[] = [];

  for (const entry of entries) {
    try {
      await storage.deleteMany(entry.keys);
      summary.journalKeys += entry.keys.length;
    } catch (error) {
      remaining.push(entry);
      summary.errors.push(`journal ${entry.createdAt}: ${(error as Error).message}`);
    }
  }

  await writeJournal(remaining);
}

export async function scanOrphans(summary: CleanupSummary): Promise<void> {
  const objects = await storage.listPrefix("photos/");
  if (objects.length === 0) return;

  const photos = await prisma.photo.findMany({
    select: { id: true, masterKey: true, status: true },
  });
  const variants = await prisma.photoVariant.findMany({
    where: { cleanedAt: null },
    select: { storageKey: true },
  });
  const staged = await prisma.photoVersion.findMany({
    where: {
      status: { in: ["STAGED", "FAILED"] },
      createdAt: { gt: new Date(Date.now() - retention.stagedVersionMs) },
    },
    select: { photoId: true, version: true },
  });

  const known = new Set<string>();
  for (const photo of photos) {
    if (photo.masterKey) known.add(photo.masterKey);
  }
  for (const variant of variants) known.add(variant.storageKey);
  for (const photo of photos) {
    if (photo.status === "DELETED" || photo.status === "PURGED") {
      // The whole prefix is handled by deleted-photo cleanup.
      known.add(`photos/${photo.id}/`);
    }
  }
  const protectedPrefixes = staged.map((version) =>
    versionPrefix(version.photoId, version.version),
  );

  const cutoff = new Date(Date.now() - retention.orphanObjectMs);
  const orphans = objects.filter((object) => {
    if (known.has(object.key)) return false;
    if (protectedPrefixes.some((prefix) => object.key.startsWith(prefix))) return false;
    if (photos.some((photo) => object.key === `photos/${photo.id}/master.webp`)) return false;
    if (!object.lastModified) return false;
    return object.lastModified < cutoff;
  });

  if (orphans.length === 0) return;
  try {
    await storage.deleteMany(orphans.map((object) => object.key));
    summary.orphanObjects += orphans.length;
  } catch (error) {
    summary.errors.push(`orphans: ${(error as Error).message}`);
  }
}

export async function cleanupSessions(summary: CleanupSummary): Promise<void> {
  summary.sessions += await cleanupExpiredSessions();
}

export async function runCleanup(options: {
  all?: boolean;
  retentionOnly?: boolean;
  orphansOnly?: boolean;
  photoId?: string;
}): Promise<CleanupSummary> {
  const summary = emptySummary();

  try {
    if (options.photoId) {
      await deletePhotoUnsafe(options.photoId);
      summary.deletedPhotos += 1;
      return summary;
    }

    if (!options.orphansOnly) {
      await cleanupJobs(summary);
      await cleanupJournal(summary);
      await cleanupStagedVersions(summary);
      await cleanupSupersededVersions(summary);
      await cleanupDeletedPhotos(summary);
      await cleanupSessions(summary);
    }

    if (options.all || options.orphansOnly) {
      await scanOrphans(summary);
    }
  } catch (error) {
    summary.errors.push((error as Error).message);
  }

  return summary;
}

async function deletePhotoUnsafe(photoId: string): Promise<void> {
  await prisma.photo.update({
    where: { id: photoId },
    data: { status: "DELETED", deletedAt: new Date() },
  });
  await purgeDeletedPhoto(photoId);
}

export async function cleanupPhotoNow(photoId: string): Promise<CleanupSummary> {
  const summary = emptySummary();
  try {
    await deletePhotoUnsafe(photoId);
    summary.deletedPhotos = 1;
  } catch (error) {
    summary.errors.push((error as Error).message);
  }
  return summary;
}
