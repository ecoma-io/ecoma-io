import { describe, expect, it } from 'vitest';

import { runSmokeChecks, type SmokeRunOptions } from './smoke-check';

/** Fetch luôn reject — mô phỏng mất mạng cho test resilience. */
const failingFetch: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));

/**
 * Giả lập fetch theo bảng route → response. Không mock framework — response
 * là object Response thật nên header parsing của smoke chạy đúng code thật.
 */
function fakeFetch(table: Record<string, Response | ((url: string) => Response)>): typeof fetch {
  const impl = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const path = new URL(url).pathname;
    const entry = table[path];
    if (!entry) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    return Promise.resolve(typeof entry === 'function' ? entry(url) : entry);
  };
  return impl as typeof fetch;
}

const SSR_HTML = (canonical: string, lang = 'en') =>
  `<!doctype html><html lang="${lang}"><head>` +
  `<link rel="canonical" href="${canonical}">` +
  `<title>Home</title></head><body><h1>Welcome</h1></body></html>`;

function options(
  overrides: Partial<SmokeRunOptions> & {
    table: Record<string, Response>;
  },
): SmokeRunOptions {
  const { table, ...rest } = overrides;
  return { origin: 'https://ecoma.io.vn', noIndex: true, fetchImpl: fakeFetch(table), ...rest };
}

describe('runSmokeChecks', () => {
  it('pass trên bề mặt staging đúng hứa hẹn', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response(SSR_HTML('https://ecoma.io.vn/en'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex, nofollow' },
          }),
          '/vi': new Response(SSR_HTML('https://ecoma.io.vn/vi', 'vi-VN'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('pass trên bề mặt production (indexable, canonical production origin)', async () => {
    const result = await runSmokeChecks(
      options({
        noIndex: false,
        origin: 'https://ecoma.io',
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response(SSR_HTML('https://ecoma.io/en'), { status: 200 }),
          '/vi': new Response(SSR_HTML('https://ecoma.io/vi', 'vi-VN'), { status: 200 }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(true);
  });

  it('fail khi `/` không 302 về /en', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response('ok', { status: 200 }),
          '/en': new Response(SSR_HTML('https://ecoma.io.vn/en'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/vi': new Response(SSR_HTML('https://ecoma.io.vn/vi'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'root-redirect-status')?.passed).toBe(false);
  });

  it('fail khi staging thiếu X-Robots-Tag noindex', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response(SSR_HTML('https://ecoma.io.vn/en'), { status: 200 }),
          '/vi': new Response(SSR_HTML('https://ecoma.io.vn/vi'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'locale-en-noindex')?.passed).toBe(false);
  });

  it('fail khi staging tự tuyên bố canonical production origin', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response(SSR_HTML('https://ecoma.io/en'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/vi': new Response(SSR_HTML('https://ecoma.io.vn/vi'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'locale-en-canonical-not-production')?.passed).toBe(
      false,
    );
  });

  it('fail khi SSR HTML thiếu <h1> hoặc canonical không tuyệt đối', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response('<html lang="en"><body><p>no h1</p></body></html>', {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/vi': new Response(SSR_HTML('/vi-relative-only'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/favicon.ico': new Response(null, { status: 200 }),
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'locale-en-ssr-h1')?.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'locale-vi-canonical-absolute')?.passed).toBe(
      false,
    );
  });

  it('fail khi favicon 404 — asset path hỏng', async () => {
    const result = await runSmokeChecks(
      options({
        table: {
          '/': new Response(null, { status: 302, headers: { location: '/en' } }),
          '/en': new Response(SSR_HTML('https://ecoma.io.vn/en'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
          '/vi': new Response(SSR_HTML('https://ecoma.io.vn/vi'), {
            status: 200,
            headers: { 'x-robots-tag': 'noindex' },
          }),
        },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === 'favicon-status')?.passed).toBe(false);
  });

  it('mọi lỗi mạng trở thành check fail, không throw', async () => {
    const result = await runSmokeChecks({
      origin: 'https://ecoma.io.vn',
      noIndex: true,
      fetchImpl: failingFetch,
    });
    expect(result.passed).toBe(false);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.every((c) => !c.passed)).toBe(true);
  });
});
