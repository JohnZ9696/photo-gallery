import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
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
const VARIANT_WIDTHS = [480, 1024, 1600];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function expectedVariantWidths(width: number): number[] {
  const widths = VARIANT_WIDTHS.filter((item) => item < width);
  if (widths.length === 0) return [width];
  if (widths.length < 3 && width > widths[widths.length - 1]) widths.push(width);
  return [...new Set(widths)].sort((a, b) => a - b).slice(0, 3);
}

function PendingThumb({
  file,
  alt,
  onOpen,
}: {
  file: File;
  alt: string;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setFailed(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <button className="pending-thumb-button" type="button" onClick={onOpen}>
      {url && !failed ? (
        <img
          src={url}
          alt={alt || file.name}
          onError={() => setFailed(true)}
          loading="eager"
          decoding="async"
        />
      ) : (
        <span className="pending-thumb-placeholder">
          {failed ? "Không xem trước được" : "Đang tạo preview…"}
        </span>
      )}
      <span className="pending-preview-hint">Xem trước</span>
    </button>
  );
}

function LocalPreview({
  file,
  alt,
  onClose,
}: {
  file: File;
  alt: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setDimensions(null);
    setFailed(false);

    const image = new Image();
    image.onload = () => {
      setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => setFailed(true);
    image.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
      image.onload = null;
      image.onerror = null;
    };
  }, [file]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const variants = dimensions
    ? expectedVariantWidths(dimensions.width)
    : [];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="local-preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Xem trước ${file.name}`}
      >
        <button className="modal-close" onClick={onClose} aria-label="Đóng">
          ×
        </button>

        <div className="local-preview-media">
          {url && !failed ? (
            <img src={url} alt={alt || file.name} />
          ) : (
            <span className="local-preview-failed">
              {failed ? "Không thể đọc file này như ảnh" : "Đang tạo preview…"}
            </span>
          )}
        </div>

        <aside className="local-preview-info">
          <p className="eyebrow">Preview cục bộ · chưa tải lên</p>
          <h2>{file.name}</h2>
          <dl className="meta-list">
            <div>
              <dt>Dung lượng</dt>
              <dd>{formatBytes(file.size)}</dd>
            </div>
            <div>
              <dt>Kích thước</dt>
              <dd>
                {dimensions
                  ? `${dimensions.width} × ${dimensions.height}`
                  : "Đang đọc…"}
              </dd>
            </div>
            <div>
              <dt>Variant dự kiến</dt>
              <dd>{variants.length ? variants.map((w) => `${w}w`).join(" · ") : "—"}</dd>
            </div>
            <div>
              <dt>Alt text</dt>
              <dd>{alt || "Sẽ dùng tên file"}</dd>
            </div>
          </dl>
          <p className="local-preview-note">
            Đây chỉ là preview trên trình duyệt. Khi bấm tải lên, server mới kiểm tra
            nội dung thật bằng magic bytes + decode, chuẩn hóa ảnh và tạo variant.
          </p>
          <div className="local-preview-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Đóng preview
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function UploadPanel({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
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
    setPreviewIndex(null);
  };

  const submit = async () => {
    if (pending.length === 0) return;
    setPreviewIndex(null);
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
        setPending((current) =>
          current.filter((_, index) => !response.results[index]?.ok),
        );
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

  const previewItem =
    previewIndex !== null && previewIndex < pending.length ? pending[previewIndex] : null;

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
        <small>
          Ảnh được xem trước ngay trên trình duyệt trước khi tải lên. Server kiểm tra
          nội dung thật, chuẩn hóa và tạo tối đa 3 kích thước.
        </small>
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
        <div className="pending-grid">
          {pending.map((item, index) => (
            <article className="pending-card" key={`${item.file.name}-${item.file.lastModified}-${index}`}>
              <PendingThumb
                file={item.file}
                alt={item.alt}
                onOpen={() => setPreviewIndex(index)}
              />
              <button
                className="pending-remove icon-btn"
                onClick={() => removeFile(index)}
                aria-label={`Bỏ ${item.file.name}`}
                type="button"
              >
                ×
              </button>
              <div className="pending-card-body">
                <div className="pending-meta">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <span>{formatBytes(item.file.size)}</span>
                </div>
                <input
                  value={item.alt}
                  onChange={(event) => updateAlt(index, event.target.value)}
                  placeholder="Mô tả ảnh (alt text)"
                  maxLength={300}
                />
              </div>
            </article>
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
        <span className="upload-hint">
          {pending.length > 0
            ? `${pending.length} ảnh đã chọn · bấm ảnh để xem trước`
            : "Chưa chọn ảnh nào"}
        </span>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={uploading || pending.length === 0}
        >
          {uploading ? "Đang xử lý ảnh…" : `Tải ${pending.length || ""} ảnh lên`}
        </button>
      </div>

      {previewItem ? (
        <LocalPreview
          file={previewItem.file}
          alt={previewItem.alt}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </section>
  );
}
