---
title: Locale switching that never lies
description: A language switcher should only offer what exists. Here is how the link list is derived from real content.
date: '2026-09-16'
author: John Martin
tags:
  - i18n
  - ux
featured: false
---

# Locale switching that never lies

The worst thing a language switcher can do is offer a translation that does
not exist. The reader clicks, lands on a 404, and learns the switcher lies.
So the rule here is simple:

> A switcher link is only rendered when the translation actually exists.

## Availability comes from content

For every page, the app asks the content collection which locales have a
document at the same resource path. The switcher renders from that answer -
not from the full registry. If a page exists in English only, English readers
see no Vietnamese link, because there is nothing behind it.

## The slug is the join key

Translations share one slug. `/en/blog/locale-switching` and
`/vi/blog/locale-switching` are the same article, so switching means replacing
exactly one segment:

```text
/en/blog/locale-switching
       |
       v
/vi/blog/locale-switching
```

No per-page mapping table, no redirects chained behind the switcher - the path
is rebuilt by the platform's own builder, which rejects malformed output at
compile time rather than serving it.

## Metadata follows the same rule

The `hreflang` alternates in the page head are built from the same
availability answer. A page never advertises a translation to search engines
that it would not offer to a reader.

| Surface          | Source of truth                 |
| ---------------- | ------------------------------- |
| Switcher links   | content query                   |
| `hreflang` links | content query                   |
| `canonical`      | current path, production origin |

One query, three surfaces, no divergence.

---

_The registry that defines which locales exist is documented in the
[build-time content](/en/blog/build-time-content) post._
