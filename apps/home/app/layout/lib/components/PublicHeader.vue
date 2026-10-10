<!--
  `PublicHeader` — shared public header: brand (artwork logo qua `EcomaLogo`
  của `app/brand`), global navigation (kèm mega panel Docs), locale switcher,
  CTA, mobile navigation.

  Header **nhận state đã parse** từ `PublicShell` chứ không tự parse pathname
  và không tự resolve locale — parse chỉ xảy ra một lần, ở `PublicShell`.
  Locale switcher chỉ đổi locale qua `switchLocale` của `app/i18n` (không
  reimplement logic locale), không đọc session, không gọi Identity hay backend
  API nào: đây là navigation tĩnh.

  Availability của locale do app cấp qua prop `availableLocales` (resource-level
  — app biết resource hiện có những locale nào); header resolve qua
  `resolveLocaleContext`, không tự suy ra từ content hay application. Locale
  hiện tại luôn nằm trong context nên luôn được render; switcher không bao giờ
  dựng link tới locale ngoài context.

  Interactivity (mega panel Docs, mobile menu) là **disclosure state thuần
  client-interaction**: khởi tạo `false` cố định nên SSR và lần hydrate đầu
  render cùng một HTML (không hydration mismatch); listener đóng theo Escape
  hoặc click ngoài chỉ được gắn trong `onMounted` (không bao giờ chạy trên
  server) và không ảnh hưởng dữ liệu render — URL, nav, locale vẫn
  deterministic. Không fetch, không `window` trong đường render.

  Render server-compatible: mọi href dựng qua builder của library; nav luôn
  là `<a href>` thật (crawlable, no-JS vẫn điều hướng được) — kể cả trigger
  mega panel, theo pattern WAI-ARIA disclosure navigation (click thuần với
  JS bị chặn để toggle, `exact` guard chạy trước `prevent` để modifier-click
  đi thẳng href). Item nào có `sections` trong nav data thì render disclosure
  — không branch theo mount literal.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { PUBLIC_LOCALES, switchLocale, type PublicLocale } from '../../../i18n/index';
import { EcomaLogo } from '../../../brand/index';
import { buildPublicPath } from '../build-public-path';
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
 * layout; `app/i18n` chỉ sở hữu `code`/`hreflang`, không render UI.
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

/**
 * CTA của header — "Get started" trỏ tới section getting-started của docs:
 * destination xác minh duy nhất có tính chất onboarding. Dựng qua
 * `buildPublicPath` (không concatenation); rỗng khi chưa có locale — header ở
 * `root`/`invalid` không đoán locale nên không render CTA.
 */
const cta = computed<{ readonly label: string; readonly href: string } | undefined>(() => {
  if (locale.value === undefined) {
    return undefined;
  }
  const built = buildPublicPath({ locale: locale.value, mount: 'docs', path: '/getting-started' });
  if (built.kind === 'invalid') {
    return undefined;
  }
  const label = locale.value === 'vi' ? 'Bắt đầu' : 'Get started';
  return Object.freeze({ label, href: built.path });
});

/** Một mục trong locale switcher: link sang locale khác, giữ nguyên resource. */
type LocaleSwitch = {
  readonly target: PublicLocale;
  readonly hreflang: string;
  readonly name: string;
  readonly href: string;
};

/**
 * Danh sách locale khác locale hiện tại **nằm trong context availability**,
 * đổi qua `switchLocale` của `app/i18n` — cùng resource path, chỉ đổi
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

/**
 * Disclosure state — khởi tạo `false` cố định ở cả server lẫn client nên
 * SSR HTML và lần render hydrate đầu giống hệt nhau (không mismatch). Chỉ
 * thay đổi sau tương tác của user. `docsMount` là mount của item đang khai
 * báo sections (data-driven) — panel id và toggle của item đó.
 */
const docsOpen = ref(false);
const mobileOpen = ref(false);

/** Mount của nav item có sections — tối đa một item như vậy trong global nav. */
const sectionedMount = computed<PublicMount | undefined>(
  (): PublicMount | undefined =>
    navigation.value.find((link) => link.sections !== undefined)?.mount,
);

function toggleDocs(): void {
  docsOpen.value = !docsOpen.value;
}

function toggleMobile(): void {
  mobileOpen.value = !mobileOpen.value;
}

/** Đóng mọi disclosure — gọi khi Escape hoặc focus rời header. */
function closeDisclosures(): void {
  docsOpen.value = false;
  mobileOpen.value = false;
}

/**
 * Đóng panel khi Escape được nhấn hoặc focus rời hẳn header (`focusout` với
 * `relatedTarget === null` nghĩa là focus chuyển ra ngoài document — click
 * vùng không focusable). Handler gắn trên chính phần tử template, không đụng
 * `document`/`window` — tsconfig của lib không có DOM lib và đường render
 * vẫn thuần server-compatible: không lifecycle hook, không state client nào
 * ảnh hưởng dữ liệu render.
 */
function onHeaderKeydown(event: { key: string }): void {
  if (event.key === 'Escape') {
    closeDisclosures();
  }
}

function onHeaderFocusout(event: { relatedTarget: unknown }): void {
  if (event.relatedTarget === null) {
    closeDisclosures();
  }
}
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur motion-safe:transition-shadow"
    @keydown="onHeaderKeydown"
    @focusout="onHeaderFocusout"
  >
    <!-- Skip link: phần tử focusable đầu tiên, ẩn cho đến khi focus
         (sr-only + focus:sr-none...), nhảy tới `#public-main` do shell render. -->
    <a
      href="#public-main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >{{ locale === 'vi' ? 'Tới nội dung chính' : 'Skip to content' }}</a
    >
    <!-- Container shell dùng chung — gutters và bề rộng khớp footer. -->
    <div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
      <!-- Brand: artwork logo thật qua `EcomaLogo` (`scope:shared`, mọi bounded
           context được phụ thuộc). Kích thước điều khiển bằng CSS (fallthrough
           `class` của logo lib) — giữ intrinsic `width`/`height` của `<img>`
           làm ratio, chỉ đặt `h-*` và để `w-auto` co giãn theo. `h-6` giữ logo
           cùng tầm thị giác với hàng navigation trong header `h-16`, không
           lấn spotlight. Accessible name đến từ `alt="ecoma.io"` mặc định của
           logo lib, tương đương text cũ. -->
      <a
        :href="homeHref"
        class="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
      >
        <EcomaLogo class="block h-6 w-auto" />
      </a>

      <!-- Global navigation — desktop -->
      <nav
        v-if="navigation.length > 0"
        aria-label="Global"
        class="hidden items-center gap-1 md:flex"
      >
        <ul class="flex items-center gap-1">
          <li v-for="link in navigation" :key="link.mount" class="relative">
            <!--
              Item khai báo sections trong data render là disclosure (mega
              panel); item khác là link thường. Branch theo **data** của nav,
              không theo mount literal — thêm mount có sub-section là thay đổi
              dữ liệu, không phải sửa component.
            -->
            <template v-if="link.sections !== undefined">
              <!--
                Disclosure link theo pattern WAI-ARIA disclosure navigation:
                trigger vẫn là `<a href>` tới mount root nên no-JS và crawler
                luôn có link thật tới mount (panel `hidden` không thay thế được
                link cấp cao nhất). `@click.exact.prevent`: guard `exact` chạy
                TRƯỚC `prevent` (withModifiers duyệt theo thứ tự khai báo) —
                click thuần bị chặn để toggle panel, click kèm modifier
                (Cmd/Ctrl/Shift/Alt — mở tab mới) đi native tới href.
                `aria-current` của mount đặt trên chính trigger (section
                semantics như link thường).
              -->
              <a
                :href="link.href"
                class="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 aria-expanded:bg-slate-100 aria-expanded:text-slate-900 aria-[current]:bg-slate-100 aria-[current]:text-slate-900"
                :aria-expanded="link.mount === sectionedMount && docsOpen"
                :aria-current="navCurrent(link.mount)"
                aria-controls="public-header-docs-panel"
                @click.exact.prevent="toggleDocs"
              >
                {{ link.label }}
                <svg
                  class="size-4 motion-safe:transition-transform duration-150 group-open:rotate-180"
                  :class="link.mount === sectionedMount && docsOpen ? 'rotate-180' : ''"
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </a>
              <!--
                Mega panel: luôn trong DOM, đóng bằng `hidden` — surface bị
                display:none không nằm trong accessibility tree, không có link
                trùng cho screen reader. Link đầu panel là chính mount root;
                phần dưới liệt kê sections của item.
              -->
              <div
                id="public-header-docs-panel"
                :hidden="!(link.mount === sectionedMount && docsOpen)"
                class="absolute left-1/2 top-full z-50 w-80 -translate-x-1/2 pt-2"
              >
                <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
                  <a
                    :href="link.href"
                    class="block rounded-md px-2 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                    >{{ link.label }}</a
                  >
                  <p
                    class="mt-2 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-400"
                  >
                    {{ locale === 'vi' ? 'Mục lục' : 'Sections' }}
                  </p>
                  <ul class="mt-1">
                    <li v-for="section in link.sections" :key="section.href">
                      <a
                        :href="section.href"
                        class="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                        >{{ section.label }}</a
                      >
                    </li>
                  </ul>
                </div>
              </div>
            </template>
            <a
              v-else
              :href="link.href"
              :aria-current="navCurrent(link.mount)"
              class="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 aria-[current]:bg-slate-100 aria-[current]:text-slate-900"
              >{{ link.label }}</a
            >
          </li>
        </ul>
      </nav>

      <!-- Cụm phải: locale switcher, CTA, mobile toggle -->
      <div class="ml-auto flex items-center gap-2">
        <!-- Nav hiển thị ngay cả khi không có link switch nào (context chỉ có
             đúng locale hiện tại): current locale luôn được render. -->
        <nav
          v-if="localeContext !== undefined"
          aria-label="Language"
          class="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1"
        >
          <ul class="flex items-center gap-1">
            <li v-if="locale !== undefined">
              <span
                :lang="locale"
                aria-current="true"
                class="block rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
                >{{ currentLocaleName }}</span
              >
            </li>
            <li v-for="switchTarget in localeSwitches" :key="switchTarget.target">
              <a
                :href="switchTarget.href"
                :lang="switchTarget.target"
                :hreflang="switchTarget.hreflang"
                class="block rounded-full px-3 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                >{{ switchTarget.name }}</a
              >
            </li>
          </ul>
        </nav>

        <!-- CTA — desktop; mobile có CTA tương đương trong panel -->
        <a
          v-if="cta !== undefined"
          :href="cta.href"
          class="hidden rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 md:inline-flex"
          >{{ cta.label }}</a
        >

        <!-- Mobile toggle -->
        <button
          type="button"
          class="rounded-md p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 md:hidden"
          :aria-expanded="mobileOpen"
          aria-controls="public-header-mobile-panel"
          @click="toggleMobile"
        >
          <span class="sr-only">{{ mobileOpen ? 'Close menu' : 'Open menu' }}</span>
          <svg
            v-if="!mobileOpen"
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M3 5h14M3 10h14M3 15h14" stroke-linecap="round" />
          </svg>
          <svg
            v-else
            aria-hidden="true"
            class="size-5"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="m5 5 10 10M15 5 5 15" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Mobile panel — cùng dữ liệu nav, một bề mặt md:hidden; surface ẩn
         (display:none) không nằm trong accessibility tree. -->
    <div
      id="public-header-mobile-panel"
      :hidden="!mobileOpen"
      class="border-t border-slate-200 bg-white md:hidden"
    >
      <div class="mx-auto w-full max-w-6xl space-y-1 px-4 py-4 sm:px-6">
        <nav v-if="navigation.length > 0" aria-label="Mobile">
          <ul class="space-y-1">
            <li v-for="link in navigation" :key="link.mount">
              <a
                :href="link.href"
                :aria-current="navCurrent(link.mount)"
                class="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 aria-[current]:bg-slate-100 aria-[current]:text-slate-900"
                >{{ link.label }}</a
              >
              <ul
                v-if="link.sections !== undefined && link.sections.length > 0"
                class="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-3"
              >
                <li v-for="section in link.sections" :key="section.href">
                  <a
                    :href="section.href"
                    class="block rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                    >{{ section.label }}</a
                  >
                </li>
              </ul>
            </li>
          </ul>
        </nav>

        <a
          v-if="cta !== undefined"
          :href="cta.href"
          class="mt-3 block rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >{{ cta.label }}</a
        >
      </div>
    </div>
  </header>
</template>
