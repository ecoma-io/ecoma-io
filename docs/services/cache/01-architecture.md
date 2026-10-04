# Cache Service — Architecture

> Ranh giới hệ thống của `cache` (disposable, không phải correctness dependency) nằm ở [`docs/overview/01-architecture.md`](../../overview/01-architecture.md) A18 và invariant 22. File này chỉ thiết kế của riêng service.
> Platform fact (Workers runtime limits): [`docs/overview/04-platform-facts.md`](../../overview/04-platform-facts.md) §2.2.

---

## 1. Purpose

`cache` là self-hosted remote cache cho Nx: Worker stateless trên Cloudflare, lưu artifact trên object storage durable qua S3-compatible API.

Thứ tự ưu tiên:

- Nx protocol compatibility.
- Streaming end-to-end.
- Project/namespace isolation.
- Immutable cache objects.
- Stateless data plane.
- Disposable storage.
- Không để cache trở thành dependency của application runtime.

```text
Nx Developer / CI
        │
        ▼
cache.ecoma.io
        │
        ▼
Cloudflare Worker
 ┌──────┼───────────────┐
 │      │               │
Auth  Namespace      Storage Router
 │      │               │
 └──────┴───────────────┘
                │
                ▼
        Storage Partition
                │
                ▼
      Backblaze B2 (S3-compatible)
```

---

## 2. Architectural boundaries

Hệ thống gồm hai plane:

```text
                 ┌─────────────────────┐
Admin ── BFF ──► │    Control Plane    │  (private, Service Binding)
                 └─────────┬───────────┘
                           │ configuration
                           ▼
Nx ────────────► │     Data Plane      │  (cache.ecoma.io, public)
                 │   Cache Worker      │
                 └─────────┬───────────┘
                           ▼
                    B2 Storage
```

**Data plane** chỉ xử lý cache traffic. Nó không scan storage, không chạy garbage collection, không thực hiện administrative operation, và không phụ thuộc database trong request hot path.

**Control plane** quản lý projects, API keys, B2 accounts, storage partitions, routing, capacity state, statistics và administrative mutations. Nó không nằm trên hot path. Control API là private interface — public Internet chỉ cần expose `cache.ecoma.io`.

Các lớp module tách trách nhiệm, dependency đi **một chiều**:

- HTTP layer không gọi storage backend trực tiếp.
- Storage abstraction không biết API-key semantics; implementation storage cụ thể (B2/S3-compatible) nằm sau abstraction đó.
- Auth layer không biết storage credentials.
- Cache protocol layer không phụ thuộc behavior của backend cụ thể.

---

## 3. Public interface

Nx protocol giữ nguyên, không mở rộng:

```http
GET /v1/cache/{hash}
PUT /v1/cache/{hash}
Authorization: Bearer <token>
```

Namespace **không** đưa vào public URL — public interface phải tương thích Nx. Namespace resolve từ authenticated principal và project authorization:

```text
Bearer token → Principal → Authorized project → Namespace → Storage partition
```

Cách này giữ URL tương thích Nx trong khi storage vẫn project-scoped.

---

## 4. Request flow và streaming

**Read:** authenticate → authorize project → resolve namespace → resolve partition → stream từ B2 về Nx. Cache miss (`404`) là trạng thái bình thường, không phải service failure.

**Write:** authenticate → authorize → validate hash → validate `Content-Length` → resolve partition → stream thẳng tới B2.

Request body được stream trực tiếp tới storage; Worker không được buffer toàn bộ artifact bằng `arrayBuffer()`:

```text
Upload:   Nx → ReadableStream → Worker → ReadableStream → B2
Download: B2  → ReadableStream → Worker → ReadableStream → Nx
```

Streaming là architectural invariant, không phải tối ưu — mục tiêu: memory usage của Worker không tăng tuyến tính theo artifact size.

---

## 5. Storage partitioning và object key

Storage pool gồm các logical partitions, mỗi partition một B2 store. Partition được chọn từ **stable project/namespace mapping**, không dùng `hash % account_count` — đổi số lượng backend sẽ remap phần lớn cache.

Partition là **routing boundary, không phải migration unit**: thêm backend mới không yêu cầu migrate cache cũ, và partition không bao giờ thay đổi authorization boundary.

Public protocol giữ `/v1/cache/:hash`; logical storage key là:

```text
cache/<namespace>/<hash>
```

Cache artifact là immutable — một hash chỉ được tạo một lần:

```text
PUT hash-A → object-X    ✓
PUT hash-A → object-Y    ✗
```

Write phải dùng **conditional object creation** khi backend hỗ trợ, thay vì `HEAD` rồi `PUT` (tránh race condition và giảm request count). Namespace đảm bảo project isolation, authorization boundary, và storage routing/statistics độc lập.

---

## 6. Configuration

Hai loại:

- **Static runtime configuration** — environment variable hoặc Cloudflare bindings (giới hạn artifact, log level, storage endpoint/bucket/credential). Giá trị và keys cụ thể → [`03-operations.md`](./03-operations.md).
- **Dynamic control-plane configuration** — projects, API keys, B2 accounts, storage partitions, routing, capacity state.

Worker dùng **cached control-plane configuration**, không truy vấn database cho mỗi request:

```text
Database → Control Plane → Worker configuration cache → Data plane
```

Database, nếu dùng, chỉ thuộc control plane.

---

## 7. Partition state

Partition có lifecycle state:

| State    | Read | Write |
| -------- | ---: | ----: |
| ACTIVE   |  yes |   yes |
| DRAINING |  yes |    no |
| FULL     |  yes |    no |
| DISABLED |   no |    no |

Khi partition ngừng nhận write, object cũ vẫn đọc được. Không migrate object giữa partitions.

---

## 8. Cache lifecycle

Cache là disposable data. **B2 lifecycle là garbage collector chính**; không có `LIST` → tìm object hết hạn → `DELETE` trong request path. Emergency cleanup nếu cần phải chạy qua control plane/background operation. Không sử dụng Object Lock cho cache.

---

## 9. Failure model

Cache availability không được trở thành application correctness dependency.

| Tình huống         | Hành vi                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Cache miss (`404`) | Kết quả bình thường — Nx thực thi task rồi `PUT` artifact mới                                       |
| Storage failure    | `503` / backend error phù hợp. Không trả `500` cho cache miss                                       |
| Stream failure     | Request body one-shot không retry mù sau khi stream đã consumed; nếu không replay an toàn thì `503` |
| Routing            | Storage routing không scan toàn bộ B2 pool để tìm object                                            |

---

## 10. Security boundaries

```text
API Key → Principal → Project / Namespace → Storage Partition → Cache Object
```

- Không có global write credential cho toàn ecosystem.
- B2 credentials nằm trong storage layer, không expose cho protocol/authentication layer; mỗi backend dùng least-privilege credentials.
- API key secrets chỉ tồn tại ở creation response; persistent state chỉ giữ cryptographic representation.

---

## 11. Observability boundary

Mỗi request có correlation identifier đi xuyên Nx → Worker → B2. Metrics phải phân biệt ít nhất: cache hit, cache miss, authentication failure, backend error. Field log cụ thể → [`03-operations.md`](./03-operations.md).

Data plane observability không được làm tăng dependency trên request path.

---

## 12. Deployment shape

`cache` là **một deploy unit** (một Cloudflare Worker) với một storage backend/partition ở MVP. Sau khi protocol và streaming được validate, mở rộng theo thứ tự: multiple projects → multiple partitions → multiple B2 accounts (initial scope → [`02-requirements.md`](./02-requirements.md) §5).

Kiến trúc ưu tiên **một deployable Worker nhỏ** thay vì distributed internal services.

---

## 13. Architectural invariants

1. Public cache protocol remains Nx-compatible.
2. Data plane không phụ thuộc database trong hot path.
3. Artifact được stream, không full-buffer trong Worker.
4. Cache object immutable.
5. Write sử dụng conditional creation.
6. Namespace/project là security boundary.
7. Storage routing ổn định theo project/namespace.
8. Thêm storage backend không yêu cầu migrate cache cũ.
9. Storage lifecycle xử lý garbage collection.
10. Không LIST/DELETE storage trong cache request.
11. Control API không cần public Internet endpoint.
12. Cache miss không phải service failure.
13. Cache không phải source of truth.
14. Cache không phải artifact registry hoặc backup system.
15. Worker dependency footprint phải nhỏ và Worker-compatible.

---

**Architectural definition:** `ecoma-cache` là một stateless Cloudflare Worker data plane, cung cấp Nx-compatible cache protocol và stream immutable cache artifacts tới project-scoped B2 storage partitions; control plane quản lý identity, authorization, routing và storage configuration nhưng không nằm trên hot path của cache traffic.
