# Image Docker cho `apps/home` ở LAN LOCAL deployment.
#
# Preset Nitro của app là `cloudflare-module` (`apps/home/nitro.config.ts`) — đó
# là đường deploy staging/production trên Cloudflare Workers, và file Dockerfile
# này KHÔNG đụng tới nó. Local deployment chạy app trong Docker với preset
# `node-server`: entrypoint là `node .output/server/index.mjs`, nghe trên `PORT`,
# và serve static assets trong `.output/public` (`serveStatic: true` của preset
# node-server). Vì vậy override preset phải là **build-time flag** của Nuxt CLI
# (`nuxt build --preset=node-server`), không phải sửa `nitro.config.ts`.
#
# Build context là REPO ROOT (không phải `apps/home`): monorepo pnpm workspace có
# `libs/ui-ecoma-logo` là workspace dependency của app, và `pnpm-workspace.yaml`
# + `pnpm-lock.yaml` + `patches/` đều nằm ở root. Dockerfile đặt ở `apps/home`
# để nằm cạnh app, nhưng mọi path bên dưới là path tương đối so với context root.
#
# Hai stage:
#   1. `build` — cài dependency, build Nuxt ra `.output`.
#   2. `runtime` — chỉ copy `.output` sang image `node:24-bookworm-slim`, không
#      mang `node_modules`, toolchain hay source. Đây là lý do image nhỏ và
#      bề mặt tấn công ở runtime hẹp.

# --- Stage 1: build ---------------------------------------------------------
FROM node:24-bookworm-slim AS build

# pnpm là package manager của repo (field `packageManager` trong package.json
# ghim `pnpm@12.14.0`). `corepack` đi kèm image Node nên không cần cài pnpm
# bằng npm — cài đúng version mà lockfile sinh ra, tránh lệch resolution.
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

WORKDIR /repo

# Lớp cache đầu chỉ copy manifest: đổi source không làm mất `pnpm install`.
# `patches/` phải có mặt **trước** install vì `pnpm-workspace.yaml` khai
# `patchedDependencies` trỏ vào nó — thiếu thì pnpm không apply patch (và với
# `--frozen-lockfile` còn fail vì config lệch lockfile).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY tools/dx/package.json ./tools/dx/
COPY apps/home/package.json ./apps/home/
COPY libs/ui-ecoma-logo/package.json ./libs/ui-ecoma-logo/

# `--ignore-scripts`: stage build không cần postinstall native nào — các
# package có native binding đều ship prebuild (better-sqlite3 mang
# `prebuilds/linux-x64.node`; `@parcel/watcher`, `workerd`, `esbuild`... tương
# tự). Chạy script ở đây chỉ chậm build mà không đổi kết quả. Bỏ cờ này nếu
# sau này một package **bắt buộc** phải build native để `nuxt build` chạy được.
RUN pnpm install --frozen-lockfile --ignore-scripts

# `apps/home/.npmrc` (`shamefully-hoist`) là config theo **từng package**, không
# phải config root, nên phải copy vào đúng vị trí trong image.
COPY apps/home/.npmrc ./apps/home/.npmrc

# Nguồn app đầy đủ + workspace package mà app import (`@ecoma-io/ui-ecoma-logo`,
# resolve qua alias trong `nuxt.config.ts` chứ không qua `paths` của tsconfig).
COPY apps/home/ ./apps/home/
COPY libs/ui-ecoma-logo/ ./libs/ui-ecoma-logo/

# CHỈ copy `tsconfig.base.json`, KHÔNG copy `tsconfig.json` ở root.
#
# `nuxt.config.ts` khai `typescript.tsConfig.extends: '../../../tsconfig.base.json'`
# (đường dẫn tương đối so với `.nuxt/`), nên base là thứ duy nhất app cần.
#
# `tsconfig.json` ở root là manifest project references cho **monorepo** — nó trỏ
# tới mọi project `libs/*` và `deploys/*`, mà image này không chứa chúng. Copy
# nó vào là Vite (`resolve.tsconfigPaths: true` trong `nuxt.config.ts`) dừng ở
# `/repo/tsconfig.json` rồi thử nạp từng project được tham chiếu và fail:
#     Error: [postcss] Tsconfig not found /repo/libs/identity-auth-application
# (postcss vì `styles.css` chạy qua PostCSS, nhưng gốc rễ là tsconfig walk của
# Vite.) Giữ manifest monorepo ra khỏi image là cách sửa: build **một** app không
# cần graph của cả workspace.
COPY tsconfig.base.json ./

# Override preset `cloudflare-module` của `nitro.config.ts`: cờ `--preset` của
# `nuxt build` được truyền thành `overrides.nitro.preset`, thắng giá trị
# `preset` trong config file. `NODE_ENV=production` để Nuxt build theo chế độ
# production (bỏ devtools, bật minify).
ENV NODE_ENV=production
RUN cd apps/home && pnpm exec nuxt build --preset=node-server

# --- Stage 2: runtime -------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

# `node:24` đã có user `node` (uid 1000) sẵn; chạy non-root để container không
# cần quyền ghi gì ngoài filesystem của chính nó.
COPY --from=build --chown=node:node /repo/apps/home/.output/ ./

ENV NODE_ENV=production
ENV PORT=3000

# Không `EXPOSE` cổng host nào: container chỉ nghe trong Docker network của
# platform, Traefik route tới nó qua alias. `EXPOSE` chỉ là tài liệu metadata.
EXPOSE 3000

USER node

CMD ["node", "/app/server/index.mjs"]