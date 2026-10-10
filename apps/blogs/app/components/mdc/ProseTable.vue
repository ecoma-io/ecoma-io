<!--
  Override `ProseTable` của `@nuxtjs/mdc` (mặc định chỉ là `<table><slot /></table>`).

  Bảng Markdown có thể rộng hơn cột nội dung, và `overflow-x` **không** có tác
  dụng trên chính phần tử `<table>`: trình duyệt bỏ qua `overflow` cho
  `display: table`, nên cách sửa bằng CSS trên `table` chỉ là no-op. Cách còn
  lại — đặt `display: block` lên `<table>` — làm mất table semantics đối với
  một số screen reader (Safari/VoiceOver). Vì vậy bọc `<table>` trong một
  scroll container thật, giữ nguyên `<table>` là bảng thật.

  `@nuxtjs/mdc` tự đăng ký thư mục `components/mdc/` của app ở ưu tiên cao
  nhất, nên file này thay thế component prose mặc định mà không cần patch
  upstream (giống `apps/docs`).
-->
<script setup lang="ts">
import { blogUiStrings } from '~/utils/blog-ui-strings';
import { parseBlogRoute } from '~/utils/blog-routing';

/**
 * Tên truy cập được của region cuộn, theo locale của trang. `ProseTable` chỉ
 * render bên trong content của blog — route `[[...slug]].vue` đã validate
 * pathname trước khi render, nên parse luôn thành công; parse hỏng là lỗi ở
 * tầng khác và phải **fail loudly** (throw, không fallback im lặng về một
 * locale nào đó).
 */
const route = useRoute();
const tableLabel = computed(() => {
  const layout = parseBlogRoute(route.path);
  if (layout === null) {
    throw new Error(`ProseTable rendered outside a blog route: ${route.path}`);
  }
  return blogUiStrings(layout.locale).tableRegion;
});
</script>
<template>
  <!--
    `tabindex="0"`: scroll container ngang phải focus được bằng bàn phím —
    `<div>` trần không focusable, người dùng chỉ bàn phím không có cách cuộn
    tới cột bị cắt (WCAG 2.1.1). `role="region"` + `:aria-label` đặt tên cho
    vùng cuộn (WCAG 2.4.1), `focus-visible:outline-*` làm nổi vùng focus.
  -->
  <div
    tabindex="0"
    role="region"
    :aria-label="tableLabel"
    class="my-6 w-full max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
  >
    <table class="w-full text-sm">
      <slot />
    </table>
  </div>
</template>
