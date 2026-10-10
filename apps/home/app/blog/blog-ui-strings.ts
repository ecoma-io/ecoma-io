/**
 * UI copy của blogs app, theo locale.
 *
 * Đây là **dictionary cục bộ của app**, không phải i18n framework: blogs chỉ có
 * một nhúm label cố định, và chúng là văn bản UI của riêng blog — không thuộc
 * locale dimension của `app/i18n` (registry đó chỉ sở hữu `code`/`hreflang`),
 * cũng không đủ để biện minh cho một abstraction i18n dùng chung.
 *
 * `Record<PublicLocale, ...>` nên thêm locale vào registry mà thiếu bản dịch là
 * lỗi type ngay tại khai báo — không có fallback im lặng về tiếng Anh. Khoá là
 * tiếng Anh vì chúng định danh vị trí trong UI; giá trị là chuỗi hiển thị đã
 * localized.
 */

import type { PublicLocale } from '../i18n/index';

/** Label UI của blog, đã resolve cho một locale. */
export type BlogUiStrings = {
  /** Tên bề mặt blog — nhãn điều hướng, disclosure mobile và phần title fallback của SEO. */
  readonly blog: string;
  /** Tiêu đề khối article featured trên landing. */
  readonly featured: string;
  /** Tiêu đề khối listing article trên landing. */
  readonly latest: string;
  /** Nhãn "đọc thêm" của card listing. */
  readonly readMore: string;
  /** Nhãn link về blog landing từ article page. */
  readonly allPosts: string;
  /** Nhãn link article trước đó. */
  readonly previous: string;
  /** Nhãn link article kế tiếp. */
  readonly next: string;
  /** Tiêu đề khối related articles. */
  readonly related: string;
  /** Tiêu đề khối footer meta của article (tác giả + ngày). */
  readonly writtenBy: string;
  /**
   * Tên truy cập được của `<nav>` bọc cặp prev/next.
   *
   * Landmark `<nav>` phải có tên phân biệt với các `<nav>` khác trên trang
   * (global nav của shell, locale switcher); thiếu tên thì screen reader chỉ
   * đọc "navigation" mà không nói là điều hướng nào.
   */
  readonly pagination: string;
  /** Danh sách tag của một article — nhãn truy cập được cho vùng tag. */
  readonly tags: string;
  /**
   * Tên truy cập được của scroll container bọc bảng Markdown (`ProseTable`).
   *
   * Container có `role="region"` + focus bằng bàn phím (cuộn ngang bảng rộng
   * hơn cột đọc); region phải có tên phân biệt, và tên theo locale của trang
   * — component resolve qua route vì `ContentRenderer` không truyền props.
   */
  readonly tableRegion: string;
};

const BLOG_UI_STRINGS: Readonly<Record<PublicLocale, BlogUiStrings>> = Object.freeze({
  en: Object.freeze({
    blog: 'Blog',
    featured: 'Featured',
    latest: 'Latest posts',
    readMore: 'Read more',
    allPosts: 'All posts',
    previous: 'Previous',
    next: 'Next',
    related: 'Related posts',
    writtenBy: 'By',
    pagination: 'Article navigation',
    tags: 'Tags',
    tableRegion: 'Data table',
  }),
  vi: Object.freeze({
    blog: 'Blog',
    featured: 'Nổi bật',
    latest: 'Bài mới nhất',
    readMore: 'Đọc tiếp',
    allPosts: 'Tất cả bài viết',
    previous: 'Bài trước',
    next: 'Bài sau',
    related: 'Bài liên quan',
    writtenBy: 'Tác giả',
    pagination: 'Điều hướng bài viết',
    tags: 'Thẻ',
    tableRegion: 'Bảng dữ liệu',
  }),
});

/** Label UI của blog cho một locale. */
export function blogUiStrings(locale: PublicLocale): BlogUiStrings {
  return BLOG_UI_STRINGS[locale];
}
