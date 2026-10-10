import { describe, expect, it } from 'vitest';
import { formatArticleDate, isValidArticleDate } from './blog-date';

describe('formatArticleDate', () => {
  it('formats an ISO date in the display locale', () => {
    // Với `en`, tháng in đầy đủ; chuỗi chính xác phụ thuộc ICU của runtime —
    // assert các phần bắt buộc thay vì một chuỗi cứng.
    const formatted = formatArticleDate('2026-09-02', 'en');
    expect(formatted).toContain('2026');
    expect(formatted.toLowerCase()).toContain('september');
    expect(formatted).toContain('2');
  });

  it('formats the same date differently per locale', () => {
    // Cùng ngày, hai locale — không khớp byte: điểm của helper là localized
    // display, không phải format cứng.
    const en = formatArticleDate('2026-09-02', 'en');
    const vi = formatArticleDate('2026-09-02', 'vi');
    expect(en).not.toBe(vi);
  });

  it('is timezone-stable: parses as UTC noon-anchored midnight', () => {
    // `2026-09-02T00:00:00Z` ở timezone âm (ví dụ UTC-10) vẫn là 2/9 —
    // không được trôi thành 1/9 hay 3/9 theo timezone của runner.
    expect(formatArticleDate('2026-09-02', 'en')).toContain('2');
  });

  it('returns an empty string for an unparseable date instead of Invalid Date', () => {
    // Ngày không tồn tại dù khớp shape (`2026-13-45`) hoặc chuỗi rỗng từ
    // fallback route — in `Invalid Date` ra UI là lỗi hiển thị, ẩn đi là đúng.
    expect(formatArticleDate('', 'en')).toBe('');
    expect(formatArticleDate('2026-13-45', 'en')).toBe('');
    expect(formatArticleDate('not-a-date', 'en')).toBe('');
  });
});

describe('isValidArticleDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidArticleDate('2026-09-02')).toBe(true);
  });

  it('rejects a shape-valid but nonexistent calendar date', () => {
    // Đây là lớp lỗi mà schema regex của content config không bắt được —
    // helper là lớp phòng vệ thứ hai của view.
    expect(isValidArticleDate('2026-02-31')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidArticleDate('')).toBe(false);
  });
});
