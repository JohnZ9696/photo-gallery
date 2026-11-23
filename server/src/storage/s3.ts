import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

export type StoredObject = {
  key: string;
  size: number;
  lastModified?: Date;
};

export interface StorageAdapter {
  ensureBucket(): Promise<void>;
  put(key: string, body: Buffer, contentType: string, cacheControl?: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  getStream(key: string): Promise<{ body: Readable; contentLength?: number; contentType?: string }>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  listPrefix(prefix: string): Promise<StoredObject[]>;
  exists(key: string): Promise<boolean>;
}

export class S3Storage implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket = env.S3_BUCKET;

  constructor() {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && status !== 403) throw error;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (createError) {
        const createStatus = (createError as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        // 409 = bucket already owned by us / exists.
        if (createStatus !== 409) throw createError;
      }
    }
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl = env.S3_CACHE_CONTROL,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object rỗng: ${key}`);
    return Buffer.from(bytes);
  }

  async getStream(
    key: string,
  ): Promise<{ body: Readable; contentLength?: number; contentType?: string }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Object rỗng: ${key}`);
    return {
      body: response.Body as Readable,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)].filter(Boolean);
    for (let index = 0; index < unique.length; index += 1000) {
      const chunk = unique.slice(index, index + 1000);
      try {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch {
        // SeaweedFS versions differ in DeleteObjects support. Fall back to per-key deletes.
        for (const key of chunk) {
          await this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
          );
        }
      }
    }
  }

  async listPrefix(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of response.Contents ?? []) {
        if (!item.Key) continue;
        objects.push({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified,
        });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const objects = await this.listPrefix(prefix);
    if (objects.length === 0) return 0;
    await this.deleteMany(objects.map((object) => object.key));
    return objects.length;
  }

  async exists(key: string): Promise<boolean> {
    const objects = await this.listPrefix(key);
    return objects.some((object) => object.key === key);
  }
}

export const storage = new S3Storage();
