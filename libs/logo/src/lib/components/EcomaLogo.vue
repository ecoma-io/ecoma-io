<!--
  `EcomaLogo` — render primary horizontal logo của ecoma.io.

  Artwork không được vẽ lại bằng code: component render đúng file SVG nguồn
  trong `src/assets/` qua `<img>` (src = URL asset do bundler resolve). Lý do
  `<img>` thay vì inline SVG: file nguồn chứa `<style>` nội bộ với class
  generic (`.a`/`.b`) — inline sẽ leak style đó ra toàn trang; `<img>` đóng gói
  SVG thành tài liệu riêng, style không rò rỉ và artwork giữ byte-identical.

  API tối giản: `alt` duy nhất (accessibility). `width`/`height` mặc định là
  kích thước intrinsic của SVG — browser reserve không gian trước khi artwork
  tải xong (không CLS); **lưu ý hai số này là bản sao kích thước của file
  artwork**: thay artwork phải cập nhật cùng lúc. Kích thước của consumer đi
  qua CSS (CSS thắng attribute HTML). Attribute fallthrough cho các attr còn
  lại, NGOẶC TRỪ một nhóm bị filter: `src`, `srcset`, `imagesrcset` (thay
  artwork ngầm — artwork là source of truth của library) và `width`/`height`
  (override một mình một trong hai làm méo artwork vì browser dùng cả hai làm
  khung co giãn; sizing chỉ đi qua CSS). Component không tự thêm margin, không
  bọc link, không đọc router — brand link là việc của consumer.
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import { ECOMA_LOGO_HORIZONTAL_SVG_URL } from '../logo-asset';

/**
 * Attribute KHÔNG được fallthrough xuống `<img>` (lọc bằng destructure trong
 * `imgAttrs` dưới đây):
 * - nhóm nguồn ảnh (`src`, `srcset`, `imagesrcset`): artwork là source of
 *   truth, không ai thay thế ngầm (browser ưu tiên `srcset` hơn `src` nên cả
 *   ba phải filter cùng nhau);
 * - `width`/`height`: override một mình một trong hai làm browser bóp méo
 *   artwork (cả hai attr được set làm khung hiển thị); sizing chỉ qua CSS.
 *
 * Tự quản fallthrough: mọi attr khác của consumer (class, style, aria-*,
 * data-*…) đều đi thẳng vào `<img>`.
 */
defineOptions({ inheritAttrs: false });

// Destructure props từ `defineProps` (rule `vue/define-props-destructuring`):
// Vue 3.5 reactive props destructure giữ được reactivity trong template.
// Một prop duy nhất — đủ cho accessibility, vừa rule `vue/max-props` (max 1).
const { alt = 'ecoma.io' } = defineProps<{
  /** Văn bản thay thế — bắt buộc có ý nghĩa, logo ngữ nghĩa là brand. */
  readonly alt?: string;
}>();

const attrs = useAttrs();

// `useAttrs()` trả Proxy over `instance.attrs` (shallowReactive, Vue mutate
// in-place + trigger) nên `computed` re-evaluate đúng khi consumer đổi binding
// động — được pin bởi ecoma-logo-reactivity.spec.ts.
// `attrs[key]` có rest sibling nên biến lọc không vi phạm `noUnusedLocals`.
const imgAttrs = computed<Record<string, unknown>>(() => {
  const { src, srcset, imagesrcset, width, height, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <img
    class="ecoma-logo"
    :src="ECOMA_LOGO_HORIZONTAL_SVG_URL"
    :alt="alt"
    width="160"
    height="46"
    v-bind="imgAttrs"
  />
</template>
