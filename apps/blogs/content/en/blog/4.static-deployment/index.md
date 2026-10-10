---
title: Deploying a blog as static assets
description: No Worker script, no database binding - the whole deployment is a directory of files and a 404 page.
date: '2026-09-23'
author: John Martin
tags:
  - deployment
  - cloudflare
featured: false
---

# Deploying a blog as static assets

The deployment of this blog has no code in it. The Worker configuration
declares a directory of files, a 404 page, and nothing else.

## What the config says

```jsonc
{
  "assets": {
    "directory": ".output/public",
    "not_found_handling": "404-page",
    "html_handling": "drop-trailing-slash",
  },
}
```

Three decisions worth explaining:

- **No `main`** - with no Worker script, nothing executes per request. The
  platform serves files directly, which is both the cheapest and the most
  reliable serving mode.
- **`404-page` handling** - an unknown URL gets a real 404 status with a real
  error page. SPA-style fallbacks return 200 for everything, which quietly
  turns typos into indexable "pages".
- **`drop-trailing-slash`** - canonical URLs here have no trailing slash.
  The default `auto-trailing-slash` mode would redirect the canonical address
  to a non-canonical one, permanently.

## The 404 is part of the product

A blog that answers every unknown slug with a soft 200 trains readers to
distrust its links. Serving a real 404 for `/en/blog/not-an-article` is the
deployment doing its job.

## Identity without a script

The deployment still carries a Worker identity for the platform - previews and
environment routing key off it - but the identity is not an executable. It is
a name for a directory of files, which is exactly what this surface is.

---

_Reading path first, deployment second: [content resolved at build
time](/en/blog/build-time-content) explains why there is no runtime database to
bind._
