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

/** Tập locale có landing của mount `blog` — landing là route tĩnh của mount, tồn tại ở mọi registry locale. */
export function blogLandingAvailableLocales(): readonly PublicLocale[] {
  return PUBLIC_LOCALES.flatMap((definition) => {
    const built = buildPublicPath({ locale: definition.code, mount: 'blog' });
    return built.kind === 'localized' ? [definition.code] : [];
  });
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
  return PUBLIC_LOCALES.flatMap((definition) => {
    const built = buildPublicPath({
      locale: definition.code,
      mount: 'blog',
      path: remainder,
    });
    return built.kind === 'localized' && existingPaths.has(built.path) ? [definition.code] : [];
  });
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
  return PUBLIC_LOCALES.flatMap((definition) => {
    const built = buildPublicPath({
      locale: definition.code,
      mount: 'blog',
      path: remainder,
    });
    return built.kind === 'localized' ? [built.path] : [];
  });
}
