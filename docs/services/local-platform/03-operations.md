# Local Platform — Operations

> Kiến trúc và bất biến: [`01-architecture.md`](./01-architecture.md).

## Prerequisites

- Docker daemon đang chạy (rootful lẫn rootless đều được; rootless được tự động nhận qua `DOCKER_HOST` — Traefik cần bind-mount đúng socket, chương trình tự suy theo thứ tự `DOCKER_SOCKET_PATH` > `DOCKER_HOST` > `/var/run/docker.sock`).
- `pulumi` CLI trên `PATH`.
- Certificate `fbi.com` ở `deploys/platform-deploy/local-certs/` (đã có trong repo) được trust **thủ công** vào trust store của máy nếu muốn browser chấp nhận TLS — không bao giờ tắt TLS verification toàn cục.

## Luồng deploy

```bash
pnpm dx local-deploy            # apply thật: platform up → outputs → .env → home up → smoke
pnpm dx local-deploy --preview  # chỉ preview: không apply, không ghi .env
pnpm dx local-status            # namespace, stack, resource names, outputs hiện tại
pnpm dx local-destroy           # teardown: giữ volume PostgreSQL
pnpm dx local-destroy --remove-data  # teardown + XOÁ volume (in cảnh báo, mất dữ liệu vĩnh viễn)
```

Luồng `local-deploy` chạy theo đúng thứ tự contract: platform up → đọc outputs → ghi `.env` → home up → smoke HTTPS. Mỗi bước chỉ chạy khi bước trước thành công. Lần chạy đầu trên stack mới, password PostgreSQL được sinh ngẫu nhiên và lưu dạng secret trong state local (passphrase mặc định `ecoma-local-only`, chỉ dùng cho state `file://` trong worktree).

Dry-run an toàn cho CI là Nx target `provision` (`pnpm nx run platform-deploy:provision`) — chỉ in kế hoạch, không chạy `pulumi up`.

## URL và smoke

Port thật nằm trong `.env` (`ROOT_HOST=fbi.com:<port>`) và trong output `traefikHostPort` của platform stack. Kiểm thử nhanh không cần trust certificate:

```bash
node tools/dx/src/local-smoke.mjs fbi.com:<port>
```

Script chỉ trust certificate local **cho đúng request này** (tham số `ca` scoped), không đụng trust store hệ điều hành.

## Vòng đời dữ liệu

- `local-destroy` mặc định **giữ** volume; container/network bị xoá nhưng dữ liệu PostgreSQL còn nguyên, deploy kế tiếp dùng lại.
- Volume được khai `retainOnDelete` nên kể cả `pulumi destroy` trực tiếp cũng không xoá volume.
- ⚠️ Đừng chạy `pulumi stack rm` trên stack local: nó xoá stack config cùng secret password trong khi volume còn lại — hai nửa lệch tuổi, Postgres kế tiếp không vào được dữ liệu cũ. Đó cũng là lý do `local-destroy` không dùng `destroy --remove`.
- Healthcheck `pg_isready` không kiểm password; khi nghi ngờ lệch password (vd. đã `stack rm` ngoài luồng), kiểm bằng auth TCP thật hoặc tạo lại volume qua `local-destroy --remove-data` rồi `local-deploy`.

## Giới hạn đã biết

- Host port Traefik đổi mỗi lần container được tạo lại (Docker cấp động) — luôn đọc lại từ `.env`/outputs sau khi up.
- Local deployment **không** auto-trust certificate, không backup volume, không monitoring — ngoài phạm vi có chủ đích.
- Preset Nitro của `apps/home` cho staging/production vẫn là `cloudflare-module` (đường Wrangler); Docker chỉ dùng preset `node-server` qua build-time flag, không sửa `nitro.config.ts`.
