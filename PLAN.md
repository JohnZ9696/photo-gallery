# Kế hoạch triển khai Photo Gallery (React + Node.js)

## 1. Mục tiêu & phạm vi

Xây dựng một photo gallery có upload nhiều ảnh, tự sinh variant responsive, lưu trữ trên MinIO/SeaweedFS, có metadata trong DB và bộ công cụ chỉnh sửa ảnh (crop, xoay, lật ngang, khôi phục) theo mô hình **version + publish an toàn**.

### Trong phạm vi

- Upload 1–5 ảnh trong một request; trả kết quả riêng cho từng file.
- Kiểm tra ảnh thật bằng magic bytes + decode, không tin phần mở rộng/MIME do client gửi.
- Chuẩn hóa ảnh gốc (auto-orient, sRGB, strip metadata) và sinh tối đa 3 variant WebP.
- Gallery responsive dùng `srcset`, `sizes`, `width`, `height`, `loading`, `alt`.
- Media server trả đúng `Content-Type`, `Cache-Control`; URL ổn định qua restart.
- Chỉnh sửa ảnh có preview phía browser, server validate tham số, tạo version mới dưới `photos/{photoId}/v{n}/`.
- Khôi phục (restore) sinh lại variant từ bản gốc chuẩn hóa.
- Variant sau chỉnh sửa không còn EXIF/GPS.
- Xóa ảnh khỏi gallery, dọn file + metadata.
- Cleanup theo nhóm retention được ghi trong README.
- Lưu storage key trong DB, không lưu URL/đường dẫn tuyệt đối.

### Ngoài phạm vi (ghi nhận để tránh phình scope)

- Đăng nhập, phân quyền đa người dùng, multi-tenant.
- CDN, image resizing on-the-fly, video.
- AI tagging, tìm kiếm nâng cao.
- Đồng bộ đa thiết bị realtime.

---

## 2. Quyết định kỹ thuật mặc định

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Stack yêu cầu, dev nhanh, build đơn giản |
| Data fetching | TanStack Query | Cache/invalidate sau upload, edit, delete |
| Crop UI | `react-image-crop` + Canvas | Preview WYSIWYG trước khi gửi tham số |
| Backend | Node.js 22 + Express 5 + TypeScript | Quen thuộc, dễ kiểm soát stream upload |
| Validation | Zod (strict object) | Chặn field lạ, ép kiểu, giới hạn giá trị |
| Xử lý ảnh | `sharp` | Decode/normalize/resize/rotate/flip, strip EXIF |
| Storage | S3 API qua `@aws-sdk/client-s3` | Dùng chung MinIO và SeaweedFS S3 gateway |
| DB | SQLite + Prisma (dev), có thể đổi Postgres | Chạy ngay, không cần service phụ; restart vẫn còn dữ liệu |
| Multipart | Busboy | Kiểm soát giới hạn theo từng file, không hủy cả request |
| Logging | Pino + requestId | Truy vết lỗi theo từng file |
| Test | Vitest + Supertest + Playwright | Unit, API integration, E2E |
| EXIF test | `exiftool-vendored` (dev) | Xác minh GPS/EXIF thực sự bị xóa |

### Nguyên tắc kiến trúc

1. **DB là nguồn sự thật** cho trạng thái gallery và key file. Storage chỉ chứa object.
2. **Không BAO GIỜ chỉnh sửa từ variant.** Mọi edit/restore đọc `Photo.masterKey` (bản gốc đã chuẩn hóa).
3. **Version bất biến:** mỗi version có URL riêng; không ghi đè file cũ.
4. **Publish hai pha:** ghi đủ file + metadata trước, chỉ cập nhật `currentVersion` sau cùng.
5. **Fail-safe:** lỗi DB sau khi ghi file thì xóa file; nếu xóa lỗi thì ghi journal để sweeper dọn lại.
6. **Không lưu đường dẫn tuyệt đối:** mọi thứ trong DB là storage key tương đối.

---

## 3. Cấu trúc dự án

```text
photo-gallery/
├── PLAN.md
├── README.md                       # setup, retention table, acceptance checklist
├── package.json                    # npm workspaces + script tổng
├── docker-compose.yml              # minio (default), seaweedfs (profile)
├── .env.example
├── server/
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── server.ts               # bootstrap: migrate check, storage ensure, worker
│       ├── app.ts                  # Express app
│       ├── config/
│       │   ├── env.ts              # validate env bằng zod
│       │   └── retention.ts        # cùng nguồn với bảng trong README
│       ├── db/
│       │   └── prisma.ts
│       ├── storage/
│       │   ├── adapter.ts          # interface StorageAdapter
│       │   └── s3.ts               # put/get/head/deleteMany/listPrefix
│       ├── http/
│       │   ├── upload.ts           # busboy, giới hạn theo file
│       │   ├── errors.ts
│       │   └── media.ts
│       ├── services/
│       │   ├── ingest.ts           # validate + normalize + variants + persist
│       │   ├── variants.ts         # width plan, render, key naming
│       │   ├── edits.ts            # validate params, versioning, publish
│       │   ├── media.ts            # stream object + headers
│       │   ├── cleanup.ts          # job runner, orphan scan, journal
│       │   └── photos.ts           # DTO, list, delete
│       ├── routes/
│       │   ├── photos.ts
│       │   └── media.ts
│       ├── lib/
│       │   ├── ids.ts
│       │   ├── exif.ts
│       │   ├── journal.ts
│       │   └── concurrency.ts
│       └── tests/
│           ├── unit/
│           ├── integration/
│           └── fixtures/
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/client.ts
│       ├── components/
│       │   ├── UploadPanel.tsx
│       │   ├── Gallery.tsx
│       │   ├── PhotoCard.tsx
│       │   ├── PhotoViewer.tsx
│       │   ├── EditDialog.tsx
│       │   └── CleanupStatus.tsx
│       └── styles/
├── scripts/
│   └── cleanup.ts                  # CLI dọn tay: photo, orphan, retention
└── .data/                          # SQLite + upload temp + cleanup journal (gitignored)
```

---

## 4. Mô hình dữ liệu

### 4.1 Prisma schema (rút gọn)

```prisma
enum PhotoStatus {
  READY
  DELETED      // đã ẩn khỏi gallery, đang chờ dọn
  PURGED       // đã dọn xong (nếu giữ tombstone)
}

enum VersionStatus {
  STAGED       // đã cấp version, đang ghi file
  PUBLISHED    // đang là currentVersion
  SUPERSEDED   // version cũ, còn file tới hết retention
  FAILED       // publish lỗi, chờ dọn
  PURGED       // file đã xóa
}

model Photo {
  id             String      @id            // "p01", "p02", ...
  alt            String
  originalName   String
  masterKey      String?                    // photos/p01/master.webp, null sau purge
  masterWidth    Int
  masterHeight   Int
  masterBytes    Int
  masterChecksum String
  format         String                     // jpeg | png | webp (định dạng gốc)
  currentVersion Int         @default(1)
  nextVersion    Int         @default(2)    // cấp phát version, tránh race
  status         PhotoStatus @default(READY)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  deletedAt      DateTime?
  purgedAt       DateTime?

  versions PhotoVersion[]
  variants PhotoVariant[]
}

model PhotoVersion {
  id          String        @id @default(cuid())
  photoId     String
  version     Int
  paramsJson  String        // JSON canonical: crop/rotate/flipH
  status      VersionStatus @default(STAGED)
  createdAt   DateTime      @default(now())
  publishedAt DateTime?

  photo Photo @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@unique([photoId, version])
}

model PhotoVariant {
  id          String    @id @default(cuid())
  photoId     String
  version     Int
  kind        String    // thumb | medium | large
  storageKey  String    @unique
  contentType String    // image/webp
  width       Int
  height      Int
  bytes       Int
  checksum    String
  createdAt   DateTime  @default(now())
  cleanedAt   DateTime?

  photo Photo @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@unique([photoId, version, kind])
  @@index([photoId, version])
}

model CleanupJob {
  id         String   @id @default(cuid())
  type       String   // STAGED_VERSION | SUPERSEDED_VERSION | DELETED_PHOTO | ORPHAN_OBJECT | JOURNAL_KEYS
  photoId    String?
  version    Int?
  storageKey String?
  prefix     String?
  runAfter   DateTime
  attempts   Int      @default(0)
  lastError  String?
  status     String   @default("PENDING") // PENDING | DONE | DEAD
  createdAt  DateTime @default(now())
}
```

### 4.2 Bất biến dữ liệu

- `Photo.currentVersion` chỉ trỏ tới version có `status = PUBLISHED` và **đủ tối đa 3 variant** (ít nhất 1).
- Không tồn tại 2 bản ghi variant trùng `storageKey`.
- `masterKey` không bao giờ nằm trong `photos/{id}/v{n}/` (tránh bị dọn nhầm khi xóa version).
- Mọi ảnh hiển thị trong gallery phải có `alt` khác rỗng (mặc định sinh từ tên file).
- `storageKey` là relative key, ví dụ `photos/p01/v2/medium-1024w.webp`; API tự build URL.

---

## 5. Bố cục storage & quy ước version

```text
photos/
└── p01/
    ├── master.webp                     # bản gốc đã chuẩn hóa, dùng cho mọi edit
    ├── v1/
    │   ├── thumb-480w.webp
    │   ├── medium-1024w.webp
    │   └── large-1600w.webp
    └── v2/                             # sau khi crop/xoay/lật
        ├── thumb-480w.webp
        ├── medium-1024w.webp
        └── large-1600w.webp
```

- Photo ID dạng `p01`, `p02`… sinh tuần tự trong transaction.
- Tối đa 3 variant: `thumb` 480w, `medium` 1024w, `large` 1600w.
- **Không upscale.** Nếu ảnh gốc nhỏ hơn width, bỏ width đó; khử trùng lặp width.
- Ảnh 300px chỉ có 1 variant `thumb-300w` (hoặc giữ width gốc, tên key theo width thực tế).
- Variant luôn là WebP, chất lượng server quy định (khoảng 80), strip toàn bộ metadata.
- Master là WebP chất lượng cao (khoảng 95), đã auto-orient + sRGB + strip metadata.
- Version 1 được tạo khi upload. Edit/restore luôn tạo version `currentVersion + 1` (cấp phát qua `nextVersion`).

---

## 6. API contract

### 6.1 Upload

```http
POST /api/photos
Content-Type: multipart/form-data
Fields:
  files: 1..5 file (bắt buộc)
  alts:  JSON string, mảng alt cùng thứ tự file (tùy chọn)
```

Response `207 Multi-Status` (hoặc `200` nếu tất cả thành công), mỗi file một object:

```json
{
  "results": [
    {
      "index": 0,
      "filename": "beach.jpg",
      "ok": true,
      "photo": { "...": "PhotoDTO" }
    },
    {
      "index": 1,
      "filename": "fake.jpg",
      "ok": false,
      "error": {
        "code": "INVALID_IMAGE",
        "message": "File không phải ảnh JPEG/PNG/WebP hợp lệ"
      }
    }
  ],
  "summary": { "total": 2, "succeeded": 1, "failed": 1 }
}
```

Mã lỗi từng file: `TOO_LARGE_BYTES`, `TOO_LARGE_PIXELS`, `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`, `ANIMATED_UNSUPPORTED`, `STORAGE_ERROR`, `DB_ERROR`, `INTERNAL_ERROR`.

- Vượt quá 5 file ở cấp request: `400 TOO_MANY_FILES`, không xử lý file nào.
- File bị từ chối: **không** tạo DB record, **không** để lại file.
- JPEG/PNG/WebP hợp lệ đều được nhận; kiểm tra dựa trên nội dung thực.

### 6.2 Gallery

```http
GET /api/photos?cursor=...&limit=24
```

```json
{
  "items": [
    {
      "id": "p01",
      "alt": "Bãi biển lúc hoàng hôn",
      "width": 4032,
      "height": 3024,
      "currentVersion": 2,
      "variants": [
        {
          "kind": "thumb",
          "width": 480,
          "height": 360,
          "url": "/media/p01/v2/thumb",
          "contentType": "image/webp"
        },
        {
          "kind": "medium",
          "width": 1024,
          "height": 768,
          "url": "/media/p01/v2/medium"
        },
        {
          "kind": "large",
          "width": 1600,
          "height": 1200,
          "url": "/media/p01/v2/large"
        }
      ],
      "createdAt": "2026-11-23T08:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

- `width`/`height` trong item là kích thước master (dùng cho editor/crop).
- Client tự dựng `srcSet` từ `variants`; `src` mặc định là `medium` (không phải large).
- Gallery chỉ trả variant của `currentVersion` đang `PUBLISHED`.

### 6.3 Chỉnh sửa & khôi phục

```http
POST /api/photos/:id/edits
Content-Type: application/json

{
  "expectedVersion": 1,
  "crop": { "x": 100, "y": 50, "width": 1200, "height": 900 },
  "rotate": 90,
  "flipH": true
}
```

- `crop`: tọa độ **pixel trên master đã chuẩn hóa** (sau auto-orient), gốc trên-trái.
  Có thể bỏ qua hoặc `null` = giữ toàn bộ.
- `rotate`: chỉ nhận `0 | 90 | 180 | 270`.
- `flipH`: boolean (lật ngang).
- `expectedVersion`: bắt buộc, chống ghi đè khi có edit đồng thời.
- Zod `.strict()`: từ chối field lạ, số thực cho tọa độ, giá trị ngoài biên.
- Thứ tự áp dụng cố định: **crop → rotate → flipH** (client preview phải dùng đúng thứ tự này).

```http
POST /api/photos/:id/restore
Content-Type: application/json

{ "expectedVersion": 2 }
```

- Luôn tạo version mới từ `masterKey`, params identity `{crop:null, rotate:0, flipH:false}`.
- Nếu đang có edit dở hoặc version conflict: `409 VERSION_CONFLICT` kèm `currentVersion`.

Response edit/restore: `201` + PhotoDTO mới (currentVersion mới, variants mới).

### 6.4 Xóa ảnh

```http
DELETE /api/photos/:id
```

- Ẩn ngay khỏi gallery (`status = DELETED`, `deletedAt`).
- Thử dọn ngay: xóa prefix `photos/{id}/` trên storage, rồi hard-delete DB.
- Nếu storage lỗi: giữ record `DELETED`, tạo `CleanupJob`, trả `202`; worker retry.
- Media của photo đã xóa trả `404` ngay cả khi file chưa kịp xóa.

### 6.5 Media

```http
GET /media/:photoId/v/:version/:kind    # kind = thumb | medium | large
```

- Tra DB theo `(photoId, version, kind)` → stream object từ S3. Không nhận key tùy ý từ client.
- Nếu photo `DELETED`/`PURGED`, version không tồn tại/chưa publish: `404`.
- Headers:
  - `Content-Type: image/webp` (lấy từ DB)
  - `Cache-Control: public, max-age=31536000, immutable`
  - `ETag` = checksum; `Content-Length`; `X-Content-Type-Options: nosniff`
  - `Content-Disposition: inline`
- JSON API dùng `Cache-Control: no-store`.
- Set metadata `Cache-Control`/`Content-Type` tương tự khi `PutObject`.

### 6.6 Health

```http
GET /api/health
```

Trả trạng thái DB, bucket, worker lần chạy gần nhất.

---

## 7. Pipeline upload

```text
Request multipart
  └─ Busboy: tối đa 5 part file, đếm byte từng part
      └─ Với mỗi file (tuần tự, giới hạn memory):
          1. Ghi stream ra temp file, dừng lưu và đánh dấu nếu vượt MAX_BYTES
          2. Sniff magic bytes (file-type) → chỉ jpeg/png/webp
          3. sharp metadata: width/height, pages (reject animated), format
          4. Kiểm tra width*height ≤ MAX_PIXELS, cạnh ≤ MAX_SIDE
          5. Decode thử với sharp (failOn: "error")
          6. Normalize: .rotate() auto-orient, to sRGB, strip metadata, WebP q95 → master
          7. Sinh kế hoạch variant: 480/1024/1600, bỏ width > master width, dedupe
          8. Render + upload master & variant lên storage
          9. Transaction DB: tạo Photo + PhotoVersion(v1, PUBLISHED) + PhotoVariant
         10. Nếu DB lỗi: xóa các object vừa ghi; nếu xóa lỗi → cleanup journal + CleanupJob
         11. Xóa temp file trong finally
```

### 7.1 Kiểm tra ảnh thật

- Không dùng `originalname`, không tin `Content-Type` multipart.
- `file-type` đọc magic bytes; sau đó `sharp` phải decode được.
- File text đổi đuôi `.jpg`, file PDF đổi đuôi `.png`, file cắt cụt → reject.
- Chặn SVG (XSS), GIF, HEIC mặc định; APNG/animated WebP reject bằng `pages > 1`.
- PNG trong suốt: master và variant WebP giữ alpha.

### 7.2 Giới hạn mặc định (env override)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MAX_UPLOAD_FILES` | 5 | Số file tối đa/request |
| `MAX_UPLOAD_BYTES` | 15 MB | Byte tối đa mỗi file |
| `MAX_PIXELS` | 50,000,000 | Tổng pixel tối đa sau decode |
| `MAX_SIDE` | 12,000 | Cạnh tối đa |
| `VARIANT_WIDTHS` | 480,1024,1600 | Width variant, tối đa 3 |
| `MIN_CROP_SIZE` | 16 px | Cạnh nhỏ nhất của crop |
| `IMAGE_CONCURRENCY` | 2 | Số ảnh xử lý song song tối đa |

Byte limit phải được xử lý **theo từng part** để không hủy kết quả của các file khác.

### 7.3 Id & transaction

- Sinh `p01`, `p02` bằng bảng đếm/`AUTOINCREMENT` trong transaction; không dùng timestamp làm ID.
- Upload 5 ảnh: mỗi file là một transaction độc lập, tránh 1 file lỗi làm rollback cả batch.
- Storage key được tạo hoàn toàn từ server; không nhận path từ client.

---

## 8. Pipeline chỉnh sửa, version & publish

### 8.1 Validate tham số

```ts
const EditParams = z.object({
  expectedVersion: z.number().int().positive(),
  crop: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(MIN_CROP_SIZE),
    height: z.number().int().min(MIN_CROP_SIZE),
  }).strict().nullable().optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  flipH: z.boolean().default(false),
}).strict();
```

Kiểm tra thêm trên server:

- `x + width <= masterWidth`, `y + height <= masterHeight`.
- Crop không được vượt biên, không âm, không rỗng.
- Sau crop + rotate, tổng pixel ≤ `MAX_PIXELS`.
- Chỉ nhận đúng góc cho phép; không nhận số thực, string, field lạ.
- Nếu `expectedVersion !== photo.currentVersion` → `409`.

### 8.2 Luồng tạo version

```text
1. Load Photo (status READY), masterKey
2. Transaction ngắn: cấp version = photo.nextVersion; nextVersion += 1;
   tạo PhotoVersion(status=STAGED, paramsJson)
3. Đọc master từ storage (KHÔNG đọc variant)
4. sharp pipeline:
     master
       .extract(crop)           // nếu có
       .rotate(rotate)          // 0/90/180/270
       .flop()                  // nếu flipH (lật ngang)
       .webp(...)               // strip metadata
5. Sinh tối đa 3 variant theo cùng quy tắc width/no-upscale
6. Upload master? KHÔNG. Chỉ upload variant vào photos/{id}/v{n}/
7. Insert PhotoVariant rows (đủ metadata, key, checksum)
8. Transaction publish:
     - PhotoVersion STAGED → PUBLISHED
     - Photo.currentVersion = n với điều kiện currentVersion = expectedVersion (CAS)
     - Version cũ PUBLISHED → SUPERSEDED
9. Nếu CAS fail / upload fail:
     - version → FAILED hoặc giữ STAGED
     - enqueue cleanup prefix photos/{id}/v{n}/
     - trả 409/500, không thay đổi currentVersion
10. Trả PhotoDTO mới
```

### 8.3 Điểm quan trọng

- **Mỗi edit/restore đọc `masterKey`**. Không có đường code nào đọc variant để làm input.
- Variant mới không chứa EXIF (sharp strip mặc định; không gọi `withMetadata`).
- Version được publish chỉ khi **tất cả file đã upload thành công** và **metadata đã insert đủ**.
- Nếu web server chết giữa chừng, version `STAGED` còn lại trong DB; startup worker dọn prefix sau grace period.
- Old version vẫn dùng được URL cũ tới khi cleanup retention xóa; gallery luôn trỏ currentVersion.
- Crop/rotate/flip chỉ áp dụng trên pixel; hướng hiển thị đúng vì master đã được auto-orient lúc upload.
- `sharp.rotate(angle)` với angle chỉ định **không** auto-orient lại; `.flop()` là lật ngang, không dùng `.flip()` (lật dọc).

### 8.4 Browser preview trước khi gửi

`EditDialog`:

1. Tải variant `large` (hoặc `medium` nếu không có large) để hiển thị; biết master width/height từ PhotoDTO.
2. Người dùng kéo crop, bấm xoay trái/phải, lật ngang.
3. Canvas vẽ lại đúng thứ tự crop → rotate → flipH, hiển thị kết quả preview.
4. Hiển thị kích thước output dự kiến và cảnh báo nếu crop không hợp lệ.
5. Nút "Áp dụng": gửi **chỉ tham số** (không gửi ảnh) lên server.
6. Server validate độc lập, render bản chính thức, trả version mới; gallery hiển thị variant mới.
7. `restore` gửi `expectedVersion`, server tạo version từ master.
8. Nếu 409: hiển thị "Ảnh vừa được chỉnh sửa ở nơi khác", reload metadata, không tự ghi đè.

Mapping tọa độ: variant preview cùng tỉ lệ với master, nên crop trên UI được quy đổi về pixel master và làm tròn; server từ chối nếu ra ngoài biên.

---

## 9. Gallery responsive & media headers

### 9.1 DOM mẫu

```tsx
<picture>
  <img
    src={medium.url}
    srcSet={variants.map(v => `${v.url} ${v.width}w`).join(", ")}
    sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
    width={medium.width}
    height={medium.height}
    loading={index < 4 ? "eager" : "lazy"}
    decoding="async"
    alt={photo.alt}
  />
</picture>
```

- `src` mặc định là `medium` (không bao giờ mặc định file lớn nhất).
- `srcSet` chỉ chứa variant thực tế của version hiện tại.
- `width`/`height` là kích thước variant mặc định → chống layout shift.
- `sizes` khớp với CSS grid tại các breakpoint; có test responsive.
- Nếu ảnh chỉ có 1 variant, vẫn render `srcSet` một phần tử và `sizes` chính xác.
- Ảnh đầu viewport `eager`/`fetchPriority="high"`; còn lại `lazy`.
- Alt bắt buộc: lấy từ input khi upload; nếu trống sinh `"Ảnh {originalName}"`.

### 9.2 Media response

- Media đi qua backend proxy để đảm bảo header và URL ổn định sau restart.
- Key lấy từ DB; không cho client truyền storage key trực tiếp.
- `Cache-Control: public, max-age=31536000, immutable` vì URL gắn version bất biến.
- Object storage cũng được set `ContentType` và `CacheControl` khi upload.
- Ảnh đã xóa/không tồn tại → `404`; lỗi storage → `502` có log.

---

## 10. Xóa ảnh & cleanup

### 10.1 Xóa

1. Transaction: `status = DELETED`, `deletedAt = now`; gallery API loại ngay.
2. Gọi `listPrefix("photos/{id}/")` + `deleteMany`, gồm master, mọi version, variant.
3. Nếu xóa object thành công: hard-delete `Photo` (cascade variant/version), ghi audit log.
4. Nếu lỗi: giữ record, tạo `CleanupJob(type=DELETED_PHOTO, runAfter=now)`, trả `202`.
5. Worker retry với backoff; media route luôn 404 cho photo DELETED.

### 10.2 Các nhóm retention (đồng bộ với README)

| Nhóm | Phạm vi | Thời hạn mặc định | Hành động |
|---|---|---|---|
| `staged_version` | Prefix `photos/{id}/v{n}` của version STAGED/FAILED | 60 phút | Xóa prefix, version → PURGED |
| `superseded_version` | Version đã SUPERSEDED | 7 ngày | Xóa file, variant `cleanedAt`, version PURGED |
| `deleted_photo` | Photo DELETED | Chạy ngay, retry tối đa 24 giờ | Xóa toàn bộ prefix, hard-delete DB |
| `orphan_object` | Object dưới `photos/` không có trong DB | 24 giờ kể từ LastModified | Xóa object |
| `journal_keys` | Key trong cleanup journal do lỗi DB | 24 giờ | Xóa file, xóa dòng journal |

- `server/src/config/retention.ts` là nguồn cấu hình; README ghi bảng giá trị mặc định + env override.
- Worker chạy khi server start và theo interval (mặc định 15 phút).
- Có CLI chạy tay để nghiệm thu:

```bash
npm run cleanup -- --photo p01
npm run cleanup -- --orphans
npm run cleanup -- --retention
npm run cleanup -- --all
```

### 10.3 Orphan scan

- Liệt kê object prefix `photos/`; đối chiếu tập key hợp lệ từ `Photo.masterKey` + `PhotoVariant.storageKey` + version STAGED chưa hết hạn.
- Object không tham chiếu và cũ hơn grace → xóa.
- Bảo vệ key đang trong version STAGED hợp lệ.
- Báo cáo số object đã xóa, số lỗi; lưu lần chạy gần nhất vào bảng/health.

### 10.4 Journal khi DB lỗi sau khi ghi file

- Mọi key vừa ghi được giữ trong `writtenKeys`.
- Nếu DB transaction fail: xóa theo batch.
- Nếu delete batch fail: append `{keys, photoId, createdAt}` vào `.data/cleanup-journal.jsonl` và tạo job.
- Startup + worker phát lại journal; xóa dòng khi xử lý thành công.
- Điều này thỏa yêu cầu "DB lỗi sau khi ghi file → xóa file mới hoặc lưu key để dọn lại".

---

## 11. Cấu hình môi trường

```dotenv
# server
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
DATABASE_URL=file:../.data/dev.db

# storage (MinIO mặc định; SeaweedFS dùng cùng S3 API)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=photo-gallery
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# upload / ảnh
MAX_UPLOAD_FILES=5
MAX_UPLOAD_BYTES=15728640
MAX_PIXELS=50000000
MAX_SIDE=12000
VARIANT_WIDTHS=480,1024,1600
MIN_CROP_SIZE=16
IMAGE_CONCURRENCY=2

# retention (ms hoặc ngày, validate trong env.ts)
RETENTION_STAGED_MINUTES=60
RETENTION_SUPERSEDED_DAYS=7
RETENTION_DELETED_HOURS=24
RETENTION_ORPHAN_HOURS=24
RETENTION_JOURNAL_HOURS=24
CLEANUP_INTERVAL_MINUTES=15
```

Compose:

- `docker compose up -d minio` + tạo bucket bằng lệnh trong README (hoặc server tự `CreateBucket` nếu thiếu).
- `docker compose --profile seaweedfs up -d seaweedfs` (S3 gateway; `S3_FORCE_PATH_STYLE=true`, endpoint port 8333). SeaweedFS cần tạo bucket trước bằng AWS CLI/weed shell theo README.
- Volume bền cho cả DB lẫn storage.

---

## 12. Các milestone triển khai

### M0 — Khung dự án & hạ tầng

- [ ] npm workspaces, TypeScript strict, lint/format.
- [ ] Express app + `/api/health`; Vite React app.
- [ ] Docker compose MinIO (default) + SeaweedFS (profile).
- [ ] Prisma schema + migration SQLite; `.env.example`; `.gitignore`.
- [ ] Storage adapter S3: `ensureBucket`, `put`, `getStream`, `head`, `deleteMany`, `listPrefix`.
- [ ] README khung + bảng retention.

**Done:** server và web chạy; restart vẫn giữ DB; health báo storage OK.

### M1 — Upload & variant

- [ ] Busboy nhận tối đa 5 file, giới hạn byte từng file, không hủy file khác.
- [ ] Magic bytes + sharp decode + pixel/side validation; strip EXIF.
- [ ] Normalize master; sinh tối đa 3 variant; key naming; checksum.
- [ ] Transaction Photo + v1 + variants; per-file result; DB failure cleanup + journal.
- [ ] Test JPEG/PNG hợp lệ, file giả, quá byte, quá pixel, hỗn hợp.

**Done:** upload 1–5 ảnh trả kết quả riêng từng file; chỉ ảnh thật được lưu; DB không có record/file rác.

### M2 — Gallery responsive & media

- [ ] `GET /api/photos` DTO + cursor.
- [ ] Media proxy `/media/:id/v/:version/:kind` với Content-Type, Cache-Control, ETag.
- [ ] React Gallery + PhotoCard với `srcset`, `sizes`, width/height, loading, alt.
- [ ] Upload UI hiển thị kết quả/ lỗi từng file.
- [ ] Test network: viewport nhỏ chọn thumb, desktop chọn medium/large; không mặc định large.

**Done:** DOM/network/headers đạt mục 13.

### M3 — Chỉnh sửa, version, restore

- [ ] Zod strict cho crop/rotate/flip/expectedVersion; validate biên trên master.
- [ ] Version allocation + STAGED + publish CAS + supersede version cũ.
- [ ] Render từ master theo thứ tự crop → rotate → flop; strip EXIF.
- [ ] Restore tạo version identity từ master.
- [ ] EditDialog canvas preview; gửi params; xử lý 409.
- [ ] Test edit 2 lần liên tiếp vẫn bắt đầu từ master; EXIF/GPS absent; orientation pixel đúng.

**Done:** version mới dưới `photos/p01/v2/`; gallery cập nhật; không variant nào còn GPS.

### M4 — Xóa & cleanup

- [ ] DELETE ẩn ngay, purge file + DB, retry job.
- [ ] Cleanup job cho staged/superseded/deleted/orphan/journal.
- [ ] CLI cleanup + startup recovery + interval worker.
- [ ] README retention table đồng bộ config.
- [ ] Test: xóa → storage prefix rỗng, DB record/variant sạch; xóa file lỗi → job retry.

**Done:** sau `npm run cleanup -- --photo p01`, storage không còn object, DB không còn/đánh dấu purged.

### M5 — Nghiệm thu & hardening

- [ ] Playwright: upload, gallery attrs, responsive currentSrc, edit preview/submit, restore, delete.
- [ ] Test restart: upload → restart server → gallery + media URL vẫn hoạt động.
- [ ] Test DB failure injection sau upload → file được xóa/journal ghi lại.
- [ ] Test SeaweedFS và MinIO.
- [ ] README đầy đủ: setup, API, retention, lệnh test, checklist.
- [ ] Logging requestId, error code thống nhất, dọn temp file.

**Done:** toàn bộ checklist mục 13 pass.

---

## 13. Ma trận nghiệm thu

| Yêu cầu | Cách kiểm tra | Bằng chứng |
|---|---|---|
| Upload JPEG + PNG | Upload 1 JPEG, 1 PNG; query DB | Có `Photo`, v1 `PUBLISHED`, 1–3 `PhotoVariant` mỗi ảnh |
| Trộn file hợp lệ + file giả | Upload `real.jpg` + `fake.jpg` (text) | Chỉ `real.jpg` có Photo/file; result của fake là `INVALID_IMAGE` |
| Vượt byte / pixel | Upload file >15MB, ảnh >50MP | Không có Photo, không có object key tương ứng; result lỗi tương ứng |
| DB lỗi sau khi ghi file | Bật fault injection ở bước insert; quan sát storage + journal | Object vừa ghi bị xóa; nếu xóa lỗi có entry journal/job |
| Restart server | Upload → stop/start → mở gallery & URL media | Gallery render, media 200 với header đúng |
| Gallery chọn variant phù hợp | Playwright set viewport 375/1440; đọc `img.currentSrc` | Mobile chọn 480w, desktop chọn 1024/1600 phù hợp; `src` không phải large |
| Content-Type + Cache-Control | `curl -I /media/p01/v2/medium` | `image/webp`; `public, max-age=31536000, immutable` |
| DOM attributes | Inspect `img` | Có `srcset`, `sizes`, `width`, `height`, `loading`, `alt` |
| Hướng ảnh sau xử lý | Upload JPEG có EXIF orientation 6; edit rotate 90; so pixel | Ảnh hiển thị đúng chiều |
| Không còn GPS | `exiftool` trên tất cả variant + master | Không có `GPS*`, không có EXIF block |
| Edit bắt đầu từ master | Flip 2 lần / edit lặp params; so pixel hash với pipeline từ master | Output không bị nén chồng; pixel khớp render từ master |
| Crop hợp lệ | Crop trong biên → 201; crop âm/vượt biên → 422 | Không tạo version/file khi invalid |
| Xoay | Gửi 45/360/"90" → 422; 0/90/180/270 → 201 | Chỉ 4 góc hợp lệ |
| Lật ngang | `flipH: true/false` | Ảnh lật đúng; field khác bị reject |
| Khôi phục | Edit → restore | Version mới từ master; ảnh về trạng thái gốc |
| Publish an toàn | Kill server trong lúc edit; restart | `currentVersion` không đổi; staged được dọn |
| Version prefix | Kiểm tra storage sau edit | Có `photos/p01/v2/...`; v1 còn tới hạn retention |
| Xóa ảnh | DELETE → gallery API | Ảnh mất ngay; sau cleanup storage rỗng, DB sạch/purged |
| Cleanup retention | Set grace ngắn, chạy CLI | File superseded/staged/orphan bị xóa đúng nhóm |
| DB chỉ lưu key | Query DB | Không có `http://` hay đường dẫn tuyệt đối trong `masterKey`/`storageKey` |
| Alt text | Upload không alt | Có alt mặc định khác rỗng; DOM có `alt` |

---

## 14. Chiến lược kiểm thử

### Unit

- Validate crop: âm, zero, vượt biên, crop 1px, crop full.
- Validate rotate: chỉ 4 giá trị; reject 45, 360, float, string.
- Validate flipH: chỉ boolean.
- Variant width planner: không upscale, dedupe, tối đa 3, ảnh rất nhỏ.
- Key naming/version allocation; thứ tự transform.

### Integration (Vitest + Supertest + MinIO)

- Upload JPEG/PNG/WebP, sprite alpha; mixed batch; oversize byte; fake magic; oversize pixel; animated reject.
- DB failure injection: mock repository throw sau upload; assert `deleteMany` được gọi; journal khi delete fail.
- Edit flow: v2 published, currentVersion=2, v1 SUPERSEDED; restore; conflict 409; invalid params không tạo file.
- Delete: purge objects + DB; failure → job + 202; retry thành công.
- Media headers/body; deleted photo 404.
- Restart: khởi tạo app lần 2 trên cùng DB/storage; đọc gallery và media thành công.

### E2E (Playwright)

- Upload 5 ảnh, quan sát per-file result.
- Kiểm tra DOM attributes và `currentSrc` ở 2 viewport.
- Mở editor, crop/xoay/lật → preview thay đổi → submit → srcset trỏ v2.
- Restore → v3; ảnh khớp bản gốc.
- Delete → biến mất, API 404; chạy cleanup → storage rỗng.

### EXIF/orientation

- Fixture JPEG có EXIF orientation + GPS (tạo bằng `exiftool-vendored` trong test setup).
- Assert master/variant không có exif buffer/GPS.
- So sánh pixel output với ảnh tham chiếu đã xoay đúng.

---

## 15. Rủi ro & cách xử lý

| Rủi ro | Xử lý |
|---|---|
| `sharp` lỗi cài trên Windows/Node version | Pin Node LTS, dùng prebuilt sharp; ghi rõ version trong README |
| SeaweedFS S3 khác MinIO (bucket, path-style, multipart) | `forcePathStyle`, tạo bucket qua AWS CLI; test cả hai; mặc định MinIO |
| SQLite tranh chấp khi edit đồng thời | WAL mode, transaction ngắn, CAS `currentVersion`, `nextVersion`; ghi chú chuyển Postgres khi cần |
| Ảnh lớn làm treo event loop | `limitInputPixels`, giới hạn concurrency, xử lý tuần tự trong request, timeout |
| Preview browser lệch server | Canonical params pixel master, cùng thứ tự transform, validate server, render chính thức từ server |
| Xóa file nhưng DB lỗi / ngược lại | Publish hai pha, journal, cleanup job, orphan scan |
| Cache immutable sau xóa | Chấp nhận cache ngoài tầm kiểm soát; URL version mới khi edit; xóa khỏi gallery/API ngay |
| Upload stream vượt giới hạn | Busboy per-file limit + đếm byte thủ công; discard phần vượt, không ghi toàn bộ vào RAM |
| PNG/alpha hoặc màu CMYK | Convert sRGB, giữ alpha, test fixture tương ứng |
| Metadata nhạy cảm (GPS) | Strip toàn bộ EXIF ở master + variants; chỉ lưu metadata an toàn (kích thước, thời gian) trong DB |

---

## 16. Definition of Done

- [ ] Upload 1–5 ảnh/request, kết quả riêng từng file, đúng validation thật.
- [ ] JPEG/PNG tạo Photo + tối đa 3 variant; DB chỉ lưu storage key.
- [ ] Gallery dùng `srcset/sizes/width/height/loading/alt`, tải variant phù hợp.
- [ ] Media trả đúng Content-Type + Cache-Control; hoạt động sau restart.
- [ ] Edit/restore luôn từ master; version mới dưới `photos/{id}/v{n}/`; publish an toàn.
- [ ] Chỉ nhận crop hợp lệ, rotate 0/90/180/270, flipH boolean.
- [ ] Variant sau xử lý đúng hướng, không còn EXIF/GPS.
- [ ] Xóa ảnh ẩn ngay, dọn file + DB; cleanup retention/orphan/staged/journal chạy được.
- [ ] README có bảng retention, hướng dẫn MinIO/SeaweedFS, lệnh chạy test và checklist nghiệm thu.
- [ ] Test unit + integration + E2E pass; có bằng chứng cho ma trận mục 13.
