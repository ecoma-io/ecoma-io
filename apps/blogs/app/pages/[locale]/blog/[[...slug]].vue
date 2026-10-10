<!--
  Route duy nhất phục vụ toàn bộ content của blog:
  `apps/blogs/app/pages/[locale]/blog/[[...slug]].vue`

  Route này **validate bằng chính pathname thô** qua `isBlogRoute` (dựng trên
  `parsePublicLayoutPath` của `layout-public`), rồi chỉ nhận
  `kind === 'localized' && mount === 'blog'`. Nguồn pathname khác nhau theo môi
  trường: trên server h3 percent-decode request path **trước** khi vue-router
  nhìn thấy (nên `to.path` đã bị decode), trong khi `useRequestURL().pathname`
  vẫn là byte gốc trên wire; client thì `to.path` giữ nguyên encoding.
  `validate` chọn nguồn theo môi trường, nhờ vậy URL không canonical
  (`/%65n/blog/...`) bị từ chối thay vì được phục vụ dưới dạng đã decode. Sau
  `validate`, mọi pathname vào được setup đều canonical nên phần còn lại của
  route dùng thẳng `route.path`. `isBlogRoute` nhận:

  - `/en/blog`, `/vi/blog`, `/en/blog/foo`, `/vi/blog/foo/bar` — hợp lệ;
  - `/fr/blog`, `/EN/blog`, `/en/blog/`, `/en/docs`, `/en/blogging` — bị
    `validate` từ chối;
  - `/en/blog/unknown` hợp lệ về topology, route chạy tiếp và 404 vì content
    không tồn tại.

  Blogs chỉ sở hữu mount `blog`; `/en/docs` thuộc deploy unit khác và `/` là
  locale-resolution entry point — route này không phục vụ chúng.

  Toàn bộ dữ liệu của trang được resolve ở **route** (query, featured, related,
  prev/next, SEO); component view chỉ render. Nhờ vậy không component nào tự
  query và SSR/hydrate nhìn thấy đúng cùng một dữ liệu.

  Query dùng `path(route.path)` — key ổn định cho SSR, không tự dựng lại URL từ
  `params.slug`. Query trước hết cho document; landing không có document ở
  `/en/blog` (chỉ article có file content), nên landing được nhận diện qua
  `remainder === ''` và **không** query document.

  Ordering dùng số prefix trong tên file (`1.url-model`): `path` bị strip prefix
  còn `stem` giữ nguyên, nên prev/next theo `stem ASC` vừa tôn trọng thứ tự
  editorial vừa deterministic.
-->
<script setup lang="ts">
import { PUBLIC_LOCALES, type PublicLocale } from '@ecoma-io/i18n-public';
import { buildPublicPath } from '@ecoma-io/layout-public';
import BlogArticleView from '~/components/blogs/BlogArticleView.vue';
// Import tường minh (giống apps/docs): auto-import đăng ký component với
// prefix thư mục (`BlogsBlogLandingView`), nên tên trong template
// (`BlogLandingView`) không resolve được — SSR render rỗng im lặng.
import BlogLandingView from '~/components/blogs/BlogLandingView.vue';
import {
  pickFeaturedArticle,
  pickRelatedArticles,
  orderArticlesByDateDesc,
  type BlogArticleSummary,
} from '~/utils/blog-articles';
import { blogUiStrings } from '~/utils/blog-ui-strings';
import { buildBlogSeo } from '~/utils/blog-seo';
import { isBlogRoute, parseBlogRoute } from '~/utils/blog-routing';

definePageMeta({
  /**
   * Nguồn pathname khác nhau theo môi trường, giống pattern của
   * `apps/home/app/pages/[locale]/index.vue`: trên server h3 đã percent-decode
   * request path trước khi `validate` nhìn thấy (nên `to.path` là bản đã
   * decode), còn `useRequestURL().pathname` đọc từ `originalUrl` — byte gốc
   * chưa decode. Client thì `to.path` giữ nguyên encoding. Validate đúng pathname
   * thô để URL không canonical (`/%65n/blog/...`) bị từ chối thay vì được phục vụ.
   */
  validate: (to) => {
    const rawPathname = import.meta.server ? useRequestURL().pathname : to.path;
    return isBlogRoute(rawPathname);
  },
});

const route = useRoute();

/**
 * Locale của pathname đã được `validate` chấp nhận: `parseBlogRoute` trả layout
 * blog (locale đã kiểm tra trong registry, mount đúng `blog`), nên ở đây không
 * cần suy đoán lại từ `params` (`params.locale` là string thô của router, không
 * phải locale đã validate).
 */
const layout = computed(() => parseBlogRoute(route.path));
const locale = computed<PublicLocale>(() => layout.value?.locale ?? 'en');

/** Phần pathname còn lại sau `<locale>/blog` — `''` nghĩa là landing. */
const remainder = computed(() => layout.value?.remainder ?? '');
const isBlogLanding = computed(() => remainder.value === '');

/**
 * Landing path canonical của mount — dùng cho SEO fallback title và link "all
 * posts" khi `buildPublicPath` từ chối (không xảy ra với mount hợp lệ, nhưng
 * kiểu kết quả là discriminated union nên phải thu hẹp).
 */
const blogRoot = computed(() => buildPublicPath({ locale: locale.value, mount: 'blog' }));

/**
 * Article của pathname hiện tại — nguồn nội dung duy nhất của article page.
 * Không chạy trên landing: `/en/blog` không có document nào (chỉ article có
 * file content), và cố query `.path('/en/blog')` sẽ trả `null` vô nghĩa.
 */
const { data: page } = await useAsyncData(`blog:page:${route.path}`, () =>
  isBlogLanding.value ? Promise.resolve(null) : queryCollection('blog').path(route.path).first(),
);

if (page.value === null && !isBlogLanding.value) {
  throw createError({ statusCode: 404, statusMessage: 'Article not found' });
}

/**
 * Toàn bộ article của **locale hiện tại**, mới nhất trước — dùng chung cho
 * landing (hero + listing) và article page (related, base của pager).
 *
 * Lọc theo locale ở **tầng query** (`path` LIKE `/<locale>/blog/%`), không lọc
 * lại ở UI: `path` của mọi item trong collection luôn bắt đầu bằng segment
 * locale (`/en/blog/...`), nên pattern này khớp đúng tập article của locale và
 * không bao giờ trộn hai locale.
 *
 * `order` ở đây chỉ để listing; featured/related giữ bất biến riêng của chúng
 * trong `blog-articles.ts` (sort lại từ input, không giả định input đã sort).
 */
const { data: articles } = await useAsyncData(`blog:articles:${locale.value}`, async () => {
  const records = await queryCollection('blog')
    .where('path', 'LIKE', `/${locale.value}/blog/%`)
    .all();
  const summaries: BlogArticleSummary[] = records.map((record) => ({
    path: record.path,
    stem: record.stem,
    title: record.title ?? '',
    description: record.description ?? '',
    date: record.date ?? '',
    author: record.author ?? '',
    tags: record.tags ?? [],
    featured: record.featured ?? false,
  }));
  return orderArticlesByDateDesc(summaries);
});

const articlesForLocale = computed<readonly BlogArticleSummary[]>(() => articles.value ?? []);

/**
 * Article hiện tại (article page) — suy ra từ danh sách đã lọc theo locale để
 * summary/related/pager dùng đúng một nguồn dữ liệu.
 */
const currentArticle = computed<BlogArticleSummary | undefined>(() =>
  articlesForLocale.value.find((article) => article.path === route.path),
);

/** Hero của landing — featured, fallback bài mới nhất, `undefined` khi blog rỗng. */
const featuredArticle = computed(() => pickFeaturedArticle(articlesForLocale.value));

/** Listing còn lại sau hero — khi không render hero thì là toàn bộ danh sách. */
const restArticles = computed<readonly BlogArticleSummary[]>(() => {
  const list = articlesForLocale.value;
  const featured = featuredArticle.value;
  if (!featured) {
    return list;
  }
  return list.filter((article) => article.path !== featured.path);
});

/**
 * Related articles của article hiện tại — cùng tag chính, cùng locale, đã loại
 * article hiện tại (bất biến trong `pickRelatedArticles`).
 */
const relatedArticles = computed<readonly BlogArticleSummary[]>(() => {
  const current = currentArticle.value;
  return current ? pickRelatedArticles(articlesForLocale.value, current, 3) : [];
});

/**
 * Locale nào thực sự có bản dịch của **resource này** — suy ra từ chính
 * content, không phải giả định. Resource được định danh bằng pathname bỏ segment
 * locale; một locale được coi là có bản dịch khi tồn tại article ở đúng đường
 * dẫn đó. Nhờ vậy locale switcher của `PublicShell` chỉ link tới bản dịch có
 * thật, và một article chỉ có tiếng Anh không hiện link tiếng Việt hỏng.
 *
 * Một **round-trip duy nhất** cho mọi locale: dựng trước candidate path của
 * từng registry locale rồi truy một lần với `where('path', 'IN', paths)` —
 * thay vì một query `.first()` mỗi locale. Locale nào có path trong kết quả là
 * locale đó có bản dịch. Candidate path bị builder từ chối (topology — ví dụ
 * remainder rơi vào mount lồng nhau) đơn giản không nằm trong `IN`, tức locale
 * đó không có bản dịch của resource.
 *
 * **Landing là trường hợp đặc biệt**: `/en/blog` không phải document của
 * collection (chỉ article có file content), nên kiểm tra theo content luôn
 * trả rỗng cho landing dù bản dịch landing luôn tồn tại — mount landing là
 * route tĩnh, có mặt ở mọi locale của registry. Vì vậy landing suy availability
 * từ **danh sách article theo từng locale** (locale có ít nhất một article là
 * locale có blog), còn article kiểm tra theo document như docs.
 */
const { data: translationAvailability } = await useAsyncData(
  `blog:translations:${route.path}`,
  async () => {
    // Landing: locale nào có ít nhất một article thì locale đó có landing.
    // Hai query theo locale — chấp nhận được vì chỉ chạy trên 2 landing.
    if (isBlogLanding.value) {
      const localesWithBlog: PublicLocale[] = [];
      for (const definition of PUBLIC_LOCALES) {
        const landing = buildPublicPath({ locale: definition.code, mount: 'blog' });
        if (landing.kind !== 'localized') {
          continue;
        }
        const records = await queryCollection('blog')
          .select('path')
          .where('path', 'LIKE', `${landing.path}/%`)
          .limit(1)
          .all();
        if (records.length > 0) {
          localesWithBlog.push(definition.code);
        }
      }
      return localesWithBlog;
    }
    const resourceRemainder = remainder.value;
    const candidates = PUBLIC_LOCALES.flatMap((definition) => {
      const built = buildPublicPath({
        locale: definition.code,
        mount: 'blog',
        path: resourceRemainder,
      });
      return built.kind === 'localized' ? [built.path] : [];
    });
    // `IN ()` không phải SQL hợp lệ: không candidate nào thì không query —
    // không locale nào có bản dịch.
    if (candidates.length === 0) {
      return [];
    }
    const records = await queryCollection('blog')
      .select('path')
      .where('path', 'IN', candidates)
      .all();
    const existingPaths = new Set(records.map((record) => record.path));
    return PUBLIC_LOCALES.flatMap((definition) => {
      const built = buildPublicPath({
        locale: definition.code,
        mount: 'blog',
        path: resourceRemainder,
      });
      return built.kind === 'localized' && existingPaths.has(built.path) ? [definition.code] : [];
    });
  },
);

/**
 * Locale context truyền cho shell: locale hiện tại luôn nằm trong context (do
 * `resolveLocaleContext` bảo đảm), cộng các locale có bản dịch thật.
 */
const availableLocales = computed<readonly PublicLocale[]>(
  () => translationAvailability.value ?? [],
);

/**
 * Article liền trước / liền sau **trong cùng locale**.
 *
 * Dùng cùng danh sách đã lọc theo locale và đã sort (`date` DESC, `stem` ASC —
 * xem `orderArticlesByDateDesc`), nên cặp prev/next không bao giờ nhảy sang
 * locale khác; biên danh sách cho `undefined` (không bọc vòng).
 *
 * Không dùng `queryCollectionItemSurroundings` ở đây: hàm đó sort theo `stem`
 * trên **toàn collection** mà không lọc được theo locale ở tầng SQL theo cách
 * bảo đảm thứ tự editorial (cây navigation trộn hai locale trước khi lọc), và
 * landing `index.md` của từng article cũng lọt vào sequence. Danh sách phẳng
 * đã sort trong tay là đúng nguồn duy nhất cho pager của blog phẳng.
 */
const previousArticle = computed(() => {
  const current = currentArticle.value;
  if (!current) {
    return undefined;
  }
  const list = articlesForLocale.value;
  const index = list.findIndex((article) => article.path === current.path);
  const item = index > 0 ? list[index - 1] : undefined;
  return item ? { path: item.path, title: item.title } : undefined;
});
const nextArticle = computed(() => {
  const current = currentArticle.value;
  if (!current) {
    return undefined;
  }
  const list = articlesForLocale.value;
  const index = list.findIndex((article) => article.path === current.path);
  const item = index >= 0 && index < list.length - 1 ? list[index + 1] : undefined;
  return item ? { path: item.path, title: item.title } : undefined;
});

/**
 * SEO: `lang` từ registry locale (hreflang `vi-VN` chứ không phải code `vi`),
 * title theo template `<article title> · Ecoma Blog`, description từ
 * frontmatter, canonical là URL hiện tại, và alternate hreflang cho **mọi
 * locale có bản dịch thật** — dựng qua `switchLocale`, không ghép chuỗi. Toàn
 * bộ thuật toán nằm trong `blog-seo.ts` (đã unit test).
 */
const seo = computed(() =>
  buildBlogSeo({
    pathname: route.path,
    locale: locale.value,
    title:
      currentArticle.value?.title ??
      page.value?.title ??
      (blogRoot.value.kind === 'localized' ? undefined : undefined),
    description: currentArticle.value?.description ?? page.value?.description,
    availableLocales: availableLocales.value,
  }),
);

useHead(() => ({
  htmlAttrs: { lang: seo.value.lang },
  title: seo.value.title,
  // Description rỗng thì **không** emit meta — meta `content=""` là metadata
  // sai (các crawler hiện trích snippet từ nội dung khi thiếu description) và
  // prerendered HTML sẽ mang rác tĩnh khó thay sau khi deploy.
  meta:
    seo.value.description === '' ? [] : [{ name: 'description', content: seo.value.description }],
  link: [
    { rel: 'canonical' as const, href: seo.value.canonical },
    ...seo.value.alternates.map((alternate) => ({
      rel: 'alternate' as const,
      hreflang: alternate.hreflang,
      href: alternate.href,
    })),
  ],
}));
</script>

<template>
  <BlogLandingView
    v-if="isBlogLanding"
    :locale="locale"
    :featured="featuredArticle"
    :rest="restArticles"
    :available-locales="availableLocales"
    :ui="blogUiStrings(locale)"
  />
  <BlogArticleView
    v-else-if="currentArticle && page"
    :locale="locale"
    :page="page"
    :summary="currentArticle"
    :related="relatedArticles"
    :previous="previousArticle"
    :next="nextArticle"
    :available-locales="availableLocales"
    :ui="blogUiStrings(locale)"
  />
</template>
