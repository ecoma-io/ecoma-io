import { describe, expect, it } from 'vitest';
import { PUBLIC_LOCALES } from '@ecoma-io/i18n-public';
import { docsUiStrings } from './docs-ui-strings';

describe('docs UI strings', () => {
  it('resolves the documented labels for each locale', () => {
    expect(docsUiStrings('en')).toEqual({
      onThisPage: 'On this page',
      previous: 'Previous',
      next: 'Next',
      pagination: 'Pagination',
      documentation: 'Documentation',
      sections: 'Sections',
    });
    expect(docsUiStrings('vi')).toEqual({
      onThisPage: 'Nội dung',
      previous: 'Trước',
      next: 'Tiếp',
      pagination: 'Phân trang',
      documentation: 'Tài liệu',
      sections: 'Các phần',
    });
  });

  it('covers every locale in the registry', () => {
    // Dictionary khai báo `Record<PublicLocale, ...>` nên thiếu locale là lỗi
    // type ngay; test này khẳng định thêm rằng không locale nào trả undefined
    // lúc runtime (ví dụ khi registry được nạp khác đi).
    for (const definition of PUBLIC_LOCALES) {
      expect(docsUiStrings(definition.code)).toBeDefined();
    }
  });

  it('does not leak English copy into the Vietnamese strings', () => {
    const vi = docsUiStrings('vi');
    for (const value of Object.values(vi)) {
      expect(value).not.toMatch(/On this page|Previous|Next|Pagination|Documentation|Sections/u);
    }
  });

  it('localizes the TOC label as Nội dung and the pager labels as Trước / Tiếp', () => {
    const vi = docsUiStrings('vi');
    expect(vi.onThisPage).toBe('Nội dung');
    expect(vi.previous).toBe('Trước');
    expect(vi.next).toBe('Tiếp');
    expect(vi.pagination).toBe('Phân trang');
  });
});
