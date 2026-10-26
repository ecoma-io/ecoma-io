/**
 * Test của cache JWKS theo issuer — bốn bất biến mà verify.spec (chạy verify
 * end-to-end) không nhìn thấy được vì nó chỉ dùng một issuer:
 *
 * 1. **Cache khoá theo issuer** — hai issuer không bao giờ nhận resolver của
 *    nhau; verify token của issuer A bằng key của issuer B là fail vì lý do
 *    sai.
 * 2. **Single-flight** — hai caller cùng gặp cache-miss chỉ tạo một resolver
 *    mới; không có cơ chế này thì mỗi request đúng lúc TTL hết là một fetch
 *    JWKS.
 * 3. **TTL** — entry quá hạn bị bỏ, lượt sau fetch lại; entry trong hạn được
 *    trả lại nguyên instance (không dựng lại resolver mỗi lần).
 * 4. **Không rò state giữa test** — `resetJwksCacheForTests` là đường duy nhất
 *    xoá cache, và module không export bất kỳ "refresh" nào cho production.
 *
 * `createRemoteJWKSet` fetch **lazy** ở lần verify đầu — nên ở đây dựng resolver
 * không phát network request nào; assert được mà không cần stub fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JWKS_CACHE_TTL_SECONDS, jwksResolver, resetJwksCacheForTests } from './jwks';

const ISSUER_A = 'https://auth-a.test.ecoma.io';
const ISSUER_B = 'https://auth-b.test.ecoma.io';

afterEach(() => {
  vi.useRealTimers();
  resetJwksCacheForTests();
});

describe('jwksResolver — per-issuer keying', () => {
  it('returns a distinct resolver per issuer and never crosses them', async () => {
    const a = await jwksResolver(ISSUER_A);
    const b = await jwksResolver(ISSUER_B);

    expect(a).not.toBe(b);
  });

  it('serves the same issuer from cache with the identical resolver instance', async () => {
    const first = await jwksResolver(ISSUER_A);
    const second = await jwksResolver(ISSUER_A);

    // Cùng **instance**: dựng lại resolver mỗi lần gọi là mất cả ý nghĩa cache
    // lẫn single-flight cooldown của `jose`.
    expect(second).toBe(first);
  });
});

describe('jwksResolver — single-flight on a cold cache', () => {
  it('collapses concurrent cold-cache calls into one resolver construction', async () => {
    const [p1, p2, p3] = [jwksResolver(ISSUER_A), jwksResolver(ISSUER_A), jwksResolver(ISSUER_A)];
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('clears the in-flight slot after settling so a later miss can rebuild', async () => {
    const first = await jwksResolver(ISSUER_A);

    // Đẩy thời gian vượt TTL: entry chết, lượt sau phải dựng resolver mới.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (JWKS_CACHE_TTL_SECONDS + 1) * 1000);

    const second = await jwksResolver(ISSUER_A);
    expect(second).not.toBe(first);
  });
});

describe('jwksResolver — TTL', () => {
  it('pins the 10-minute TTL that matches the jose default it wraps', () => {
    expect(JWKS_CACHE_TTL_SECONDS).toBe(600);
  });

  it('serves a cache hit inside the TTL window', async () => {
    const first = await jwksResolver(ISSUER_A);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (JWKS_CACHE_TTL_SECONDS - 1) * 1000);

    expect(await jwksResolver(ISSUER_A)).toBe(first);
  });

  it('drops an expired entry so the next call rebuilds it', async () => {
    const first = await jwksResolver(ISSUER_A);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + JWKS_CACHE_TTL_SECONDS * 1000);

    expect(await jwksResolver(ISSUER_A)).not.toBe(first);
  });
});

describe('resetJwksCacheForTests', () => {
  it('is the only way state crosses between suites — clearing forces a rebuild', async () => {
    const first = await jwksResolver(ISSUER_A);
    resetJwksCacheForTests();

    expect(await jwksResolver(ISSUER_A)).not.toBe(first);
  });
});
