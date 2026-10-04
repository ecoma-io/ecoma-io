import { describe, expect, it } from 'vitest';

import {
  HANDLE_DOMAINS,
  assertHandleBelongsToTransaction,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveHandle,
  hashHandle,
  lengthPrefixed,
  timingSafeEqual,
} from './index';
import { OAuthProtocolError } from './errors';

/** 32 byte base64url — kích thước khoá HMAC chuẩn. */
const K_AUTH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const K_OTHER = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const TX_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('deriveHandle', () => {
  it('sinh handle 43 ky tu base64url', async () => {
    const handle = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.loginHandoff,
    });
    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('tinh lai cho cung gia trong MOT transaction', async () => {
    const first = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.consentContinuation,
    });
    const second = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.consentContinuation,
    });
    expect(first).toBe(second);
  });

  it('domain separation: cung transaction, ba domain, ba gia tri khac nhau', async () => {
    // FR-016l. Neu ba domain ra cung gia tri, handle loai nay dung duoc cho
    // loai kia va state machine mat het y nghia.
    const values = await Promise.all(
      Object.values(HANDLE_DOMAINS).map((domain) =>
        deriveHandle({ key: K_AUTH, transactionId: TX_A, domain }),
      ),
    );
    expect(new Set(values).size).toBe(3);
  });

  it('khac transaction cho ra handle khac nhau', async () => {
    const a = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.authorizationCode,
    });
    const b = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_B,
      domain: HANDLE_DOMAINS.authorizationCode,
    });
    expect(a).not.toBe(b);
  });

  it('khac khoa cho ra handle khac nhau', async () => {
    const a = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.loginHandoff,
    });
    const b = await deriveHandle({
      key: K_OTHER,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.loginHandoff,
    });
    expect(a).not.toBe(b);
  });

  it('khong chua transaction_id trong plaintext', async () => {
    const handle = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.loginHandoff,
    });
    expect(handle).not.toContain(TX_A);
  });

  it('tu choi transaction_id qua ngan', async () => {
    await expect(
      deriveHandle({ key: K_AUTH, transactionId: 'abc', domain: HANDLE_DOMAINS.loginHandoff }),
    ).rejects.toThrow(/qua ngan/u);
  });

  it('tu choi transaction_id khong phai base64url', async () => {
    await expect(
      deriveHandle({ key: K_AUTH, transactionId: `${TX_A}+`, domain: HANDLE_DOMAINS.loginHandoff }),
    ).rejects.toThrow(/base64url/u);
  });

  it('tu choi domain la', async () => {
    await expect(
      deriveHandle({
        key: K_AUTH,
        transactionId: TX_A,
        domain: 'khong-ton-tai' as (typeof HANDLE_DOMAINS)[keyof typeof HANDLE_DOMAINS],
      }),
    ).rejects.toThrow(/domain khong hop le/u);
  });

  it('tu choi khoa dai sai', async () => {
    await expect(
      deriveHandle({ key: 'c2hvcnQ', transactionId: TX_A, domain: HANDLE_DOMAINS.loginHandoff }),
    ).rejects.toThrow(/32 byte/u);
  });
});

describe('lengthPrefixed', () => {
  it('la injective: ("ab","c") va ("a","bc") phai ra hai chuoi byte khac nhau', () => {
    // Khong length-prefix thi ca hai cho cung mot thong diep HMAC. Do la duong
    // thuc de vuot domain separation khi mot phan input do caller chon.
    const enc = new TextEncoder();
    const a = lengthPrefixed([enc.encode('ab'), enc.encode('c')]);
    const b = lengthPrefixed([enc.encode('a'), enc.encode('bc')]);
    expect(new Uint8Array(a)).not.toEqual(new Uint8Array(b));
  });

  it('khong cat ngan khi mot truong rong o giua', () => {
    const enc = new TextEncoder();
    const withEmpty = lengthPrefixed([enc.encode('ab'), enc.encode(''), enc.encode('cd')]);
    const without = lengthPrefixed([enc.encode('abcd')]);
    expect(new Uint8Array(withEmpty)).not.toEqual(new Uint8Array(without));
  });
});

describe('hashHandle', () => {
  it('khong luu plaintext — hash khac gia tri handle', async () => {
    const handle = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.loginHandoff,
    });
    const hash = await hashHandle(handle);
    expect(hash).not.toBe(handle);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('tinh lai cho cung handle', async () => {
    const hash1 = await hashHandle('abc');
    const hash2 = await hashHandle('abc');
    expect(hash1).toBe(hash2);
  });
});

describe('timingSafeEqual', () => {
  it('bang chuoi bang', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('khac ky tu o giua', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('khac do dai', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('assertHandleBelongsToTransaction', () => {
  it('handle dung domain va transaction: qua', async () => {
    const handle = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.consentContinuation,
    });
    await expect(
      assertHandleBelongsToTransaction({
        key: K_AUTH,
        transactionId: TX_A,
        domain: HANDLE_DOMAINS.consentContinuation,
        presentedHandle: handle,
      }),
    ).resolves.toBeUndefined();
  });

  it('handle cua transaction khac: bi tu choi', async () => {
    // FR-016q — chuyen handle sang transaction khac phai that bai.
    const handleYOfA = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.consentContinuation,
    });
    await expect(
      assertHandleBelongsToTransaction({
        key: K_AUTH,
        transactionId: TX_B,
        domain: HANDLE_DOMAINS.consentContinuation,
        presentedHandle: handleYOfA,
      }),
    ).rejects.toThrow(OAuthProtocolError);
  });

  it('handle dung domain sai (Y duoc dung nhu Z): bi tu choi', async () => {
    // Domain separation phai chan duoc ca viec tra ve dung handle.
    const handleY = await deriveHandle({
      key: K_AUTH,
      transactionId: TX_A,
      domain: HANDLE_DOMAINS.consentContinuation,
    });
    await expect(
      assertHandleBelongsToTransaction({
        key: K_AUTH,
        transactionId: TX_A,
        domain: HANDLE_DOMAINS.authorizationCode,
        presentedHandle: handleY,
      }),
    ).rejects.toThrow(OAuthProtocolError);
  });
});

describe('bytesToBase64Url', () => {
  // Bo codec nay la CAU NOI duy nhat giua cot bytea trong db-auth va bieu dien
  // base64url trong domain/application. Round-trip sai o day nghia la hash luu
  // vao bang khong tra lai dung hash khi doc — lookup transaction bien mat.
  it('round-trips bytes: encode then decode restores the original bytes', () => {
    // Lenh danh xieng: bytes -> string -> bytes phai la identity cho MOI do
    // dai byte, ke ca do dai khong chia het cho 3 (cho xuat hien padding).
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0x01]),
      new Uint8Array([0x01, 0x02]),
      new Uint8Array(31).fill(0x5a),
      new Uint8Array(32).fill(0x77),
      new Uint8Array(33).map((_, i) => i * 7),
    ];
    for (const bytes of samples) {
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it('round-trips canonical strings: decode then re-encode restores the string', () => {
    // Chieu nguoc chi dung cho chuoi CANONICAL — nhung chuoi encoder sinh ra.
    // Base64url khong canonical (vi du 'aaa=' ma encoder se in 'aaY=') khong
    // duoc bao round-trip: decoder cham nhan chuon chuon, encoder luon in dang
    // chuan. Handle/hash trong he thong deu la dau ra encoder, nen day la
    // invariant thuc te quan trong.
    for (const bytes of [new Uint8Array(32).fill(0x77), new Uint8Array(32).map((_, i) => i)]) {
      const canonical = bytesToBase64Url(bytes);
      expect(bytesToBase64Url(base64UrlToBytes(canonical))).toBe(canonical);
    }
  });

  it('emits NO padding even for byte lengths that are not multiples of 3', () => {
    // 32 byte = khoá HMAC chuẩn; 31 va 33 byte khong chia het cho 3 nen la
    // duong pho bien de padding xuat hien neu encode sai.
    for (const length of [31, 32, 33]) {
      const encoded = bytesToBase64Url(new Uint8Array(length).fill(0x77));
      expect(encoded).not.toMatch(/=$/u);
    }
  });

  it('maps the + and / alphabet correctly (0xfb and 0x0f-style bytes)', () => {
    const encoded = bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0x0f]));
    expect(encoded).not.toMatch(/[+/]/u);
    // decode nguoc lai cho cung byte — ky tu '-','_' phai hieu duoc boi decoder.
    expect([...base64UrlToBytes(encoded)]).toEqual([0xfb, 0xff, 0x0f]);
  });

  it('round-trips an empty array to the empty string', () => {
    expect(bytesToBase64Url(new Uint8Array(0))).toBe('');
    expect([...base64UrlToBytes('')]).toEqual([]);
  });
});
