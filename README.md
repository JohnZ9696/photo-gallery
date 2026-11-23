# Lumina — Photo Gallery

Photo gallery full-stack: React + Node.js + PostgreSQL + **SeaweedFS S3 gateway**. Hỗ trợ đăng ký/đăng nhập, gallery chung giữa các user, upload 1–5 ảnh/request, variant responsive, chỉnh sửa ảnh có version và cleanup theo retention.

## Tính năng

- Đăng ký / đăng nhập / đăng xuất bằng email + mật khẩu.
- Mọi user đã đăng nhập xem được ảnh của nhau; chỉ owner được sửa, khôi phục, xóa.
- Upload tối đa 5 ảnh/request, trả kết quả riêng từng file.
- Kiểm tra ảnh thật bằng magic bytes + decode `sharp`; không tin extension/MIME.
- Chuẩn hóa master: auto-orient, sRGB, WebP, strip EXIF.
- Tạo tối đa 3 variant WebP (480/1024/1600, không upscale).
- Gallery dùng `srcset`, `sizes`, `width`, `height`, `loading`, `alt`.
- Chỉnh sửa: crop, xoay 0/90/180/270, lật ngang, khôi phục.
- Browser preview bằng canvas trước khi gửi tham số; server validate lại.
- Mỗi lần edit/restore tạo version mới dưới `photos/{photoId}/v{n}/`; publish an toàn.
- Variant sau chỉnh sửa không còn EXIF/GPS.
- Xóa ảnh khỏi gallery và dọn file + metadata.
- Cleanup staged/superseded/deleted/orphan/journal theo retention.
- Storage key lưu trong DB, không lưu URL/đường dẫn tuyệt đối.

## Stack

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, react-image-crop |
| Backend | Node.js, Express 5, TypeScript |
| DB | PostgreSQL 16 + Prisma |
| Storage | SeaweedFS S3 gateway (`@aws-sdk/client-s3`) |
| Ảnh | sharp |
| Auth | argon2id + session cookie httpOnly |

## Chạy local

Yêu cầu: Node.js 22+, Docker Desktop.

```bash
cp .env.example .env

# PostgreSQL + SeaweedFS
docker compose up -d

# dependencies (npm workspaces)
npm install

# Prisma client + migration
npm run db:generate
npm run db:migrate

# chạy web (5173) + API (3000)
npm run dev
```

Mở http://localhost:5173, bấm **Tạo tài khoản**.

Nếu chạy lần đầu và Prisma báo chưa có migration:

```bash
npm run db:migrate -- --name init
```

### SeaweedFS

- S3 gateway: http://localhost:8333
- Filer: http://localhost:8888
- Master: http://localhost:9333
- Bucket mặc định: `photo-gallery`
- Credentials local: `gallery` / `gallery-local-secret` (khớp `infra/seaweedfs/s3.json` và `.env`)
- App tự gọi `CreateBucket` khi khởi động nếu bucket chưa tồn tại.
- `S3_FORCE_PATH_STYLE=true` là bắt buộc với SeaweedFS.
- Volume `seaweed_data` giữ object qua restart container.

Tạo bucket thủ công (nếu cần):

```bash
aws --endpoint-url http://localhost:8333 s3 mb s3://photo-gallery
```

### PostgreSQL

- `postgres:16-alpine`, database `photo_gallery`, user/password `gallery`/`gallery`.
- Volume `pg_data` giữ user/photo/session qua restart.
- Đổi `DATABASE_URL` và các biến `POSTGRES_*` nếu dùng port/credential khác.

## Cấu trúc storage

```text
photos/
└── p01/
    ├── master.webp                 # bản gốc chuẩn hóa, mọi edit đọc file này
    ├── v1/
    │   ├── thumb-480w.webp
    │   ├── medium-1024w.webp
    │   └── large-1600w.webp
    └── v2/                         # version sau crop/xoay/lật
        ├── thumb-480w.webp
        ├── medium-1024w.webp
        └── large-1600w.webp
```

- Photo ID dạng `p01`, `p02`… (global, duy nhất).
- Quyền sở hữu nằm trong DB (`Photo.ownerId`), không nằm trong storage key.
- Xóa ảnh sẽ xóa prefix `photos/{photoId}/`.

## API

| Method | Endpoint | Ghi chú |
|---|---|---|
| POST | `/api/auth/register` | `{ email, displayName, password }` |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | Xóa session hiện tại |
| GET | `/api/auth/me` | `{ user: UserDTO \| null }` |
| GET | `/api/photos?scope=all\|mine&cursor=&limit=` | Gallery chung / của tôi |
| POST | `/api/photos` | Multipart `files` (1–5), `alts` (JSON array) |
| GET | `/api/photos/:id` | Chi tiết ảnh |
| POST | `/api/photos/:id/edits` | Crop/rotate/flip, tạo version mới |
| POST | `/api/photos/:id/restore` | Khôi phục từ master |
| DELETE | `/api/photos/:id` | Ẩn + purge file/DB |
| GET | `/media/:photoId/v/:version/:kind` | Stream variant (cần đăng nhập) |
| GET | `/media/:photoId/master` | Bản gốc chuẩn hóa cho editor preview (cần đăng nhập) |
| GET | `/api/health` | DB + storage health |

Edit payload:

```json
{
  "expectedVersion": 1,
  "crop": { "x": 100, "y": 50, "width": 1200, "height": 900 },
  "rotate": 90,
  "flipH": true
}
```

- `crop` là pixel trên master đã chuẩn hóa (gốc trên-trái), có thể `null`.
- `rotate` chỉ nhận `0`, `90`, `180`, `270`.
- Thứ tự xử lý: crop → rotate → flipH.
- Mọi edit/restore đọc `master.webp`, không đọc variant đã nén.

## Retention & cleanup

Bảng dưới đây là nguồn tham chiếu; giá trị thực tế lấy từ `.env` và `server/src/config/retention.ts`.

| Nhóm | Phạm vi | Mặc định | Hành động |
|---|---|---|---|
| `staged_version` | Prefix của version STAGED/FAILED | 60 phút | Xóa prefix, version → PURGED |
| `superseded_version` | Version SUPERSEDED | 7 ngày | Xóa file, variant `cleanedAt` |
| `deleted_photo` | Photo DELETED, retry | 24 giờ | Xóa toàn bộ prefix, xóa DB |
| `orphan_object` | Object không có trong DB | 24 giờ | Xóa object |
| `journal_keys` | Key trong cleanup journal | 24 giờ | Xóa file, xóa dòng journal |
| `expired_session` | Session hết hạn | Ngay lập tức | Xóa bản ghi session |

Lệnh cleanup thủ công:

```bash
npm run cleanup -- --all
npm run cleanup -- --retention
npm run cleanup -- --orphans
npm run cleanup -- --photo p01
```

API `DELETE /api/photos/:id` cố gắng purge ngay. Nếu storage lỗi, trả `202` và tạo cleanup job retry.

## Biến môi trường

Xem `.env.example`. Các nhóm chính:

- `DATABASE_URL`
- `SESSION_SECRET`, `SESSION_TTL_DAYS`, `COOKIE_SECURE`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`
- `MAX_UPLOAD_FILES`, `MAX_UPLOAD_BYTES`, `MAX_PIXELS`, `MAX_SIDE`
- `VARIANT_WIDTHS`, `MIN_CROP_SIZE`
- `RETENTION_*`, `CLEANUP_INTERVAL_MINUTES`

## Kiểm thử / nghiệm thu nhanh

```bash
npm run typecheck
npm run build
```

Checklist thủ công:

1. Đăng ký user A, upload JPEG + PNG.
2. Upload file text đổi đuôi `.jpg` → chỉ file thật được lưu.
3. Upload >15MB hoặc >50MP → không có Photo/file.
4. Mở gallery, kiểm tra `<img>` có `srcset`, `sizes`, `width`, `height`, `loading`, `alt`.
5. DevTools Network: mobile tải 480w, desktop tải 1024/1600; `src` mặc định không phải large.
6. `curl -I -b cookie.txt http://localhost:3000/media/p02/v/1/medium`:
   - `Content-Type: image/webp`
   - `Cache-Control: private, max-age=31536000, immutable`
   - `Vary: Cookie`
7. Đăng ký user B: thấy ảnh A, không thấy nút sửa/xóa; gọi edit/delete ảnh A → `403`.
8. User A chỉnh crop/xoay/lật, preview thay đổi → áp dụng → URL chuyển sang `/v/2/`.
9. `exiftool` file variant mới: không có GPS/EXIF.
10. Restore → `/v/3/`, ảnh trở về bản gốc.
11. Xóa ảnh → gallery mất ngay; chạy cleanup → prefix storage rỗng, DB không còn record.
12. Restart `npm run dev` / Docker → session, gallery, URL media vẫn hoạt động.

## Bảo mật

- Password hash argon2id; session token ngẫu nhiên, DB chỉ lưu SHA-256 hash.
- Cookie `httpOnly`, `SameSite=Lax`, `Secure` khi chạy HTTPS.
- Rate limit login/register.
- Kiểm tra `Origin` cho mutation (CSRF).
- Media yêu cầu session; cache `private` + `Vary: Cookie`.
- Không trả `passwordHash` hay storage key ra client.
