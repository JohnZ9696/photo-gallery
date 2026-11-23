import type { Photo } from "../types";

type Props = {
  photo: Photo;
  index: number;
  onOpen: (photo: Photo) => void;
};

const SIZES = "(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw";

export function PhotoCard({ photo, index, onOpen }: Props) {
  const variants = [...photo.variants].sort((a, b) => a.width - b.width);
  const fallback =
    variants.find((variant) => variant.kind === "medium") ??
    variants[Math.floor(variants.length / 2)] ??
    variants[0];

  if (!fallback) return null;

  const srcSet = variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ");

  return (
    <article className="photo-card">
      <button className="photo-button" onClick={() => onOpen(photo)} type="button">
        <img
          src={fallback.url}
          srcSet={srcSet}
          sizes={SIZES}
          width={fallback.width}
          height={fallback.height}
          loading={index < 4 ? "eager" : "lazy"}
          decoding="async"
          alt={photo.alt}
        />
        <span className="photo-owner">{photo.owner.displayName}</span>
        {photo.canEdit ? <span className="photo-badge">Của bạn</span> : null}
        <span className="photo-view">Xem ảnh</span>
      </button>
      <div className="photo-caption">
        <p>{photo.alt}</p>
        <small>
          v{photo.currentVersion} · {photo.width} × {photo.height}
        </small>
      </div>
    </article>
  );
}
