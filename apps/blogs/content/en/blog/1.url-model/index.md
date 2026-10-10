---
title: One URL model for every public page
description: How /locale/mount/path keeps every public page predictable - and why we enforce it instead of hoping for it.
date: '2026-09-02'
author: John Martin
tags:
  - architecture
  - urls
featured: true
---

# One URL model for every public page

Every page on `ecoma.io` lives under one shape:

```text
/<locale>/<mount>/<path>
```

That is not a convention we hope teams follow. It is parsed, rejected and built
by two small libraries, so a page cannot silently drift into a shape the rest
of the platform does not understand.

![Diagram of a public website as three stacked layers, from pages down to static delivery](../../../assets/public-web-layers.svg)

## The three segments

- **locale** comes first, always: `/en/...` or `/vi/...`. There is no
  unprefixed variant, so a URL never needs to guess its own language.
- **mount** names the surface: `blog`, `docs`. It matches on a full segment
  boundary - `/en/blogging` is _not_ the blog.
- **path** is everything after the mount, and it belongs to the app that owns
  the mount.

## Strictness is a feature

The parser does not repair input. A trailing slash, an empty segment, or an
unknown locale is rejected with a typed reason:

```text
/en        -> ok
/en/docs/  -> rejected: trailing slash
/EN/docs   -> rejected: unknown locale
/en//docs  -> rejected: empty segment
```

Repairs feel helpful and are quietly harmful: a URL that "works" in a
non-canonical form gets indexed, cached and shared in exactly that form.
Rejection keeps one canonical address per page.

## Slugs survive translation

An article keeps the same slug in both languages. `/en/blog/url-model` and
`/vi/blog/url-model` are the same resource wearing two languages, so the locale
switcher can move a reader between them without a lookup table.

![One article slug branching into an English and a Vietnamese path](../../../assets/two-locales-one-page.svg)

---

_Related: the docs surface documents the same model in more depth - see
[Public web layers](/en/blog/build-time-content) for how content reaches the
page._
