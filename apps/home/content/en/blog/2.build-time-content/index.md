---
title: Content is resolved at build time
description: Why this blog ships as prerendered files instead of a content API - and what that buys.
date: '2026-09-09'
author: John Martin
tags:
  - architecture
  - static-sites
featured: false
---

# Content is resolved at build time

When you open an article here, no server asks a database what the article says.
The answer was already written down - as a plain HTML file - the moment the
site was built.

![Pipeline diagram: Markdown flows through a static build into plain HTML, CSS and SVG files](../../../assets/build-time-pipeline.svg)

## The pipeline

1. **Write** - an article is a Markdown file with frontmatter, colocated with
   its images.
2. **Build** - the static build runs every content query once, on the build
   machine: listings, the featured pick, previous and next links.
3. **Serve** - the edge serves files. Nothing renders per request.

## What this buys

| Concern             | Static answer                           |
| ------------------- | --------------------------------------- |
| Latency             | CDN cache hit, no origin render         |
| Availability        | The site survives a database being down |
| Cost model          | Serving files, not running compute      |
| Content correctness | What you published is what you serve    |

The table above is the honest list. Static generation is not the right answer
for every product surface, but for reading surfaces it is hard to beat.

## The trade we accepted

Publishing is no longer instant: content changes land with the next build.
For a blog, that is the right trade - a deploy takes minutes, and in return
the reading path never waits on a runtime query.

> A page that renders from files cannot have a slow query. The class of
> outage simply does not exist for it.

---

_The [URL model](/en/blog/url-model) post covers how these files end up at
clean, localized addresses._
