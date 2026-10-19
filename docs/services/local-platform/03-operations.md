# Local Platform — Operations

> Kiến trúc và bất biến: [`01-architecture.md`](./01-architecture.md).

## Prerequisites

- Docker daemon đang chạy (rootful lẫn rootless đều được; rootless được tự động nhận qua `DOCKER_HOST` — Traefik cần bind-mount đúng socket, chương trình tự suy theo thứ tự `DOCKER_SOCKET_PATH` > `DOCKER_HOST` > `/var/run/docker.sock`, và **fail sớm** nếu không tìm thấy socket nào tồn tại thật thay vì mount nhầm path).
- `pulumi` CLI trên `PATH` — **bản đã xác minh cho luồng này là `3.270.0`** (CLI pin trong repo, `node_modules/.bin/pulumi`; stack reference format `organization/<project>/<stack>` chỉ được kiểm chứng từ bản này — xem `04-platform-facts.md` §2.16 PU12). CLI cũ hơn trên `PATH` có thể fail với lỗi rối khó chẩn đoán.
- **Passphrase Pulumi** của riêng bạn, đặt qua biến môi trường trước khi chạy bất kỳ lệnh nào của luồng này:

  ```bash
  export PULUMI_CONFIG_PASSPHRASE="<passphrase-riêng-của-bạn>"
  # hoặc trỏ tới file NGOÀI repo:
  export PULUMI_CONFIG_PASSPHRASE_FILE=~/.secrets/ecoma-local-pulumi
  ```

  Thiếu passphrase, `local-deploy`/`local-status` fail ngay từ đầu với hướng dẫn, không đụng resource nào. `local-destroy` là **ngoại lệ**: worktree chưa từng deploy (chưa có `.pulumi-local-state/`) thì nó là no-op idempotent trả exit 0 **không cần** passphrase. Giữ passphrase **ổn định cho từng worktree**: nó là khoá giải secret trong state Pulumi local — mất là mất plaintext của mọi secret trong state đó vĩnh viễn. Không commit vào Git, không ghi vào `.env`. Worktree đã khởi tạo bằng passphrase khác thì cung cấp lại đúng passphrase đó (không có đường reset không mất dữ liệu; đổi passphrase = `pulumi stack change-secrets-provider` ngoài luồng này).

- Certificate `fbi.com` ở `deploys/platform-deploy/local-certs/` (đường dẫn đầy đủ từ root repo; đã có trong repo). ⚠️ **Đường an toàn là trust scoped**: smoke đã làm đúng kiểu đó — trust certificate **cho đúng request** (tham số `ca` scoped), không đụng trust store hệ điều hành. Chỉ khi cần browser chấp nhận TLS thì mới trust thủ công, và phải hiểu hệ quả: cert này mang `CA:TRUE` (`keyCertSign`) — cài vào trust store là biến nó thành CA được toàn máy tin, tức **mọi certificate ký bằng khoá này cho bất kỳ hostname nào** cũng được chấp nhận. Khoá nằm vĩnh viễn trong Git history (không bị `.gitignore` loại) nên ai đọc được repo đều giữ được khoá — với trust store đầy máy, người đó có thể cấp cert giả cho domain bất kỳ trên máy của developer. Nếu bắt buộc trust ở mức máy, làm trên máy thử nghiệm rồi **tái sinh cert/key khi repo chuyển sang public**. Không bao giờ tắt TLS verification toàn cục. Khoá này **chỉ dùng cho local**, không tái sử dụng ở staging/production.

## Cách ly worktree (Pulumi CLI/backend)

Mọi lệnh Pulumi của luồng này chạy với `PULUMI_BACKEND_URL=file://<worktree>/.pulumi-local-state` và `--stack organization/<project>/<stack>` tường minh (`tools/dx/src/pulumi-context.ts`) — không `pulumi login`, nên không backend toàn cục nào bị chọn. `stack init`/`stack select` của `ensureStack` vẫn ghi stack hiện tại vào workspace file `~/.pulumi/workspaces/<project>-<sha1(Pulumi.yaml)>-workspace.json`, nhưng file đó key theo đường dẫn project (PU13) nên hai worktree không đụng file của nhau; các lệnh đọc/ghi state khác đều truyền `--stack` tường minh nên không phụ thuộc giá trị được ghi đó. `~/.pulumi` còn dùng chung cho plugin cache. Chi tiết platform đã đo: `04-platform-facts.md` §2.16 PU12–PU13.

## Luồng deploy

```bash
pnpm dx local-deploy            # apply thật: platform up → outputs → .env → home up → smoke
pnpm dx local-deploy --preview  # chỉ preview: platform + home, không apply, không ghi .env
pnpm dx local-status            # namespace, stack, resource names, trạng thái platform
pnpm dx local-destroy           # teardown: giữ volume PostgreSQL
pnpm dx local-destroy --remove-data  # teardown + XOÁ volume (in cảnh báo, mất dữ liệu vĩnh viễn)
```

Luồng `local-deploy` chạy theo đúng thứ tự contract: platform up → đọc outputs → ghi `.env` → home up → smoke HTTPS. Mỗi bước chỉ chạy khi bước trước thành công. Lần chạy đầu trên stack mới, password PostgreSQL được sinh ngẫu nhiên và lưu dạng secret trong state local, mã hoá bằng passphrase ở Prerequisites.

`--worktree-root <dir>` (cả ba lệnh `local-*`) chọn worktree bị tác động về **state/namespace/`.env`** (namespace Docker, Pulumi stack, `.pulumi-local-state`, `.env`); mặc định là checkout hiện hành. Chương trình Pulumi và smoke vẫn chạy từ checkout đang gõ lệnh — flag không phải "deploy code của worktree kia".

**Preview covers cả hai project** (platform rồi home) nhưng có giới hạn đã biết: trước khi platform được apply lần đầu, outputs của stack reference là `undefined` — preview home khi đó fail tường minh kèm hướng dẫn (chạy apply thật trước). Preview không bao giờ tạo container/volume và không ghi `.env` — nhưng nó **có** ghi state local của worktree: `stack init` và sinh/lưu secret `postgres:password` trong stack config (không đụng Docker).

Dry-run an toàn cho CI là Nx target `provision` (`pnpm nx run platform-deploy:provision`) — chỉ in kế hoạch, không chạy `pulumi up`.

## `local-status` — đọc trạng thái

Read-only. Phân biệt năm trạng thái, mỗi trạng thái một dòng:

- `chưa có stack trong backend` — worktree này chưa từng deploy (exit 0; cần passphrase hợp lệ đã export — gate passphrase chạy trước khi hỏi backend).
- `stack có sẵn nhưng chưa up (outputs rỗng)` — `stack init` đã chạy nhưng chưa `up` thành công lần nào (exit 0).
- `platform outputs: {...}` — deployed, in outputs (exit 0).
- `[local-status] lỗi Pulumi/backend: ...` — backend không đọc được, sai passphrase — **exit != 0**; "lỗi thật" không bao giờ được nuốt thành "chưa deploy".
- `[local-status] outputs platform không parse được JSON: ...` — backend trả dữ liệu nhưng stdout không phải JSON — **exit != 0**.

## URL và smoke

Port thật nằm trong `.env` (`ROOT_HOST=fbi.com:<port>`) và trong output `traefikHostPort` của platform stack. Kiểm thử nhanh không cần trust certificate:

```bash
node tools/dx/src/local-smoke.mjs fbi.com:<port>
```

Smoke xác nhận đúng hành vi ứng dụng qua Traefik, không chỉ "server còn sống": `GET /` (kèm header `Accept: text/html`) phải **302 → `/en`**, sau đó `GET /en` phải **200 HTML** chứa title của home. Retry chỉ áp dụng cho dấu hiệu "chưa sẵn sàng" (`ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, 404/502/503/504 — 404 là cửa sổ registration router khi container bị recreate) trong budget mặc định 90s; 4xx còn lại/500, lỗi TLS/cert, redirect sai đích hay thiếu title là fail ngay. TLS bắt buộc hợp lệ — script chỉ trust certificate local **cho đúng request này** (tham số `ca` scoped), không đụng trust store hệ điều hành, không tắt verification. Cờ tuỳ chọn cho test: `--connect <host:port>` (dial địa chỉ khác hostname), `--budget-ms`, `--request-timeout-ms`.

## Vòng đời dữ liệu

- `local-destroy` mặc định **giữ** volume; container/network bị xoá nhưng dữ liệu PostgreSQL còn nguyên, deploy kế tiếp dùng lại.
- Volume được khai `retainOnDelete` nên kể cả `pulumi destroy` trực tiếp cũng không xoá volume.
- ⚠️ Đừng chạy `pulumi stack rm` trên stack local: nó xoá stack config cùng secret password trong khi volume còn lại — hai nửa lệch tuổi, Postgres kế tiếp không vào được dữ liệu cũ. Đó cũng là lý do `local-destroy` không dùng `destroy --remove`.
- ⚠️ Đừng đổi secret `postgres:password` trong stack config sau khi volume đã init: `POSTGRES_PASSWORD` chỉ có tác dụng lúc `initdb` trên volume rỗng. Pulumi sẽ thay container (envs nằm trong diff) nhưng Postgres không chạy lại initdb — superuser trong volume vẫn giữ mật khẩu cũ, kết nối bằng giá trị mới nhận `password authentication failed` trong khi healthcheck `pg_isready` vẫn xanh (nó không xác thực mật khẩu). Nguyên tắc: secret và volume phải cùng tuổi.
- Healthcheck `pg_isready` không kiểm password; khi nghi ngờ lệch password (vd. đã `stack rm` ngoài luồng), kiểm bằng auth TCP thật hoặc tạo lại volume qua `local-destroy --remove-data` rồi `local-deploy`.

## Giới hạn đã biết

- Host port Traefik đổi mỗi lần container được tạo lại (Docker cấp động) — luôn đọc lại từ `.env`/outputs sau khi up.
- Preview home trước apply platform đầu tiên fail tường minh (outputs stack reference là `undefined` trước apply) — xem mục Luồng deploy.
- Traefik bind-mount Docker socket read-only: `readOnly` chỉ chặn ghi filesystem, KHÔNG giới hạn Docker API — mount này vẫn là đường leo thang đặc quyền tiềm năng nếu container bị chiếm. Socket proxy GET-only là giảm thiểu đúng nghĩa, chưa có ở đây (chấp nhận rủi ro có chủ đích cho môi trường local).
- Local deployment **không** auto-trust certificate, không backup volume, không monitoring — ngoài phạm vi có chủ đích.
- Preset Nitro của `apps/home` cho staging/production vẫn là `cloudflare-module` (đường Wrangler); Docker chỉ dùng preset `node-server` qua build-time flag, không sửa `nitro.config.ts`.
