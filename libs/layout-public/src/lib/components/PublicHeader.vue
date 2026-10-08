<!--
  `PublicHeader` — shared public header: brand, global navigation, locale
  switcher.

  Header **nhận state đã parse** từ `PublicShell` chứ không tự parse pathname
  và không tự resolve locale — parse chỉ xảy ra một lần, ở `PublicShell`.
  Locale switcher chỉ đổi locale qua `switchLocale` của `i18n-public` (không
  reimplement logic locale), không đọc session, không gọi Identity hay backend
  API nào: đây là navigation tĩnh.

  Availability của locale do app cấp qua prop `availableLocales` (resource-level
  — app biết resource hiện có những locale nào); header resolve qua
  `resolveLocaleContext`, không tự suy ra từ content hay application. Locale
  hiện tại luôn nằm trong context nên luôn được render; switcher không bao giờ
  dựng link tới locale ngoài context.

  Render thuần server-compatible: không lifecycle hook, không `window`, không
  fetch, không state client — hydrate không có gì để làm.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { PUBLIC_LOCALES, switchLocale, type PublicLocale } from '@ecoma-io/i18n-public';
import { localeRootHref } from '../locale-root-href';
import { resolveLocaleContext, type PublicLocaleContext } from '../locale-context';
import { buildPublicNavigation, type PublicNavigationLink } from '../public-navigation';
import type { PublicLayoutPathResult } from '../public-layout-path';
import type { PublicMount } from '../mount-registry';

// Destructure `layout` và `availableLocales` từ `defineProps` (rule
// `vue/define-props-destructuring`): Vue 3.5 reactive props destructure rewrite
// thành accessor trên `props.*` nên tham chiếu trong computed/function luôn đọc
// prop hiện tại — đã được test `updates chrome reactively when the path prop changes` pin lại.
// Header cần đúng hai prop (parsed state + availability) — không gộp được thêm
// vì cả hai đều là input độc lập từ shell.
// oxlint-disable-next-line vue/max-props
const { layout, availableLocales = undefined } = defineProps<{
  readonly layout: PublicLayoutPathResult;
  readonly availableLocales?: readonly PublicLocale[];
}>();

/**
 * Tên hiển thị của mỗi locale cho switcher — dữ liệu trình bày thuộc về
 * layout; `i18n-public` chỉ sở hữu `code`/`hreflang`, không render UI.
 * Khai báo `Record<PublicLocale, string>` nên thêm locale mà thiếu tên là
 * lỗi type.
 */
const LOCALE_NAMES: Readonly<Record<PublicLocale, string>> = Object.freeze({
  en: 'English',
  vi: 'Tiếng Việt',
});

/**
 * Locale của pathname hiện tại, hoặc `undefined` ở `root`/`invalid`.
 *
 * `undefined` là trạng thái hợp lệ, không phải lỗi: `/` là
 * locale-resolution entry point nên không mang locale. Header ở trạng thái
 * này render không có locale-aware link — không bao giờ đoán locale.
 */
const locale = computed<PublicLocale | undefined>((): PublicLocale | undefined => {
  if (layout.kind === 'localized' || layout.kind === 'locale-root') {
    return layout.locale;
  }
  return undefined;
});

/**
 * Context availability của resource hiện tại — resolve `availableLocales` của
 * app với locale của pathname. `undefined` ở `root`/`invalid` (không có locale
 * thì không có context); khi có locale thì `current` luôn nằm trong
 * `availableLocales`.
 */
const localeContext = computed<PublicLocaleContext | undefined>(
  (): PublicLocaleContext | undefined =>
    locale.value === undefined ? undefined : resolveLocaleContext(locale.value, availableLocales),
);

/** Brand luôn về bề mặt root của locale hiện tại (dựng qua `buildPublicPath`). */
const homeHref = computed<string>((): string => localeRootHref(layout));

/** Global navigation đã resolve theo locale hiện tại; rỗng khi không có locale. */
const navigation = computed<readonly PublicNavigationLink[]>((): readonly PublicNavigationLink[] =>
  locale.value === undefined ? [] : buildPublicNavigation(locale.value),
);

/** Một mục trong locale switcher: link sang locale khác, giữ nguyên resource. */
type LocaleSwitch = {
  readonly target: PublicLocale;
  readonly hreflang: string;
  readonly name: string;
  readonly href: string;
};

/**
 * Danh sách locale khác locale hiện tại **nằm trong context availability**,
 * đổi qua `switchLocale` của `i18n-public` — cùng resource path, chỉ đổi
 * segment locale. Locale ngoài `availableLocales` bị loại ở resolve nên không
 * bao giờ sinh link. Ở `root`/`invalid` không có gì để đổi → danh sách rỗng.
 */
const localeSwitches = computed<readonly LocaleSwitch[]>((): readonly LocaleSwitch[] => {
  const context = localeContext.value;
  // Guard `layout.kind` thu hẹp union để `layout.path` type-check được
  // (arm `invalid` không có `path`; `context === undefined` đã ngụ ý nó,
  // nhưng compiler không suy luận chéo qua computed).
  if (context === undefined || layout.kind === 'invalid') {
    return [];
  }
  const switches: LocaleSwitch[] = [];
  for (const definition of PUBLIC_LOCALES) {
    if (definition.code === context.current) {
      continue;
    }
    // Ngoài context (app không liệt kê locale này cho resource) → không link.
    if (!context.availableLocales.includes(definition.code)) {
      continue;
    }
    const switched = switchLocale(layout.path, definition.code);
    if (switched.kind !== 'localized') {
      continue;
    }
    switches.push({
      target: definition.code,
      hreflang: definition.hreflang,
      name: LOCALE_NAMES[definition.code],
      href: switched.path,
    });
  }
  return switches;
});

/** Tên của locale hiện tại — chỉ render khi switcher hiển thị. */
const currentLocaleName = computed<string | undefined>((): string | undefined =>
  locale.value === undefined ? undefined : LOCALE_NAMES[locale.value],
);

/**
 * Trạng thái active của một mục navigation trên pathname hiện tại:
 * `page` khi pathname **dừng đúng** tại mount root (chính href của mục nav),
 * `true` khi pathname nằm dưới mount — resource của mount (`/en/blog/hello`
 * sáng `Blog`) hoặc mount lồng nhau (`docs/api` sáng `docs`). Không có
 * locale → `undefined`.
 */
const navCurrent = (mount: PublicMount): 'page' | 'true' | undefined => {
  if (layout.kind !== 'localized') {
    return undefined;
  }
  if (layout.mount === mount) {
    // Link trỏ mount root; có remainder nghĩa là đang ở trang con, không phải
    // chính link đó — 'page' sẽ sai semantics ARIA (`aria-current="page"`
    // phải là current page, không phải section).
    return layout.remainder === '' ? 'page' : 'true';
  }
  if (layout.mount.startsWith(`${mount}/`)) {
    return 'true';
  }
  return undefined;
};
</script>

<template>
  <header>
    <a :href="homeHref">ecoma.io</a>

    <nav v-if="navigation.length > 0" aria-label="Global">
      <ul>
        <li v-for="link in navigation" :key="link.mount">
          <a :href="link.href" :aria-current="navCurrent(link.mount)">{{ link.label }}</a>
        </li>
      </ul>
    </nav>

    <!-- Nav hiển thị ngay cả khi không có link switch nào (context chỉ có
         đúng locale hiện tại): current locale luôn được render. -->
    <nav v-if="localeContext !== undefined" aria-label="Language">
      <ul>
        <li v-if="locale !== undefined">
          <span :lang="locale" aria-current="true">{{ currentLocaleName }}</span>
        </li>
        <li v-for="switchTarget in localeSwitches" :key="switchTarget.target">
          <a
            :href="switchTarget.href"
            :lang="switchTarget.target"
            :hreflang="switchTarget.hreflang"
            >{{ switchTarget.name }}</a
          >
        </li>
      </ul>
    </nav>
  </header>
</template>
