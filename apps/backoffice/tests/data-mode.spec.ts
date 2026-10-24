import { describe, expect, it } from 'vitest';

import {
  BACKOFFICE_PREVIEW_DATA_MODE,
  resolveBackofficeDataMode,
} from '../app/backoffice-data/data-mode';

/**
 * Matrix quyết định chế độ dữ liệu.
 *
 * Luật là fail-closed, nên test phải khẳng định **mọi** giá trị không đúng chuỗi
 * `'prototype'` đều rơi vào `'unavailable'`. Các giá trị "gần đúng" quan trọng
 * hơn cả: một `vars` bị gõ `Prototype` hay thừa khoảng trắng không được mở cổng
 * mock ở Production.
 */
describe('resolveBackofficeDataMode', () => {
  it('enables prototype only when the value equals the specified string exactly', () => {
    expect(resolveBackofficeDataMode(BACKOFFICE_PREVIEW_DATA_MODE)).toBe('prototype');
    expect(BACKOFFICE_PREVIEW_DATA_MODE).toBe('prototype');
  });

  it('fails closed when configuration is missing', () => {
    expect(resolveBackofficeDataMode(undefined)).toBe('unavailable');
    expect(resolveBackofficeDataMode(null)).toBe('unavailable');
  });

  it.each([
    ['empty string', ''],
    ['explicit disabled value', 'disabled'],
    ['wrong case', 'PROTOTYPE'],
    ['leading capital', 'Prototype'],
    ['trailing whitespace', 'prototype '],
    ['unsupported synonym', 'preview'],
    ['unsupported synonym', 'mock'],
    ['unsupported synonym', 'realtime'],
    ['boolean-like string', 'true'],
    ['unrelated value', 'yes'],
    ['another app value', 'staging'],
  ])('string %s -> unavailable', (_label, raw) => {
    expect(resolveBackofficeDataMode(raw)).toBe('unavailable');
  });

  it.each([
    ['boolean true', true],
    ['boolean false', false],
    ['number 1', 1],
    ['number 0', 0],
    ['object', { mode: 'prototype' }],
    ['array', ['prototype']],
  ])('non-string value (%s) -> unavailable', (_label, raw) => {
    expect(resolveBackofficeDataMode(raw)).toBe('unavailable');
  });

  it('an object that looks like valid configuration still does not enable prototype', () => {
    // `destr` của Nitro có thể parse JSON từ env; một object tới đây là cấu hình
    // sai kiểu, không phải cấu hình hợp lệ.
    expect(resolveBackofficeDataMode({ value: 'prototype' })).toBe('unavailable');
  });
});
