import { exportPKCS8, generateKeyPair } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { signRequest } from '@ecoma-io/identity-auth-contracts';

import app from './main';
import type { AuthEnv } from './config';

/**
 * Hợp đồng HTTP bề mặt công khai của `auth`.
 *
 * ⚠️ Phần quan trọng nhất không phải là endpoint nào trả gì, mà là endpoint
 * nào **chưa có** mà vẫn trả 404. Một endpoint stub trả 200 là một lời hứa
 * sai với resource server.
 */

let pem: string;
let env: AuthEnv;

/**
 * Issuer của test CỐ TÌNH khác mọi giá trị trong `src/`.
 *
 * ⚠️ Nếu test dùng `https://auth.ecoma.io` — cùng chuỗi với bản hardcode từng
 * tồn tại — thì test ĐI QUA với cả hai cách dựng. Đó chính là lý do một
 * endpoint hardcode issuer vẫn xanh toàn bộ suite. Giá trị ở đây phải là giá trị
 * mà chỉ config mới có thể cấp.
 */
const TEST_ISSUER = 'https://issuer-from-config-test.invalid';

/** Route nội bộ — hằng của hợp đồng, dùng lại ở cả đăng ký route lẫn dòng log. */
const INTERNAL_PATH = '/internal/session/verified';

/**
 * Nonce mạnh và **cố định** cho các ca chỉ muốn đi tới bước chữ ký.
 *
 * UUID v4 hợp lệ (version `4`, variant `9`) nên `isStrongNonce` đi đường nhanh và không
 * phụ thuộc heuristic đếm ký tự — một nonce ngẫu nhiên theo từng lần chạy sẽ làm test
 * này đỏ không tất định nếu heuristic đổi ngưỡng.
 */
const STRONG_NONCE = '3f2a9c1e-5b7d-4a86-9f01-2c4d6e8a0b13';

/**
 * Bắt mọi dòng `console.log` phát ra trong lúc chạy `run`, cùng giá trị nó trả về.
 *
 * ⚠️ Trả về **cả hai** để mỗi ca chỉ gọi `app.request` một lần: gọi lần thứ hai ở ngoài
 * thì assertion về dòng log không còn thuộc về chính response đang được kiểm.
 *
 * ⚠️ Spy phải được gỡ trong `finally`: để lại một `console.log` bị mock sẽ nuốt log của
 * các test chạy sau trong cùng file, và triệu chứng là một test khác "im lặng đỏ" ở chỗ
 * không liên quan.
 */
async function captureLogLines<T>(run: () => Promise<T>): Promise<{ lines: string[]; result: T }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  });
  try {
    return { lines, result: await run() };
  } finally {
    spy.mockRestore();
  }
}

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  pem = await exportPKCS8(privateKey);
});

beforeEach(() => {
  // ⚠️ `getConfig` cache theo isolate, nên `env` phải ỔN ĐỊNH qua các test —
  // đổi env giữa chừng sẽ không có tác dụng vì cache đã giữ config cũ.
  env = {
    HYPERDRIVE: { connectionString: 'hyperdrive-internal-placeholder' },
    ACCOUNT_SERVICE: { fetch: async () => new Response('{}') },
    AUTH_SIGNING_KEY: pem,
    AUTH_SIGNING_KEY_ID: 'kid-2026-01',
    AUTH_HANDLE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    // `0011`/C1: version cua khoá handle phải được khai báo tường minh — không
    // có giá trị mặc định, vì mặc định câm làm việc xoay khoá vô nghĩa.
    AUTH_HANDLE_KEY_VERSION: '1',
    AUTH_INTERNAL_SECRET: 'internal-secret-test',
    AUTH_ISSUER: TEST_ISSUER,
    AUTH_AUDIENCE: 'https://api.ecoma.io',
  };
});

async function get(path: string): Promise<Response> {
  return await app.request(path, {}, env);
}

describe('GET /health', () => {
  it('reports the service as ok', async () => {
    const response = await get('/health');
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.service).toBe('auth');
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.time as string))).toBe(false);
  });
});

describe('GET /.well-known/openid-configuration', () => {
  it('khai bao chi endpoint co that', async () => {
    const response = await get('/.well-known/openid-configuration');
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.issuer).toBe(TEST_ISSUER);
    expect(body.jwks_uri).toBe(`${TEST_ISSUER}/.well-known/jwks.json`);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.response_types_supported).toEqual(['code']);
  });

  it('dung issuer tu config o MOI endpoint, khong hardcode', async () => {
    // ⚠️ Regression: `issuer` trong discovery và `iss` trong access token là
    // MỘT điều kiện so khớp ở phía resource server. Nếu discovery hardcode
    // còn token ký theo config, hai bên lệch nhau — và sự lệch đó chỉ lộ ra
    // khi một token thật bị verify, không phải khi endpoint trả 200.
    const body = (await (await get('/.well-known/openid-configuration')).json()) as Record<
      string,
      unknown
    >;

    expect(body.authorization_endpoint).toBe(`${TEST_ISSUER}/authorize`);
    expect(body.token_endpoint).toBe(`${TEST_ISSUER}/token`);
    expect(body.jwks_uri).toBe(`${TEST_ISSUER}/.well-known/jwks.json`);
    // Issuer của test không được xuất hiện ở bất kỳ chỗ nào trong `src/`.
    expect(body.issuer).not.toBe('https://auth.ecoma.io');
  });

  it('KHONG khai revocation/introspection endpoint khi chua implement', async () => {
    // ⚠️ Khai một endpoint không tồn tại là hướng client vào một 404. Và
    // `introspection_endpoint` không tồn tại theo D3: access token verify
    // offline nên không cần endpoint hỏi trạng thái token.
    const body = (await (await get('/.well-known/openid-configuration')).json()) as Record<
      string,
      unknown
    >;

    expect(body).not.toHaveProperty('revocation_endpoint');
    expect(body).not.toHaveProperty('introspection_endpoint');
    expect(body).not.toHaveProperty('userinfo_endpoint');
  });
});

describe('GET /.well-known/jwks.json', () => {
  it('chi cong bo khoa cong khai', async () => {
    const response = await get('/.well-known/jwks.json');
    const body = (await response.json()) as { keys: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);

    const key = body.keys[0] ?? {};
    expect(key).not.toHaveProperty('d');
    expect(Object.keys(key).toSorted()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(key.kid).toBe('kid-2026-01');
    expect(key.alg).toBe('ES256');
  });

  it('response KHONG chua private key material duoi bat ky hinh thuc nao', async () => {
    const text = await (await get('/.well-known/jwks.json')).text();

    expect(text).not.toContain(pem);
    expect(text).not.toContain('PRIVATE KEY');
    const body = pem.split('\n').filter((line) => line.length > 10)[1] ?? '';
    expect(body.length).toBeGreaterThan(10);
    expect(text).not.toContain(body);
  });
});

describe('endpoint chua implement — 404, KHONG phai stub 200', () => {
  it('/authorize tra 404', async () => {
    // ⚠️ Không có endpoint giả. `/authorize` chưa implement thì 404 — và 404 là
    // sự thật. Một 200 rỗng ở đây sẽ khiến một resource server dựng vào một
    // phản hồi vô nghĩa.
    expect((await get('/authorize?client_id=x&redirect_uri=https://a.example.com/cb')).status).toBe(
      404,
    );
  });

  it('/token tra 404', async () => {
    expect((await get('/token')).status).toBe(404);
  });

  it('/authorize/complete va /authorize/confirm tra 404', async () => {
    expect((await get('/authorize/complete')).status).toBe(404);
    expect((await get('/authorize/confirm')).status).toBe(404);
  });

  it('root tra 404 — khong co UI o day', async () => {
    expect((await get('/')).status).toBe(404);
  });
});

describe('POST /internal/session/verified — xac thuc truoc, nghiep vu sau', () => {
  it('khong co chu ky — 401, KHONG phai 501', async () => {
    // ⚠️ Thứ tự la mot phan cua hop dong: xac thuc truoc, nghiep vu sau. Neu
    // route tra 501 cho request khong chu ky thi no da xu ly du lieu cua
    // ke goi chua duoc xac thuc — va 501 cho request hop le la cau tra loi.
    const response = await app.request('/internal/session/verified', { method: 'POST' }, env);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('HMAC');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('detail');
  });

  it('than dung BANG han muc — khong bi 413 (bien la `>`, khong phai `>=`)', async () => {
    // ⚠️ Bien cua mot gioi han la thu de sai nhat: doi `total > limit` thanh
    // `total >= limit` khong lam test nao do — muon bat duoc phai co mot ca dung
    // BANG nguong. Body day dai dung 64 KiB, nen no phai di QUA buoc kiem kich
    // thuoc. Khong co header chu ky nen buoc tiep theo la `401` (thieu header,
    // truoc ca khi cham toi kho nonce): do la trang thai chung minh no da qua
    // cong kich thuoc, khac han `413`.
    const atLimit = new Uint8Array(64 * 1024);
    const response = await app.request(
      '/internal/session/verified',
      { method: 'POST', body: atLimit as unknown as BodyInit },
      env,
    );

    expect(response.status).not.toBe(413);
    expect(response.status).toBe(401);
  });

  it('Content-Length vuot han muc — 413 TRUOC khi doc byte nao', async () => {
    const response = await app.request(
      '/internal/session/verified',
      {
        method: 'POST',
        headers: { 'content-length': String(65 * 1024) },
        body: '{}',
      },
      env,
    );

    expect(response.status).toBe(413);
  });

  it('chunked khong co Content-Length — 413 khi vuot han muc trong khi doc stream', async () => {
    // ⚠️ Day chinh la lo OOM: `arrayBuffer()` nạp het payload truoc roi moi so,
    // nen chunked vuot han muc van cham bo nho. `readBodyLimited` phai tu choi
    // GIUA chung khi tong chunk vuot 64 KiB. Body day la ReadableStream truc
    // tiep — Hono khong dat Content-Length cho stream, giong chunked that.
    const limit = 64 * 1024;
    const oversized = new Uint8Array(limit + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Nhom 1 KiB de chot chan phai phai doc NHIEU lan moi vuot tong.
        for (let offset = 0; offset < oversized.length; offset += 1024) {
          controller.enqueue(oversized.subarray(offset, Math.min(offset + 1024, oversized.length)));
        }
        controller.close();
      },
    });

    const response = await app.request(
      '/internal/session/verified',
      // `duplex: 'half'` la yeu cau cua undici khi body la stream.
      { method: 'POST', body: stream as unknown as BodyInit, duplex: 'half' } as RequestInit,
      env,
    );

    expect(response.status).toBe(413);
  });

  it('khong ro ly do cu the trong response — khong thanh oracle', async () => {
    const response = await app.request(
      '/internal/session/verified',
      {
        method: 'POST',
        headers: {
          'x-ecoma-internal-timestamp': '99999999999999',
          'x-ecoma-internal-nonce': 'x',
          'x-ecoma-internal-signature': 'v1=deadbeef',
        },
        body: '{}',
      },
      env,
    );

    expect(response.status).toBe(401);
    const text = await response.text();
    // Ten ly do cu the ("signature_mismatch", "timestamp_out_of_skew") se bi
    // bien response thanh oracle do chu ky.
    expect(text).not.toContain('signature_mismatch');
    expect(text).not.toContain('timestamp_out_of_skew');
  });

  it('an unreachable nonce store returns 503 service_unavailable, NOT 401', async () => {
    // ⚠️ Đây là thay đổi **ngữ nghĩa bảo mật** của endpoint, không phải chi tiết
    // hiển thị: trước đây mọi từ chối đều là 401. Request ở đây được **ký hợp lệ**
    // (đúng secret, nonce mạnh, timestamp trong cửa sổ skew) nên nó đi qua được
    // bước chữ ký và chết ở bước chiếm nonce — vì `HYPERDRIVE` trỏ vào một
    // connection string không resolve được.
    //
    // Phải khoá ở **tầng route**, không phải chỉ ở tầng dưới: `internal-auth.spec.ts`
    // chỉ chứng minh `isAuthenticatedInternalRequest` trả `db_unreachable`, còn
    // 401 hay 503 là quyết định của `main.ts`. Nếu nhánh `db_unreachable` bị bỏ
    // đi, request này quay về 401 và không test nào khác đỏ.
    const raw = '{}';
    const body = new TextEncoder().encode(raw);
    const path = '/internal/session/verified';
    const headers = await signRequest({
      method: 'POST',
      path,
      body,
      secret: env.AUTH_INTERNAL_SECRET as string,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    // Một lần gọi duy nhất, bắt cả response lẫn dòng log: gọi hai lần thì assertion về
    // dòng log không còn thuộc về chính response đang được kiểm.
    const { lines, result: response } = await captureLogLines(
      async () => await app.request(path, { method: 'POST', headers, body: raw }, env),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
    // ⚠️ `Retry-After` là phần của hợp đồng 503 của nền tảng
    // (`docs/overview/03-operations.md` §3.2): thiếu nó thì phía gọi không phân biệt
    // được sự cố tạm thời với sự cố vĩnh viễn. Test này ghim cả **sự có mặt** lẫn
    // **định dạng** (số giây) — một header rỗng cũng thoả `not.toBeNull()`.
    const retryAfter = response.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(Number(retryAfter))).toBe(true);
    // ⚠️ 503 là sự cố hạ tầng, không phải lỗi xác thực: không được mang
    // `WWW-Authenticate` (nó khiếu client thử lại bằng credential khác) và không
    // được rò chi tiết lỗi driver (SR-001 — message của driver có thể chứa
    // connection string).
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(JSON.stringify(response.headers)).not.toContain('hyperdrive');
    // ⚠️ Cùng bất biến đó áp cho dòng log: `db_unreachable` là **mã**, không phải
    // message của driver `pg` (message của nó có thể chứa connection string). Log là nơi
    // duy nhất nói rằng kho nonce không gọi được, nên nó phải ghi được mà không rò gì.
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      event: 'internal_auth.rejected',
      route: INTERNAL_PATH,
      method: 'POST',
      status: 503,
      reason: 'db_unreachable',
    });
    expect(lines[0]).not.toContain('hyperdrive');
  });

  it('rejects a body that differs only in bytes invalid as UTF-8 (F-01, end to end)', async () => {
    // ⚠️ Bất biến bảo mật trung tâm của PR này, kiểm **qua route thật** — không chỉ ở
    // tầng lib.
    //
    // `0xff` không phải UTF-8 hợp lệ, và `TextDecoder` non-fatal biến nó thành U+FFFD.
    // Bản trước của route này `new TextDecoder().decode(raw)` rồi mới ký, nên hai payload
    // **khác nhau trên dây** ra cùng một chữ ký: kẻ tấn công đổi byte trong payload mà
    // chữ ký vẫn đúng. Ca này ký `61 ff 62` rồi gửi `61 efbfbd 62` (chính là `a�b`)
    // và đòi `bad_signature`.
    //
    // Một bản cài đặt quay lại decode trước khi băm sẽ làm test này **xanh sai** ở nhánh
    // `ok` (nó chấp nhận), nên không thể lọt: đây là ca duy nhất trong file mà hai đầu
    // vào khác byte nhưng cùng "nội dung đã decode".
    const signedBytes = new Uint8Array([0x61, 0xff, 0x62]);
    const headers = await signRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body: signedBytes,
      secret: env.AUTH_INTERNAL_SECRET as string,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    expect(new TextDecoder().decode(signedBytes)).toBe('a�b');

    const { lines, result: response } = await captureLogLines(
      async () =>
        await app.request(
          INTERNAL_PATH,
          { method: 'POST', headers, body: new Uint8Array([0x61, 0xef, 0xbf, 0xbd, 0x62]) },
          env,
        ),
    );

    expect(response.status).toBe(401);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ reason: 'bad_signature' });
  });

  it('rejects a body whose bytes differ from the signed ones, at the route', async () => {
    // Một byte bị thêm vào: cùng payload "có nghĩa", khác byte. Không được 501 (đi qua
    // được bước xác thực) mà phải 401.
    const raw = '{"sub":"sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
    const headers = await signRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body: new TextEncoder().encode(raw),
      secret: env.AUTH_INTERNAL_SECRET as string,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    const response = await app.request(
      INTERNAL_PATH,
      { method: 'POST', headers, body: `${raw} ` },
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});

describe('internal rejection log', () => {
  it('writes one line with event/route/method/status/reason and the fixed reason code', async () => {
    // ⚠️ Không có header nào ⇒ `missing_header`. Ca này ghim **hình dạng** của dòng log
    // (đúng năm trường, không thêm) và việc `reason` là mã của union chứ không phải chuỗi
    // tự do. Bỏ dòng log đi thì `401` trả về vẫn đúng như cũ và không test nào khác đỏ —
    // nghĩa là tín hiệu audit sẽ biến mất trong im lặng.
    const { lines, result: response } = await captureLogLines(
      async () => await app.request(INTERNAL_PATH, { method: 'POST', body: '{}' }, env),
    );

    expect(response.status).toBe(401);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      event: 'internal_auth.rejected',
      route: INTERNAL_PATH,
      method: 'POST',
      status: 401,
      reason: 'missing_header',
    });
  });

  it('never writes the signature header value into the log', async () => {
    // ⚠️ Chữ ký HMAC là giá trị **còn tái dùng được trong cửa sổ skew**, và một dòng log
    // sống lâu hơn request rất nhiều. Hợp đồng ở `docs/services/auth/03-operations.md` §3
    // cấm ghi nó; `reason` mới là thứ đủ để phân loại sự cố.
    //
    // Bất biến này chỉ đo được bằng một chữ ký **nhận ra được** trong dòng log, nên ca
    // này dùng chuỗi `v1=…` đặc trưng; timestamp hợp lệ + nonce mạnh đưa request tới
    // bước so chữ ký (`bad_signature` là lý do xác định: `verifyRequest` kiểm chữ ký
    // TRƯỚC khi chạm kho nonce), nên không cần DB.
    const { lines, result: response } = await captureLogLines(
      async () =>
        await app.request(
          INTERNAL_PATH,
          {
            method: 'POST',
            headers: {
              'x-ecoma-internal-timestamp': String(Math.floor(Date.now() / 1000)),
              'x-ecoma-internal-nonce': STRONG_NONCE,
              'x-ecoma-internal-signature': 'v1=deadbeefdeadbeefdeadbeef',
            },
            body: '{}',
          },
          env,
        ),
    );

    expect(response.status).toBe(401);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(parsed.reason).toBe('bad_signature');
    expect(lines[0]).not.toContain('deadbeef');
  });
});

describe('routing', () => {
  it('khong route nao o goc den khi duoc dinh nghia', async () => {
    expect((await get('/')).status).toBe(404);
  });
});
