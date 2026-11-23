import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ApiClientError, api } from "../api/client";
import type { UploadResponse } from "../types";

type Props = {
  onUploaded: () => void;
};

type PendingFile = {
  file: File;
  alt: string;
};

const MAX_FILES = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPanel({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResponse | null>(null);

  const addFiles = (files: FileList | File[]) => {
    setError("");
    setResult(null);
    const incoming = Array.from(files);
    const next = [...pending];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) break;
      next.push({ file, alt: "" });
    }
    if (pending.length + incoming.length > MAX_FILES) {
      setError("Mỗi lần chỉ upload tối đa 5 ảnh");
    }
    setPending(next);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  };

  const updateAlt = (index: number, alt: string) => {
    setPending((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, alt } : item)),
    );
  };

  const removeFile = (index: number) => {
    setPending((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const submit = async () => {
    if (pending.length === 0) return;
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.uploadPhotos(
        pending.map((item) => item.file),
        pending.map((item) => item.alt),
      );
      setResult(response);
      if (response.summary.succeeded > 0) {
        onUploaded();
        setPending((current) => current.filter((_, index) => !response.results[index]?.ok));
      }
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Upload thất bại, vui lòng thử lại",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="upload-panel">
      <div className="upload-heading">
        <div>
          <p className="eyebrow">Thêm vào album</p>
          <h2>Tải ảnh lên</h2>
        </div>
        <span className="hint">JPEG · PNG · WebP · tối đa 5 ảnh</span>
      </div>

      <div
        className={`drop-zone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
      >
        <strong>Kéo ảnh vào đây</strong>
        <span>hoặc bấm để chọn từ máy</span>
        <small>Ảnh được kiểm tra nội dung thật, chuẩn hóa và tạo tối đa 3 kích thước.</small>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={onInputChange}
          hidden
        />
      </div>

      {pending.length > 0 ? (
        <div className="pending-list">
          {pending.map((item, index) => (
            <div className="pending-row" key={`${item.file.name}-${index}`}>
              <div className="pending-meta">
                <strong>{item.file.name}</strong>
                <span>{formatBytes(item.file.size)}</span>
              </div>
              <input
                value={item.alt}
                onChange={(event) => updateAlt(index, event.target.value)}
                placeholder="Alt text (mô tả ảnh)"
                maxLength={300}
              />
              <button
                className="icon-btn"
                onClick={() => removeFile(index)}
                aria-label={`Bỏ ${item.file.name}`}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {result ? (
        <div className="upload-results">
          <p className="result-summary">
            {result.summary.succeeded} thành công · {result.summary.failed} lỗi
          </p>
          {result.results.map((item) => (
            <div className={`result-row ${item.ok ? "ok" : "fail"}`} key={item.index}>
              <span>{item.ok ? "✓" : "×"}</span>
              <span className="result-name">{item.filename}</span>
              <span>{item.ok ? "Đã lưu và tạo variant" : item.error?.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="upload-actions">
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={uploading || pending.length === 0}
        >
          {uploading ? "Đang xử lý ảnh…" : `Tải ${pending.length || ""} ảnh lên`}
        </button>
      </div>
    </section>
  );
}
