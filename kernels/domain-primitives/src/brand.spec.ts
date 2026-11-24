import type { Brand } from './brand.js';

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
type NumericId = Brand<number, 'NumericId'>;

const asUserId = (value: string): UserId => value as UserId;

describe('brand runtime behavior', () => {
  it('keeps the underlying type at runtime', () => {
    expect.hasAssertions();
    const userId = asUserId('user-1');

    expect(userId).toBe('user-1');
    expect(userId).toBeTypeOf('string');
  });

  it('keeps the underlying type operations available', () => {
    expect.hasAssertions();
    const numericId: NumericId = 42 as NumericId;

    expect(numericId + 1).toBe(43);
  });

  it('is transparent to the underlying runtime value', () => {
    expect.hasAssertions();
    const userId = asUserId('user-1');

    // Brand chỉ là annotation kiểu, không thay đổi giá trị runtime.
    expect(userId === 'user-1').toBe(true);
  });

  it('accepts values of the same brand interchangeably', () => {
    expect.hasAssertions();
    const a: UserId = asUserId('user-1'),
      b: UserId = a;

    expect(a).toBe(b);
  });
});

describe('brand type-level behavior', () => {
  // Kiểm thử thuần kiểu: expectTypeOf không tạo assertion runtime.
  it('preserves the underlying type at the type level', () => {
    expectTypeOf<UserId>().toMatchTypeOf<string>();
    expectTypeOf(asUserId('x')).toMatchTypeOf<string>();
    expectTypeOf<NumericId>().toMatchTypeOf<number>();
  });

  it('is not assignable across different brands of the same base type', () => {
    expectTypeOf<UserId>().not.toMatchTypeOf<OrderId>();
    expectTypeOf<OrderId>().not.toMatchTypeOf<UserId>();
  });

  it('is not assignable to an unrelated base type', () => {
    expectTypeOf<NumericId>().not.toMatchTypeOf<string>();
    expectTypeOf<UserId>().not.toMatchTypeOf<number>();
  });

  // @ts-expect-error — hai brand khác nhau không thể gán nhầm cho nhau.
  const misassigned: UserId = 'x' as OrderId;

  it('rejects cross-brand assignment at compile time', () => {
    expectTypeOf(misassigned).toEqualTypeOf<UserId>();
  });

  // @ts-expect-error — string thuần không gán trực tiếp được cho branded type.
  const raw: UserId = 'user-1';

  it('rejects raw unbranded values at compile time', () => {
    expectTypeOf(raw).toEqualTypeOf<UserId>();
  });
});
