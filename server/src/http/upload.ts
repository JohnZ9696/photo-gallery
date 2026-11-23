import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import Busboy from "busboy";
import { env } from "../config/env.js";

export type TempUploadFile = {
  fieldName: string;
  filename: string;
  tempPath: string;
  mimeType: string;
  bytes: number;
  truncated: boolean;
};

export type ParsedUpload = {
  files: TempUploadFile[];
  fields: Record<string, string>;
  tooManyFiles: boolean;
};

export async function parseMultipartUpload(req: Request): Promise<ParsedUpload> {
  const tempDir = path.join(env.dataDir, "tmp");
  await fs.mkdir(tempDir, { recursive: true });

  return new Promise<ParsedUpload>((resolve, reject) => {
    const files: TempUploadFile[] = [];
    const fields: Record<string, string> = {};
    const pending: Promise<void>[] = [];
    let tooManyFiles = false;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      void Promise.all(files.map((file) => fs.unlink(file.tempPath).catch(() => undefined)));
      reject(error);
    };

    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          files: env.MAX_UPLOAD_FILES,
          fileSize: env.MAX_UPLOAD_BYTES,
          fields: 20,
          fieldSize: 64 * 1024,
        },
      });
    } catch {
      reject(new Error("Multipart request không hợp lệ"));
      return;
    }

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (fieldName, stream, info) => {
      const tempPath = path.join(tempDir, `${randomUUID()}.upload`);
      const out = createWriteStream(tempPath);
      const record: TempUploadFile = {
        fieldName,
        filename: info.filename || "upload",
        tempPath,
        mimeType: info.mimeType || "application/octet-stream",
        bytes: 0,
        truncated: false,
      };
      // Push immediately so the result order matches multipart part order, not completion order.
      files.push(record);

      const done = new Promise<void>((resolveFile, rejectFile) => {
        let finished = false;
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          if (error) {
            rejectFile(error);
            return;
          }
          resolveFile();
        };

        stream.on("data", (chunk: Buffer) => {
          record.bytes += chunk.length;
        });
        stream.on("limit", () => {
          record.truncated = true;
        });
        stream.on("error", (error) => finish(error));
        out.on("error", (error) => finish(error));
        out.on("finish", () => finish());
        stream.pipe(out);
      });

      pending.push(done.catch((error) => fail(error as Error)));
    });

    busboy.on("filesLimit", () => {
      tooManyFiles = true;
    });
    busboy.on("error", (error) => fail(error as Error));

    req.on("aborted", () => fail(new Error("Request bị hủy")));

    busboy.on("close", async () => {
      if (settled) return;
      const results = await Promise.allSettled(pending);
      const failure = results.find((result) => result.status === "rejected");
      if (failure && failure.status === "rejected") {
        fail(failure.reason instanceof Error ? failure.reason : new Error("Upload lỗi"));
        return;
      }
      settled = true;
      resolve({ files, fields, tooManyFiles });
    });

    req.pipe(busboy);
  });
}

export async function cleanupTempFiles(files: TempUploadFile[]): Promise<void> {
  await Promise.all(
    files.map((file) => fs.unlink(file.tempPath).catch(() => undefined)),
  );
}
