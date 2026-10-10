<!--
  Trang landing của blog — `/en/blog`, `/vi/blog`.

  Route dùng chung `[[...slug]].vue` cho cả landing lẫn article, nên view nhận
  dữ liệu đã resolve từ route và chỉ render. Hero là article featured (hoặc
  fallback bài mới nhất — logic trong `blog-articles.ts`), dưới đó là listing
  các article còn lại mới nhất trước.
-->
<script setup lang="ts">
// Import tường minh (không phụ thuộc auto-import): component test mount SFC
// này ngoài Nuxt runtime (`@vitejs/plugin-vue` thuần) — same pattern với
// PublicShell của app/layout.
import { computed } from 'vue';
import type { PublicLocale } from '../../i18n/index';
import { PublicShell, buildPublicPath } from '../../layout/index';
import BlogArticleCard from '~/components/blog/BlogArticleCard.vue';
import BlogTagList from '~/components/blog/BlogTagList.vue';
import { formatArticleDate } from '~/blog/blog-date';
import type { BlogArticleSummary } from '~/blog/blog-articles';
import type { BlogUiStrings } from '~/blog/blog-ui-strings';

const { locale, featured, rest, availableLocales } =
  // oxlint-disable-next-line vue/max-props
  defineProps<{
    /** Locale đã được route validate từ registry — component không tự suy đoán. */
    readonly locale: PublicLocale;
    /** Article featured (hoặc fallback bài mới nhất) — vắng khi blog rỗng. */
    readonly featured: BlogArticleSummary | undefined;
    /** Các article còn lại sau hero, mới nhất trước. */
    readonly rest: readonly BlogArticleSummary[];
    /** Locale thực sự có bản dịch của landing — input cho locale switcher. */
    readonly availableLocales: readonly PublicLocale[];
    readonly ui: BlogUiStrings;
  }>();

/**
 * Landing path canonical của mount — dựng qua builder của `app/layout`
 * thay vì concatenate `/${locale}/blog`, để landing đi đúng cùng contract
 * topology với mọi path public khác của app. Bọc trong `computed()` để track
 * prop `locale`: `PublicShell` có contract phản ứng khi `path` đổi, và
 * client-side navigate `/en/blog` → `/vi/blog` tái dùng instance component
 * này (cùng route record, chỉ đổi param) — path tính một lần lúc setup sẽ
 * giữ nguyên locale cũ trong khi nội dung đã sang locale mới.
 */
const currentPath = computed<string>(() => {
  const built = buildPublicPath({ locale, mount: 'blog' });
  return built.kind === 'localized' ? built.path : '/';
});
</script>

<template>
  <PublicShell :path="currentPath" :available-locales="availableLocales">
    <div class="mx-auto w-full max-w-6xl px-4 py-10 lg:px-8">
      <!--
        Hero chỉ render khi có article featured (hoặc fallback). Blog rỗng vẫn
        là landing hợp lệ: tiêu đề + listing rỗng, không hero rỗng — và "tiêu
        đề" ở đây là `<h1>` thật: blog rỗng cũng không được mất heading cấp
        một (hierarchy cho screen reader + tín hiệu chủ đề cho SEO), nên
        `ui.blog` làm h1 fallback khi không có hero.
      -->
      <h1 v-if="!featured" class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {{ ui.blog }}
      </h1>
      <article v-if="featured">
        <!--
          Nhãn chỉ khi article hero thực sự `featured: true` — fallback bài
          mới nhất không phải featured, gắn nhãn đó là nói dối người đọc.
        -->
        <p
          v-if="featured.featured"
          class="text-sm font-semibold uppercase tracking-wide text-slate-500"
        >
          {{ ui.featured }}
        </p>
        <!--
          Cover của hero: phần tử LCP của landing, `fetchpriority="high"` để
          browser ưu tiên tải ngay; `aspect-video` + `object-cover` giữ tỉ lệ
          khung bất kể kích thước gốc. Featured không cover thì không render
          `<img>` — không hình hỏng.
        -->
        <img
          v-if="featured.cover"
          :src="featured.cover.src"
          :alt="featured.cover.alt"
          class="mt-4 aspect-video w-full max-w-4xl rounded-lg object-cover"
          fetchpriority="high"
        />
        <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          <a
            :href="featured.path"
            :aria-label="`${featured.title} — ${ui.readMore}`"
            class="hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            {{ featured.title }}
          </a>
        </h1>
        <p class="mt-3 max-w-2xl text-lg leading-relaxed text-slate-600">
          {{ featured.description }}
        </p>
        <p class="mt-3 text-sm text-slate-500">
          <time :datetime="featured.date">{{ formatArticleDate(featured.date, locale) }}</time>
          <span aria-hidden="true"> · </span>
          <span>{{ ui.writtenBy }} {{ featured.author }}</span>
        </p>
        <div class="mt-3">
          <BlogTagList :tags="featured.tags" :label="ui.tags" />
        </div>
      </article>

      <section class="mt-12">
        <h2 class="text-xl font-semibold tracking-tight text-slate-900">{{ ui.latest }}</h2>
        <ul class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="article in rest" :key="article.path">
            <BlogArticleCard :article="article" :locale="locale" :ui="ui" />
          </li>
        </ul>
      </section>
    </div>
  </PublicShell>
</template>
