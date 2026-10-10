/**
 * Logic thuần của translation availability cho blog — tách khỏi route để
 * test được đúng 5 scenario regression của Finding 1 mà không cần dựng Nuxt
 * runtime hay SQLite query.
 *
 * `translationAvailability` trong route gọi helper này với kết quả query
 * `where('path', 'IN', candidates)`; helper là **hàm thuần** trên
 * (isLanding, candidates, existingPaths) nên mọi case — blog trống hai locale,
 * chỉ EN, chỉ VI, landing switch, article switch — test được trên data tĩnh.
 */

import { PUBLIC_LOCALES, type PublicLocale } from '@ecoma-io/i18n-public';
import { buildPublicPath } from '@ecoma-io/layout-public';

/**
 * Cặp `{ locale, path }` cho **một** resource trên **mọi** registry locale —
 * nguồn suy ra duy nhất của cả ba helper dưới đây.
 *
 * `path` là candidate của query `where('path', 'IN', …)`; `locale` là phần tử
 * của tập availability. Ba hàm export cùng chạy trên danh sách này nên
 * candidate dùng để query và candidate dùng để lọc `existingPaths` không bao
 * giờ tách nhau — sửa contract (buildPublicPath/PUBLIC_LOCALES) chỉ cần đúng
 * một chỗ.
 */
function blogLocalizedEntries(
  remainder?: string,
): readonly { locale: PublicLocale; path: string }[] {
  return PUBLIC_LOCALES.flatMap((definition) => {
    const built = buildPublicPath({
      locale: definition.code,
      mount: 'blog',
      ...(remainder === undefined ? {} : { path: remainder }),
    });
    return built.kind === 'localized' ? [{ locale: definition.code, path: built.path }] : [];
  });
}

/** Tập locale có landing của mount `blog` — landing là route tĩnh của mount, tồn tại ở mọi registry locale. */
export function blogLandingAvailableLocales(): readonly PublicLocale[] {
  return blogLocalizedEntries().map((entry) => entry.locale);
}

/**
 * Tập locale có bản dịch của resource `remainder` — suy từ tập path tồn tại
 * trong content.
 *
 * Locale không sinh được candidate path hợp lệ (topology từ chối) hoặc
 * candidate không nằm trong `existingPaths` thì không có bản dịch — điều này
 * giữ bất biến "không bao giờ sinh URL switch cho bản dịch không tồn tại".
 */
export function blogArticleAvailableLocales(
  remainder: string,
  existingPaths: ReadonlySet<string>,
): readonly PublicLocale[] {
  return blogLocalizedEntries(remainder)
    .filter((entry) => existingPaths.has(entry.path))
    .map((entry) => entry.locale);
}

/**
 * Candidate path của **mọi registry locale** cho resource `remainder` — đầu
 * vào của query `where('path', 'IN', candidates)`.
 *
 * Export riêng để test khẳng định tập candidate không phụ thuộc content (một
 * article chỉ có EN vẫn sinh candidate VI — VI bị loại ở bước khớp
 * `existingPaths`, không phải ở bước dựng candidate).
 */
export function blogTranslationCandidates(remainder: string): readonly string[] {
  return blogLocalizedEntries(remainder).map((entry) => entry.path);
}
