# Local Platform — Operations

> Kiến trúc và bất biến: [`01-architecture.md`](./01-architecture.md).

## Prerequisites

- Docker daemon đang chạy (rootful lẫn rootless đều được; rootless được tự động nhận qua `DOCKER_HOST` — Traefik cần bind-mount đúng socket, chương trình tự suy theo thứ tự `DOCKER_SOCKET_PATH` > `DOCKER_HOST` > `/var/run/docker.sock`, và **fail sớm** nếu không tìm thấy socket nào tồn tại thật thay vì mount nhầm path).
- `pulumi` CLI trên `PATH` — **bản đã xác minh cho luồng này là `3.270.0`** (CLI pin trong repo, `node_modules/.bin/pulumi`; stack reference format `organization/<project>/<stack>` chỉ được kiểm chứng từ bản này — xem `04-platform-facts.md` §2.16 PU12). CLI cũ hơn trên `PATH` có thể fail với lỗi rối khó chẩn đoán.
- **Passphrase Pulumi** — **không cần developer tự đặt nữa.** Pulumi CLI 3.270 trên DIY backend `file://` bắt buộc passphrase cho mọi thao tác nạp stack config; luồng này giải bằng cách **công cụ tự sinh** một passphrase ngẫu nhiên (32 byte `randomBytes`, `base64url`) cho từng worktree, lưu ở `<worktree>/.pulumi-local-passphrase` (quyền `0600`, **ngoài Git** — `.gitignore` chặn tường minh). Developer không cần `export PULUMI_CONFIG_PASSPHRASE` cho stack local mới. Nếu môi trường đã có passphrase (`PULUMI_CONFIG_PASSPHRASE`/`PULUMI_CONFIG_PASSPHRASE_FILE`), giá trị đó được ưu tiên và ghi vào file để stack tự chứa từ lần chạy sau; stack cũ tạo bằng passphrase của developer vẫn giải được khi cung cấp lại đúng passphrase đó. Worktree đã deploy bằng passphrase khác thì cung cấp lại qua biến môi trường (không có đường reset không mất dữ liệu). Giữ file `.pulumi-local-passphrase` ổn định cho từng worktree — mất file mà state còn thì passphrase không khôi phục được.

- Certificate `fbi.com` ở `deploys/platform-deploy/local-certs/` (đường dẫn đầy đủ từ root repo; đã có trong repo). ⚠️ **Đường an toàn là trust scoped**: smoke đã làm đúng kiểu đó — trust certificate **cho đúng request** (tham số `ca` scoped), không đụng trust store hệ điều hành. Chỉ khi cần browser chấp nhận TLS thì mới trust thủ công, và phải hiểu hệ quả: cert này mang `CA:TRUE` (`keyCertSign`) — cài vào trust store là biến nó thành CA được toàn máy tin, tức **mọi certificate ký bằng khoá này cho bất kỳ hostname nào** cũng được chấp nhận. Khoá nằm vĩnh viễn trong Git history (không bị `.gitignore` loại) nên ai đọc được repo đều giữ được khoá — với trust store đầy máy, người đó có thể cấp cert giả cho domain bất kỳ trên máy của developer. Nếu bắt buộc trust ở mức máy, làm trên máy thử nghiệm rồi **tái sinh cert/key khi repo chuyển sang public**. Không bao giờ tắt TLS verification toàn cục. Khoá này **chỉ dùng cho local**, không tái sử dụng ở staging/production.

## Cách ly worktree (Pulumi CLI/backend)

Mọi lệnh Pulumi của luồng này chạy với `PULUMI_BACKEND_URL=file://<worktree>/.pulumi-local-state` và `--stack organization/<project>/<stack>` tường minh (`tools/dx/src/pulumi-context.ts`) — không `pulumi login`, nên không backend toàn cục nào bị chọn. `stack init`/`stack select` của `ensureStack` vẫn ghi stack hiện tại vào workspace file `~/.pulumi/workspaces/<project>-<sha1(Pulumi.yaml)>-workspace.json`, nhưng file đó key theo đường dẫn project (PU13) nên hai worktree không đụng file của nhau; các lệnh đọc/ghi state khác đều truyền `--stack` tường minh nên không phụ thuộc giá trị được ghi đó. `~/.pulumi` còn dùng chung cho plugin cache. Chi tiết platform đã đo: `04-platform-facts.md` §2.16 PU12–PU13.

## Luồng deploy

```bash
pnpm dx local-deploy            # apply thật: platform up → outputs → .env → home up → smoke
pnpm dx local-deploy --preview  # read-only: preview platform + home, không mutate gì
pnpm dx local-status            # namespace, stack, resource names, trạng thái platform
pnpm dx local-destroy           # teardown: giữ volume PostgreSQL
pnpm dx local-destroy --remove-data  # teardown + XOÁ volume (in cảnh báo, mất dữ liệu vĩnh viễn)
```

Luồng `local-deploy` (không `--preview`) chạy theo đúng thứ tự contract: platform up → đọc outputs → ghi `.env` → home up → smoke HTTPS. Mỗi bước chỉ chạy khi bước trước thành công. Lần chạy đầu trên stack mới, password PostgreSQL được sinh ngẫu nhiên (24 byte `randomBytes`, `base64url`) và lưu ở **Pulumi stack config plaintext** (`postgres:password`) của local stack — đây là nguồn sự thật canonical; cùng giá trị được ghi vào `.env` (`POSTGRES_PASSWORD`) để E2E/dev tools dùng. Passphrase chỉ là encryption material của state Pulumi local, không còn đóng vai trò bảo vệ password. `local-deploy` tái dùng mật khẩu đã có trong config cho mọi lần deploy sau; `.env` bị xoá thì được khôi phục từ config mà không xoay password. Nếu volume PostgreSQL đã tồn tại nhưng config mất password, luồng fail với hướng dẫn thay vì sinh password mới (tránh khoá người dùng ra khỏi dữ liệu cũ).

Hai chi tiết CLI 3.270 đã đo thật, cả hai đều bắt buộc để password được lưu đúng: `pulumi config set` **từ chối** giá trị "trông như secret" (key `postgres:password` + chuỗi ngẫu nhiên) với exit 1 và lời khuyên dùng `--secret`/`--plaintext` — nên luồng luôn truyền `--plaintext`; và giá trị được ghi qua **stdin** (`--raw`, không có argument value) thay vì argv, vì argv của process khác đọc được qua `/proc/<pid>/cmdline` và `ps`.

`--worktree-root <dir>` (cả ba lệnh `local-*`) chọn worktree bị tác động về **state/namespace/`.env`** (namespace Docker, Pulumi stack, `.pulumi-local-state`, `.env`); mặc định là checkout hiện hành. Chương trình Pulumi và smoke vẫn chạy từ checkout đang gõ lệnh — flag không phải "deploy code của worktree kia".

### Preview là read-only, và cần worktree đã apply

`--preview` **không mutate gì**: không tạo `.pulumi-local-state`, không `stack init`, không `pulumi config set`, không sinh/lưu `postgres:password`, không `up`/`destroy`, không ghi `.env`, không đụng Docker. Nó cũng **không truyền `--config`** cho `pulumi preview` — CLI 3.x _lưu_ `--config` vào stack config file kể cả khi preview (`pulumi preview --help`: "Config to use during the preview and save to the stack config file"), nên truyền nó là mutation cấu hình giữa chừng lệnh read-only. Mọi config mà chương trình cần (`namespace:worktreeRoot`, `namespace:platformStackRef`, `postgres:password`) do lần apply trước lưu vào stack config; preview chỉ đọc lại.

**Prerequisite**: worktree phải đã apply ít nhất một lần (`pnpm dx local-deploy`). Preview tự kiểm read-only trước khi chạy lệnh nào — state dir tồn tại, platform stack đã up (outputs thật), home stack tồn tại — và khi thiếu thì báo đúng thứ thiếu kèm cách khắc phục, exit 1, **không** tự khởi tạo gì để "giúp" preview xanh. Lý do có prerequisite: preview của Pulumi _có_ đọc state (nó đối chiếu desired state với state thật), nên một stack chưa tồn tại không có gì để preview; và home đọc platform qua `StackReference` mà chỉ có dữ liệu thật sau apply đầu tiên.

Cả hai project đều được preview (platform rồi home). Nếu preview home fail sau khi platform đã preview xanh, thông báo nói rõ home **không** được preview — không báo chung chung "preview xong".

Dry-run an toàn cho CI là Nx target `provision` (`pnpm nx run platform-deploy:provision`) — chỉ in kế hoạch, không chạy `pulumi up`.

## `local-status` — đọc trạng thái

Read-only. Phân biệt năm trạng thái, mỗi trạng thái một dòng:

- `chưa có stack trong backend` — worktree này chưa từng deploy (exit 0; passphrase được tool quản lý — file `.pulumi-local-passphrase` hoặc passphrase của developer trong môi trường).
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
- ⚠️ Đừng chạy `pulumi stack rm` trên stack local: nó xoá stack config (trong đó có `postgres:password`) trong khi volume còn lại — hai nửa lệch tuổi, Postgres kế tiếp không vào được dữ liệu cũ. Đó cũng là lý do `local-destroy` không dùng `destroy --remove`. Khi phát hiện tình huống này, `local-deploy` **fail với hướng dẫn** (không sinh mật khẩu mới): khôi phục mật khẩu cũ vào stack config, hoặc `pnpm dx local-destroy --remove-data` rồi `pnpm dx local-deploy` để bắt đầu lại từ dữ liệu rỗng.
- ⚠️ Đừng đổi `postgres:password` trong stack config sau khi volume đã init: `POSTGRES_PASSWORD` chỉ có tác dụng lúc `initdb` trên volume rỗng. Pulumi sẽ thay container (envs nằm trong diff) nhưng Postgres không chạy lại initdb — superuser trong volume vẫn giữ mật khẩu cũ, kết nối bằng giá trị mới nhận `password authentication failed` trong khi healthcheck `pg_isready` vẫn xanh (nó không xác thực mật khẩu). Nguyên tắc: mật khẩu và volume phải cùng tuổi.
- Healthcheck `pg_isready` không kiểm password; khi nghi ngờ lệch password (vd. đã `stack rm` ngoài luồng), kiểm bằng auth TCP thật hoặc tạo lại volume qua `local-destroy --remove-data` rồi `local-deploy`.
- **Mật khẩu PostgreSQL local lưu plaintext** trong Pulumi stack config (`.pulumi-local-state/`) và trong `.env` của worktree — cả hai đều ngoài Git (`.gitignore` chặn `.pulumi-local-state/`, `Pulumi.*.yaml`, `.env*`). Đây là đánh đổi **có chủ đích cho môi trường local development**, không phải khuôn mẫu cho staging/production: ở đó secret vẫn phải là secret của Cloudflare Worker. Mật khẩu không bao giờ được in ra log/stdout, không nằm trong Pulumi outputs, không nằm trong URL, và PostgreSQL không publish host port.

## `local-cleanup` — dọn resource mồ côi

Worktree xoá mà quên `local-destroy` là Docker resource còn lại: container/network/volume mang tên `ecoma-<namespace>-<kind>` không ai quản lý. `pnpm dx local-cleanup` tìm và xoá resource mồ côi đó — worktree sở hữu nó không còn trên đĩa.

```bash
pnpm dx local-cleanup                       # dọn thật (vẫn giữ volume PostgreSQL)
pnpm dx local-cleanup --dry-run             # chỉ báo cáo, không có lệnh destructive nào
pnpm dx local-cleanup --worktree-root <dir> # lọc báo cáo theo worktree (diagnostics, không nới ràng buộc)
```

**Cleanup phát hiện và xoá những gì**: resource Docker mà luồng local deployment tạo — network platform, container Traefik, container PostgreSQL, container home, volume PostgreSQL (`CLEANUP_KINDS` trong `tools/dx/src/local-cleanup.ts`). Cleanup KHÔNG có teardown theo thứ tự phụ thuộc: worktree biến mất thì không resource nào còn phụ thuộc vòng sống vào nhau; Docker chấp nhận lệnh `rm` trực tiếp từng resource.

### Labels ownership — bằng chứng "của ai"

Mọi resource local deployment được gắn bốn label kể từ thay đổi này (`deploys/platform-deploy`, `deploys/home-deploy`; định nghĩa một bản duy nhất ở `tools/dx/src/deploy-labels.ts`):

| Label                       | Ý nghĩa                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `io.ecoma.managed-by=dx`    | Đánh dấu resource thuộc quản lý DX local tooling. **Không có label này (hoặc sai giá trị) là cleanup không bao giờ đụng**, dù tên có trông giống resource ecoma. |
| `io.ecoma.worktree-path`    | Worktree root đã normalize (`normalizeWorktreeRoot` — realpath, bỏ trailing sep) — cleanup so đường này với worktree còn tồn tại trên đĩa.                       |
| `io.ecoma.worktree-id`      | Namespace ổn định của worktree (`w` + xxHash64 hex 12, `deploy-namespace.ts`) — cùng giá trị với tên resource.                                                   |
| `io.ecoma.deployment=local` | Luồng sở hữu — hiện chỉ có `local`.                                                                                                                              |

Resource thiếu bất kỳ label trong bốn, `worktree-id` sai pattern namespace, hay `worktree-path` không absolute → **metadata không trọn vẹn (malformed) → skip, không xoá**. Quyết định xóa luôn dựa trên metadata hợp lệ, không dựa trên hình dạng tên.

**Volume persistent mặc định được giữ**: cleanup không xoá volume PostgreSQL kể cả khi worktree mồ côi — đúng convention `local-destroy` (dữ liệu chỉ xoá khi `--remove-data` tường minh). Orphan volume được báo ra entries `kept` với lý do rõ để developer tự quyết.

### An toàn và xử lý lỗi

- **Chưa có thể verify ownership thì không xoá**: `docker inspect` lỗi, JSON sai, label lệch — resource được báo `skipped` trong output (không âm thầm).
- **Docker daemon không phản hồi** (`docker info` fail): cleanup trả lỗi ở stderr với chi tiết, exit 1, **không quét và không xoá gì**.
- **Lỗi `ls` per-kind** (daemon lỗi giữa chừng): kind đó được bỏ với lỗi trong output; các kind khác vẫn xử lý — lệnh exit 1 khi có bất kỳ lỗi nào, không `return 0` nói dối.
- **Worktree filter** (`--worktree-root`) chỉ dành cho diagnostics — nó lọc báo cáo, không thay check ownership/liveness; resource ngoài filter vẫn phải qua đủ check như thường.
- **Phối hợp với deploy đang chạy**: cleanup và `local-deploy` apply chia sẻ một lock host-wide (`tools/dx/src/local-lock.ts`, file lock đối chiếu PID + stale timeout). Deploy đang apply hoặc cleanup đang quét thì lệnh thứ hai báo `lock bị giữ` và thoát — không race vào Docker daemon.
- Cleanup chạy không đòi checkout cũ hay thao tác Pulumi nào: nó chỉ nói chuyện Docker + filesystem của worktree path được ghi trong label.

## Giới hạn đã biết

- Host port Traefik đổi mỗi lần container được tạo lại (Docker cấp động) — luôn đọc lại từ `.env`/outputs sau khi up.
- Preview cần worktree đã apply trước (read-only, xem mục Luồng deploy); nó không tự khởi tạo stack/mật khẩu/config.
- Traefik bind-mount Docker socket read-only: `readOnly` chỉ chặn ghi filesystem, KHÔNG giới hạn Docker API — mount này vẫn là đường leo thang đặc quyền tiềm năng nếu container bị chiếm. Socket proxy GET-only là giảm thiểu đúng nghĩa, chưa có ở đây (chấp nhận rủi ro có chủ đích cho môi trường local).
- Local deployment **không** auto-trust certificate, không backup volume, không monitoring — ngoài phạm vi có chủ đích.
- Preset Nitro của `apps/home` cho staging/production vẫn là `cloudflare-module` (đường Wrangler); Docker chỉ dùng preset `node-server` qua build-time flag, không sửa `nitro.config.ts`.
