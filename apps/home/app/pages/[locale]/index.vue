<script setup lang="ts">
import { PublicShell } from '@ecoma-io/layout-public';
import { parseHomeLocaleRoot } from '~/domain/home-locale';
import { buildHomeSeo } from '~/domain/home-seo';
import { HOME_CONTENT } from '~/domain/home-content';

/**
 * Route `/en` và `/vi` — locale-root surface của Home.
 *
 * File-based route `[locale]/index.vue` chỉ khớp pathname **một segment** sau
 * `/`, nên `/en/foo` không bao giờ vào được page này. Việc còn lại là bảo
 * đảm segment đó là một **locale hợp lệ** và **không** có gì khác lạ trong
 * pathname (`/en/`, `/EN`, `/%65n`).
 *
 * Thứ tự `validate` rồi mới tới `setup`: route bị `validate` từ chối trả 404
 * và component không render, nên mọi truy cập vào content bên dưới đã được
 * bảo đảm locale hợp lệ.
 */
definePageMeta({
  /**
   * Chỉ nhận pathname là locale-root của Home.
   *
   * Nguồn pathname khác nhau theo môi trường, và đây là điểm **quan trọng
   * nhất** của cả route. Trên server, `to.path` đã bị **percent-decode**
   * trước khi `validate` nhìn thấy nó: `/%65n` đến đây dưới dạng `/en`.
   * Dùng `to.path` ở đó sẽ hợp lệ hoá một URL **không** canonical và biến
   * `%65n` thành đường vòng qua strict canonicality.
   *
   * Việc decode **không** do vue-router: `router.resolve('/%65n').path` giữ
   * nguyên `/%65n` trên cả vue-router 4.6.4 (dependency gốc) lẫn 5.3.1 (bản
   * Nuxt bundle) — đã kiểm chứng trực tiếp (chỉ `params` được decode:
   * `params.locale === 'en'`). Chuỗi thật trong SSR là:
   *
   * 1. h3 chuẩn hoá request path khi vào app: `createAppEventHandler` tính
   *    `_decodePath(event.node.req.url)` (percent-decode phần path, giữ nguyên
   *    query) rồi gán vào `event._path` — và getter `event.path` đọc chính
   *    `_path` đó (`h3/dist/index.mjs`). Nên **`event.path` là pathname đã
   *    decode**, còn `event.node.req.originalUrl` (byte gốc trên wire) thì
   *    không;
   * 2. Nitro dựng `ssrContext` từ path đó: `createSSRContext(event)` đặt
   *    `ssrContext.url = encodeEventPath(event.path)`
   *    (`@nuxt/nitro-server/dist/runtime/utils/renderer/app.mjs`), tức từ
   *    pathname **đã decode** ở bước 1;
   * 3. plugin router của Nuxt lấy `initialURL = nuxtApp.ssrContext.url` rồi
   *    `router.push(initialURL)` (`nuxt/dist/pages/runtime/plugins/router.js`)
   *    — vì vue-router không decode, `to.path` mang đúng giá trị đã decode
   *    từ bước 1.
   *
   * `useRequestURL()` trên server đọc `event.node.req.originalUrl` trước
   * `event.path` (`h3` `getRequestURL`: `event.node.req.originalUrl ||
   * event.path`, cộng `useRequestURL` của Nuxt gọi thẳng `getRequestURL`),
   * nên `.pathname` của nó vẫn là **byte gốc chưa decode** — đúng thứ cần cho
   * strict canonicality, và đã kiểm chứng bằng probe: request
   * `/%65n` cho `useRequestURL().pathname === '/%65n'` nhưng `event.path` và
   * `to.path` trong `validate` đều là `/en`.
   *
   * Trên client, path đến từ `window.location` qua `createCurrentLocation`
   * của Nuxt (không qua h3), nên `to.path` giữ nguyên encoding — `to.path` là
   * nguồn **thô** ở đó.
   *
   * Vì vậy server lấy pathname thô từ request URL gốc chưa bị h3 chuẩn hoá
   * (`useRequestURL().pathname`), còn client dùng `to.path`. Hai nguồn này
   * được chọn đúng theo từng môi trường thay vì dùng chung một nguồn đã bị
   * decode ở một phía.
   *
   * Kiểm tra luôn đi qua `parseHomeLocaleRoot` → `parsePublicPath` của
   * `i18n-public` với so khớp exact: không decode, không lowercase, không
   * strip slash, nên `/%65n`, `/EN`, `/Vi`, `/en/` và mọi pathname có
   * remainder đều bị từ chối mà không cần bảng locale thứ hai.
   */
  validate: (to) => {
    const rawPathname = import.meta.server ? useRequestURL().pathname : to.path;
    return parseHomeLocaleRoot(rawPathname) !== undefined;
  },
});

const route = useRoute();

/**
 * Locale của trang — parse lại từ pathname, không đọc `route.params.locale`.
 *
 * `route.params.locale` là dữ liệu đã decode của router; pathname mới là
 * nguồn chân lý của URL. `validate` đã chặn mọi pathname không phải
 * locale-root, nên nhánh `undefined` ở đây thuần phòng thủ: nó biến "locale
 * không xác định" thành 404 thay vì fallback âm thầm sang `en` — fallback
 * kiểu đó sẽ phục vụ nội dung của một locale dưới URL của locale khác, và
 * tạo ra một URL không self-canonical.
 */
const locale = parseHomeLocaleRoot(route.path);
if (locale === undefined) {
  throw createError({ statusCode: 404, statusMessage: 'Page Not Found' });
}

const content = HOME_CONTENT[locale];
const seo = buildHomeSeo(locale, content);

/* Root `/` không emit SEO metadata — `/` chỉ là locale-resolution entry point,
 * không serve content (`docs/overview/01-architecture.md` A13), và `<head>`
 * của nó thuộc về redirect 302 tới `/en`, không phải một trang.
 *
 * `canonical` và `hreflang` là URL tuyệt đối dưới production origin
 * (`~/domain/home-origin`) — không phải pathname tương đối, và không phải
 * origin của request đang phục vụ. Xem `buildHomeSeo` để biết vì sao. */
useHead({
  htmlAttrs: { lang: seo.lang },
  title: seo.title,
  meta: [{ name: 'description', content: seo.description }],
  link: [{ rel: 'canonical', href: seo.canonicalUrl }, ...seo.alternates],
});
</script>

<template>
  <!--
    `PublicShell` là nguồn duy nhất của header/footer/navigation; Home chỉ đưa
    pathname hiện tại vào đó (`route.path`, không phải `route.fullPath`) để
    shell tự parse một lần. `route.path` không chứa query/hash nên luôn có
    dạng pathname mà `parsePublicLayoutPath` nhận.

    Không truyền `availableLocales`: Home tồn tại ở **mọi** locale của registry,
    nên mặc định của shell (toàn bộ registry) mới là đúng — không resource
    nào của Home bị giới hạn locale.
  -->
  <PublicShell :path="route.path">
    <div class="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      <section class="flex flex-col gap-3">
        <h1 class="text-4xl font-bold tracking-tight">{{ content.heading }}</h1>
        <p class="text-lg text-gray-600">{{ content.description }}</p>
      </section>

      <section class="flex flex-col gap-3 text-gray-800">
        <p v-for="paragraph in content.intro" :key="paragraph">{{ paragraph }}</p>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-semibold">{{ content.platformLabel }}</h2>
        <ul class="flex list-disc flex-col gap-2 pl-5 text-gray-800">
          <li v-for="point in content.platformPoints" :key="point">{{ point }}</li>
        </ul>
      </section>
    </div>
  </PublicShell>
</template>
