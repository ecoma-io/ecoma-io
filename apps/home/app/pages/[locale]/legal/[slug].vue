<script setup lang="ts">
import { PublicShell } from '@ecoma-io/layout-public';
import { parseLegalPage } from '~/domain/legal-locale';
import { buildLegalSeo } from '~/domain/legal-seo';
import { LEGAL_CONTENT } from '~/domain/legal-content';

/**
 * Route `/en/legal/<slug>` và `/vi/legal/<slug>` — các trang policy của Home.
 *
 * Cùng nguồn pathname với `[locale]/index.vue`: trên server `to.path` đã bị
 * h3 percent-decode trước khi `validate` nhìn thấy, nên luật strict
 * canonicality dùng pathname **thô** từ `useRequestURL().pathname`; trên
 * client path đến thẳng từ `window.location`, nên `to.path` là nguồn thô ở đó
 * (chi tiết đầy đủ trong comment của `[locale]/index.vue`).
 *
 * Thứ tự `validate` rồi mới tới `setup`: route bị từ chối trả 404 và
 * component không render, nên mọi truy cập vào content bên dưới đã được bảo
 * đảm là một cặp (locale, slug) hợp lệ.
 */
definePageMeta({
  validate: (to) => {
    const rawPathname = import.meta.server ? useRequestURL().pathname : to.path;
    return parseLegalPage(rawPathname) !== undefined;
  },
});

const route = useRoute();

/**
 * Cặp (locale, slug) của trang — parse lại từ pathname, không đọc
 * `route.params` (dữ liệu đã decode của router, không phải nguồn chân lý của
 * URL). `validate` đã chặn mọi pathname khác, nên nhánh `undefined` ở đây
 * thuần phòng thủ: biến "trang không xác định" thành 404 thay vì fallback
 * âm thầm sang một trang khác dưới URL này.
 */
const page = parseLegalPage(route.path);
if (page === undefined) {
  throw createError({ statusCode: 404, statusMessage: 'Page Not Found' });
}

const { locale, slug } = page;
const content = LEGAL_CONTENT[locale][slug];
const seo = buildLegalSeo(locale, slug, content);

/* Root `/` không emit SEO metadata, nhưng các trang policy **serve content**
 * thật nên `<head>` đầy đủ: canonical + hreflang là URL tuyệt đối dưới
 * production origin (`~/domain/home-origin`), không phải origin của request
 * đang phục vụ. Xem `buildLegalSeo`. */
useHead({
  htmlAttrs: { lang: seo.lang },
  title: seo.title,
  meta: [{ name: 'description', content: seo.description }],
  link: [{ rel: 'canonical', href: seo.canonicalUrl }, ...seo.alternates],
});
</script>

<template>
  <!--
    `PublicShell` là nguồn duy nhất của header/footer/navigation; trang đưa
    `route.path` vào để shell tự parse một lần. Không truyền
    `availableLocales`: policy tồn tại ở mọi locale của registry.

    Nội dung policy là văn bản dài: container giới hạn đọc bằng `max-w-3xl`
    (khác landing dùng `max-w-6xl`), mỗi đề mục là một `<section>` heading h2
    + các đoạn văn.
  -->
  <PublicShell :path="route.path">
    <div class="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
      <article class="flex flex-col gap-8 py-16">
        <header class="flex flex-col gap-3">
          <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {{ content.heading }}
          </h1>
          <p class="text-base leading-relaxed text-slate-600">{{ content.description }}</p>
        </header>

        <section
          v-for="section in content.sections"
          :key="section.heading"
          class="flex flex-col gap-3 border-t border-slate-200 pt-6 text-slate-800"
        >
          <h2 class="text-xl font-semibold tracking-tight text-slate-900">
            {{ section.heading }}
          </h2>
          <p
            v-for="paragraph in section.paragraphs"
            :key="paragraph"
            class="text-sm leading-relaxed text-slate-700"
          >
            {{ paragraph }}
          </p>
        </section>
      </article>
    </div>
  </PublicShell>
</template>
