/**
 * UI copy của docs app, theo locale.
 *
 * Đây là **dictionary cục bộ của app**, không phải i18n framework: docs chỉ có
 * một nhúm label cố định, và chúng là văn bản UI của riêng docs — không thuộc
 * locale dimension của `app/i18n` (registry đó chỉ sở hữu `code`/`hreflang`),
 * cũng không đủ để biện minh cho một abstraction i18n dùng chung.
 *
 * `Record<PublicLocale, ...>` nên thêm locale vào registry mà thiếu bản dịch là
 * lỗi type ngay tại khai báo — không có fallback im lặng về tiếng Anh. Khoá là
 * tiếng Anh vì chúng định danh vị trí trong UI; giá trị là chuỗi hiển thị đã
 * localized.
 */

import type { PublicLocale } from '../i18n/index';

/** Label UI của docs, đã resolve cho một locale. */
export type DocsUiStrings = {
  /** Tiêu đề của table of contents trong trang ("On this page"). */
  readonly onThisPage: string;
  /** Nhãn link tới document trước đó. */
  readonly previous: string;
  /** Nhãn link tới document kế tiếp. */
  readonly next: string;
  /**
   * Tên truy cập được của `<nav>` bọc cặp prev/next.
   *
   * Landmark `<nav>` phải có tên phân biệt với các `<nav>` khác trên trang
   * (sidebar, TOC, breadcrumb, điều hướng global của shell); thiếu tên thì
   * screen reader chỉ đọc "navigation" mà không nói là điều hướng nào.
   */
  readonly pagination: string;
  /** Tên bề mặt docs — dùng cho nhãn navigation và tiêu đề disclosure trên mobile. */
  readonly documentation: string;
  /**
   * Tên truy cập được của `<nav>` breadcrumb.
   *
   * Phải **khác** `documentation`: breadcrumb và sidebar là hai landmark
   * `<nav>` cùng tồn tại trên một page, nên nếu dùng chung một chuỗi thì screen
   * reader đọc hai mục "Documentation" giống hệt nhau và người dùng không phân
   * biệt được đâu là breadcrumb, đâu là cây điều hướng.
   */
  readonly breadcrumbs: string;
  /** Tiêu đề của khối card section trên docs landing. */
  readonly sections: string;
  /**
   * Tên truy cập được của scroll container bọc bảng Markdown (`ProseTable`).
   *
   * Container có `role="region"` + focus bằng bàn phím (cuộn ngang bảng rộng
   * hơn cột đọc); region phải có tên phân biệt, và tên theo locale của trang —
   * component resolve qua route vì `ContentRenderer` không truyền props.
   */
  readonly tableRegion: string;
  /**
   * Tiêu đề `<h1>` của trang lỗi 404 ("Page not found").
   *
   * Trang 404 tĩnh (`error.vue` → `404.html` qua wrangler
   * `not_found_handling`) render bằng locale **mặc định khi build** vì file
   * tĩnh duy nhất không biết URL bị lỗi thuộc locale nào — copy theo locale
   * khác không thể chọn được lúc serve. Vẫn giữ entry per-locale ở đây để
   * thêm locale vào registry mà thiếu bản dịch là lỗi type.
   */
  readonly notFoundTitle: string;
  /** Mô tả dưới tiêu đề của trang 404. */
  readonly notFoundDescription: string;
  /** Nhãn CTA quay về docs landing. */
  readonly notFoundBackToDocs: string;
};

const DOCS_UI_STRINGS: Readonly<Record<PublicLocale, DocsUiStrings>> = Object.freeze({
  en: Object.freeze({
    onThisPage: 'On this page',
    previous: 'Previous',
    next: 'Next',
    pagination: 'Pagination',
    documentation: 'Documentation',
    breadcrumbs: 'Breadcrumbs',
    sections: 'Sections',
    tableRegion: 'Data table',
    notFoundTitle: 'Page not found',
    notFoundDescription:
      'The documentation page you are looking for does not exist or has been moved.',
    notFoundBackToDocs: 'Back to documentation',
  }),
  vi: Object.freeze({
    onThisPage: 'Nội dung',
    previous: 'Trước',
    next: 'Tiếp',
    pagination: 'Phân trang',
    documentation: 'Tài liệu',
    breadcrumbs: 'Đường dẫn',
    sections: 'Các phần',
    tableRegion: 'Bảng dữ liệu',
    notFoundTitle: 'Không tìm thấy trang',
    notFoundDescription: 'Trang tài liệu bạn tìm không tồn tại hoặc đã được di chuyển.',
    notFoundBackToDocs: 'Về trang tài liệu',
  }),
});

/** Label UI của docs cho một locale. */
export function docsUiStrings(locale: PublicLocale): DocsUiStrings {
  return DOCS_UI_STRINGS[locale];
}
