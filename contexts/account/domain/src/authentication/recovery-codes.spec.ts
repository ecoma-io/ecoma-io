import {
  RECOVERY_CODES_PER_SET,
  RECOVERY_CODE_ENTROPY_BYTES,
  createRecoveryCode,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from './recovery-codes';
import type { RecoveryCode } from './recovery-codes';

/** Nguồn byte tất định, tuần tự — để snapshot được chuỗi code không phụ thuộc CSPRNG. */
function deterministicRandom(): (length: number) => Uint8Array {
  let counter = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      out[i] = (counter + i * 7) % 256;
    }
    counter += length;
    return out;
  };
}

/** Sinh một code từ nguồn tất định — helper dùng chung của suite. */
function deterministicCode(): Promise<RecoveryCode> {
  return createRecoveryCode(deterministicRandom());
}

describe('formatRecoveryCode', () => {
  it('renders ten bytes as five dash-separated Base32 groups of four', () => {
    expect.hasAssertions();
    // 10 byte = 80 bit = 16 ký tự Base32 = 5 nhóm 4 ký tự.
    const bytes = new Uint8Array(RECOVERY_CODE_ENTROPY_BYTES).fill(0);
    expect(formatRecoveryCode(bytes)).toBe('AAAA-AAAA-AAAA-AAAA-AAAA');
  });

  it('maps an all-ones buffer to the top of the alphabet', () => {
    expect.hasAssertions();
    const bytes = new Uint8Array(RECOVERY_CODE_ENTROPY_BYTES).fill(0xff);
    // 0xff... liên tục: mỗi nhóm 5 bit đều 31 → '7'. Đúng biên trên của alphabet.
    expect(formatRecoveryCode(bytes)).toBe('7777-7777-7777-7777-7777');
  });

  it('uses only characters from the RFC 4648 Base32 alphabet', async () => {
    expect.hasAssertions();
    const code = await deterministicCode();
    expect(code.plaintext).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/u);
  });

  it('excludes lookalike digits 0, 1, 8 and 9 by construction', () => {
    expect.hasAssertions();
    // Alphabet Base32 không chứa 0/1/8/9 — người dùng không phải phân biệt O/0, I/1.
    for (let i = 0; i < 20; i += 1) {
      const bytes = new Uint8Array(RECOVERY_CODE_ENTROPY_BYTES);
      crypto.getRandomValues(bytes);
      const code = formatRecoveryCode(bytes);
      expect(code).not.toMatch(/[0189]/u);
    }
  });
});

describe('generateRecoveryCodes', () => {
  it('generates the full set of distinct codes', async () => {
    expect.hasAssertions();
    const codes = await generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODES_PER_SET);
    const plaintexts = new Set(codes.map((code) => code.plaintext));
    expect(plaintexts.size).toBe(RECOVERY_CODES_PER_SET);
  });

  it('never repeats a hash across the set', async () => {
    expect.hasAssertions();
    // Hai code trùng hash là hai mã cùng một giá trị — sinh trùng là lỗi entropy,
    // Còn trùng hash khi plaintext khác nhau là lỗi thuật toán.
    const codes = await generateRecoveryCodes(),
      hashes = new Set(codes.map((code) => code.hash));
    expect(hashes.size).toBe(RECOVERY_CODES_PER_SET);
  });

  it('is deterministic for a fixed random source', async () => {
    expect.hasAssertions();
    const first = await generateRecoveryCodes(deterministicRandom()),
      second = await generateRecoveryCodes(deterministicRandom());
    expect(first.map((code) => code.plaintext)).toStrictEqual(second.map((code) => code.plaintext));
  });

  it('carries a distinct salt per code', async () => {
    expect.hasAssertions();
    const codes = await generateRecoveryCodes(),
      salts = new Set(codes.map((code) => code.salt));
    expect(salts.size).toBe(RECOVERY_CODES_PER_SET);
  });
});

describe('hashRecoveryCode / verifyRecoveryCode', () => {
  it('verifies the exact code it hashed', async () => {
    expect.hasAssertions();
    const { hash, salt } = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV');
    await expect(verifyRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV', { hash, salt })).resolves.toBe(
      true,
    );
  });

  it('verifies a transcribed code regardless of case, dashes and spaces', async () => {
    expect.hasAssertions();
    const code = await deterministicCode(),
      { hash, salt } = await hashRecoveryCode(code.plaintext),
      variants = [
        code.plaintext.toLowerCase(),
        code.plaintext.replaceAll('-', ''),
        code.plaintext.replaceAll('-', ' ').toLowerCase(),
        ` ${code.plaintext.toLowerCase()} `,
      ];
    await Promise.all(
      variants.map((variant) =>
        expect(verifyRecoveryCode(variant, { hash, salt })).resolves.toBe(true),
      ),
    );
  });

  it('rejects a different code', async () => {
    expect.hasAssertions();
    const { hash, salt } = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV');
    await expect(
      verifyRecoveryCode('ZZZZ-EFGH-JKLM-NPQR-STUV', { hash, salt }),
    ).resolves.toBeFalsy();
  });

  it('hashes the same code differently under two fresh salts', async () => {
    expect.hasAssertions();
    // Salt per-code là điều kiện của hash credential: cùng plaintext hai lần phải
    // Cho hai hash khác nhau, và mỗi cặp (hash, salt) vẫn verify đúng code của nó.
    const left = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV'),
      right = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV');
    expect(left.hash).not.toBe(right.hash);
    await expect(verifyRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV', left)).resolves.toBe(true);
    await expect(verifyRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV', right)).resolves.toBe(true);
  });

  it('rejects an empty or garbage candidate', async () => {
    expect.hasAssertions();
    const { hash, salt } = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV');
    await expect(verifyRecoveryCode('', { hash, salt })).resolves.toBeFalsy();
    await expect(verifyRecoveryCode('not a code at all', { hash, salt })).resolves.toBeFalsy();
  });

  it('produces a 64-hex digest and a 32-hex salt', async () => {
    expect.hasAssertions();
    const { hash, salt } = await hashRecoveryCode('ABCD-EFGH-JKLM-NPQR-STUV');
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(salt).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('binds verify and generation to the same derivation path', async () => {
    expect.hasAssertions();
    // Assertion mutation-test: nếu verify tách khỏi hash (thuật toán khác, số vòng
    // Khác), ca này đỏ — generator và verifier lệch nhau là lỗi chỉ thấy khi cả hai
    // Cùng chạy qua đường thật của module.
    const code = await deterministicCode();
    await expect(
      verifyRecoveryCode(code.plaintext, { hash: code.hash, salt: code.salt }),
    ).resolves.toBeTruthy();
  });
});
