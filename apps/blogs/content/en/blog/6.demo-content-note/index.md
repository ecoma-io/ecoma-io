---
title: What this blog is (and is not)
description: This is a demo vertical slice - real layout, real pipelines, deliberately editorial content.
date: '2026-10-07'
author: John Martin
tags:
  - meta
featured: false
---

# What this blog is (and is not)

Everything you are reading here is a **demonstration**. The articles exercise
the machinery - listings, featured selection, related posts, previous and next,
locale switching, media resolution - with editorial copy written for that
purpose.

## What is real

- The layout you are reading renders from the same code paths a production
  article would.
- The build pipeline is the production one: Markdown in, prerendered pages
  out, every link and image resolved at build time.
- The 404 behavior, canonical URLs, and locale alternates are enforced, not
  simulated.

![Pipeline diagram: Markdown flows through a static build into plain HTML, CSS and SVG files](../../../assets/build-time-pipeline.svg)

## What is not

- The articles themselves are not product documentation; the docs surface owns
  that.
- Names, dates and bylines are demo data.
- There is no CMS behind this - publishing is a commit.

## How to review it

Click around with intent:

1. Open [the featured post](/en/blog/url-model), then use previous/next to
   walk the whole list.
2. Switch locale mid-article and confirm the slug survives the trip.
3. Visit `/en/blog/not-a-real-article` and check you get a real 404.
4. Inspect any page head for one canonical URL and `hreflang` alternates that
   only point at pages that exist.

---

_Start anywhere - [the URL model post](/en/blog/url-model) is as good a place
as any._
