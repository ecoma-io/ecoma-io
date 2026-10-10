/**
 * Locale cho formatting ngày tháng theo locale của trang hiện tại.
 *
 * Nuxt không có `useI18nLocale` (không dùng `@nuxtjs/i18n` — locale dimension
 * của platform thuộc `i18n-public`), nên composable này bọc giá trị `locale`
 * đã validate của route thành API auto-import được cho các component trình bày
 * dữ liệu theo locale (`toLocaleDateString`).
 *
 * Component nhận `locale` đã validate qua props khi có thể; composable này chỉ
 * dành cho component không nhận props (xem `BlogArticleCard`).
 */
export function useI18nLocale(): { readonly locale: string } {
  const route = useRoute();
  const layout = parseBlogRoute(route.path);
  return { locale: layout?.locale ?? 'en' };
}
