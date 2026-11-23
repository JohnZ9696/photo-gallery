import { useEffect, useState } from "react";
import type { Photo } from "../types";

type Props = {
  photo: Photo;
  onClose: () => void;
  onEdit: () => void;
  onRestore: () => Promise<void>;
  onDelete: () => Promise<void>;
};

function fullUrl(photo: Photo): string {
  const variants = [...photo.variants].sort((a, b) => b.width - a.width);
  return variants.find((variant) => variant.kind === "large")?.url ?? variants[0]?.url ?? "";
}

export function PhotoViewer({ photo, onClose, onEdit, onRestore, onDelete }: Props) {
  const [working, setWorking] = useState<"restore" | "delete" | null>(null);
  const [error, setError] = useState("");

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

  const handleRestore = async () => {
    if (!window.confirm("Khôi phục ảnh về bản gốc đã chuẩn hóa? Một phiên bản mới sẽ được tạo.")) {
      return;
    }
    setWorking("restore");
    setError("");
    try {
      await onRestore();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không khôi phục được ảnh");
    } finally {
      setWorking(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Xóa ảnh này khỏi gallery và dọn toàn bộ file liên quan?")) {
      return;
    }
    setWorking("delete");
    setError("");
    try {
      await onDelete();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không xóa được ảnh");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="viewer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={photo.alt}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Đóng">
          ×
        </button>

        <div className="viewer-image-wrap">
          <img src={fullUrl(photo)} alt={photo.alt} />
        </div>

        <aside className="viewer-info">
          <p className="eyebrow">Ảnh chia sẻ</p>
          <h2>{photo.alt}</h2>
          <dl className="meta-list">
            <div>
              <dt>Người đăng</dt>
              <dd>{photo.owner.displayName}</dd>
            </div>
            <div>
              <dt>Kích thước gốc</dt>
              <dd>
                {photo.width} × {photo.height}
              </dd>
            </div>
            <div>
              <dt>Phiên bản</dt>
              <dd>v{photo.currentVersion}</dd>
            </div>
            <div>
              <dt>Ngày đăng</dt>
              <dd>{new Date(photo.createdAt).toLocaleString("vi-VN")}</dd>
            </div>
          </dl>

          <div className="variant-list">
            {[...photo.variants]
              .sort((a, b) => a.width - b.width)
              .map((variant) => (
                <span key={variant.kind}>
                  {variant.kind} · {variant.width}w
                </span>
              ))}
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          {photo.canEdit ? (
            <div className="viewer-actions">
              <button className="btn btn-primary" onClick={onEdit}>
                Chỉnh sửa ảnh
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleRestore}
                disabled={working !== null}
              >
                {working === "restore" ? "Đang khôi phục…" : "Khôi phục bản gốc"}
              </button>
              <button
                className="btn btn-danger-ghost"
                onClick={handleDelete}
                disabled={working !== null}
              >
                {working === "delete" ? "Đang xóa…" : "Xóa ảnh"}
              </button>
            </div>
          ) : (
            <p className="viewer-note">
              Bạn đang xem ảnh của {photo.owner.displayName}. Chỉ chủ ảnh mới có thể
              chỉnh sửa hoặc xóa.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
