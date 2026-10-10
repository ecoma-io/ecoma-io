/**
 * Nội dung Home — localized, type-safe, **thuộc sở hữu của application**.
 *
 * Home tự sở hữu content của mình; `layout-public` chỉ sở hữu chrome dùng
 * chung (header/footer/navigation) và không biết content của Home. Cấu trúc
 * `Record<PublicLocale, HomeContent>` khiến việc thêm một locale vào
 * `i18n-public` mà thiếu bản dịch trở thành lỗi type ngay tại khai báo, không
 * phải lỗi runtime.
 *
 * Nội dung ở đây là copy **trung tính, mô tả đúng bề mặt đang tồn tại** —
 * không hứa hẹn tính năng chưa có, không số liệu, không claim sản phẩm suy
 * đoán. `HomeContent` là dữ liệu thuần (không hàm, không JSX/VNode) nên
 * render được như nhau ở server và client — cùng input cho cùng output.
 */

import type { PublicLocale } from '@ecoma-io/i18n-public';

/**
 * Nội dung một trang Home cho một locale.
 *
 * `readonly` ở mọi field: content là dữ liệu tĩnh, không phải mutable state.
 */
export type HomeContent = {
  /** Tiêu đề tài liệu (localized) — `document.title`. */
  readonly title: string;
  /** Tiêu đề chính của trang (một `<h1>` duy nhất). */
  readonly heading: string;
  /** Mô tả ngắn, một câu, dùng cho cả phần hero và meta description. */
  readonly description: string;
  /** Nội dung chính — các đoạn văn giới thiệu. */
  readonly intro: readonly string[];
  /** Nhãn khối giới thiệu nền tảng. */
  readonly platformLabel: string;
  /** Các điểm mô tả nền tảng, trung tính và đúng với bề mặt public hiện tại. */
  readonly platformPoints: readonly string[];
  /** Nhãn CTA hero trỏ tới docs — destination thật duy nhất của public web. */
  readonly docsCta: string;
  /** Nhãn CTA phụ hero trỏ tới blog. */
  readonly blogCta: string;
  /** Tiêu đề `<h1>` của trang lỗi 404 — render qua `libs/error-pages`. */
  readonly notFoundTitle: string;
  /** Mô tả dưới tiêu đề của trang 404. */
  readonly notFoundDescription: string;
  /** Nhãn CTA của trang 404 — trỏ về locale-root của URL lỗi. */
  readonly notFoundCta: string;
};

/**
 * Nội dung Home cho mọi locale của registry.
 *
 * Khoá là `PublicLocale` nên thiếu bản dịch cho một locale là lỗi compile
 * time; không có nhánh fallback runtime và không có bảng locale thứ hai.
 */
export const HOME_CONTENT: Readonly<Record<PublicLocale, HomeContent>> = Object.freeze({
  en: Object.freeze({
    title: 'Ecoma.io — public home',
    heading: 'Ecoma.io',
    description: 'The public home of ecoma.io, available in English and Vietnamese.',
    intro: Object.freeze([
      'This is the public landing surface of ecoma.io.',
      'Every page is served under a locale prefix, so a URL always names the language it renders in.',
    ]),
    platformLabel: 'About the platform',
    platformPoints: Object.freeze([
      'Public pages are served from the edge and rendered on the server.',
      'English and Vietnamese are first-class locales, each with its own stable URL.',
    ]),
    docsCta: 'Read the docs',
    blogCta: 'Visit the blog',
    notFoundTitle: 'Page not found',
    notFoundDescription: 'The page you are looking for does not exist.',
    notFoundCta: 'Go to the homepage',
  }),
  vi: Object.freeze({
    title: 'Ecoma.io — trang chủ public',
    heading: 'Ecoma.io',
    description: 'Trang chủ public của ecoma.io, hiển thị bằng tiếng Anh và tiếng Việt.',
    intro: Object.freeze([
      'Đây là bề mặt public của ecoma.io.',
      'Mọi trang đều được phục vụ dưới một locale prefix, nên URL luôn nói rõ ngôn ngữ mà trang hiển thị.',
    ]),
    platformLabel: 'Về nền tảng',
    platformPoints: Object.freeze([
      'Các trang public được phục vụ từ edge và render ở server.',
      'Tiếng Anh và tiếng Việt đều là locale hạng nhất, mỗi locale có URL ổn định riêng.',
    ]),
    docsCta: 'Đọc tài liệu',
    blogCta: 'Xem blog',
    notFoundTitle: 'Không tìm thấy trang',
    notFoundDescription: 'Trang bạn tìm không tồn tại.',
    notFoundCta: 'Về trang chủ',
  }),
});
