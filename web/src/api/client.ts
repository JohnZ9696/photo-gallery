import type {
  EditPayload,
  Photo,
  PhotoListResponse,
  UploadResponse,
  User,
} from "../types";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const error = payload?.error as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    throw new ApiClientError(
      response.status,
      error?.code || "REQUEST_FAILED",
      error?.message || `Request thất bại (${response.status})`,
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  me(): Promise<{ user: User | null }> {
    return request("/api/auth/me");
  },
  login(email: string, password: string): Promise<{ user: User }> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  register(email: string, displayName: string, password: string): Promise<{ user: User }> {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, displayName, password }),
    });
  },
  logout(): Promise<void> {
    return request("/api/auth/logout", { method: "POST" });
  },
  listPhotos(options: {
    scope: "all" | "mine";
    cursor?: string | null;
    limit?: number;
  }): Promise<PhotoListResponse> {
    const params = new URLSearchParams();
    params.set("scope", options.scope);
    params.set("limit", String(options.limit ?? 24));
    if (options.cursor) params.set("cursor", options.cursor);
    return request(`/api/photos?${params.toString()}`);
  },
  uploadPhotos(files: File[], alts: string[]): Promise<UploadResponse> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("alts", JSON.stringify(alts));
    return request("/api/photos", { method: "POST", body: form });
  },
  editPhoto(photoId: string, payload: EditPayload): Promise<{ photo: Photo }> {
    return request(`/api/photos/${photoId}/edits`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  restorePhoto(photoId: string, expectedVersion: number): Promise<{ photo: Photo }> {
    return request(`/api/photos/${photoId}/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    });
  },
  deletePhoto(photoId: string): Promise<{ deleted: boolean; pending: boolean }> {
    return request(`/api/photos/${photoId}`, { method: "DELETE" });
  },
};
