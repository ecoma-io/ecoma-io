/**
 * Kiểm chứng signed internal delivery client của `transactional-mailer-job`.
 *
 * Nguồn canonical: `docs/services/transactional-mail/01-architecture.md` §7.4 (receiver
 * contract) và `docs/services/auth/01-architecture.md` §5.1.8 (envelope). Mọi assert về chữ
 * ký đi qua `verifyRequest` của lib contract — **không** có verifier viết riêng cho test ở
 * đây: một verifier riêng chỉ chứng minh client thống nhất với chính nó, chứ không chứng
 * minh client nói đúng ngôn ngữ với phía nhận.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  INTERNAL_NONCE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  isStrongNonce,
  verifyRequest,
} from '@ecoma-io/identity-auth-contracts';
import {
  validatePostDeliveryOutcomeRequest,
  validatePostDeliveryOutcomeResponse,
  type PostDeliveryOutcomeRequest,
} from '@ecoma-io/transactional-mail-contracts';

import {
  INTERNAL_AUTH_SECRET_ENV,
  InternalDeliveryClient,
  InternalDeliveryConfigError,
  InternalDeliveryRequestError,
  resolveInternalAuthSecret,
  type InternalDeliveryBinding,
} from './internal-delivery-client';

const SECRET = 'test-internal-hmac-secret-0123456789abcdef';
const DELIVERY_ID = 'dlv_01HZ0000000000000000000000';
const DELIVERY_PATH = `/internal/deliveries/${DELIVERY_ID}`;
const OUTCOME_PATH = `${DELIVERY_PATH}/outcome`;

/** Epoch mili giây cố định — đồng hồ của client là injected, không đọc đồng hồ thật. */
const FIXED_NOW_MS = 1_780_000_000_000;
const FIXED_NOW_SECONDS = String(Math.floor(FIXED_NOW_MS / 1000));

const OUTCOME: PostDeliveryOutcomeRequest = {
  outcome: 'failed',
  error_class: 'permanent',
  dispatch_generation: 3,
};

/** Byte thân đúng những gì client phải gửi: JSON của `PostDeliveryOutcomeRequest` hợp lệ. */
function expectedOutcomeBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(OUTCOME));
}

interface Captured {
  request: Request;
  bodyBytes: Uint8Array;
}

/** Service Binding giả: chỉ ghi lại request rồi trả về Response được đưa vào. */
function recordingBinding(response: () => Response): {
  binding: InternalDeliveryBinding;
  captured: Captured[];
  fetch: ReturnType<typeof vi.fn>;
} {
  const captured: Captured[] = [];
  const fetch = vi.fn<(input: Request) => Promise<Response>>(async (input: Request) => {
    captured.push({ request: input, bodyBytes: new Uint8Array(await input.arrayBuffer()) });
    return response();
  });
  return { binding: { fetch }, captured, fetch };
}

function makeClient(overrides: { secret?: string; response?: () => Response } = {}): {
  client: InternalDeliveryClient;
  binding: InternalDeliveryBinding;
  captured: Captured[];
  fetch: ReturnType<typeof vi.fn>;
} {
  const recorder = recordingBinding(
    overrides.response ?? (() => new Response('{}', { status: 200 })),
  );
  const client = new InternalDeliveryClient({
    binding: recorder.binding,
    secret: overrides.secret ?? SECRET,
    now: () => FIXED_NOW_MS,
  });
  return { client, binding: recorder.binding, captured: recorder.captured, fetch: recorder.fetch };
}

/**
 * Chạy `verifyRequest` với đúng secret của test và một kho nonce giả.
 *
 * `claimNonce` trả `false` (chưa từng thấy) và ghi lại tham số để assert TTL neo theo
 * timestamp của envelope — cùng hợp đồng với kho nonce thật.
 */
async function verify(
  captured: Captured,
  overrides: {
    method?: string;
    path?: string;
    body?: Uint8Array | null;
    headers?: Record<string, string>;
    secret?: string;
    now?: string;
  } = {},
) {
  const request = captured.request;
  const method = overrides.method ?? request.method;
  const url = new URL(request.url);
  const path = overrides.path ?? `${url.pathname}${url.search}`;
  const body = overrides.body === undefined ? captured.bodyBytes : overrides.body;
  const headers = overrides.headers ?? {
    [INTERNAL_TIMESTAMP_HEADER]: request.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
    [INTERNAL_NONCE_HEADER]: request.headers.get(INTERNAL_NONCE_HEADER) ?? '',
    [INTERNAL_SIGNATURE_HEADER]: request.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '',
  };
  const claims: { nonce: string; timestampSeconds: number }[] = [];
  const result = await verifyRequest({
    method,
    path,
    body,
    headers,
    secret: overrides.secret ?? SECRET,
    now: overrides.now ?? FIXED_NOW_SECONDS,
    claimNonce: (nonce, timestampSeconds) => {
      claims.push({ nonce, timestampSeconds });
      return false;
    },
  });
  return { result, claims };
}

describe('A — chữ ký đúng cho từng method', () => {
  it('GET ký đúng method, path và delivery_id, và verify được bằng secret đó', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);

    expect(captured).toHaveLength(1);
    const [call] = captured;
    const request = call.request;

    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe(DELIVERY_PATH);
    // Thân GET không được mang gì: chữ ký phải băm thân rỗng, không phải `undefined`.
    expect(call.bodyBytes).toEqual(new Uint8Array(0));

    const { result, claims } = await verify(call);
    expect(result.ok).toBe(true);
    expect(claims).toHaveLength(1);
  });

  it('GET chỉ mang đúng ba header ký, không có header định danh caller tự khai', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);

    const names = [...captured[0].request.headers.keys()].toSorted();
    expect(names).toEqual(
      [INTERNAL_TIMESTAMP_HEADER, INTERNAL_NONCE_HEADER, INTERNAL_SIGNATURE_HEADER].toSorted(),
    );
    // Rõ ràng, không chỉ suy ra từ danh sách: hai header này là định danh do caller tự khai
    // nên không bao giờ được gửi lên private interface.
    expect(captured[0].request.headers.get('x-ecoma-principal')).toBeNull();
    expect(captured[0].request.headers.get('x-ecoma-app')).toBeNull();
  });

  it('timestamp là epoch giây dạng chuỗi chữ số, lấy từ đồng hồ injected', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);

    const timestamp = captured[0].request.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '';
    expect(timestamp).toBe(FIXED_NOW_SECONDS);
    expect(timestamp).toMatch(/^\d+$/u);
    // Không phải ISO string, không phải epoch mili giây.
    expect(timestamp).not.toContain('T');
    expect(Number(timestamp)).toBe(FIXED_NOW_MS / 1000);
  });

  it('nonce là nonce mạnh và khác nhau giữa hai request', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);
    await client.getDelivery(DELIVERY_ID);

    const first = captured[0].request.headers.get(INTERNAL_NONCE_HEADER) ?? '';
    const second = captured[1].request.headers.get(INTERNAL_NONCE_HEADER) ?? '';
    expect(isStrongNonce(first)).toBe(true);
    expect(isStrongNonce(second)).toBe(true);
    // Mỗi request một nonce: replay guard của phía nhận chỉ có tác dụng khi client sinh
    // nonce mới mỗi lần; một bộ header đã ký cache lại sẽ khiến request thứ hai thành
    // `replayed_nonce`.
    expect(second).not.toBe(first);
    expect(captured[0].request.headers.get(INTERNAL_SIGNATURE_HEADER)).not.toBe(
      captured[1].request.headers.get(INTERNAL_SIGNATURE_HEADER),
    );
  });

  it('chữ ký mang đúng định dạng `v1=<hex>`', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);

    const signature = captured[0].request.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '';
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/u);
  });

  it('POST ký đúng path `/outcome` và verify được với chính byte đã gửi', async () => {
    const { client, captured } = makeClient();
    await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);

    const [call] = captured;
    expect(call.request.method).toBe('POST');
    expect(new URL(call.request.url).pathname).toBe(OUTCOME_PATH);
    expect(call.request.headers.get('content-type')).toBe('application/json');
    expect(call.bodyBytes).toEqual(expectedOutcomeBytes());

    const { result, claims } = await verify(call);
    expect(result.ok).toBe(true);
    // TTL của nonce neo vào timestamp **của envelope**, không phải đồng hồ của verifier.
    expect(claims).toEqual([
      {
        nonce: call.request.headers.get(INTERNAL_NONCE_HEADER),
        timestampSeconds: Number(FIXED_NOW_SECONDS),
      },
    ]);
  });

  it('thân POST gửi đi và thân được ký là cùng một mảng byte', async () => {
    const { client, captured } = makeClient();
    await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);

    const [call] = captured;
    // Cùng nội dung byte-for-byte…
    expect([...call.bodyBytes]).toEqual([...expectedOutcomeBytes()]);
    // …và chữ ký chỉ hợp lệ với đúng mảng byte đó: mảng rỗng (một bản cài đặt ký thân rỗng)
    // bị từ chối.
    const wrong = await verify(call, { body: new Uint8Array(0) });
    expect(wrong.result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('POST không có `error_class` thì vẫn gửi body đúng contract', async () => {
    const { client, captured } = makeClient();
    await client.postDeliveryOutcome(DELIVERY_ID, { outcome: 'sent', dispatch_generation: 1 });

    const [call] = captured;
    expect(call.bodyBytes).toEqual(
      new TextEncoder().encode(JSON.stringify({ outcome: 'sent', dispatch_generation: 1 })),
    );
    expect((await verify(call)).result.ok).toBe(true);
  });
});

/** Một request GET đã ký, dùng lại cho toàn bộ nhóm tamper test. */
async function signedGet(): Promise<Captured> {
  const { client, captured } = makeClient();
  await client.getDelivery(DELIVERY_ID);
  return captured[0] as Captured;
}

describe('B — mọi thay đổi trên đường đi đều làm chữ ký mất hiệu lực', () => {
  it('đổi method thì `bad_signature`', async () => {
    const call = await signedGet();
    expect((await verify(call, { method: 'POST' })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('đổi delivery_id trong path thì `bad_signature`', async () => {
    const call = await signedGet();
    expect((await verify(call, { path: '/internal/deliveries/dlv_khac' })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('thêm query string vào path thì `bad_signature` — query nằm trong canonical string', async () => {
    const call = await signedGet();
    expect((await verify(call, { path: `${DELIVERY_PATH}?debug=1` })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('đổi byte thân thì `bad_signature`', async () => {
    const { client, captured } = makeClient();
    await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
    const [call] = captured;

    const mutated = new Uint8Array(call.bodyBytes);
    mutated[mutated.length - 2] = (mutated[mutated.length - 2] ?? 0) ^ 0x01;
    expect((await verify(call, { body: mutated })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('đổi timestamp trong khoảng skew thì `bad_signature`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    headers[INTERNAL_TIMESTAMP_HEADER] = String(Number(FIXED_NOW_SECONDS) + 10);

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('đổi timestamp ra ngoài skew thì `bad_timestamp`, trước cả khi bước chứng minh chữ ký', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    headers[INTERNAL_TIMESTAMP_HEADER] = String(Number(FIXED_NOW_SECONDS) - 100_000);

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    });
  });

  it('timestamp không phải epoch giây thì `bad_timestamp`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    headers[INTERNAL_TIMESTAMP_HEADER] = new Date(FIXED_NOW_MS).toISOString();

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    });
  });

  it('thay nonce bằng nonce yếu thì `weak_nonce`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    // ⚠️ Một UUID v4 "toàn số 0" **không** phải nonce yếu theo `isStrongNonce`: nó khớp
    // `UUID_V4_PATTERN` nên đi đường nhanh và được chấp nhận (đánh đổi đã biết của lib).
    // Nonce yếu thật là chuỗi vượt qua được phép ước lượng entropy: một ký tự lặp lại.
    headers[INTERNAL_NONCE_HEADER] = '0'.repeat(64);

    expect((await verify(call, { headers })).result).toEqual({ ok: false, reason: 'weak_nonce' });
  });

  it('đổi nonce (vẫn mạnh) thì `bad_signature`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    headers[INTERNAL_NONCE_HEADER] = '11111111-2222-4333-8444-555555555555';

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('đổi chữ ký thì `bad_signature`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    const signature = headers[INTERNAL_SIGNATURE_HEADER];
    headers[INTERNAL_SIGNATURE_HEADER] = `v1=${'0'.repeat((signature?.length ?? 3) - 3)}`;

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('bỏ chữ ký thì `missing_header`', async () => {
    const call = await signedGet();
    const headers = { ...headerRecord(call) };
    headers[INTERNAL_SIGNATURE_HEADER] = '';

    expect((await verify(call, { headers })).result).toEqual({
      ok: false,
      reason: 'missing_header',
    });
  });

  it('secret khác thì `bad_signature`', async () => {
    const call = await signedGet();
    expect((await verify(call, { secret: 'mot-secret-khac' })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('GET không mang thân, nên chữ ký của GET không dùng được cho một thân bất kỳ', async () => {
    const call = await signedGet();
    expect((await verify(call, { body: new TextEncoder().encode('{}') })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('nonce đã bị chiếm thì `replayed_nonce`', async () => {
    const call = await signedGet();
    const request = call.request;
    const nonce = request.headers.get(INTERNAL_NONCE_HEADER) ?? '';
    const result = await verifyRequest({
      method: 'GET',
      path: DELIVERY_PATH,
      body: call.bodyBytes,
      headers: {
        [INTERNAL_TIMESTAMP_HEADER]: request.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
        [INTERNAL_NONCE_HEADER]: nonce,
        [INTERNAL_SIGNATURE_HEADER]: request.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '',
      },
      secret: SECRET,
      now: FIXED_NOW_SECONDS,
      // Kho nonce thật trả `true` khi nonce đã có từ trước — replay bị chặn ở phía nhận,
      // không phải ở phía gọi.
      claimNonce: () => true,
    });
    expect(result).toEqual({ ok: false, reason: 'replayed_nonce' });
  });
});

function headerRecord(call: Captured): Record<string, string> {
  const request = call.request;
  return {
    [INTERNAL_TIMESTAMP_HEADER]: request.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
    [INTERNAL_NONCE_HEADER]: request.headers.get(INTERNAL_NONCE_HEADER) ?? '',
    [INTERNAL_SIGNATURE_HEADER]: request.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '',
  };
}

describe('C — credential hỏng thì fail trước khi gửi', () => {
  it('thiếu Worker Secret thì ném lỗi cấu hình, không có giá trị bí mật trong message', () => {
    expect(() => resolveInternalAuthSecret({})).toThrow(InternalDeliveryConfigError);
    expect(() => resolveInternalAuthSecret({})).toThrow(INTERNAL_AUTH_SECRET_ENV);
  });

  it('Worker Secret không phải chuỗi thì ném lỗi cấu hình', () => {
    for (const value of [undefined, null, 1234, true, {}]) {
      expect(() => resolveInternalAuthSecret({ [INTERNAL_AUTH_SECRET_ENV]: value })).toThrow(
        InternalDeliveryConfigError,
      );
    }
  });

  it('Worker Secret rỗng hoặc chỉ khoảng trắng thì ném lỗi cấu hình', () => {
    for (const value of ['', '   ', '\t\n ']) {
      expect(() => resolveInternalAuthSecret({ [INTERNAL_AUTH_SECRET_ENV]: value })).toThrow(
        InternalDeliveryConfigError,
      );
    }
  });

  it('message lỗi cấu hình chỉ nêu tên biến, không nêu giá trị', () => {
    // Giá trị bí mật phải **không** xuất hiện trong message, kể cả khi nó tới từ một `env`
    // sai kiểu — chỗ dễ bị `JSON.stringify(value)` nhất.
    const leaky = 'sieu-bi-mat-co-the-bi-ro-ri';
    const envs: Readonly<Record<string, unknown>>[] = [
      {},
      { [INTERNAL_AUTH_SECRET_ENV]: undefined },
      { [INTERNAL_AUTH_SECRET_ENV]: 1234 },
      { [INTERNAL_AUTH_SECRET_ENV]: { token: leaky } },
      { [INTERNAL_AUTH_SECRET_ENV]: '' },
      { [INTERNAL_AUTH_SECRET_ENV]: '\t\n ' },
    ];
    const messages = envs.map((env) => {
      try {
        resolveInternalAuthSecret(env);
        return 'KHONG NEM';
      } catch (error) {
        return error instanceof Error ? error.message : '';
      }
    });
    for (const message of messages) {
      expect(message).toContain(INTERNAL_AUTH_SECRET_ENV);
      expect(message).not.toContain(leaky);
    }
    // Ghim rằng nhánh sai-kiểu thật sự chạy (không phải rơi vào nhánh thiếu), nếu không
    // assert "không chứa giá trị" ở trên là một assert rỗng.
    expect(messages[3]).toContain('object');
  });

  it('client dựng với secret rỗng/khoảng trắng thì ném lỗi cấu hình và không gọi binding', () => {
    const fetch = vi.fn<(input: Request) => Promise<Response>>();
    for (const secret of ['', '   ']) {
      expect(() => new InternalDeliveryClient({ binding: { fetch }, secret })).toThrow(
        InternalDeliveryConfigError,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('secret hợp lệ giữ nguyên văn: khoảng trắng thừa KHÔNG bị trim', async () => {
    // Ký bằng secret có khoảng trắng thừa, rồi verify bằng chính nó — và bằng bản đã trim.
    // Nếu client lưu bản đã trim, chữ ký gửi đi sẽ không verify được với secret thật.
    const padded = `  ${SECRET}  `;
    const { client, captured } = makeClient({ secret: padded });
    await client.getDelivery(DELIVERY_ID);

    expect((await verify(captured[0], { secret: padded })).result.ok).toBe(true);
    expect((await verify(captured[0], { secret: SECRET })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('secret đọc qua resolveInternalAuthSecret cũng giữ nguyên văn, không bị trim', async () => {
    // Đường composition root: `resolveInternalAuthSecret(env)` rồi truyền kết quả vào client.
    // Nếu hàm đó trả bản đã trim thì chữ ký không bao giờ verify được với secret thật, mà
    // client thì vẫn "chạy" — nên phải ghim riêng đường này, không chỉ ghim constructor.
    const padded = `  ${SECRET}  `;
    const resolved = resolveInternalAuthSecret({ [INTERNAL_AUTH_SECRET_ENV]: padded });
    const { client, captured } = makeClient({ secret: resolved });
    await client.getDelivery(DELIVERY_ID);

    expect((await verify(captured[0], { secret: padded })).result.ok).toBe(true);
    expect((await verify(captured[0], { secret: SECRET })).result).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('secret rỗng và secret chỉ khoảng trắng là hai lỗi cấu hình phân biệt được', () => {
    const messages = ['', '   '].map((value) => {
      try {
        resolveInternalAuthSecret({ [INTERNAL_AUTH_SECRET_ENV]: value });
        return 'KHONG NEM';
      } catch (error) {
        return error instanceof Error ? error.message : '';
      }
    });
    // `toContain` tên biến chứng minh nhánh đã ném (chuỗi 'KHONG NEM' không chứa tên biến).
    expect(messages[0]).toContain(INTERNAL_AUTH_SECRET_ENV);
    expect(messages[1]).toContain(INTERNAL_AUTH_SECRET_ENV);
    // Gộp hai nhánh thành một phép kiểm thì hai message trùng nhau và assert này đỏ — pin
    // rằng hai tình huống cấu hình khác nhau vẫn nói ra hai điều khác nhau.
    expect(messages[0]).not.toBe(messages[1]);
  });

  it('một request đầy đủ không ghi ra console — không secret, không chữ ký, không thân', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const { client } = makeClient();
      await client.getDelivery(DELIVERY_ID);
      await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});

describe('D — ranh giới response: trả nguyên, không phân loại, không retry', () => {
  it('mọi status của private interface đi thẳng về tầng gọi, không ném, không đổi status', async () => {
    // 401/403 là chuyện credential **nội bộ**, không phải credential provider; 404 là
    // chuyện delivery không tồn tại, không phải kết quả gửi mail; 409/422/429/5xx cũng vậy.
    const statuses = [200, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503];
    for (const status of statuses) {
      const sent = new Response(JSON.stringify({ code: 'x' }), { status });
      const { client } = makeClient({ response: () => sent });
      const response = await client.getDelivery(DELIVERY_ID);
      // **Cùng instance** Response: client không dựng lại response mới.
      expect(response).toBe(sent);
      expect(response.status).toBe(status);
      // Thân response chưa bị đọc: tầng gọi tự parse bằng validator của contract.
      expect(await response.text()).toBe('{"code":"x"}');
    }
  });

  it('lỗi mạng từ binding ném ra nguyên vẹn, không bị phân loại hay gói lại', async () => {
    const boom = new TypeError('fetch failed');
    const { client } = makeClient({
      response: () => {
        throw boom;
      },
    });
    await expect(client.getDelivery(DELIVERY_ID)).rejects.toBe(boom);
  });

  it('không retry: một lời gọi client = đúng một lần binding.fetch', async () => {
    for (const status of [401, 404, 429, 500, 503]) {
      const { client, fetch } = makeClient({ response: () => new Response(null, { status }) });
      await client.getDelivery(DELIVERY_ID);
      await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it('không phân loại status thành kết quả provider nào', async () => {
    const { client } = makeClient({
      response: () =>
        new Response(JSON.stringify({ result: 'applied', status: 'sent' }), { status: 200 }),
    });
    const response = await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
    // Client trả raw Response; chỉ `validatePostDeliveryOutcomeResponse` của contract mới
    // được quyết định thứ này có phải outcome hợp lệ không.
    expect(response).toBeInstanceOf(Response);
    const validated = validatePostDeliveryOutcomeResponse(await response.json());
    expect(validated.ok).toBe(true);
  });
});

describe('E — hợp đồng khác: input hỏng, route, và ranh giới runtime', () => {
  it('outcome không hợp lệ theo contract bị từ chối trước khi gửi, không gửi request rác', async () => {
    const { client, fetch } = makeClient();
    const invalid: unknown[] = [
      { outcome: 'khong-ton-tai', dispatch_generation: 1 },
      { outcome: 'sent', dispatch_generation: 0 },
      { outcome: 'sent', dispatch_generation: 1, error_class: 'khong-hop-le' },
      { outcome: 'sent' },
      { outcome: 'sent', dispatch_generation: 1, extra_field: true },
      { outcome: 'sent', dispatch_generation: 1.5 },
    ];
    for (const outcome of invalid) {
      await expect(
        client.postDeliveryOutcome(DELIVERY_ID, outcome as PostDeliveryOutcomeRequest),
      ).rejects.toThrow(InternalDeliveryRequestError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('outcome hợp lệ thì gửi **giá trị đã qua contract**, không gửi object thô', async () => {
    // `validatePostDeliveryOutcomeRequest` chuẩn hoá lại value; client gửi `validated.value`
    // nên trường không thuộc schema không bao giờ lọt ra dây.
    const { client, captured } = makeClient();
    const withExtra = { outcome: 'sent', dispatch_generation: 7 } as PostDeliveryOutcomeRequest & {
      extra_field?: string;
    };
    await client.postDeliveryOutcome(DELIVERY_ID, withExtra);
    expect(captured[0].bodyBytes).toEqual(
      new TextEncoder().encode(JSON.stringify({ outcome: 'sent', dispatch_generation: 7 })),
    );
  });

  it('delivery_id rỗng bị từ chối trước khi gửi', async () => {
    const { client, fetch } = makeClient();
    await expect(client.getDelivery('')).rejects.toThrow(InternalDeliveryRequestError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delivery_id có ký tự phân đoạn path vẫn nằm trong một phân đoạn duy nhất', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery('a/b/../../../secret');

    const { pathname } = new URL(captured[0].request.url);
    // `encodeURIComponent` mã hoá `/` thành `%2F` — `..` bị mã hoá thành `..` nên chỉ còn
    // chốt chặn ở `#send` mới đủ; ở đây đường dẫn phải vẫn là một delivery duy nhất.
    expect(pathname.startsWith('/internal/deliveries/')).toBe(true);
    expect(pathname).toBe('/internal/deliveries/a%2Fb%2F..%2F..%2F..%2Fsecret');
  });

  it('delivery_id là dot-segment bị từ chối, không gửi tới route khác', async () => {
    const { client, fetch } = makeClient();
    // Chỉ `.` và `..` là dot-segment sau khi `encodeURIComponent`: chuỗi có `/` (vd `../..`)
    // được mã hoá thành `%2F` nên nó là **một** phân đoạn hợp lệ, và URL parser không cắt
    // gì cả — test dưới cùng suite ghim đúng trường hợp đó.
    for (const deliveryId of ['..', '.']) {
      await expect(client.getDelivery(deliveryId)).rejects.toThrow(InternalDeliveryRequestError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delivery_id chứa surrogate lẻ bị từ chối chứ không làm vỡ runtime', async () => {
    const { client, fetch } = makeClient();
    await expect(client.getDelivery('a\uD800b')).rejects.toThrow(InternalDeliveryRequestError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runtime code không import Node builtin và không dùng `crypto.subtle` trực tiếp', () => {
    const source = readFileSync(join(import.meta.dirname, 'internal-delivery-client.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]node:/u);
    expect(source).not.toMatch(/require\(['"]node:/u);
    // WebCrypto nằm trong lib contract; client tự gọi `crypto.subtle` nghĩa là tự dựng
    // canonical string hoặc tự định dạng chữ ký — chính là giao thức thứ hai.
    expect(source).not.toMatch(/crypto\.subtle/u);
    expect(source).toMatch(/from '@ecoma-io\/identity-auth-contracts'/u);
  });

  it('kho nonce không nằm trong worker này: client không nhận D1 và không tự lưu nonce', () => {
    const source = readFileSync(join(import.meta.dirname, 'internal-delivery-client.ts'), 'utf8');
    expect(source).not.toMatch(/D1Database/u);
    expect(source).not.toMatch(/\bprepare\s*\(/u);
    // Không có bộ header đã ký cache: mỗi request sinh chữ ký mới.
    expect(source).not.toMatch(/Map<string, InternalAuthHeaders>|#cached/u);
  });

  it('client không biết hostname của control plane: chỉ qua binding truyền vào', () => {
    const source = readFileSync(join(import.meta.dirname, 'internal-delivery-client.ts'), 'utf8');
    // Không có `fetch` toàn cục: mọi request đi qua binding do composition root tiêm vào.
    expect(source).not.toMatch(/(?<![\w.$])await fetch\(/u);
    expect(source).not.toMatch(/env\.[A-Z_]+_URL/u);
  });

  it('contract của request không đổi: các path dùng đúng trong tài liệu', async () => {
    const { client, captured } = makeClient();
    await client.getDelivery(DELIVERY_ID);
    await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
    expect(captured.map((call) => new URL(call.request.url).pathname)).toEqual([
      DELIVERY_PATH,
      OUTCOME_PATH,
    ]);
  });

  it('`validatePostDeliveryOutcomeRequest` được dùng đúng bản contract (không chép lại luật)', async () => {
    const { client, captured } = makeClient();
    await client.postDeliveryOutcome(DELIVERY_ID, OUTCOME);
    // Nếu client chép lại luật validate, một thay đổi ở contract sẽ không lan tới đây.
    const validated = validatePostDeliveryOutcomeRequest(
      JSON.parse(new TextDecoder().decode(captured[0].bodyBytes)),
    );
    expect(validated.ok).toBe(true);
  });
});
