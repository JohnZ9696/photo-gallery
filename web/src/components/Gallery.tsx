import type { Photo } from "../types";
import { PhotoCard } from "./PhotoCard";

type Props = {
  photos: Photo[];
  onOpen: (photo: Photo) => void;
};

export function Gallery({ photos, onOpen }: Props) {
  return (
    <div className="photo-grid">
      {photos.map((photo, index) => (
        <PhotoCard key={photo.id} photo={photo} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}
