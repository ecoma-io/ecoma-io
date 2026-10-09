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

Each element of that layout is a pnpm workspace package. The `apps/docs`
package is the documentation app you are reading right now.

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

Building the docs app produces a Nitro server bundle plus static assets:

```text
.nuxt/         Nuxt build artifacts
.output/       Nitro output (server + public assets)
```

The `nitro.config.ts` of the docs app selects the **`cloudflare-module`** preset
so the output can be deployed to Cloudflare Workers.

> **Warning** — never commit secrets into `.dev.vars*` or `.env*`. Local Worker
> configuration is for development only.

---

_Next: [First Steps](/en/docs/getting-started/first-steps)_
