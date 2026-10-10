/**
 * Strict parse cho bề mặt legal của Home: một pathname chỉ hợp lệ khi nó là
 * `/<locale>/legal/<slug>` với slug nằm trong `LEGAL_SLUGS`.
 *
 * Cùng cấu trúc với `parseHomeLocaleRoot`: seam dùng chung giữa
 * `definePageMeta({ validate })` và phần render — một nguồn duy nhất cho luật
 * "đâu là trang legal", nên hai chỗ không thể lệch nhau.
 *
 * Không tự phân tích locale: toàn bộ luật cấu trúc (`?`/`#`, `//`, trailing
 * slash, so khớp locale exact từng byte) thuộc `parsePublicPath` của
 * `app/i18n`; phần thêm của app chỉ là khớp segment `legal` + slug exact.
 * Không decode, không lowercase, không repair: `/%6Cegal`, `/Legal`,
 * `/en/legal/` và `/en/legal/privacy/x` đều bị từ chối.
 */

import { parsePublicPath, type PublicLocale } from '../i18n/index';
import { LEGAL_SLUGS, type LegalSlug } from './legal-content';

/**
 * Trả về `{ locale, slug }` khi `pathname` là trang legal hợp lệ, ngược lại
 * `undefined`.
 *
 * Chỉ nhận `kind === 'localized'` với remainder đúng dạng `/legal/<slug>`
 * (slug exact từng byte, thuộc `LEGAL_SLUGS`, không có gì phía sau). Locale
 * trả về do chính parser quyết định, không suy từ `route.params`.
 */
export function parseLegalPage(
  pathname: string,
): { locale: PublicLocale; slug: LegalSlug } | undefined {
  const parsed = parsePublicPath(pathname);
  if (parsed.kind !== 'localized') {
    return undefined;
  }
  if (!parsed.remainder.startsWith('/legal/')) {
    return undefined;
  }
  const slug = parsed.remainder.slice('/legal/'.length);
  const known = LEGAL_SLUGS.find((candidate) => candidate === slug);
  if (known === undefined) {
    return undefined;
  }
  return { locale: parsed.locale, slug: known };
}
