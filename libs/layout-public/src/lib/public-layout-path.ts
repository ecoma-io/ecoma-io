/**
 * Kiểu kết quả chung của `layout-public` — phần pathname sau khi locale đã
 * được `i18n-public` giải quyết.
 *
 * Thư viện **không normalize input**: mọi kiểm tra cấu trúc kế thừa từ
 * `parsePublicPath`/`localizePath` của `i18n-public`; phần thêm riêng ở đây
 * là mount matching. Expected invalid input luôn trả `{ kind: 'invalid',
 * reason }` — không bao giờ throw.
 */

import type { PublicLocale, PublicPathReason } from '@ecoma-io/i18n-public';
import type { PublicMount } from './mount-registry';

/**
 * Lý do một pathname bị `layout-public` từ chối.
 *
 * Tập lý do bằng đúng tập của `i18n-public` cộng `unknown_mount` — mỗi lý do
 * ứng với một action khác nhau phía caller:
 *
 * - `not_a_pathname` / `trailing_slash` / `empty_segment` / `unsupported_locale` —
 *   pass-through từ `parsePublicPath` (parse) hoặc `localizePath` (build);
 *   cấu trúc được kiểm tra trước mount, nên `/en//docs`, `/en/docs/` không
 *   bao giờ bị gán nhầm `unknown_mount`.
 * - `unknown_mount` — segment sau locale không khớp mount registry nào
 *   (`/en/unknown`, `/en/blogging`), input build thiếu mount trong khi
 *   `path` khác rỗng (JS caller vi phạm contract type), hoặc input build
 *   ghép lại thành pathname có topology **khác** mount đã yêu cầu
 *   (`{ mount: 'docs', path: '/api' }` thuộc mount `docs/api` — caller
 *   phải dựng `{ mount: 'docs/api' }`, builder không reinterpret).
 *
 * `not_localized` và `already_localized` là lý do riêng của `switchLocale`/
 * `localizePath` — hai hàm này không thuộc `layout-public`, nhưng kiểu dùng
 * chung `PublicPathReason` nên chúng vẫn có mặt trong union (đúng convention
 * của `i18n-public`: mỗi hàm document rõ lý do nào hàm đó thực sự phát).
 */
export type PublicLayoutPathReason = PublicPathReason | 'unknown_mount';

/**
 * Kết quả phân biệt (discriminated) của `parsePublicLayoutPath` và
 * `buildPublicPath`.
 *
 * Bốn state:
 * - `root` — đúng `/`: locale-resolution entry point, không serve content,
 *   không phải `en` và không phải invalid;
 * - `locale-root` — `/en`, `/vi`: bề mặt root public, không có mount;
 * - `localized` — pathname có mount: `mount` khớp registry, `remainder` là
 *   phần **sau mount** (`/en/docs/api/guide` → `mount = 'docs/api'`,
 *   `remainder = '/guide'`) — khác với `remainder` sau locale của
 *   `i18n-public`;
 * - `invalid` — kèm typed reason, không throw.
 *
 * `path` trên variant thành công là public path đầy đủ, không bao giờ có
 * trailing slash — giữ nguyên từng byte kể từ input (parse) hoặc đúng những
 * gì đã dựng (build).
 */
export type PublicLayoutPathResult =
  | { readonly kind: 'root'; readonly path: '/' }
  | {
      readonly kind: 'locale-root';
      readonly locale: PublicLocale;
      readonly path: string;
    }
  | {
      readonly kind: 'localized';
      readonly locale: PublicLocale;
      readonly mount: PublicMount;
      readonly path: string;
      readonly remainder: string;
    }
  | { readonly kind: 'invalid'; readonly reason: PublicLayoutPathReason };

/**
 * Input của `buildPublicPath`.
 *
 * Hai nhánh, `path` chỉ có ý nghĩa khi `mount` có mặt:
 * - `{ locale }` — bề mặt locale-root (`/en`);
 * - `{ locale, mount, path? }` — mounted surface; `path` là resource path
 *   **dưới mount**, phải bắt đầu bằng `/` hoặc là `''` (mặc định).
 *
 * Contract này được enforce cả ở type (nhánh đầu không nhận `path`) lẫn ở
 * runtime (`unknown_mount` khi JS caller truyền `path` không kèm `mount`).
 */
export type PublicLayoutPathInput =
  | {
      readonly locale: PublicLocale;
      readonly mount?: undefined;
      readonly path?: undefined;
    }
  | {
      readonly locale: PublicLocale;
      readonly mount: PublicMount;
      readonly path?: string;
    };

/** Variant invalid cho sẵn — mọi early-return dùng đúng một constructor này. */
export function invalidLayoutPath(reason: PublicLayoutPathReason): PublicLayoutPathResult {
  return { kind: 'invalid', reason };
}
