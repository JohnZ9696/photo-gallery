import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { ApiError } from "../lib/errors.js";
import { getMasterForStream, getPublishedVariant } from "../services/media.js";
import { storage } from "../storage/index.js";

export const mediaRouter = Router();

mediaRouter.get("/:photoId/master", requireAuth, async (req, res) => {
  const master = await getMasterForStream(String(req.params.photoId));

  let object;
  try {
    object = await storage.getStream(master.masterKey);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      throw new ApiError(404, "NOT_FOUND", "Không tìm thấy bản gốc");
    }
    throw new ApiError(502, "STORAGE_ERROR", "Không đọc được bản gốc từ storage");
  }

  res.status(200);
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Vary", "Cookie");
  res.setHeader("ETag", `"${master.masterChecksum}"`);
  res.setHeader("Content-Length", String(master.masterBytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    object.body.destroy();
    res.end();
    return;
  }

  object.body.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).end();
    } else {
      res.destroy(error);
    }
  });
  object.body.pipe(res);
});

mediaRouter.get("/:photoId/v/:version/:kind", requireAuth, async (req, res) => {
  const version = Number.parseInt(String(req.params.version), 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(404, "NOT_FOUND", "Không tìm thấy ảnh");
  }

  const { variant, cacheControl } = await getPublishedVariant(
    String(req.params.photoId),
    version,
    String(req.params.kind),
  );

  let object;
  try {
    object = await storage.getStream(variant.storageKey);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      throw new ApiError(404, "NOT_FOUND", "Không tìm thấy file ảnh");
    }
    throw new ApiError(502, "STORAGE_ERROR", "Không đọc được file ảnh từ storage");
  }

  res.status(200);
  res.setHeader("Content-Type", variant.contentType || "image/webp");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Vary", "Cookie");
  res.setHeader("ETag", `"${variant.checksum}"`);
  res.setHeader("Content-Length", String(variant.bytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    object.body.destroy();
    res.end();
    return;
  }

  object.body.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).end();
    } else {
      res.destroy(error);
    }
  });
  object.body.pipe(res);
});
