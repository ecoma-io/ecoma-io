# Image Docker cho `apps/account` ở LAN LOCAL deployment.
#
# Preset Nitro của app là `cloudflare-module` (staging/production trên
# Cloudflare Workers). Local deployment chạy preset `node-server`: override qua
# build-time flag `--preset=node-server` của Nuxt CLI, không sửa nitro.config.ts.
#
# Build context là REPO ROOT. Hai stage: build + runtime slim.

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS build

RUN corepack enable

WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
COPY tools/dx/package.json ./tools/dx/
COPY apps/account/package.json ./apps/account/
COPY apps/account/.npmrc ./apps/account/.npmrc
COPY libs/identity-contracts/package.json ./libs/identity-contracts/
COPY libs/internal-auth-contracts/package.json ./libs/internal-auth-contracts/
COPY libs/identity-domain/package.json ./libs/identity-domain/
COPY libs/identity-auth-contracts/package.json ./libs/identity-auth-contracts/
COPY libs/transactional-mail-contracts/package.json ./libs/transactional-mail-contracts/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --trust-lockfile

COPY apps/account/ ./apps/account/
COPY libs/identity-contracts/ ./libs/identity-contracts/
COPY libs/internal-auth-contracts/ ./libs/internal-auth-contracts/
COPY libs/identity-domain/ ./libs/identity-domain/
COPY libs/identity-auth-contracts/ ./libs/identity-auth-contracts/
COPY libs/transactional-mail-contracts/ ./libs/transactional-mail-contracts/
COPY tsconfig.base.json ./

ENV NODE_ENV=production
RUN cd apps/account && pnpm exec nuxt build --preset=node-server

FROM ${NODE_IMAGE} AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/account/.output/ ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

CMD ["node", "/app/server/index.mjs"]
