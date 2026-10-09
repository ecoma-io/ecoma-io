<!--
  `PublicFooter` — shared public footer: brand, mô tả, link groups, copyright.

  Footer deterministic: không runtime fetch, không dependency backend, không
  Date (không hydration mismatch theo thời gian), không application-specific
  content. Dữ liệu link đến từ `PUBLIC_FOOTER_GROUPS` (tĩnh, frozen) — chỉ
  chứa destination thực sự tồn tại; không bịa Terms/Privacy/social để lấp
  layout.

  Không có `<nav>` bên trong footer: spec component (`public-shell.spec.ts`)
  ghim footer không chứa navigation landmark — các cột link là heading + list,
  không phải điều hướng cấp trang. Mọi href đi qua builder của library (không
  string concat); brand dùng chung `localeRootHref` với header nên hai bề mặt
  luôn lockstep.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { PublicLocale } from '@ecoma-io/i18n-public';
import { localeRootHref } from '../locale-root-href';
import { buildPublicFooterGroups, PUBLIC_FOOTER_TAGLINE } from '../public-navigation';
import type { PublicLayoutPathResult } from '../public-layout-path';

const { layout } = defineProps<{ readonly layout: PublicLayoutPathResult }>();

/** Brand về bề mặt root của locale hiện tại; `root`/`invalid` → `/`. */
const homeHref = computed<string>((): string => localeRootHref(layout));

/**
 * Locale của layout — quyết định ngôn ngữ heading/link text. Không có locale
 * (`root`/`invalid`) → groups rỗng: footer không đoán locale, chỉ còn brand +
 * copyright (không locale-aware).
 */
const locale = computed<PublicLocale | undefined>((): PublicLocale | undefined => {
  if (layout.kind === 'localized' || layout.kind === 'locale-root') {
    return layout.locale;
  }
  return undefined;
});

/**
 * Footer groups đã resolve theo locale — heading + link text theo đúng locale
 * của trang; rỗng khi layout chưa mang locale.
 */
const groups = computed(() =>
  locale.value === undefined ? [] : buildPublicFooterGroups(locale.value),
);
</script>

<template>
  <footer class="border-t border-slate-800 bg-slate-950 text-slate-300">
    <!-- Container shell dùng chung: cùng bề rộng và gutters với header. -->
    <div class="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div class="flex flex-col gap-10 md:flex-row md:justify-between">
        <!-- Brand block -->
        <div class="max-w-sm">
          <p class="text-lg font-semibold text-white">
            <a
              :href="homeHref"
              class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >ecoma.io</a
            >
          </p>
          <p class="mt-3 text-sm leading-relaxed text-slate-400">
            {{ locale === undefined ? '' : PUBLIC_FOOTER_TAGLINE[locale] }}
          </p>
        </div>

        <!-- Link groups: heading + list, không phải nav -->
        <div v-if="groups.length > 0" class="grid grid-cols-2 gap-8 sm:gap-12 md:flex md:gap-16">
          <div v-for="group in groups" :key="group.heading" class="min-w-0">
            <h3 class="text-sm font-semibold text-white">{{ group.heading }}</h3>
            <ul class="mt-4 space-y-2 text-sm">
              <li v-for="link in group.links" :key="link.href">
                <a
                  :href="link.href"
                  class="text-slate-400 transition-colors duration-150 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >{{ link.label }}</a
                >
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Hàng copyright tách khỏi link groups — không năm (deterministic). -->
      <div class="mt-10 border-t border-slate-800 pt-6">
        <p class="text-sm text-slate-500">© ecoma.io</p>
      </div>
    </div>
  </footer>
</template>
