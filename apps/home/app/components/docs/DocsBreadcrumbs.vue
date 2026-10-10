<!--
  Breadcrumbs của docs — sinh từ content navigation, không hard-code theo page.

  Nhận `entries` **đã resolve đầy đủ** từ route (gồm cả page hiện tại ở cuối):
  route lấy cây navigation của locale hiện tại, chạy qua `findPageBreadcrumb`
  của Nuxt Content rồi chèn entry `Docs` ở đầu. Component chỉ render, nên không
  có logic dựng breadcrumb thứ hai.

  Cấu trúc dùng `nav` + `<ol>` — mẫu chuẩn cho breadcrumb; mọi mục trừ mục cuối
  là link tới một pathname thật của content, mục cuối là page hiện tại nên mang
  `aria-current="page"`. Dấu phân cách là `aria-hidden` để screen reader không
  đọc chúng thành nội dung.
-->
<script setup lang="ts">
// `entries` là dữ liệu, `label` là nhãn a11y của `<nav>` — hai input độc lập,
// xem ghi chú ở `DocsNavTree`.
// oxlint-disable-next-line vue/max-props
const { entries, label } = defineProps<{
  /**
   * Chuỗi breadcrumb từ gốc xuống, mục cuối là page hiện tại — mỗi mục là một
   * pathname hợp lệ của content kèm nhãn hiển thị.
   */
  readonly entries: readonly { readonly path: string; readonly title: string }[];
  /** Nhãn của `<nav>` breadcrumb, đã localized. */
  readonly label: string;
}>();
</script>

<template>
  <nav v-if="entries.length > 0" :aria-label="label">
    <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
      <li v-for="(entry, index) in entries" :key="entry.path" class="flex items-center gap-x-2">
        <span v-if="index > 0" aria-hidden="true">/</span>
        <a
          :href="entry.path"
          class="hover:underline"
          :class="index === entries.length - 1 ? 'font-medium text-slate-900' : undefined"
          :aria-current="index === entries.length - 1 ? 'page' : undefined"
          >{{ entry.title }}</a
        >
      </li>
    </ol>
  </nav>
</template>
