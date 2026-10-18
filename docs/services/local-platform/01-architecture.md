# Local Platform — Architecture

> Policy của toàn hệ thống nằm ở [`02-delivery.md`](../../overview/02-delivery.md). File này mô tả ranh giới và bất biến riêng của local platform.

## Ownership

| Resource                     | Owner                 | Ghi chú                                                                                                                                                                                      |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker network               | `platform-deploy`     | Mỗi worktree một network                                                                                                                                                                     |
| Traefik container            | `platform-deploy`     | Entrypoint HTTPS duy nhất; image ghim theo digest ≥ 3.6.1 (lý do: Traefik ≤ 3.6.0 ghim Docker API client 1.24, bị daemon mới từ chối — xem comment trong `deploys/platform-deploy/index.ts`) |
| PostgreSQL + volume          | `platform-deploy`     | TimescaleDB + pgvector; volume `retainOnDelete` — xoá stack không xoá dữ liệu                                                                                                                |
| Image build + container home | `home-deploy`         | Build bằng `@pulumi/docker-build` (không push registry); routing qua Traefik labels                                                                                                          |
| Certificate `fbi.com`        | Repo (`local-certs/`) | Tự ký, commit trong repo; trust **thủ công**, không có đường auto-trust                                                                                                                      |

`home-deploy` không tự tạo network/Traefik/PostgreSQL — nó đọc qua Pulumi stack reference tới `platform-deploy` và join network. Hợp đồng outputs (`namespace`, `networkName`, `postgresHost`, `postgresPort`, `traefikHostPort`, `rootHostname`) khai ở `tools/dx/src/platform-outputs-contract.ts`; **không secret nào** nằm trong outputs — password PostgreSQL là Pulumi secret config của `platform-deploy`.

## Cách ly worktree

Namespace = `w` + 12 hex đầu của xxHash64 trên **absolute worktree root đã normalize** (`tools/dx/src/deploy-namespace.ts`). Mọi tên Docker resource (`ecoma-<ns>-<kind>`) và tên Pulumi stack (`local-<ns>`) đều mang namespace; state Pulumi là `file://` trong `.pulumi-local-state/` của từng worktree. Hai worktree có thể deploy song song trên một host mà không đụng tài nguyên nào của nhau.

Routing của Traefik phải lọc theo network của worktree (`--providers.docker.constraints` + label `traefik.docker.network` trên container home): không filter thì Docker provider của **mỗi** Traefik trên host thấy container `traefik.enable=true` của **mọi** worktree qua socket dùng chung, đăng ký router trùng rule `Host(fbi.com)` và request có thể trúng backend ở network không nối tới — treo thay vì lỗi.

## Port và URL

- Chỉ Traefik publish host port: Docker cấp **động**, bind `127.0.0.1` — home và PostgreSQL không publish host port nào.
- `ROOT_HOST` = `fbi.com:<traefik-host-port>`, chỉ suy từ Pulumi outputs sau khi up (`buildRootHost` trong contract). Không hard-code port bao giờ.
- `.env` là **artifact tiện dụng**: orchestration ghi `ROOT_HOST` sau khi đọc outputs (chỉ đụng key mình sở hữu, giữ nguyên byte còn lại), và không chương trình Pulumi nào đọc `.env`.

## Invariants

1. Chỉ Traefik publish host port, và chỉ trên loopback.
2. Volume PostgreSQL sống độc lập với vòng đời container **và** vòng đời stack; đường xoá dữ liệu duy nhất là `pnpm dx local-destroy --remove-data` (in cảnh báo trước).
3. Secret PostgreSQL nằm trong Pulumi secret config, không vào Git/log/output; secret trong stack config và dữ liệu trong volume phải cùng tuổi — destroy **không** `--remove` stack vì đó là cách hai nửa lệch nhau.
4. Preview và apply tách bạch: `pnpm dx local-deploy --preview` không apply, không ghi `.env`; Nx target `provision` là dry-run an toàn cho CI (không chạy `pulumi up`).
5. Tên resource luôn qua namespace; không tên nào được suy từ thứ tự chạy hay timestamp.
