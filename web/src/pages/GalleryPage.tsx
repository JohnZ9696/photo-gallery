import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Photo } from "../types";
import { EditDialog } from "../components/EditDialog";
import { Gallery } from "../components/Gallery";
import { Header } from "../components/Header";
import { PhotoViewer } from "../components/PhotoViewer";
import { UploadPanel } from "../components/UploadPanel";

type Scope = "all" | "mine";

export function GalleryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState<Photo | null>(null);
  const [editing, setEditing] = useState<Photo | null>(null);
  const [notice, setNotice] = useState("");

  const query = useInfiniteQuery({
    queryKey: ["photos", user?.id, scope],
    queryFn: ({ pageParam }) =>
      api.listPhotos({
        scope,
        cursor: pageParam as string | null,
        limit: 18,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 10_000,
  });

  const photos = query.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["photos"] });
  };

  const handleDelete = async (photo: Photo) => {
    try {
      const result = await api.deletePhoto(photo.id);
      await refresh();
      setSelected(null);
      setNotice(
        result.pending
          ? "Ảnh đã được ẩn. Hệ thống sẽ tiếp tục dọn file còn lại."
          : "Đã xóa ảnh và dọn file liên quan.",
      );
    } catch (caught) {
      throw caught;
    }
  };

  const handleRestore = async (photo: Photo) => {
    try {
      const response = await api.restorePhoto(photo.id, photo.currentVersion);
      setSelected(response.photo);
      await refresh();
      setNotice("Đã khôi phục từ bản gốc chuẩn hóa và tạo phiên bản mới.");
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 409) {
        await refresh();
        throw new Error("Ảnh vừa thay đổi ở phiên khác. Hãy đóng và mở lại ảnh.");
      }
      throw caught;
    }
  };

  return (
    <div className="app-shell">
      <Header />

      <main className="gallery-main">
        <section className="gallery-hero">
          <div>
            <p className="eyebrow">Bộ sưu tập chung</p>
            <h1>Những gì mọi người đã ghi lại.</h1>
            <p className="hero-copy">
              Tất cả thành viên có thể xem ảnh của nhau. Bạn chỉ có thể chỉnh sửa,
              khôi phục hoặc xóa ảnh do chính mình tải lên.
            </p>
          </div>
          <div className="hero-stat">
            <strong>{photos.length}</strong>
            <span>ảnh đã tải trong phiên xem này</span>
          </div>
        </section>

        <UploadPanel onUploaded={() => void refresh()} />

        <section className="collection-section">
          <div className="collection-head">
            <div>
              <p className="eyebrow">Thư viện</p>
              <h2>{scope === "all" ? "Tất cả ảnh" : "Ảnh của tôi"}</h2>
            </div>
            <div className="segmented" role="tablist" aria-label="Phạm vi ảnh">
              <button
                role="tab"
                aria-selected={scope === "all"}
                className={scope === "all" ? "is-active" : ""}
                onClick={() => setScope("all")}
              >
                Tất cả
              </button>
              <button
                role="tab"
                aria-selected={scope === "mine"}
                className={scope === "mine" ? "is-active" : ""}
                onClick={() => setScope("mine")}
              >
                Ảnh của tôi
              </button>
            </div>
          </div>

          {query.isLoading ? (
            <div className="loading-grid" aria-label="Đang tải ảnh">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="skeleton" key={index} />
              ))}
            </div>
          ) : null}

          {query.isError ? (
            <div className="empty-state">
              <h3>Không tải được thư viện</h3>
              <p>
                {query.error instanceof ApiClientError
                  ? query.error.message
                  : "Vui lòng kiểm tra kết nối và thử lại."}
              </p>
              <button className="btn btn-secondary" onClick={() => void query.refetch()}>
                Thử lại
              </button>
            </div>
          ) : null}

          {!query.isLoading && !query.isError && photos.length === 0 ? (
            <div className="empty-state">
              <h3>Chưa có ảnh nào ở đây</h3>
              <p>
                {scope === "mine"
                  ? "Bạn chưa tải ảnh nào. Hãy thêm ảnh đầu tiên ở phía trên."
                  : "Hãy là người đầu tiên chia sẻ một khoảnh khắc."}
              </p>
            </div>
          ) : null}

          {photos.length > 0 ? <Gallery photos={photos} onOpen={setSelected} /> : null}

          {query.hasNextPage ? (
            <div className="load-more">
              <button
                className="btn btn-secondary"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Đang tải…" : "Tải thêm ảnh"}
              </button>
            </div>
          ) : null}
        </section>
      </main>

      <footer className="site-footer">
        <span>Lumina · shared photo archive</span>
        <span>{user?.displayName} đang đăng nhập</span>
      </footer>

      {notice ? <div className="toast">{notice}</div> : null}

      {selected ? (
        <PhotoViewer
          photo={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onRestore={() => handleRestore(selected)}
          onDelete={() => handleDelete(selected)}
        />
      ) : null}

      {editing ? (
        <EditDialog
          photo={editing}
          onClose={() => setEditing(null)}
          onSaved={(photo) => {
            setSelected(photo);
            setEditing(null);
            void refresh();
            setNotice("Đã tạo phiên bản mới từ bản gốc chuẩn hóa.");
          }}
        />
      ) : null}
    </div>
  );
}
