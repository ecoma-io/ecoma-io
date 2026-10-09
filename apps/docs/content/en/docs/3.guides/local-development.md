---
title: Local Development
description: A concrete development loop — start the app, inspect a page, change content, run tests, build.
---

# Local Development

This guide walks through the everyday development loop for a public app.

## 1. Start the app

From the workspace root, start the docs app dev server:

```bash
cd apps/docs
pnpm exec nuxt dev
```

The server listens on `http://localhost:4203`.

## 2. Inspect a page

Open a document in the browser, for example:

```text
http://localhost:4203/en/docs/getting-started/installation
```

Look at the rendered page: the header with global navigation and locale
switcher, the docs sidebar, breadcrumbs, the table of contents, and the
previous/next links. Use the browser _View Source_ to confirm the page is
server-rendered.

## 3. Change content

Markdown content lives under `apps/docs/content`. Edit an English page and open
its Vietnamese counterpart to see both sides:

```bash
# pick a page, e.g.
$EDITOR apps/docs/content/en/docs/guides/local-development.md
```

`nuxt dev` picks up the change; the page reloads with the new content.

## 4. Run tests

From the workspace root, run the unit tests:

```bash
pnpm exec nx test docs
```

This runs the Vitest suites colocated with the docs app — including the
path-validation and content-resolution tests.

## 5. Build

A production build exercises SSR, static asset generation and the Cloudflare
preset:

```bash
cd apps/docs
pnpm exec nuxt build
```

The output lands in `.output/`. You can preview it locally:

```bash
npx wrangler dev .output/server/index.mjs --assets .output/public
```

---

_Previous: [Guides](/en/docs/guides) · Next: [Building a Public Page](/en/docs/guides/building-a-public-page)_
