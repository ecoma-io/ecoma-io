<!--
  Card article trong listing landing: cover, title, mô tả, meta và tag.

  Link duy nhất trỏ tới article là **title** (`one card, one link` — một link
  lặp lại cùng đích chỉ nhân bản accessible name). `readMore` là nhãn truy cập
  được của chính link title, không phải một link thứ hai.
-->
<script setup lang="ts">
// Import tường minh: auto-import đăng ký `BlogsBlogTagList` (prefix thư mục),
// còn template dùng `BlogTagList` — không import thì SSR render rỗng im lặng.
import BlogTagList from '~/components/blogs/BlogTagList.vue';
import type { BlogArticleSummary } from '~/utils/blog-articles';
import type { BlogUiStrings } from '~/utils/blog-ui-strings';

// oxlint-disable-next-line vue/max-props
defineProps<{
  readonly article: BlogArticleSummary;
  readonly ui: BlogUiStrings;
}>();

/** Ngày hiển thị theo locale — demo content vẫn format đúng locale, không hard-code `en-US`. */
const { locale } = useI18nLocale();

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
  <article class="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
    <!--
      Cover: `aspect-video` + `object-cover` giữ tỉ lệ khung bất kể kích thước
      gốc; `loading="lazy"`/`decoding="async"` vì card nằm dưới fold của
      listing. Article không cover thì không render `<img>` — không bao giờ
      có hình hỏng hay placeholder rỗng.
    -->
    <img
      v-if="article.cover"
      :src="article.cover.src"
      :alt="article.cover.alt"
      class="aspect-video w-full object-cover"
      loading="lazy"
      decoding="async"
    />
    <div class="flex flex-1 flex-col p-5">
      <h3 class="text-lg font-semibold tracking-tight text-slate-900">
        <a
          :href="article.path"
          :aria-label="`${article.title} — ${ui.readMore}`"
          class="hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          {{ article.title }}
        </a>
      </h3>
      <p class="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
        {{ article.description }}
      </p>
      <p class="mt-3 text-xs text-slate-500">
        <time :datetime="article.date">{{ formatDate(article.date, locale) }}</time>
        <span aria-hidden="true"> · </span>
        <span>{{ article.author }}</span>
      </p>
      <div class="mt-3">
        <BlogTagList :tags="article.tags" :label="ui.tags" />
      </div>
    </div>
  </article>
</template>
