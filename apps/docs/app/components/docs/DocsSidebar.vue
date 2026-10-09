<!--
  Sidebar của docs — bọc cây navigation (`DocsNavTree`) thành hai bề mặt:

  - **mobile**: disclosure gốc của HTML (`<details>`/`<summary>`), đóng/mở
    không cần JavaScript nên SSR và hydrate cho ra cùng một HTML, không có
    state client nào để lệch;
  - **desktop (`lg`)**: cột luôn hiện, `<details>` bị vô hiệu hoá về mặt hiển
    thị (`lg:block` trên wrapper, `lg:hidden` trên `<summary>`) — nội dung vẫn
    là cùng một cây, không nhân bản dữ liệu.

  Bề mặt bị `display:none` không nằm trong accessibility tree nên không có link
  trùng cho screen reader; chỉ một trong hai bề mặt được đọc tại một thời điểm.
-->
<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content';
import DocsNavTree from './DocsNavTree.vue';

// Ba input độc lập (cây navigation, page hiện tại, nhãn a11y) — xem ghi chú
// tương ứng ở `DocsNavTree`.
// oxlint-disable-next-line vue/max-props
const { items, currentPath, label } = defineProps<{
  readonly items: readonly ContentNavigationItem[];
  readonly currentPath: string;
  readonly label: string;
}>();
</script>

<template>
  <details class="lg:block" open>
    <summary
      class="cursor-pointer rounded border border-slate-300 px-3 py-2 font-semibold lg:hidden"
    >
      {{ label }}
    </summary>
    <div class="mt-3 lg:mt-0">
      <DocsNavTree :items="items" :current-path="currentPath" :label="label" />
    </div>
  </details>
</template>
