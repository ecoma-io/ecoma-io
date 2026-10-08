<!--
  `PublicShell` — khung chung của mọi public page:

  ```text
  ┌───────────────────────┐
  │      PublicHeader     │
  ├───────────────────────┤
  │                       │
  │   slot: nội dung app  │
  │                       │
  ├───────────────────────┤
  │      PublicFooter     │
  └───────────────────────┘
  ```

  Shell là chỗ **duy nhất** parse pathname (qua `parsePublicLayoutPath`) rồi
  truyền state đã parse vào Header/Footer — component không parse lần thứ
  hai, không tự resolve locale. Nhận `path` dạng string để app chỉ cần trỏ
  pathname hiện tại vào; không phụ thuộc vue-router, không import Nuxt.

  Render thuần SSR/SSG: slot tĩnh, không fetch, không hydration state.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { parsePublicLayoutPath } from '../parse-public-layout-path';
import type { PublicLayoutPathResult } from '../public-layout-path';
import PublicHeader from './PublicHeader.vue';
import PublicFooter from './PublicFooter.vue';

// Destructure `path` (rule `vue/define-props-destructuring`): Vue 3.5 rewrite
// thành accessor trên `props.path` nên `layout` recompute khi prop đổi — test
// `updates chrome reactively when the path prop changes` pin lại hành vi này.
const { path } = defineProps<{ readonly path: string }>();

/** Kết quả parse một lần cho mỗi `path` — truyền xuống toàn bộ shell. */
const layout = computed<PublicLayoutPathResult>((): PublicLayoutPathResult =>
  parsePublicLayoutPath(path),
);
</script>

<template>
  <PublicHeader :layout="layout" />
  <main>
    <slot />
  </main>
  <PublicFooter :layout="layout" />
</template>
