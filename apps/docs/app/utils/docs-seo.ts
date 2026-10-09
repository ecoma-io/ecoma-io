/**
 * Dựng head/SEO của một docs page — tách khỏi route để test được các bất biến
 * về `lang`, canonical, hreflang mà không cần dựng Nuxt runtime.
 *
 * Quy tắc đang được pin ở đây:
 *
 * - `lang` lấy từ registry locale (`hreflang`), **không** phải locale code:
 *   `vi` → `vi-VN`. Đây là điểm dễ sai nhất khi ai đó "tối ưu" bằng cách
 *   truyền thẳng `locale` vào `htmlAttrs.lang`.
 * - canonical luôn là URL của **pathname hiện tại** (không phải landing, không
 *   phải bản dịch) — mỗi URL tự canonical chính nó.
 * - hreflang chỉ sinh cho locale **có bản dịch thật** và đi qua `switchLocale`
 *   của `i18n-public`, không ghép chuỗi `/${locale}${...}` thủ công.
 * - origin là hằng số `ecoma.io`: không đọc host của request nên kết quả
 *   deterministic và không phụ thuộc môi trường preview.
 */

import {
  PUBLIC_LOCALES,
  getLocaleDefinition,
  switchLocale,
  type PublicLocale,
} from '@ecoma-io/i18n-public';
import { docsUiStrings } from './docs-ui-strings';

/** Origin public của bề mặt `ecoma.io` — hằng số, không suy từ request. */
const PUBLIC_ORIGIN = 'https://ecoma.io';

/** Một link `alternate` hreflang đã dựng sẵn cho `useHead`. */
export type DocsAlternateLink = {
  readonly rel: 'alternate';
  readonly hreflang: string;
  readonly href: string;
};

/** Head đã resolve của một docs page. */
export type DocsSeo = {
  /** Giá trị `htmlAttrs.lang` — lấy từ registry (`en`, `vi-VN`). */
  readonly lang: string;
  /** `document.title`. */
  readonly title: string;
  /** `description` từ frontmatter (rỗng nếu page không khai báo). */
  readonly description: string;
  /** URL tuyệt đối canonical của chính pathname hiện tại. */
  readonly canonical: string;
  /** Link `alternate` cho các locale có bản dịch thật. */
  readonly alternates: readonly DocsAlternateLink[];
};

/** URL tuyệt đối cho một public pathname. */
export function absolutePublicUrl(pathname: string): string {
  return `${PUBLIC_ORIGIN}${pathname}`;
}

/**
 * Head của một docs page.
 *
 * `availableLocales` là tập locale **thực sự có document** ở cùng resource
 * path (route resolve bằng query, không phải suy đoán); truyền vào thay vì để
 * hàm tự query giữ cho hàm thuần và test được. Locale không nằm trong tập này
 * không sinh hreflang — một page chỉ có tiếng Anh sẽ không quảng bá bản dịch
 * tiếng Việt 404.
 */
export function buildDocsSeo(input: {
  readonly pathname: string;
  readonly locale: PublicLocale;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly availableLocales: readonly PublicLocale[];
}): DocsSeo {
  const strings = docsUiStrings(input.locale);

  const alternates: DocsAlternateLink[] = [];
  for (const definition of PUBLIC_LOCALES) {
    if (!input.availableLocales.includes(definition.code)) {
      continue;
    }
    // `switchLocale` (không ghép chuỗi): giữ nguyên phần resource và chỉ đổi
    // segment locale, đúng contract của `i18n-public`.
    const switched = switchLocale(input.pathname, definition.code);
    if (switched.kind !== 'localized') {
      continue;
    }
    alternates.push({
      rel: 'alternate',
      hreflang: definition.hreflang,
      href: absolutePublicUrl(switched.path),
    });
  }

  return {
    // `hreflang` của registry, không phải `locale` code: `vi` → `vi-VN`.
    lang: getLocaleDefinition(input.locale)?.hreflang ?? input.locale,
    title: `${input.title ?? ''} · Ecoma ${strings.documentation}`,
    description: input.description ?? '',
    canonical: absolutePublicUrl(input.pathname),
    alternates,
  };
}
