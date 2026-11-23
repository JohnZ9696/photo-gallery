import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import ReactCrop, { type Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ApiClientError, api } from "../api/client";
import type { Photo } from "../types";

type Props = {
  photo: Photo;
  onClose: () => void;
  onSaved: (photo: Photo) => void;
};

const FULL_CROP: Crop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

function previewVariant(photo: Photo): string {
  // Editors always preview the normalized master so crop coordinates map 1:1,
  // even when the current published version was already cropped/rotated.
  return `/media/${photo.id}/master`;
}

function rounded(value: number): number {
  return Math.round(value);
}

export function EditDialog({ photo, onClose, onSaved }: Props) {
  const [crop, setCrop] = useState<Crop>(FULL_CROP);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewUrl = previewVariant(photo);

  const mutation = useMutation({
    mutationFn: async () => {
      const cropPayload = computeCropPayload(crop, photo);
      return api.editPhoto(photo.id, {
        expectedVersion: photo.currentVersion,
        crop: cropPayload,
        rotate,
        flipH,
      });
    },
    onSuccess: (response) => {
      onSaved(response.photo);
      onClose();
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Không áp dụng được chỉnh sửa, vui lòng thử lại",
      );
    },
  });

  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = previewUrl;
    return () => {
      element.onload = null;
    };
  }, [previewUrl]);

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

  const cropPixels = useMemo(() => computeCropPayload(crop, photo), [crop, photo]);
  const outputSize = useMemo(() => {
    if (!cropPixels) {
      const width = photo.width;
      const height = photo.height;
      return rotate === 90 || rotate === 270
        ? { width: height, height: width }
        : { width, height };
    }
    return rotate === 90 || rotate === 270
      ? { width: cropPixels.height, height: cropPixels.width }
      : { width: cropPixels.width, height: cropPixels.height };
  }, [cropPixels, photo.height, photo.width, rotate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const percent = crop.unit === "%" ? crop : FULL_CROP;
    const sx = (percent.x / 100) * image.naturalWidth;
    const sy = (percent.y / 100) * image.naturalHeight;
    const sw = Math.max(1, (percent.width / 100) * image.naturalWidth);
    const sh = Math.max(1, (percent.height / 100) * image.naturalHeight);
    const rotated = rotate === 90 || rotate === 270;
    const outW = rotated ? sh : sw;
    const outH = rotated ? sw : sh;
    const scale = Math.min(1, 900 / Math.max(outW, outH));

    canvas.width = Math.max(1, rounded(outW * scale));
    canvas.height = Math.max(1, rounded(outH * scale));
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotate * Math.PI) / 180);
    context.scale(flipH ? -1 : 1, 1);
    context.drawImage(
      image,
      sx,
      sy,
      sw,
      sh,
      (-sw * scale) / 2,
      (-sh * scale) / 2,
      sw * scale,
      sh * scale,
    );
    context.restore();
  }, [crop, flipH, image, rotate]);

  const cropIsValid = cropPixels
    ? cropPixels.width >= 16 && cropPixels.height >= 16
    : true;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="editor-panel" role="dialog" aria-modal="true" aria-label="Chỉnh sửa ảnh">
        <button className="modal-close" onClick={onClose} aria-label="Đóng">
          ×
        </button>

        <div className="editor-head">
          <div>
            <p className="eyebrow">Chỉnh sửa · v{photo.currentVersion}</p>
            <h2>{photo.alt}</h2>
          </div>
          <p className="editor-note">
            Mọi thay đổi bắt đầu từ bản gốc đã chuẩn hóa, không dùng variant đã nén.
            Variant mới không giữ EXIF.
          </p>
        </div>

        <div className="editor-grid">
          <div className="editor-canvas-area">
            <p className="mini-label">Vùng crop</p>
            {previewUrl ? (
              <ReactCrop
                crop={crop}
                onChange={(_crop, percentCrop) => {
                  setCrop(percentCrop);
                  setError("");
                }}
                minWidth={16}
                minHeight={16}
                keepSelection
              >
                <img
                  className="crop-source"
                  src={previewUrl}
                  alt={photo.alt}
                  crossOrigin="anonymous"
                />
              </ReactCrop>
            ) : null}
            <div className="transform-bar">
              <button
                className="btn btn-small"
                type="button"
                onClick={() => setRotate(((rotate + 270) % 360) as 0 | 90 | 180 | 270)}
              >
                ↺ Xoay trái
              </button>
              <button
                className="btn btn-small"
                type="button"
                onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)}
              >
                ↻ Xoay phải
              </button>
              <button
                className={`btn btn-small ${flipH ? "is-active" : ""}`}
                type="button"
                onClick={() => setFlipH((value) => !value)}
              >
                ⇋ Lật ngang
              </button>
              <button
                className="btn btn-small"
                type="button"
                onClick={() => {
                  setCrop(FULL_CROP);
                  setRotate(0);
                  setFlipH(false);
                }}
              >
                Đặt lại
              </button>
            </div>
            <p className="mini-label">
              Crop: {cropPixels ? `${cropPixels.width} × ${cropPixels.height}` : "toàn ảnh"} ·
              output dự kiến: {outputSize.width} × {outputSize.height}
            </p>
            {!cropIsValid ? (
              <p className="form-error">Crop phải có kích thước tối thiểu 16 × 16 px.</p>
            ) : null}
          </div>

          <div className="editor-preview-area">
            <p className="mini-label">Xem trước kết quả</p>
            <div className="preview-frame">
              <canvas ref={canvasRef} />
              {!image ? <span className="preview-loading">Đang tải ảnh…</span> : null}
            </div>
            <div className="preview-meta">
              <span>Xoay {rotate}°</span>
              <span>{flipH ? "Lật ngang" : "Không lật"}</span>
              <span>v{photo.currentVersion} → v{photo.currentVersion + 1}</span>
            </div>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="editor-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={mutation.isPending}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !cropIsValid}
          >
            {mutation.isPending ? "Đang tạo phiên bản mới…" : "Áp dụng chỉnh sửa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function computeCropPayload(
  crop: Crop,
  photo: Photo,
): { x: number; y: number; width: number; height: number } | null {
  if (crop.unit !== "%") return null;
  const isFull =
    crop.x <= 0.01 &&
    crop.y <= 0.01 &&
    crop.width >= 99.99 &&
    crop.height >= 99.99;
  if (isFull) return null;

  const x = Math.max(0, rounded((crop.x / 100) * photo.width));
  const y = Math.max(0, rounded((crop.y / 100) * photo.height));
  const width = Math.min(photo.width - x, Math.max(1, rounded((crop.width / 100) * photo.width)));
  const height = Math.min(
    photo.height - y,
    Math.max(1, rounded((crop.height / 100) * photo.height)),
  );
  return { x, y, width, height };
}
