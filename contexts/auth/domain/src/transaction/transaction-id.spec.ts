import { AuthConfigurationError } from '../shared/errors';
import { MIN_TRANSACTION_ID_LENGTH, createTransactionId } from './handle';
import type { TransactionId } from './handle';

/**
 * `createTransactionId` là đường brand DUY NHẤT từ chuỗi ngoài (wire, DB) vào
 * `TransactionId`. Sai định dạng hoặc quá ngắn phải ném trước khi giá trị được
 * tin là định danh transaction.
 */

describe('createTransactionId', () => {
  it('brands a 43-character base64url string (256-bit entropy floor)', () => {
    expect.hasAssertions();
    const value = 'a'.repeat(43),
      id: TransactionId = createTransactionId(value);
    expect(id).toBe(value);
  });

  it('accepts base64url alphabet including - and _', () => {
    expect.hasAssertions();
    expect(createTransactionId('a-b_c'.padEnd(43, 'd'))).toBe('a-b_c'.padEnd(43, 'd'));
  });

  it('rejects a too-short id (below MIN_TRANSACTION_ID_LENGTH)', () => {
    expect.hasAssertions();
    expect(() => createTransactionId('a'.repeat(MIN_TRANSACTION_ID_LENGTH - 1))).toThrow(
      AuthConfigurationError,
    );
  });

  it('rejects a non-base64url id (padding, +, /)', () => {
    expect.hasAssertions();
    for (const bad of [`${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`]) {
      expect(() => createTransactionId(bad)).toThrow(AuthConfigurationError);
    }
  });

  it('rejects characters outside the base64url alphabet', () => {
    expect.hasAssertions();
    expect(() => createTransactionId(`${'a'.repeat(42)}!`)).toThrow(AuthConfigurationError);
  });
});
