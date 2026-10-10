<!--
  Trang article của blog — `/en/blog/<slug>`, `/vi/blog/<slug>`.

  Khác docs: một cột đọc hẹp, không TOC, không breadcrumb — điều hướng nằm ở
  hai đầu đường đọc (về landing, trước/sau, related). Shell dùng chung vẫn đảm
  bảo một landmark `<main>`, skip link và global nav có tên.
-->
<script setup lang="ts">
import type { PublicLocale } from '@ecoma-io/i18n-public';
import { PublicShell, buildPublicPath } from '@ecoma-io/layout-public';
import type { BlogCollectionItem } from '@nuxt/content';
import { ContentRenderer } from '#components';
import BlogTagList from '~/components/blogs/BlogTagList.vue';
import type { BlogArticleSummary } from '~/utils/blog-articles';
import type { BlogUiStrings } from '~/utils/blog-ui-strings';

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
    readonly previous: { readonly path: string; readonly title: string } | undefined;
    readonly next: { readonly path: string; readonly title: string } | undefined;
    /** Locale thực sự có bản dịch của article — input cho locale switcher. */
    readonly availableLocales: readonly PublicLocale[];
    readonly ui: BlogUiStrings;
  }>();

/** Link về blog landing — dựng qua builder của `layout-public`, không concatenate. */
const blogRoot = buildPublicPath({ locale, mount: 'blog' });

/** Ngày hiển thị theo locale. */
function formatDate(date: string, localeCode: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(localeCode, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
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
        <time :datetime="summary.date">{{ formatDate(summary.date, locale) }}</time>
        <span aria-hidden="true"> · </span>
        <span>{{ ui.writtenBy }} {{ summary.author }}</span>
      </p>

      <div class="mt-2">
        <BlogTagList :tags="summary.tags" :label="ui.tags" />
      </div>

      <!--
        Cover của article: `aspect-video` + `object-cover` giữ tỉ lệ khung;
        lazy vì người đọc chưa scroll tới nội dung. Article không cover thì
        không render `<img>` — không hình hỏng hay placeholder rỗng.
      -->
      <img
        v-if="summary.cover"
        :src="summary.cover.src"
        :alt="summary.cover.alt"
        class="mt-6 aspect-video w-full rounded-lg object-cover"
        loading="lazy"
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
        <a
          v-if="blogRoot.kind === 'localized'"
          :href="blogRoot.path"
          class="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          ← {{ ui.allPosts }}
        </a>
      </p>

      <!--
        Cặp prev/next chỉ chứa article **cùng locale** (query đã lọc ở tầng SQL,
        xem route). `<nav>` mang tên riêng để không trùng accessible name với
        global nav của shell.
      -->
      <nav
        v-if="previous || next"
        :aria-label="ui.pagination"
        class="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between"
      >
        <div v-if="previous" class="sm:max-w-[48%]">
          <p class="text-xs uppercase tracking-wide text-slate-500">{{ ui.previous }}</p>
          <a
            :href="previous.path"
            class="text-sm font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            {{ previous.title }}
          </a>
        </div>
        <div v-if="next" class="sm:max-w-[48%] sm:text-right">
          <p class="text-xs uppercase tracking-wide text-slate-500">{{ ui.next }}</p>
          <a
            :href="next.path"
            class="text-sm font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            {{ next.title }}
          </a>
        </div>
      </nav>

      <section v-if="related.length > 0" class="mt-12">
        <h2 class="text-lg font-semibold tracking-tight text-slate-900">{{ ui.related }}</h2>
        <ul class="mt-4 space-y-3">
          <li v-for="article in related" :key="article.path">
            <p class="text-sm">
              <a
                :href="article.path"
                class="font-medium text-slate-900 hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
              >
                {{ article.title }}
              </a>
              <span class="text-slate-500"> — {{ article.description }}</span>
            </p>
          </li>
        </ul>
      </section>
    </div>
  </PublicShell>
</template>
