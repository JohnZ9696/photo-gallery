export type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type Variant = {
  kind: "thumb" | "medium" | "large" | string;
  width: number;
  height: number;
  url: string;
  contentType: string;
};

export type Photo = {
  id: string;
  alt: string;
  width: number;
  height: number;
  currentVersion: number;
  owner: { id: string; displayName: string };
  canEdit: boolean;
  variants: Variant[];
  createdAt: string;
};

export type PhotoListResponse = {
  items: Photo[];
  nextCursor: string | null;
};

export type UploadResult = {
  index: number;
  filename: string;
  ok: boolean;
  photo?: Photo;
  error?: { code: string; message: string };
};

export type UploadResponse = {
  results: UploadResult[];
  summary: { total: number; succeeded: number; failed: number };
};

export type EditPayload = {
  expectedVersion: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
};
