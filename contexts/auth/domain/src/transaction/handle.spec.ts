import {
  HANDLE_DOMAINS,
  assertHandleBelongsToTransaction,
  base64UrlToBytes,
  bytesToBase64Url,
  createTransactionId,
  deriveHandle,
  hashHandle,
  lengthPrefixed,
  timingSafeEqual,
} from '../index';
import type { TransactionId } from '../index';
import { OAuthProtocolError } from '../shared/errors';

/** 32 byte base64url — kích thước khoá HMAC chuẩn. */
const K_AUTH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  K_OTHER = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  TX_A = createTransactionId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  TX_B = createTransactionId('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

describe('deriveHandle', () => {
  it('derives a 43-character base64url handle', async () => {
    expect.hasAssertions();
    const handle = await deriveHandle({
      domain: HANDLE_DOMAINS.loginHandoff,
      key: K_AUTH,
      transactionId: TX_A,
    });
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('recomputes the same value for the same transaction', async () => {
    expect.hasAssertions();
    const first = await deriveHandle({
        domain: HANDLE_DOMAINS.consentContinuation,
        key: K_AUTH,
        transactionId: TX_A,
      }),
      second = await deriveHandle({
        domain: HANDLE_DOMAINS.consentContinuation,
        key: K_AUTH,
        transactionId: TX_A,
      });
    expect(first).toBe(second);
  });

  it('domain separation: same transaction, three domains, three distinct values', async () => {
    expect.hasAssertions();
    // FR-016l. Neu ba domain ra cung gia tri, handle loai nay dung duoc cho
    // Loai kia va state machine mat het y nghia.
    const values = await Promise.all(
      Object.values(HANDLE_DOMAINS).map((domain) =>
        deriveHandle({ domain, key: K_AUTH, transactionId: TX_A }),
      ),
    );
    expect(new Set(values).size).toBe(3);
  });

  it('a different transaction yields a different handle', async () => {
    expect.hasAssertions();
    const a = await deriveHandle({
        domain: HANDLE_DOMAINS.authorizationCode,
        key: K_AUTH,
        transactionId: TX_A,
      }),
      b = await deriveHandle({
        domain: HANDLE_DOMAINS.authorizationCode,
        key: K_AUTH,
        transactionId: TX_B,
      });
    expect(a).not.toBe(b);
  });

  it('a different key yields a different handle', async () => {
    expect.hasAssertions();
    const a = await deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        key: K_AUTH,
        transactionId: TX_A,
      }),
      b = await deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        key: K_OTHER,
        transactionId: TX_A,
      });
    expect(a).not.toBe(b);
  });

  it('transaction_id is never embedded in plaintext', async () => {
    expect.hasAssertions();
    const handle = await deriveHandle({
      domain: HANDLE_DOMAINS.loginHandoff,
      key: K_AUTH,
      transactionId: TX_A,
    });
    expect(handle).not.toContain(TX_A);
  });

  it('rejects a too-short transaction_id', async () => {
    expect.hasAssertions();
    await expect(
      deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        key: K_AUTH,
        transactionId: 'abc' as TransactionId,
      }),
    ).rejects.toThrow(/qua ngan/u);
  });

  it('rejects a transaction_id that is not base64url', async () => {
    expect.hasAssertions();
    await expect(
      deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        key: K_AUTH,
        transactionId: `${TX_A}+` as TransactionId,
      }),
    ).rejects.toThrow(/base64url/u);
  });

  it('rejects an unknown domain', async () => {
    expect.hasAssertions();
    await expect(
      deriveHandle({
        domain: 'khong-ton-tai' as (typeof HANDLE_DOMAINS)[keyof typeof HANDLE_DOMAINS],
        key: K_AUTH,
        transactionId: TX_A,
      }),
    ).rejects.toThrow(/domain khong hop le/u);
  });

  it('rejects a key of the wrong length', async () => {
    expect.hasAssertions();
    await expect(
      deriveHandle({ domain: HANDLE_DOMAINS.loginHandoff, key: 'c2hvcnQ', transactionId: TX_A }),
    ).rejects.toThrow(/32 byte/u);
  });
});

describe('lengthPrefixed', () => {
  it('is injective: ("ab","c") and ("a","bc") produce different byte strings', () => {
    expect.hasAssertions();
    // Khong length-prefix thi ca hai cho cung mot thong diep HMAC. Do la duong
    // Thuc de vuot domain separation khi mot phan input do caller chon.
    const enc = new TextEncoder(),
      a = lengthPrefixed([enc.encode('ab'), enc.encode('c')]),
      b = lengthPrefixed([enc.encode('a'), enc.encode('bc')]);
    expect(new Uint8Array(a)).not.toStrictEqual(new Uint8Array(b));
  });

  it('does not truncate on an empty middle field', () => {
    expect.hasAssertions();
    const enc = new TextEncoder(),
      withEmpty = lengthPrefixed([enc.encode('ab'), enc.encode(''), enc.encode('cd')]),
      without = lengthPrefixed([enc.encode('abcd')]);
    expect(new Uint8Array(withEmpty)).not.toStrictEqual(new Uint8Array(without));
  });
});

describe('hashHandle', () => {
  it('never stores plaintext — the hash differs from the handle', async () => {
    expect.hasAssertions();
    const handle = await deriveHandle({
        domain: HANDLE_DOMAINS.loginHandoff,
        key: K_AUTH,
        transactionId: TX_A,
      }),
      hash = await hashHandle(handle);
    expect(hash).not.toBe(handle);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('recomputes the same hash for the same handle', async () => {
    expect.hasAssertions();
    const hash1 = await hashHandle('abc'),
      hash2 = await hashHandle('abc');
    expect(hash1).toBe(hash2);
  });
});

describe('timingSafeEqual', () => {
  it('identical strings are equal', () => {
    expect.hasAssertions();
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('a differing character in the middle is not equal', () => {
    expect.hasAssertions();
    expect(timingSafeEqual('abc', 'abd')).toBeFalsy();
  });

  it('a differing length is not equal', () => {
    expect.hasAssertions();
    expect(timingSafeEqual('abc', 'abcd')).toBeFalsy();
  });
});

describe('assertHandleBelongsToTransaction', () => {
  it('a handle with the right domain and transaction passes', async () => {
    expect.hasAssertions();
    const handle = await deriveHandle({
      domain: HANDLE_DOMAINS.consentContinuation,
      key: K_AUTH,
      transactionId: TX_A,
    });
    await expect(
      assertHandleBelongsToTransaction({
        domain: HANDLE_DOMAINS.consentContinuation,
        key: K_AUTH,
        presentedHandle: handle,
        transactionId: TX_A,
      }),
    ).resolves.toBeUndefined();
  });

  it('a handle from another transaction: REJECTS', async () => {
    expect.hasAssertions();
    // FR-016q — chuyen handle sang transaction khac phai that bai.
    const handleYOfA = await deriveHandle({
      domain: HANDLE_DOMAINS.consentContinuation,
      key: K_AUTH,
      transactionId: TX_A,
    });
    await expect(
      assertHandleBelongsToTransaction({
        domain: HANDLE_DOMAINS.consentContinuation,
        key: K_AUTH,
        presentedHandle: handleYOfA,
        transactionId: TX_B,
      }),
    ).rejects.toThrow(OAuthProtocolError);
  });

  it('a valid handle with the wrong domain (Y presented as Z): REJECTS', async () => {
    expect.hasAssertions();
    // Domain separation phai chan duoc ca viec tra ve dung handle.
    const handleY = await deriveHandle({
      domain: HANDLE_DOMAINS.consentContinuation,
      key: K_AUTH,
      transactionId: TX_A,
    });
    await expect(
      assertHandleBelongsToTransaction({
        domain: HANDLE_DOMAINS.authorizationCode,
        key: K_AUTH,
        presentedHandle: handleY,
        transactionId: TX_A,
      }),
    ).rejects.toThrow(OAuthProtocolError);
  });
});

describe('bytesToBase64Url', () => {
  // Bo codec nay la CAU NOI duy nhat giua cot bytea trong db-auth va bieu dien
  // Base64url trong domain/application. Round-trip sai o day nghia la hash luu
  // Vao bang khong tra lai dung hash khi doc — lookup transaction bien mat.
  it('round-trips bytes: encode then decode restores the original bytes', () => {
    expect.hasAssertions();
    // Lenh danh xieng: bytes -> string -> bytes phai la identity cho MOI do
    // Dai byte, ke ca do dai khong chia het cho 3 (cho xuat hien padding).
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0x01]),
      new Uint8Array([0x01, 0x02]),
      new Uint8Array(31).fill(0x5a),
      new Uint8Array(32).fill(0x77),
      new Uint8Array(33).map((_, i) => i * 7),
    ];
    for (const bytes of samples) {
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toStrictEqual([...bytes]);
    }
  });

  it('round-trips canonical strings: decode then re-encode restores the string', () => {
    expect.hasAssertions();
    // Chieu nguoc chi dung cho chuoi CANONICAL — nhung chuoi encoder sinh ra.
    // Base64url khong canonical (vi du 'aaa=' ma encoder se in 'aaY=') khong
    // Duoc bao round-trip: decoder cham nhan chuon chuon, encoder luon in dang
    // Chuan. Handle/hash trong he thong deu la dau ra encoder, nen day la
    // Invariant thuc te quan trong.
    for (const bytes of [new Uint8Array(32).fill(0x77), new Uint8Array(32).map((_, i) => i)]) {
      const canonical = bytesToBase64Url(bytes);
      expect(bytesToBase64Url(base64UrlToBytes(canonical))).toBe(canonical);
    }
  });

  it('emits NO padding even for byte lengths that are not multiples of 3', () => {
    expect.hasAssertions();
    // 32 byte = khoá HMAC chuẩn; 31 va 33 byte khong chia het cho 3 nen la
    // Duong pho bien de padding xuat hien neu encode sai.
    for (const length of [31, 32, 33]) {
      const encoded = bytesToBase64Url(new Uint8Array(length).fill(0x77));
      expect(encoded).not.toMatch(/[=]$/u);
    }
  });

  it('maps the + and / alphabet correctly (0xfb and 0x0f-style bytes)', () => {
    expect.hasAssertions();
    const encoded = bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0x0f]));
    expect(encoded).not.toMatch(/[+/]/u);
    // Decode nguoc lai cho cung byte — ky tu '-','_' phai hieu duoc boi decoder.
    expect([...base64UrlToBytes(encoded)]).toStrictEqual([0xfb, 0xff, 0x0f]);
  });

  it('round-trips an empty array to the empty string', () => {
    expect.hasAssertions();
    expect(bytesToBase64Url(new Uint8Array(0))).toBe('');
    expect([...base64UrlToBytes('')]).toStrictEqual([]);
  });
});
