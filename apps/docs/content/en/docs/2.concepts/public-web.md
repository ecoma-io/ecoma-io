---
title: Public Web
description: The public URL model — /<locale>/<mount>/<path> — and how the platform parses and builds it.
---

# Public Web

The public surface of `ecoma.io` follows one strict URL model:

```text
/<locale>/<mount>/<path>
```

## The three segments

- **locale** — the first segment, always present. Supported locales live in the
  locale registry (`PUBLIC_LOCALES` in `libs/i18n-public`). English is
  `/en/...`, Vietnamese is `/vi/...`; there is no unprefixed variant.
- **mount** — the public application. Currently registered mounts in
  `libs/layout-public` are `blog`, `docs` and `docs/api`. A mount matches on a
  full segment boundary: `/en/docs` is `docs`, while `/en/blogging` is not
  `blog`.
- **path** — everything after the mount. It is opaque to the platform; the
  application that owns the mount decides whether the resource exists.

## Examples

| URL                                     | Meaning                            |
| --------------------------------------- | ---------------------------------- |
| `/en`                                   | English locale root                |
| `/en/docs`                              | English docs, docs root            |
| `/en/docs/getting-started`              | English docs, Getting Started      |
| `/vi/docs/getting-started/installation` | Vietnamese docs, Installation page |

## Parsing is strict

Paths are **not** normalized or repaired. A trailing slash, an empty segment,
or an unsupported locale are rejected with a typed reason rather than being
silently fixed:

```text
/en        → localized (en)
/EN/docs   → invalid (unsupported_locale)
/en/docs/  → invalid (trailing_slash)
/en//docs  → invalid (empty_segment)
```

## Boundaries

- `/` is a locale-resolution entry point. It never serves content and never
  redirects to an unprefixed path on its own; the caller decides the policy.
- `docs/api` is a nested mount with its own deployment unit. The docs
  application does not serve it — a request for `/en/docs/api` is rejected
  before content lookup.

---

_Next: [Content and Locales](/en/docs/concepts/content-and-locales)_
