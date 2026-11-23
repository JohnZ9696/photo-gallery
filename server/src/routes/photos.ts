import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../config/env.js";
import { ApiError, badRequest, unprocessable } from "../lib/errors.js";
import { cleanupTempFiles, parseMultipartUpload } from "../http/upload.js";
import { ingestFile } from "../services/ingest.js";
import { deletePhoto, getPhotoDto, listPhotos } from "../services/photos.js";
import { editParamsSchema, editPhoto, restoreSchema, restorePhoto } from "../services/edits.js";

export const photosRouter = Router();

photosRouter.use(requireAuth);

photosRouter.get("/", async (req, res) => {
  const scope = req.query.scope === "mine" ? "mine" : "all";
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "24"), 10) || 24, 1), 50);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const result = await listPhotos({
    viewerId: req.user!.id,
    scope,
    cursor,
    limit,
  });

  res.setHeader("Cache-Control", "no-store");
  res.json(result);
});

photosRouter.get("/:id", async (req, res) => {
  const photo = await getPhotoDto(req.params.id, req.user!.id);
  res.setHeader("Cache-Control", "no-store");
  res.json({ photo });
});

photosRouter.post("/", async (req, res, next) => {
  let parsed;
  try {
    parsed = await parseMultipartUpload(req);
  } catch {
    res.status(400).json({
      error: { code: "INVALID_MULTIPART", message: "Request upload không hợp lệ" },
    });
    return;
  }

  try {
    if (parsed.tooManyFiles) {
      throw badRequest("TOO_MANY_FILES", "Chỉ được upload tối đa 5 ảnh mỗi request");
    }
    if (parsed.files.length === 0) {
      throw badRequest("NO_FILES", "Vui lòng chọn ít nhất 1 ảnh");
    }

    let alts: string[] = [];
    if (typeof parsed.fields.alts === "string") {
      try {
        const value = JSON.parse(parsed.fields.alts.replace(/^\uFEFF/, ""));
        if (Array.isArray(value)) {
          alts = value.map((item) => String(item ?? "").trim());
        }
      } catch {
        alts = [];
      }
    }

    const results: unknown[] = [];
    let succeeded = 0;

    for (let index = 0; index < parsed.files.length; index += 1) {
      const file = parsed.files[index];
      try {
        if (file.truncated || file.bytes > env.MAX_UPLOAD_BYTES) {
          // The byte limit is enforced per-part by busboy; do not create DB/file records.
          throw badRequest("TOO_LARGE_BYTES", "File vượt quá giới hạn dung lượng cho phép");
        }

        const fallbackAlt = `Ảnh ${path.basename(file.filename) || "không tên"}`;
        const alt = (alts[index] || fallbackAlt).slice(0, 300);
        const outcome = await ingestFile({
          tempPath: file.tempPath,
          originalName: file.filename,
          alt,
          ownerId: req.user!.id,
        });
        const photo = await getPhotoDto(outcome.photoId, req.user!.id);
        succeeded += 1;
        results.push({
          index,
          filename: file.filename,
          ok: true,
          photo,
        });
      } catch (error) {
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(500, "INTERNAL_ERROR", "Không xử lý được file ảnh");
        results.push({
          index,
          filename: file.filename,
          ok: false,
          error: { code: apiError.code, message: apiError.message },
        });
      } finally {
        await cleanupTempFiles([file]);
      }
    }

    const failed = results.length - succeeded;
    res.status(failed === 0 ? 201 : 207).json({
      results,
      summary: { total: results.length, succeeded, failed },
    });
  } catch (error) {
    await cleanupTempFiles(parsed.files);
    next(error);
  }
});

photosRouter.post("/:id/edits", async (req, res) => {
  const parsed = editParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw unprocessable(
      "INVALID_EDIT_PARAMS",
      "Tham số chỉnh sửa không hợp lệ",
      z.treeifyError(parsed.error),
    );
  }

  const photo = await editPhoto(req.params.id, req.user!.id, parsed.data);
  res.status(201).json({ photo });
});

photosRouter.post("/:id/restore", async (req, res) => {
  const parsed = restoreSchema.safeParse(req.body);
  if (!parsed.success) {
    throw unprocessable("INVALID_EDIT_PARAMS", "expectedVersion không hợp lệ");
  }

  const photo = await restorePhoto(req.params.id, req.user!.id, parsed.data.expectedVersion);
  res.status(201).json({ photo });
});

photosRouter.delete("/:id", async (req, res) => {
  const result = await deletePhoto(req.params.id, req.user!.id);
  res.status(result.pending ? 202 : 200).json(result);
});
