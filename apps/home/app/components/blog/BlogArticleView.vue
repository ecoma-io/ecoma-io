<!--
  Trang article của blog — `/en/blog/<slug>`, `/vi/blog/<slug>`.

  Khác docs: một cột đọc hẹp, không TOC, không breadcrumb — điều hướng nằm ở
  hai đầu đường đọc (về landing, trước/sau, related). Shell dùng chung vẫn đảm
  bảo một landmark `<main>`, skip link và global nav có tên.
-->
<script setup lang="ts">
// Import tường minh (không phụ thuộc auto-import): component test mount SFC
// này ngoài Nuxt runtime (`@vitejs/plugin-vue` thuần) — same pattern với
// PublicShell của app/layout.
import { computed } from 'vue';
import type { PublicLocale } from '../../i18n/index';
import { PublicShell, buildPublicPath } from '../../layout/index';
import type { BlogCollectionItem } from '@nuxt/content';
import { ContentRenderer } from '#components';
import BlogTagList from '~/components/blog/BlogTagList.vue';
import { formatArticleDate } from '~/blog/blog-date';
import type { BlogArticleSummary } from '~/blog/blog-articles';
import type { BlogUiStrings } from '~/blog/blog-ui-strings';

const { locale, page, summary, related, previous, next, availableLocales, ui } =
  // oxlint-disable-next-line vue/max-props
  defineProps<{
    /** Locale đã được route validate từ registry — component không tự suy đoán. */
    readonly locale: PublicLocale;
    /** Document đầy đủ đã query từ collection `blog` (body Markdown rendered). */
    readonly page: BlogCollectionItem;
    /** Summary đã map từ frontmatter — nguồn cho meta, tag. */
    readonly summary: BlogArticleSummary;
    /** Related articles cùng tag chính, đã loại chính article này. */
    readonly related: readonly BlogArticleSummary[];
    /** Bài cũ hơn liền trước — `undefined` ở biên (bài cũ nhất). */
    readonly previous: { readonly path: string; readonly title: string } | undefined;
    /** Bài mới hơn liền sau — `undefined` ở biên (bài mới nhất). */
    readonly next: { readonly path: string; readonly title: string } | undefined;
    /** Locale thực sự có bản dịch của article — input cho locale switcher. */
    readonly availableLocales: readonly PublicLocale[];
    readonly ui: BlogUiStrings;
  }>();

/**
 * Link về blog landing — dựng qua builder của `app/layout`, không
 * concatenate. Bọc `computed()` để track prop `locale`: client-side navigate
 * giữa hai locale tái dùng instance component này, path tính một lần lúc
 * setup sẽ trỏ landing cũ trong khi nội dung đã sang locale mới.
 */
const blogRoot = computed(() => buildPublicPath({ locale, mount: 'blog' }));
</script>

<template>
  <PublicShell :path="summary.path" :available-locales="availableLocales">
    <div class="mx-auto w-full max-w-3xl px-4 py-10 lg:px-8">
      <!--
        Tiêu đề của article do chính Markdown sở hữu (`# Heading` ở đầu mỗi
        document), nên view **không** render thêm một `<h1>` nữa: hai `<h1>`
        cùng nội dung vừa lặp chữ trên màn hình vừa phá heading hierarchy.
        `summary.title` vẫn được dùng cho SEO và `<title>` — metadata, không
        phải nội dung hiển thị lần hai.
      -->
      <p class="text-sm text-slate-500">
        <time :datetime="summary.date">{{ formatArticleDate(summary.date, locale) }}</time>
        <span aria-hidden="true"> · </span>
        <span>{{ ui.writtenBy }} {{ summary.author }}</span>
      </p>

      <div class="mt-2">
        <BlogTagList :tags="summary.tags" :label="ui.tags" />
      </div>

      <!--
        Cover của article: nằm trên khối nội dung ở tỉ lệ full-cột đọc — đây
        là phần tử LCP của trang, nên `loading="eager"` + `fetchpriority="high"`
        (lazy trên LCP image là anti-pattern: browser chỉ bắt đầu tải khi phần
        tử gần viewport). `decoding="async"` giữ lại — giải mã bất đồng bộ
        không chặn render. Article không cover thì không render `<img>`.
      -->
      <img
        v-if="summary.cover"
        :src="summary.cover.src"
        :alt="summary.cover.alt"
        class="mt-6 aspect-video w-full rounded-lg object-cover"
        loading="eager"
        fetchpriority="high"
        decoding="async"
      />

      <!--
        `PublicShell` đã render landmark `<main>` bọc slot này, nên ở đây chỉ
        dùng `<div>`: lồng `<main>` trong `<main>` là HTML không hợp lệ và làm
        hỏng landmark cho screen reader.
      -->
      <div class="blog-content mt-8">
        <ContentRenderer :value="page" />
      </div>

      <p class="mt-10">
        <NuxtLink
          v-if="blogRoot.kind === 'localized'"
          :to="blogRoot.path"
          class="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          ← {{ ui.allPosts }}
        </NuxtLink>
      </p>

      <!--
        Cặp prev/next chỉ chứa article **cùng locale** (query đã lọc ở tầng SQL,
        xem route). Ngữ nghĩa theo trục thời gian: "previous" = bài cũ hơn,
        "next" = bài mới hơn — nguồn là `pickAdjacentArticles` trong
        `blog-articles.ts`. `<nav>` mang tên riêng để không trùng accessible
        name với global nav của shell.
      -->
      <nav
        v-if="previous || next"
        :aria-label="ui.pagination"
        class="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between"
      >
        <div v-if="previous" class="sm:max-w-[48%]">
          <p class="text-xs uppercase tracking-wide text-slate-500">{{ ui.previous }}</p>
          <NuxtLink
            :to="previous.path"
            class="text-sm font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            {{ previous.title }}
          </NuxtLink>
        </div>
        <div v-if="next" class="sm:max-w-[48%] sm:text-right">
          <p class="text-xs uppercase tracking-wide text-slate-500">{{ ui.next }}</p>
          <NuxtLink
            :to="next.path"
            class="text-sm font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            {{ next.title }}
          </NuxtLink>
        </div>
      </nav>

      <section v-if="related.length > 0" class="mt-12">
        <h2 class="text-lg font-semibold tracking-tight text-slate-900">{{ ui.related }}</h2>
        <ul class="mt-4 space-y-3">
          <li v-for="article in related" :key="article.path">
            <p class="text-sm">
              <NuxtLink
                :to="article.path"
                class="font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
              >
                {{ article.title }}
              </NuxtLink>
              <span class="text-slate-500"> — {{ article.description }}</span>
            </p>
          </li>
        </ul>
      </section>
    </div>
  </PublicShell>
</template>
