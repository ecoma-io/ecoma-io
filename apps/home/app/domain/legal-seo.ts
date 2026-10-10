/**
 * SEO payload cho một trang policy — mirror của `home-seo.ts` cho bề mặt
 * `/<locale>/legal/<slug>`.
 *
 * Mọi URL là **tuyệt đối dưới production origin** (`home-origin.ts`):
 * pathname do `buildPublicPath` dựng (nguồn topology duy nhất), origin do
 * `toProductionUrl` áp. Hàm thuần theo `(locale, slug, content)` — không đọc
 * request, không `Date`/random.
 */

import { getLocaleDefinition, PUBLIC_LOCALES, type PublicLocale } from '../i18n/index';
import { buildPublicPath } from '../layout/index';
import { toProductionUrl } from './home-origin';

/** Một `<link rel="alternate" hreflang=…>` cho một locale khác của resource. */
export type LegalAlternateLink = {
  readonly rel: 'alternate';
  readonly hreflang: string;
  readonly href: string;
};

/** Toàn bộ metadata SEO của một trang policy. */
export type LegalSeo = {
  /** Giá trị `lang` cho `<html>` — BCP-47 (`vi-VN`), không phải locale code. */
  readonly lang: string;
  /** `<title>` localized. */
  readonly title: string;
  /** `meta[name=description]` localized. */
  readonly description: string;
  /** Canonical URL tuyệt đối của chính trang — luôn self-canonical. */
  readonly canonicalUrl: string;
  /** Hai chiều `en` ↔ `vi-VN` kèm self-reference, phủ toàn bộ registry. */
  readonly alternates: readonly LegalAlternateLink[];
};

/**
 * URL tuyệt đối của trang policy cho một locale.
 *
 * Nhánh `invalid` là bất khả với locale/slug đã thuộc registry — ném lỗi thay
 * vì fallback để một thay đổi registry sau này không âm thầm sinh URL sai.
 */
function legalPageUrl(locale: PublicLocale, slug: string): string {
  const built = buildPublicPath({ locale, mount: 'legal', path: `/${slug}` });
  if (built.kind === 'invalid') {
    throw new Error(`Unbuildable public path for legal page "${slug}" (${locale})`);
  }
  return toProductionUrl(built.path);
}

/**
 * Dựng SEO payload cho trang policy `slug` của `locale`.
 *
 * `canonicalUrl` luôn là chính trang đó; `alternates` phủ toàn bộ registry
 * (hreflang hai chiều kèm self-reference, đúng yêu cầu của Google).
 */
export function buildLegalSeo(
  locale: PublicLocale,
  slug: string,
  content: { title: string; description: string },
): LegalSeo {
  return {
    lang: getLocaleDefinition(locale)?.hreflang ?? locale,
    title: content.title,
    description: content.description,
    canonicalUrl: legalPageUrl(locale, slug),
    alternates: PUBLIC_LOCALES.map((definition) => ({
      rel: 'alternate' as const,
      hreflang: definition.hreflang,
      href: legalPageUrl(definition.code, slug),
    })),
  };
}
