---
title: Installation
description: Prerequisites and local development overview for the Ecoma monorepo.
---

# Installation

This page covers what you need before you can run the repository locally, and
roughly what "local development" means in this workspace.

## Prerequisites

You need the following tools:

| Tool        | Purpose                           |
| ----------- | --------------------------------- |
| Node.js 24+ | Runtime for tooling and the build |
| pnpm 12+    | Package manager for the workspace |
| Git         | Version control                   |

The exact versions are pinned in the repository: `.node-version` pins Node.js
and the `packageManager` field in `package.json` pins pnpm. Use Corepack or
install those versions directly and the whole toolchain agrees.

> **Note** — macOS users may need `watchman` for file watching if the DevTools
> watcher reports unrelated rebuilds.

## The repository and workspace

The repository is a **monorepo** managed with [Nx](https://nx.dev/) and pnpm:

```text
apps/    runtime and deploy units (web apps, services)
libs/    shared libraries owned by bounded contexts
docs/    architecture and operations documentation
tools/   developer tooling such as the `dx` CLI
```

The pnpm workspace covers `apps/*`, `tools/*` and `docs`; the libraries under
`libs/` are Nx projects without their own `package.json`, resolved through
workspace aliases. Everything else in that layout is a pnpm workspace package.
The `apps/docs` package is the documentation app you are reading right now.

## Local development overview

The typical loop has three steps.

### Install the dependencies

From the workspace root:

```bash
pnpm install
```

### Prepare the Nuxt types

Nuxt generates the `.nuxt/` type files once before the first run:

```bash
cd apps/docs
pnpm exec nuxt prepare
```

### Start the dev server

```bash
pnpm exec nuxt dev
```

The dev server is then available at `http://localhost:4203`, for example:

```bash
curl -I http://localhost:4203/en/docs/getting-started
```

Run the unit tests for a single app from the workspace root:

```bash
pnpm exec nx test docs
```

## What happens during a build

The docs app is a **static site**: `nitro.config.ts` selects the Nitro
**`static`** preset, so every content query runs at build time on Node and the
output is plain files — no runtime code, no database. Building the Nx target
runs Nuxt with prerendering:

```bash
npx nx build-static @ecoma-io/docs
```

The output lands in `apps/docs/.output/public`:

```text
.output/public/           prerendered HTML, one directory per route
.output/public/_nuxt/     hashed client assets
.output/public/__nuxt_content/  the content database dump
```

Nuxt also leaves a `dist` symlink pointing at `.output/public` — that is the
path the `serve-static` target serves and the path `wrangler.jsonc` deploys
(`nx deploy @ecoma-io/docs` builds the static site first, then publishes it as
an assets-only Worker).

> **Warning** — never commit secrets into `.dev.vars*` or `.env*`. Local Worker
> configuration is for development only.

---

_Next: [First Steps](/en/docs/getting-started/first-steps)_
