---
title: Content and Locales
description: How documentation content is localized and how content paths map to public routes.
---

# Content and Locales

Documentation content is **localized at the source**: every page exists in each
locale, and the content path maps directly to the public route.

## Localized content

The docs content lives in `apps/docs/content`:

```text
content/
├── en/
│   └── docs/
│       └── getting-started/
│           └── installation.md
└── vi/
    └── docs/
        └── getting-started/
            └── installation.md
```

Each locale has its **own copy** of every page, written to read naturally in
that language — not a machine translation of the other.

## Content path → public route

The file path under `content/<locale>` becomes the public pathname exactly:

```text
content/en/docs/getting-started/installation.md
                  ↓
/en/docs/getting-started/installation

content/vi/docs/getting-started/installation.md
                  ↓
/vi/docs/getting-started/installation
```

There is **no per-page locale mapping** — the directory is the route.

## Self-contained URLs

Because the locale is part of the URL, every document has a self-contained
canonical address. Links within the documentation stay inside the current
locale:

```text
/en/docs/concepts/public-web   ← English reader's link
/vi/docs/concepts/public-web   ← Vietnamese reader's link
```

## Locale-aware navigation

The docs sidebar, breadcrumbs and previous/next navigation are derived from the
content tree **filtered to the current locale**. An English reader sees only the
English tree; the Vietnamese tree never leaks in, and prev/next never jumps
across locales.

---

_Previous: [Public Web](/en/docs/concepts/public-web) · Next: [Guides](/en/docs/guides)_
