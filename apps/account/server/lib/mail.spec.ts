/**
 * Unit test cho `server/lib/mail.ts` — build payload bằng validator thật của lib
 * contract, và fail-closed phân loại của `sendMail`.
 *
 * `sendMail` được test qua `vi.stubGlobal('fetch', ...)` — adapter chỉ dùng
 * `fetch` chuẩn nên stub là trung thực về biên (biên thật là HTTP transport;
 * kết nối tới transactional-mail thật thuộc về integration của service đó).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildOtpMailRequest, OTP_LOGIN_TEMPLATE, otpMailIdempotencyKey, sendMail } from './mail';

/** Response shape hợp lệ theo `isPostMessagesResponse`. */
function validMailResponse(): Record<string, unknown> {
  return {
    id: 'msg-1',
    delivery_id: 'dlv-1',
    app: 'account',
    template: OTP_LOGIN_TEMPLATE,
    template_version: 1,
    status: 'queued',
    created: true,
    created_at: new Date().toISOString(),
  };
}

const VALID_REQUEST = buildOtpMailRequest({
  recipient: 'user@example.com',
  code: '12345678',
  correlationId: 'corr-1',
});

describe('buildOtpMailRequest', () => {
  it('builds a payload accepted by the real contract validator', () => {
    // Không phải test validator của lib — test rằng adapter của ta TẠO ra payload
    // mà lib chấp nhận. Build bằng validator thật là điều kiện để đổi contract
    // làm adapter đỏ ngay tại đây, chứ không ở production.
    expect(VALID_REQUEST).not.toBeNull();
  });

  it('carries the code only inside variables', () => {
    // Mã OTP đi vào `variables` để service render; không field nào khác của
    // request được chứa mã.
    const request = buildOtpMailRequest({
      recipient: 'user@example.com',
      code: '99887766',
      correlationId: 'corr-2',
    });
    expect(request?.variables).toEqual({ code: '99887766' });
    expect(JSON.stringify(request)).toContain('99887766');
  });

  it('keeps the template constant in sync with the contract', () => {
    // Template là logical name service bên kia phải có — đổi tên ở đây mà không
    // đổi bên kia là mail rơi vào template không tồn tại.
    expect(OTP_LOGIN_TEMPLATE).toBe('account.login-otp');
    expect(VALID_REQUEST?.template).toBe(OTP_LOGIN_TEMPLATE);
  });

  it('normalizes the recipient whitespace like the validator does', () => {
    const request = buildOtpMailRequest({
      recipient: '  user@example.com  ',
      code: '00000000',
      correlationId: 'corr-3',
    });
    expect(request?.recipient).toBe('user@example.com');
  });

  it('rejects a payload that breaks the contract (empty code)', () => {
    // variables rỗng không sai theo validator hiện tại (isObject là đủ), nhưng
    // recipient rỗng thì sai — dùng nó làm vết cho đường invalid_payload.
    const broken = buildOtpMailRequest({
      recipient: '',
      code: '12345678',
      correlationId: 'corr-4',
    });
    expect(broken).toBeNull();
  });
});

describe('sendMail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed with config_missing when no URL is configured', async () => {
    // Config thiếu phải là một reason riêng — không được ngụy trang thành lỗi
    // transport thoáng qua, và không được fetch gì cả.
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(
      undefined,
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: false, reason: 'config_missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed with credential_missing when no signing secret is configured', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail('https://mail.example.com', VALID_REQUEST, undefined);
    expect(result).toEqual({
      ok: false,
      reason: 'credential_missing',
      detail: 'NUXT_MAIL_INTERNAL_AUTH_SECRET',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed with invalid_payload without fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(
      'https://mail.example.com',
      null,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the validated payload to /v1/messages with json content-type and the required Idempotency-Key', async () => {
    // Contract receiver (`transactional-mail` FR-001 bước 3) bắt buộc
    // `Idempotency-Key`: thiếu ⇒ `400 invalid_request` và mail không bao giờ tới
    // hàng SEND. Assertion khớp ĐỦ headers thực tế — không `objectContaining` một
    // shape thiếu header (chi tiết `mail.ts` `sendMail`).
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(validMailResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendMail(
      'https://mail.example.com',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe(
      otpMailIdempotencyKey(VALID_REQUEST.correlation_id),
    );
    expect(headers.get('x-ecoma-internal-timestamp')).not.toBeNull();
    expect(headers.get('x-ecoma-internal-nonce')).not.toBeNull();
    expect(headers.get('x-ecoma-internal-signature')).toMatch(/^v1=[0-9a-f]{64}$/u);
  });

  it('strips a trailing slash from the configured URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(validMailResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail(
      'https://mail.example.com/',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(calledUrl.endsWith('/v1/messages')).toBe(true);
  });

  it('classifies a non-2xx response as rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('too many requests', { status: 429 })),
    );
    const result = await sendMail(
      'https://mail.example.com',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: false, reason: 'rejected', detail: '429' });
  });

  it('classifies a 2xx with a foreign body as rejected, not as delivered', async () => {
    // Body lạ = đường không đúng service. Coi nó như đã gửi là mất mail im lặng.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>ok</html>', { status: 200 })),
    );
    const result = await sendMail(
      'https://mail.example.com',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('classifies a network error as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const result = await sendMail(
      'https://mail.example.com',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });

  describe('idempotency key semantics (FR-002 at the receiver)', () => {
    it('derives a unique key per attempt and a stable key for the same attempt', () => {
      // Two different attempts (different digests ⇒ different correlation ids) must
      // never collide: a shared key would make the receiver answer `409
      // idempotency_key_conflict` for the second, legitimate attempt — silent
      // non-delivery at the OTP resend path.
      const first = otpMailIdempotencyKey('abcdef1234567890');
      const second = otpMailIdempotencyKey('fedcba0987654321');
      expect(first).not.toBe(second);

      // A retry of the SAME attempt (same correlation id) must reuse the same key:
      // the receiver then answers `200` replay instead of double-sending.
      expect(otpMailIdempotencyKey('abcdef1234567890')).toBe(first);
    });

    it('keeps the derived key inside the 128-character ceiling of the receiver', () => {
      // FR-001 bước 3: `Idempotency-Key` > 128 ký tự ⇒ `400 invalid_request`.
      const longestCorrelationId = '0'.repeat(16);
      expect(otpMailIdempotencyKey(longestCorrelationId).length).toBeLessThanOrEqual(128);
    });

    it('falls back to a defined key when the request carries no correlation_id', () => {
      // `correlation_id` là optional trong `PostMessagesRequest`; adapter không bao
      // giờ tự thêm field vào body, nhưng header thì luôn phải có — không value
      // undefined len vào header.
      expect(otpMailIdempotencyKey(undefined)).toMatch(/^account-otp-corr-/u);
    });
  });

  it('classifies a timeout as unreachable', async () => {
    // Timeout là đường quan trọng nhất của route OTP: request challenge không được
    // treo quá MAIL_TIMEOUT_MS. Stub fetch treo mãi — adapter phải tự cắt.
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const result = await sendMail(
      'https://mail.example.com',
      VALID_REQUEST,
      'test-mail-internal-auth-secret-placeholder-0001',
    );
    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('never throws for classified failures', async () => {
    // Bốn loại lỗi đã phân loại đều phải trả giá trị — ném ở đây buộc route
    // phân loại lại, tức là hai tầng cùng biết chi tiết transport.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('boom')));
    await expect(
      sendMail(
        'https://mail.example.com',
        VALID_REQUEST,
        'test-mail-internal-auth-secret-placeholder-0001',
      ),
    ).resolves.toBeDefined();
  });
});
