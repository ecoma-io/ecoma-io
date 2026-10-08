/**
 * Khai báo module cho file `.vue` khi typecheck bằng `tsc`.
 *
 * `tsc` không tự resolve `.vue`; app Nuxt có shim của riêng nó, shim này
 * chỉ phục vụ typecheck của chính library (index.ts re-export component)
 * và test import `.vue`.
 *
 * Props khai báo `Record<string, unknown>` (không `any`): mọi prop của
 * consumer đều assign được (kiểu prop cụ thể vẫn đọc được ở phía khai báo
 * `defineProps` thật trong file `.vue`), và lint cấm `no-explicit-any`.
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, never>>;
  export default component;
}
