import { createSubject, isSubject, subjectEntropy } from '../account/subject';

/** 32 ký tự base32 hợp lệ (160 bit entropy). */
const VALID_ENTROPY = 'abcdefghijklmnopqrstuvwxyz234567';

describe('createSubject', () => {
  it('builds an opaque sub from valid entropy', () => {
    expect.hasAssertions();
    const sub = createSubject(VALID_ENTROPY);
    expect(sub).toBe(`sub_${VALID_ENTROPY}`);
    expect(isSubject(sub)).toBe(true);
  });

  it.each([
    ['uppercase characters', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456'],
    ['digits outside the base32 alphabet', 'abcdefghijklmnopqrstuvwxyz234560'],
    ['too short', 'abcdefghij'],
    ['too long', `${VALID_ENTROPY}aa`],
    ['empty', ''],
    ['non-base32 symbols', 'abcdefghijklmnopqrstuvwxyz23456!'],
    ['padding character', 'abcdefghijklmnopqrstuvwxyz23456='],
  ])('rejects %s', (_label, entropy) => {
    expect.hasAssertions();
    expect(() => createSubject(entropy)).toThrow(TypeError);
  });

  it('rejects a non-string entropy', () => {
    expect.hasAssertions();
    const notStrings = [123, undefined, undefined, {}, ['abcdefghijklmnopqrstuvwxyz234567']];
    for (const value of notStrings) {
      expect(() => createSubject(value as unknown as string)).toThrow(TypeError);
    }
  });

  it('never accepts an already prefixed sub as entropy', () => {
    expect.hasAssertions();
    // Chặn lỗi "truyền nhầm sub đã có prefix" — nếu lỗi này lọt, kết quả là
    // `sub_sub_...`, tức một định danh khác hẳn đã qua kiểm tra định dạng.
    expect(() => createSubject(`sub_${VALID_ENTROPY}`)).toThrow(TypeError);
  });
});

describe('isSubject', () => {
  it('accepts a subject produced by createSubject', () => {
    expect.hasAssertions();
    expect(isSubject(createSubject(VALID_ENTROPY))).toBe(true);
  });

  it.each([
    ['a plain string', 'sub_'],
    ['an empty string', ''],
    ['a non-string', 42],
    ['null', undefined],
    ['undefined', undefined],
    ['an object', { sub: `sub_${VALID_ENTROPY}` }],
    ['uppercase sub', `SUB_${VALID_ENTROPY}`],
    ['sub without prefix', VALID_ENTROPY],
  ])('rejects %s', (_label, value) => {
    expect.hasAssertions();
    expect(isSubject(value)).toBeFalsy();
  });
});

describe('subjectEntropy', () => {
  it('returns the entropy part without the prefix', () => {
    expect.hasAssertions();
    expect(subjectEntropy(createSubject(VALID_ENTROPY))).toBe(VALID_ENTROPY);
  });

  it('keeps the value usable to rebuild an identical subject', () => {
    expect.hasAssertions();
    const sub = createSubject(VALID_ENTROPY);
    expect(createSubject(subjectEntropy(sub))).toBe(sub);
  });
});
