# Local Platform — Operations

> Kiến trúc và bất biến: [`01-architecture.md`](./01-architecture.md).

## Prerequisites

- Docker daemon đang chạy (rootful lẫn rootless đều được; rootless được tự động nhận qua `DOCKER_HOST` — Traefik cần bind-mount đúng socket, chương trình tự suy theo thứ tự `DOCKER_SOCKET_PATH` > `DOCKER_HOST` > `/var/run/docker.sock`).
- `pulumi` CLI trên `PATH`.
- **Passphrase Pulumi** của riêng bạn, đặt qua biến môi trường trước khi chạy bất kỳ lệnh nào của luồng này:

  ```bash
  export PULUMI_CONFIG_PASSPHRASE="<passphrase-riêng-của-bạn>"
  # hoặc trỏ tới file NGOÀI repo:
  export PULUMI_CONFIG_PASSPHRASE_FILE=~/.secrets/ecoma-local-pulumi
  ```

  Thiếu passphrase, `local-deploy`/`local-destroy`/`local-status` fail ngay từ đầu với hướng dẫn, không đụng resource nào. Giữ passphrase **ổn định cho từng worktree**: nó là khoá giải secret trong state Pulumi local — mất là mất plaintext của mọi secret trong state đó vĩnh viễn. Không commit vào Git, không ghi vào `.env`. Worktree đã khởi tạo bằng passphrase khác thì cung cấp lại đúng passphrase đó (không có đường reset không mất dữ liệu; đổi passphrase = `pulumi stack change-secrets-provider` ngoài luồng này).

- Certificate `fbi.com` ở `deploys/platform-deploy/local-certs/` (đã có trong repo) được trust **thủ công** vào trust store của máy nếu muốn browser chấp nhận TLS — không bao giờ tắt TLS verification toàn cục.

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

**Preview covers cả hai project** (platform rồi home) nhưng có giới hạn đã biết: trước khi platform được apply lần đầu, outputs của stack reference là `undefined` — preview home khi đó fail tường minh kèm hướng dẫn (chạy apply thật trước). Preview không bao giờ tạo container/volume và không ghi `.env` — nhưng nó **có** ghi state local của worktree: `stack init` và sinh/lưu secret `postgres:password` trong stack config (không đụng Docker).

Dry-run an toàn cho CI là Nx target `provision` (`pnpm nx run platform-deploy:provision`) — chỉ in kế hoạch, không chạy `pulumi up`.

## `local-status` — đọc trạng thái

Read-only. Phân biệt năm trạng thái, mỗi trạng thái một dòng:

- `chưa có stack trong backend` — worktree này chưa từng deploy (exit 0).
- `stack có sẵn nhưng chưa up (outputs rỗng)` — `stack init` đã chạy nhưng chưa `up` thành công lần nào (exit 0).
- `platform outputs: {...}` — deployed, in outputs (exit 0).
- `[local-status] lỗi Pulumi/backend: ...` — backend không đọc được, sai passphrase — **exit != 0**; "lỗi thật" không bao giờ được nuốt thành "chưa deploy".
- `[local-status] outputs platform không parse được JSON: ...` — backend trả dữ liệu nhưng stdout không phải JSON — **exit != 0**.

## URL và smoke

Port thật nằm trong `.env` (`ROOT_HOST=fbi.com:<port>`) và trong output `traefikHostPort` của platform stack. Kiểm thử nhanh không cần trust certificate:

```bash
node tools/dx/src/local-smoke.mjs fbi.com:<port>
```

Smoke xác nhận đúng hành vi ứng dụng qua Traefik, không chỉ "server còn sống": `GET /` (kèm header `Accept: text/html`) phải **302 → `/en`**, sau đó `GET /en` phải **200 HTML** chứa title của home. Retry chỉ áp dụng cho dấu hiệu "chưa sẵn sàng" (connection refused, 502/503/504, timeout) trong budget mặc định 90s; 4xx/500, redirect sai đích hay thiếu title là fail ngay. TLS bắt buộc hợp lệ — script chỉ trust certificate local **cho đúng request này** (tham số `ca` scoped), không đụng trust store hệ điều hành, không tắt verification. Cờ tuỳ chọn cho test: `--connect <host:port>` (dial địa chỉ khác hostname), `--budget-ms`, `--request-timeout-ms`.

## Vòng đời dữ liệu

- `local-destroy` mặc định **giữ** volume; container/network bị xoá nhưng dữ liệu PostgreSQL còn nguyên, deploy kế tiếp dùng lại.
- Volume được khai `retainOnDelete` nên kể cả `pulumi destroy` trực tiếp cũng không xoá volume.
- ⚠️ Đừng chạy `pulumi stack rm` trên stack local: nó xoá stack config cùng secret password trong khi volume còn lại — hai nửa lệch tuổi, Postgres kế tiếp không vào được dữ liệu cũ. Đó cũng là lý do `local-destroy` không dùng `destroy --remove`.
- Healthcheck `pg_isready` không kiểm password; khi nghi ngờ lệch password (vd. đã `stack rm` ngoài luồng), kiểm bằng auth TCP thật hoặc tạo lại volume qua `local-destroy --remove-data` rồi `local-deploy`.

## Giới hạn đã biết

- Host port Traefik đổi mỗi lần container được tạo lại (Docker cấp động) — luôn đọc lại từ `.env`/outputs sau khi up.
- Preview home trước apply platform đầu tiên fail tường minh (outputs stack reference là `undefined` trước apply) — xem mục Luồng deploy.
- Traefik bind-mount Docker socket read-only: `readOnly` chỉ chặn ghi filesystem, KHÔNG giới hạn Docker API — mount này vẫn là đường leo thang đặc quyền tiềm năng nếu container bị chiếm. Socket proxy GET-only là giảm thiểu đúng nghĩa, chưa có ở đây (chấp nhận rủi ro có chủ đích cho môi trường local).
- Local deployment **không** auto-trust certificate, không backup volume, không monitoring — ngoài phạm vi có chủ đích.
- Preset Nitro của `apps/home` cho staging/production vẫn là `cloudflare-module` (đường Wrangler); Docker chỉ dùng preset `node-server` qua build-time flag, không sửa `nitro.config.ts`.
