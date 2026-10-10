<!--
  Trang landing của blog — `/en/blog`, `/vi/blog`.

  Route dùng chung `[[...slug]].vue` cho cả landing lẫn article, nên view nhận
  dữ liệu đã resolve từ route và chỉ render. Hero là article featured (hoặc
  fallback bài mới nhất — logic trong `blog-articles.ts`), dưới đó là listing
  các article còn lại mới nhất trước.
-->
<script setup lang="ts">
import type { PublicLocale } from '@ecoma-io/i18n-public';
import { PublicShell, buildPublicPath } from '@ecoma-io/layout-public';
import BlogArticleCard from '~/components/blogs/BlogArticleCard.vue';
import BlogTagList from '~/components/blogs/BlogTagList.vue';
import type { BlogArticleSummary } from '~/utils/blog-articles';
import type { BlogUiStrings } from '~/utils/blog-ui-strings';

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
 * Landing path canonical của mount — dựng qua builder của `layout-public`
 * thay vì concatenate `/${locale}/blog`, để landing đi đúng cùng contract
 * topology với mọi path public khác của app. Builder trả discriminated union;
 * với mount hợp lệ nhánh `localized` luôn xảy ra, nên extract sẵn path.
 */
const builtPath = buildPublicPath({ locale, mount: 'blog' });
const currentPath = builtPath.kind === 'localized' ? builtPath.path : '/';

/** Ngày hiển thị theo locale — demo content vẫn format đúng locale. */
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
  <PublicShell :path="currentPath" :available-locales="availableLocales">
    <div class="mx-auto w-full max-w-6xl px-4 py-10 lg:px-8">
      <!--
        Hero chỉ render khi có article featured (hoặc fallback). Blog rỗng vẫn
        là landing hợp lệ: tiêu đề + listing rỗng, không hero rỗng.
      -->
      <article v-if="featured">
        <p class="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {{ ui.featured }}
        </p>
        <!--
          Cover của hero: ảnh lớn nhất trang, nên eager decode; `aspect-video`
          + `object-cover` giữ tỉ lệ khung bất kể kích thước gốc. Featured
          không cover thì không render `<img>` — không hình hỏng.
        -->
        <img
          v-if="featured.cover"
          :src="featured.cover.src"
          :alt="featured.cover.alt"
          class="mt-4 aspect-video w-full max-w-4xl rounded-lg object-cover"
          decoding="async"
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
          <time :datetime="featured.date">{{ formatDate(featured.date, locale) }}</time>
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
            <BlogArticleCard :article="article" :ui="ui" />
          </li>
        </ul>
      </section>
    </div>
  </PublicShell>
</template>
