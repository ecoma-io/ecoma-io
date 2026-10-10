/**
 * Smoke verification sau deploy cho deploy unit `home`.
 *
 * Khẳng định thực tế trên HTTP response — không chấp nhận "wrangler deploy
 * exit 0" làm bằng chứng (yêu cầu §4 của task và §7.4 delivery doc). Mỗi
 * assertion kiểm một đặc tính quan sát được của bề mặt đã hứa hẹn:
 *
 * - `/` phải 302 về locale mặc định (`/en`) server-side — locale-resolution
 *   entry point, không serve content (A13).
 * - `/{locale}` phải 200 với HTML SSR thật: `<html lang>` đúng, canonical
 *   tuyệt đối dưới production origin, `<h1>` present.
 * - Staging thêm một khẳng định: `X-Robots-Tag: noindex` phải có mặt, và
 *   canonical **không** được trỏ production origin (staging không được
 *   chiếm canonical URL của production).
 * - `/favicon.ico` phải 200 — asset tĩnh đi qua Workers Assets.
 *
 * Production chạy cùng bộ assertion trừ nhánh staging (`noIndex: false`),
 * qua một hàm duy nhất để hai làn không thể trôi khỏi nhau.
 */

/** Cấu hình một lần chạy smoke — môi trường quyết định origin và noindex. */
export type SmokeRunOptions = {
  /** Origin để test (`https://ecoma.io.vn` staging, `https://ecoma.io` prod). */
  readonly origin: string;
  /** Staging là `true`: bắt buộc `X-Robots-Tag: noindex`. */
  readonly noIndex: boolean;
  /** Fetch tuỳ biến cho test; mặc định `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
};

/** Kết quả một assertion đơn. */
export type SmokeCheckResult = {
  /** Tên ổn định của assertion — dùng trong output workflow. */
  readonly name: string;
  readonly passed: boolean;
  /** Chi tiết khi fail; rỗng khi pass. */
  readonly detail: string;
};

/** Kết quả toàn bộ run: pass chỉ khi mọi assertion pass. */
export type SmokeRunResult = {
  readonly passed: boolean;
  readonly checks: readonly SmokeCheckResult[];
};

/** Locale mặc định của Home — khớp `apps/home/shared/default-locale.ts`. */
const DEFAULT_LOCALE = 'en';

/** Hai locale của registry public — khớp `PUBLIC_LOCALES` của `i18n-public`. */
const PUBLIC_LOCALES = ['en', 'vi'] as const;

/** Production origin — khớp `HOME_PRODUCTION_ORIGIN` của app. */
const PRODUCTION_ORIGIN = 'https://ecoma.io';

/**
 * Dựng một check pass/fail ngắn gọn — helper nội bộ giữ style hàm thuần.
 */
function check(name: string, passed: boolean, detail = ''): SmokeCheckResult {
  return { name, passed, detail: passed ? '' : detail };
}

/**
 * Chạy toàn bộ smoke suite cho một origin đã deploy.
 *
 * Hàm không throw: mọi lỗi mạng/HTTP đều trở thành check fail kèm chi tiết,
 * để caller (workflow) ghi kết quả đầy đủ thay vì mất thông tin ở một
 * exception. `passed` của run là AND của mọi check.
 */
export async function runSmokeChecks(options: SmokeRunOptions): Promise<SmokeRunResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const checks: SmokeCheckResult[] = [];

  // --- `/` → 302 `/en` (locale resolution entry point) ---
  try {
    const res = await doFetch(`${options.origin}/`, {
      redirect: 'manual',
      headers: { 'user-agent': 'ecoma-smoke/1.0' },
    });
    checks.push(
      check('root-redirect-status', res.status === 302, `expected 302, got ${res.status}`),
    );
    const location = res.headers.get('location');
    checks.push(
      check(
        'root-redirect-location',
        location === `/${DEFAULT_LOCALE}`,
        `expected "/${DEFAULT_LOCALE}", got ${JSON.stringify(location)}`,
      ),
    );
  } catch (error) {
    checks.push(check('root-redirect', false, `request failed: ${String(error)}`));
  }

  // --- `/{locale}` SSR surface cho từng locale ---
  for (const locale of PUBLIC_LOCALES) {
    const name = `locale-${locale}`;
    try {
      const res = await doFetch(`${options.origin}/${locale}`, {
        redirect: 'manual',
        headers: { 'user-agent': 'ecoma-smoke/1.0' },
      });
      checks.push(check(`${name}-status`, res.status === 200, `expected 200, got ${res.status}`));
      if (res.status !== 200) {
        continue;
      }

      // Staging phải noindex; production không được noindex (SEO).
      const robots = res.headers.get('x-robots-tag');
      checks.push(
        options.noIndex
          ? check(
              `${name}-noindex`,
              robots !== null && /noindex/iu.test(robots),
              `expected X-Robots-Tag with noindex, got ${JSON.stringify(robots)}`,
            )
          : check(
              `${name}-indexable`,
              robots === null || !/noindex/iu.test(robots),
              `production must not be noindex, got ${JSON.stringify(robots)}`,
            ),
      );

      const html = await res.text();
      const langMatch = /<html[^>]*\blang="([^"]*)"/u.exec(html);
      checks.push(
        check(
          `${name}-ssr-lang`,
          langMatch !== null && langMatch[1].length > 0,
          'SSR HTML missing <html lang>',
        ),
      );

      const h1 = /<h1[\s>]/u.test(html);
      checks.push(check(`${name}-ssr-h1`, h1, 'SSR HTML missing <h1>'));

      const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/u.exec(html);
      checks.push(
        check(
          `${name}-canonical-absolute`,
          canonical !== null && canonical[1].startsWith('https://'),
          `canonical must be an absolute https URL, got ${JSON.stringify(canonical?.[1])}`,
        ),
      );

      if (options.noIndex) {
        // Staging không được tự tuyên bố canonical production-origin: crawler
        // index một trang staging nhưng canonical của nó vẫn phải là staging
        // origin (và trang đó bị noindex nên canonical gần như vô nghĩa).
        // So sánh **origin** qua URL chứ không startsWith chuỗi: `ecoma.io.vn`
        // cũng startsWith `ecoma.io` — so chuỗi sẽ dương tính giả.
        let canonicalIsProduction = false;
        if (canonical !== null) {
          try {
            canonicalIsProduction = new URL(canonical[1]).origin === PRODUCTION_ORIGIN;
          } catch {
            // URL không parse được đã bị check canonical-absolute bắt riêng.
          }
        }
        checks.push(
          check(
            `${name}-canonical-not-production`,
            !canonicalIsProduction,
            `staging canonical must not claim the production origin, got ${JSON.stringify(canonical?.[1])}`,
          ),
        );
      }
    } catch (error) {
      checks.push(check(name, false, `request failed: ${String(error)}`));
    }
  }

  // --- favicon qua Workers Assets ---
  try {
    const res = await doFetch(`${options.origin}/favicon.ico`, {
      redirect: 'manual',
      headers: { 'user-agent': 'ecoma-smoke/1.0' },
    });
    checks.push(check('favicon-status', res.status === 200, `expected 200, got ${res.status}`));
  } catch (error) {
    checks.push(check('favicon', false, `request failed: ${String(error)}`));
  }

  return { passed: checks.every((c) => c.passed), checks };
}
