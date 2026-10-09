/**
 * UI copy của docs app, theo locale.
 *
 * Đây là **dictionary cục bộ của app**, không phải i18n framework: docs chỉ có
 * một nhúm label cố định, và chúng là văn bản UI của riêng docs — không thuộc
 * locale dimension của `i18n-public` (registry đó chỉ sở hữu `code`/`hreflang`),
 * cũng không đủ để biện minh cho một abstraction i18n dùng chung.
 *
 * `Record<PublicLocale, ...>` nên thêm locale vào registry mà thiếu bản dịch là
 * lỗi type ngay tại khai báo — không có fallback im lặng về tiếng Anh. Khoá là
 * tiếng Anh vì chúng định danh vị trí trong UI; giá trị là chuỗi hiển thị đã
 * localized.
 */

import type { PublicLocale } from '@ecoma-io/i18n-public';

/** Label UI của docs, đã resolve cho một locale. */
export type DocsUiStrings = {
  /** Tiêu đề của table of contents trong trang ("On this page"). */
  readonly onThisPage: string;
  /** Nhãn link tới document trước đó. */
  readonly previous: string;
  /** Nhãn link tới document kế tiếp. */
  readonly next: string;
  /** Tên bề mặt docs — dùng cho breadcrumb gốc và nhãn navigation. */
  readonly documentation: string;
  /** Tiêu đề của khối card section trên docs landing. */
  readonly sections: string;
};

const DOCS_UI_STRINGS: Readonly<Record<PublicLocale, DocsUiStrings>> = Object.freeze({
  en: Object.freeze({
    onThisPage: 'On this page',
    previous: 'Previous',
    next: 'Next',
    documentation: 'Documentation',
    sections: 'Sections',
  }),
  vi: Object.freeze({
    onThisPage: 'Nội dung',
    previous: 'Trước',
    next: 'Tiếp',
    documentation: 'Tài liệu',
    sections: 'Các phần',
  }),
});

/** Label UI của docs cho một locale. */
export function docsUiStrings(locale: PublicLocale): DocsUiStrings {
  return DOCS_UI_STRINGS[locale];
}
