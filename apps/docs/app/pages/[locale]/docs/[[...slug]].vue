<!--
  Route duy nhất phục vụ toàn bộ content của docs:
  `apps/docs/app/pages/[locale]/docs/[[...slug]].vue`

  Route này **validate bằng chính pathname thật** (`route.path`) qua
  `isDocsRoute` (dựng trên `parsePublicLayoutPath` của `layout-public`), rồi chỉ
  nhận `kind === 'localized' && mount === 'docs'`. Nhờ vậy:

  - `/en/docs`, `/vi/docs`, `/en/docs/getting-started`, `/vi/docs/foo/bar` —
    hợp lệ;
  - `/fr/docs`, `/EN/docs`, `/en/docs/`, `/en/blog` — bị `validate` từ chối;
  - `/en/docs/api` và `/en/docs/api/foo` resolve thành mount `docs/api` nên bị
    từ chối — boundary của `api-reference` không bị docs chiếm;
  - `/en/docs/unknown` hợp lệ về topology, route chạy tiếp và 404 vì content
    không tồn tại.

  Toàn bộ dữ liệu của trang được resolve ở **route** (query, navigation,
  breadcrumbs, prev/next, SEO); component `DocsPageView` chỉ render. Nhờ vậy
  không component nào tự query và SSR/hydrate nhìn thấy đúng cùng một dữ liệu.

  Query dùng `path(route.path)` — key ổn định cho SSR, không tự dựng lại URL từ
  `params.slug`. Query trước hết cho document; không có document thì 404 luôn,
  không render trang rỗng.
-->
<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content';
import { PUBLIC_LOCALES, type PublicLocale } from '@ecoma-io/i18n-public';
import { buildPublicPath } from '@ecoma-io/layout-public';
import { findPageBreadcrumb } from '@nuxt/content/utils';
import DocsLandingView from '~/components/docs/DocsLandingView.vue';
import DocsPageView from '~/components/docs/DocsPageView.vue';
import { docsUiStrings } from '~/utils/docs-ui-strings';
import { getSidebarItems } from '~/utils/docs-navigation';
import { buildDocsBreadcrumbs } from '~/utils/docs-breadcrumbs';
import { buildDocsSeo } from '~/utils/docs-seo';
import { isDocsRoute, parseDocsRoute } from '~/utils/docs-routing';

definePageMeta({
  validate: (route) => isDocsRoute(route.path),
});

const route = useRoute();

/**
 * Locale của pathname đã được `validate` chấp nhận: `parseDocsRoute` trả layout
 * docs (locale đã kiểm tra trong registry, mount đúng `docs`), nên ở đây không
 * cần suy đoán lại từ `params` (`params.locale` là string thô của router, không
 * phải locale đã validate).
 */
const layout = computed(() => parseDocsRoute(route.path));
const locale = computed<PublicLocale>(() => layout.value?.locale ?? 'en');

/** Document của pathname hiện tại — nguồn nội dung duy nhất của trang. */
const { data: page } = await useAsyncData(`docs:page:${route.path}`, () =>
  queryCollection('docs').path(route.path).first(),
);

if (page.value === null) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found' });
}

/**
 * Cây navigation của collection, **lọc theo locale hiện tại** — dùng chung cho
 * sidebar, breadcrumbs và kiểm tra tồn tại của bản dịch. Query một lần cho mỗi
 * locale nên điều hướng qua lại giữa các page cùng locale không query lại.
 */
const { data: navigation } = await useAsyncData(`docs:navigation:${locale.value}`, () =>
  queryCollectionNavigation('docs').where('path', 'LIKE', `/${locale.value}/%`),
);

/**
 * Description của các section index, keyed by path — dùng cho card trên docs
 * landing. Lấy từ chính content (`description` ở frontmatter) nên landing không
 * phải hard-code mô tả của section; query riêng vì `queryCollectionNavigation`
 * chỉ trả metadata điều hướng (title/path), không mang `description`.
 */
const { data: sectionDescriptions } = await useAsyncData(
  `docs:section-descriptions:${locale.value}`,
  async () => {
    const records = await queryCollection('docs')
      .select('path', 'description')
      .where('path', 'LIKE', `/${locale.value}/docs/%`)
      .all();
    return Object.fromEntries(records.map((record) => [record.path, record.description ?? '']));
  },
);

/** Navigation của locale hiện tại — đã lọc ở tầng query, không lọc lại ở UI. */
const navigationForLocale = computed<readonly ContentNavigationItem[]>(
  () => navigation.value ?? [],
);

/**
 * Cây sidebar: link tới landing (`Overview`) rồi đến từng section. Logic thuần
 * nằm trong `docs-navigation.ts` (đã unit test) — route chỉ nối dữ liệu, và
 * không lộ node `locale` (`/en`, vốn không phải page docs) ra UI.
 */
const sidebarNavigation = computed<readonly ContentNavigationItem[]>(() =>
  getSidebarItems(locale.value, navigationForLocale.value),
);

/** Phần pathname còn lại sau `<locale>/docs` — dùng để nhận diện landing. */
const remainder = computed(() => layout.value?.remainder ?? '');
/** Đúng khi đang ở `/en/docs` hoặc `/vi/docs` — không có segment tài liệu nào. */
const isDocsLanding = computed(() => remainder.value === '');

/**
 * Tổ tiên của page hiện tại trong cây navigation — `findPageBreadcrumb` của Nuxt
 * Content, không hard-code breadcrumb cho từng page. Cây đầu vào đã lọc theo
 * locale nên breadcrumb không bao giờ trộn hai locale.
 */
const ancestorCrumbs = computed<readonly ContentNavigationItem[]>(() =>
  findPageBreadcrumb([...navigationForLocale.value], route.path, { current: true }),
);

/**
 * Chuỗi breadcrumb cuối cùng: entry `Docs` trỏ về docs landing, rồi các tổ tiên
 * từ content tree. Mục cuối là page hiện tại (lấy từ chính document, không phải
 * từ navigation) để nhãn luôn khớp tiêu đề trang.
 *
 * Thuật toán nằm trong `docs-breadcrumbs.ts` (đã unit test): nó chèn entry
 * `Docs`, lọc bỏ locale-root (`/en`) và mọi crumb ngoài docs tree theo pathname
 * (không phụ thuộc ngôn ngữ), và luôn kết thúc bằng page hiện tại.
 */
const breadcrumbs = computed<readonly { path: string; title: string }[]>(() => {
  const docsRoot = buildPublicPath({ locale: locale.value, mount: 'docs' });
  return buildDocsBreadcrumbs({
    docsRootPath: docsRoot.kind === 'localized' ? docsRoot.path : undefined,
    docsRootTitle: docsUiStrings(locale.value).documentation,
    ancestorCrumbs: ancestorCrumbs.value,
    currentPath: route.path,
    currentTitle: page.value?.title ?? '',
  });
});

/**
 * Locale nào thực sự có bản dịch của **resource này** — suy ra từ chính content
 * tree, không phải giả định. Resource được định danh bằng pathname bỏ segment
 * locale; một locale được coi là có bản dịch khi tồn tại document ở đúng đường
 * dẫn đó. Nhờ vậy locale switcher của `PublicShell` chỉ link tới bản dịch có
 * thật, và một page chỉ có tiếng Anh không hiện link tiếng Việt hỏng.
 */
const { data: translationAvailability } = await useAsyncData(
  `docs:translations:${route.path}`,
  async () => {
    const resourceRemainder = layout.value?.remainder ?? '';
    const checks = await Promise.all(
      PUBLIC_LOCALES.map(async (definition) => {
        const built = buildPublicPath({
          locale: definition.code,
          mount: 'docs',
          path: resourceRemainder,
        });
        if (built.kind !== 'localized') {
          return { code: definition.code, exists: false };
        }
        const found = await queryCollection('docs').path(built.path).first();
        return { code: definition.code, exists: found !== null };
      }),
    );
    return checks.filter((check) => check.exists).map((check) => check.code);
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
 * Document liền trước / liền sau **trong cùng locale**.
 *
 * `queryCollectionItemSurroundings` chạy trên cây đã lọc theo locale, nên cặp
 * prev/next không bao giờ nhảy sang locale khác hay ra ngoài docs tree; hai giá
 * trị đã ở dạng `{ path, title }` hoặc `null` ở biên.
 */
const { data: surroundings } = await useAsyncData(`docs:surroundings:${route.path}`, () =>
  queryCollectionItemSurroundings('docs', route.path, { fields: ['title'] }).where(
    'path',
    'LIKE',
    `/${locale.value}/%`,
  ),
);

const previous = computed(() => {
  const item = surroundings.value?.[0];
  return item ? { path: item.path, title: item.title } : undefined;
});
const nextPage = computed(() => {
  const item = surroundings.value?.[1];
  return item ? { path: item.path, title: item.title } : undefined;
});

/**
 * SEO: `lang` từ registry locale (hreflang `vi-VN` chứ không phải code `vi`),
 * title theo template `<page title> · Ecoma Documentation`, description từ
 * frontmatter, canonical là URL hiện tại, và alternate hreflang cho **mọi
 * locale có bản dịch thật** — dựng qua `switchLocale`, không ghép chuỗi. Toàn
 * bộ thuật toán nằm trong `docs-seo.ts` (đã unit test).
 */
const seo = computed(() =>
  buildDocsSeo({
    pathname: route.path,
    locale: locale.value,
    title: page.value?.title,
    description: page.value?.description,
    availableLocales: availableLocales.value,
  }),
);

useHead(() => ({
  htmlAttrs: { lang: seo.value.lang },
  title: seo.value.title,
  meta: [{ name: 'description', content: seo.value.description }],
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
  <DocsLandingView
    v-if="page && isDocsLanding"
    :page="page"
    :navigation="sidebarNavigation"
    :current-path="route.path"
    :available-locales="availableLocales"
    :breadcrumbs="breadcrumbs"
    :section-descriptions="sectionDescriptions ?? {}"
  />
  <DocsPageView
    v-else-if="page"
    :page="page"
    :navigation="sidebarNavigation"
    :current-path="route.path"
    :available-locales="availableLocales"
    :breadcrumbs="breadcrumbs"
    :previous="previous"
    :next="nextPage"
  />
</template>
