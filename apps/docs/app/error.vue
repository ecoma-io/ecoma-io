<!--
  Error page của docs — bề mặt duy nhất render lỗi HTTP của app.

  Trên SSR, Nuxt render file này cho mọi `createError` thoát ra từ page
  (route [[...slug]].vue ném 404 khi document không tồn tại). Với docs,
  quan trọng hơn: preset `static` prerender file này thành
  `.output/public/404.html`, và wrangler (`not_found_handling: "404-page"`)
  phục vụ nó cho mọi request không khớp asset — với HTTP 404 thật.

  Locale: một file 404.html tĩnh duy nhất **không biết** URL bị lỗi thuộc
  locale nào, nên trang render bằng locale mặc định khi build (`en` — khai
  báo tường minh, không suy từ thứ tự `PUBLIC_LOCALES`). Copy cho locale
  khác vẫn tồn tại trong `docs-ui-strings` (bổ sung locale thiếu dịch là lỗi
  type), nhưng chỉ dùng được khi trang được render theo request — không phải
  mode phục vụ của docs.

  Shell: `PublicShell` giữ chrome (header/footer/nav) nhất quán với mọi page
  docs khác. `path` là pathname canonical của docs landing cho locale đó —
  pathname thật của request bị lỗi không thể biết trước trong file tĩnh, và
  shell cần một pathname hợp lệ để state chrome không rơi vào nhánh
  `root`/`invalid` (mất locale-aware link).

  Chỉ 404 được map sang shared page. 401/500/unknown KHÔNG rơi vào
  `NotFoundPage` — chúng giữ fallback mặc định của Nuxt (`error.statusCode`
  khác 404), đúng ranh giới: `libs/error-pages` là pure presenter, app sở hữu
  quyết định map lỗi nào sang trang nào.

  CTA là `<a href>` thuần (không `NuxtLink`): trang 404.html tĩnh không có
  hydration, mọi điều hướng phải hoạt động không JavaScript.
-->
<script setup lang="ts">
import { NotFoundPage, type ErrorPageContent } from '@ecoma-io/error-pages';
import { PublicShell, buildPublicPath } from '@ecoma-io/layout-public';
import type { NuxtError } from '#app';
import { docsUiStrings } from '~/utils/docs-ui-strings';

const { error } = defineProps<{
  readonly error: NuxtError;
}>();

/** Locale mặc định khi build — file tĩnh duy nhất không chọn locale theo request. */
const BUILD_DEFAULT_LOCALE = 'en' as const;

const strings = docsUiStrings(BUILD_DEFAULT_LOCALE);

/**
 * CTA quay về docs landing. `buildPublicPath` có thể từ chối (topology đổi)
 * — khi đó fallback về locale-root thay vì render link hỏng.
 */
const docsRoot = buildPublicPath({ locale: BUILD_DEFAULT_LOCALE, mount: 'docs' });
const backHref = docsRoot.kind === 'localized' ? docsRoot.path : `/${BUILD_DEFAULT_LOCALE}`;

/**
 * Nội dung đã localize cho trang 404 — hằng số module-level: không phụ thuộc
 * runtime nào, nên HTML prerendered deterministic.
 */
const notFoundContent: ErrorPageContent = {
  title: strings.notFoundTitle,
  description: strings.notFoundDescription,
  primaryAction: { label: strings.notFoundBackToDocs, href: backHref },
};

/** 404 thật sự (kể cả khi `error.message` khác) — các status khác giữ fallback. */
const isNotFound = computed(() => error.status === 404);

/** `<title>` của trang lỗi — docs đặt title theo template như page thường. */
useHead({ title: strings.notFoundTitle });
</script>

<template>
  <PublicShell v-if="isNotFound" :path="backHref">
    <NotFoundPage :content="notFoundContent" />
  </PublicShell>
  <!--
    Status khác 404 (500, 401…): KHÔNG map sang shared error page. Fallback
    mặc định của Nuxt giữ nguyên hành vi cũ — task cấm mở rộng map lỗi.
    `<pre>` không được style thêm: đây là nhánh hy hữu, không phải bề mặt
    product.
  -->
  <main v-else class="grid min-h-dvh place-items-center bg-white px-4 py-16">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-slate-900">
        {{ error.status ?? error.statusCode }} — {{ error.statusText ?? error.statusMessage }}
      </h1>
      <p class="mt-2 text-sm text-slate-600">{{ error.message }}</p>
    </div>
  </main>
</template>
