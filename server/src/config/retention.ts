import { env } from "./env.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const retention = {
  stagedVersionMs: env.RETENTION_STAGED_MINUTES * MINUTE_MS,
  supersededVersionMs: env.RETENTION_SUPERSEDED_DAYS * DAY_MS,
  deletedPhotoMs: env.RETENTION_DELETED_HOURS * HOUR_MS,
  orphanObjectMs: env.RETENTION_ORPHAN_HOURS * HOUR_MS,
  journalMs: env.RETENTION_JOURNAL_HOURS * HOUR_MS,
  cleanupIntervalMs: env.CLEANUP_INTERVAL_MINUTES * MINUTE_MS,
} as const;

export const retentionTable = [
  {
    group: "staged_version",
    scope: "photos/{id}/v{n} của version STAGED/FAILED",
    duration: `${env.RETENTION_STAGED_MINUTES} phút`,
  },
  {
    group: "superseded_version",
    scope: "Version SUPERSEDED",
    duration: `${env.RETENTION_SUPERSEDED_DAYS} ngày`,
  },
  {
    group: "deleted_photo",
    scope: "Photo DELETED, retry tối đa",
    duration: `${env.RETENTION_DELETED_HOURS} giờ`,
  },
  {
    group: "orphan_object",
    scope: "Object không còn tham chiếu trong DB",
    duration: `${env.RETENTION_ORPHAN_HOURS} giờ`,
  },
  {
    group: "journal_keys",
    scope: "Key trong cleanup journal",
    duration: `${env.RETENTION_JOURNAL_HOURS} giờ`,
  },
  {
    group: "expired_session",
    scope: "Session hết hạn",
    duration: "ngay lập tức",
  },
] as const;
