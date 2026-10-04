import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_SKEW_SECONDS,
  INTERNAL_NONCE_HEADER,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  NONCE_TTL_BUFFER_SECONDS,
  createNonce,
  signRequest,
  verifyRequest,
} from '@ecoma-io/identity-auth-contracts';
import { createPostgresClient } from '@ecoma-io/identity-auth-infrastructure';

import {
  NONCE_CLAIM_CONNECT_TIMEOUT_SECONDS,
  isAuthenticatedInternalRequest,
  makeNonceGuard,
  signInternalRequest,
} from './account-client';

/**
 * Đường xác thực nội bộ của `auth`, nhìn từ chính composition root của nó.
 *
 * Ba tầng được kiểm ở đây, và tầng nào cũng cần một lý do:
 *
 *  1. **Contract cơ bản** — ký rồi verify trên đúng envelope canonical. Chạy được
 *     ở mọi môi trường.
 *  2. **Fail-closed khi kho nonce không gọi được** — không cần PostgreSQL, và đây
 *     là tính chất bảo mật quan trọng nhất của file: nếu lỗi hạ tầng bị nuốt thành
 *     "nonce chưa từng thấy" thì mọi envelope đã ký trở thành replayable trong suốt
 *     thời gian DB chết, và không test tuần tự nào bắt được.
 *  3. **`makeNonceGuard` trên PostgreSQL thật** — chỉ chạy khi có `AUTH_TEST_PG_*`.
 *     ⚠️ **Thiếu biến thì SKIP, và một skip trông y hệt một pass.** PR phải nói rõ
 *     phần đó chưa verify nếu CI không set biến.
 *
 * ⚠️ Test này **áp chính các file `apps/auth/migrations/*.sql`**, không khai một bảng
 * riêng: một bảng do test tự chế là schema thứ hai, và test xanh trên schema thứ hai
 * không nói được gì về production. Cùng lý do và cùng khoá advisory với
 * `libs/identity-auth-infrastructure/src/internal-nonces.spec.ts` và
 * `authorization-code-cas.spec.ts` — ba spec dựng schema trên cùng một database.
 */

const HOST = process.env['AUTH_TEST_PG_HOST'];
const PORT = process.env['AUTH_TEST_PG_PORT'];
const DATABASE = process.env['AUTH_TEST_PG_DATABASE'];
const RUNTIME_USER = process.env['AUTH_TEST_PG_USER'];
const RUNTIME_PASSWORD = process.env['AUTH_TEST_PG_PASSWORD'];
const MIGRATOR_USER = process.env['AUTH_TEST_PG_MIGRATOR_USER'];
const MIGRATOR_PASSWORD = process.env['AUTH_TEST_PG_MIGRATOR_PASSWORD'];

const available =
  HOST !== undefined &&
  PORT !== undefined &&
  DATABASE !== undefined &&
  RUNTIME_USER !== undefined &&
  MIGRATOR_USER !== undefined;

const MIGRATIONS_DIR = join(import.meta.dirname, '../migrations');

/**
 * Khoá advisory cho bước dựng schema — **phải trùng** hằng cùng tên ở
 * `libs/identity-auth-infrastructure/src/internal-nonces.spec.ts` và
 * `authorization-code-cas.spec.ts`.
 *
 * ⚠️ Không trùng thì lock mất tác dụng và triệu chứng duy nhất là một suite đỏ ngẫu
 * nhiên vì `relation "oauth_clients" already exists`: Vitest chạy song song theo file,
 * `nx run-many -t test` chạy song song theo project.
 */
const SCHEMA_SETUP_LOCK_KEY = 8_274_411;

/**
 * Khoá advisory giữ suốt suite — **phải trùng** hằng cùng tên ở
 * `libs/identity-auth-infrastructure/src/internal-nonces.spec.ts`.
 *
 * ⚠️ Cần cả hai khoá, không chỉ khoá schema. `SCHEMA_SETUP_LOCK_KEY` chỉ tuần tự hoá
 * bước `CREATE`; nó không ngăn hai suite chạm cùng dữ liệu. `auth.internal_nonces` là
 * bảng **dùng chung**, và spec bên lib `DELETE` toàn bảng rồi assert `count(*)` toàn
 * bảng — nên chạy song song thì hàng của suite này lọt vào phép đếm đó. Đã đo được:
 * `nx run-many -t test` cho hai project song song làm `count(*)` trả `2` thay vì `1`.
 *
 * Thứ tự lấy khoá nhất quán giữa các suite (`suite` rồi mới `schema`) nên không có
 * chu trình khoá. Khoá là session-scoped nên nó nằm trên một connection duy nhất.
 */
const NONCE_SUITE_LOCK_KEY = 3_771_002;

/** Secret HMAC dùng chung trong test — không phải secret thật, chỉ để ký/verify. */
const SECRET = 'test-internal-hmac-secret-0123456789abcdef';

const INTERNAL_PATH = '/internal/session/verified';

/**
 * Binding Hyperdrive.
 *
 * ⚠️ Có `connectionString` **và** các trường rời, vì `postgres.js` chỉ gọi `parseUrl`
 * khi tham số là `string`; với một object nó bỏ qua `connectionString` và đọc
 * `host`/`port`/`user`/`password`/`database`. Binding Hyperdrive thật mang đủ các
 * trường đó, nên đây là hình dạng đúng của Workers — không phải hình dạng tối thiểu
 * mà type của lib khai.
 */
interface TestBinding {
  readonly connectionString: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

function bindingFor(user: string, password: string | undefined): TestBinding {
  const host = HOST as string;
  const port = Number(PORT as string);
  const database = DATABASE as string;
  return {
    connectionString: `postgres://${user}:${encodeURIComponent(password ?? '')}@${host}:${port}/${database}`,
    host,
    port,
    user,
    password: password ?? '',
    database,
  };
}

/**
 * Binding tới một cổng không có listener.
 *
 * `ECONNREFUSED` ngay, không phải một lần chờ timeout — test fail-closed phải đo
 * **nhánh xử lý lỗi**, không đo độ kiên nhẫn của driver.
 */
const UNREACHABLE_BINDING: TestBinding = {
  connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
  host: '127.0.0.1',
  port: 1,
  user: 'nobody',
  password: 'nobody',
  database: 'nothing',
};

/** Encode chuỗi → byte UTF-8, khớp đúng byte mà `Request` gửi đi. */
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * Ký một request nội bộ hợp lệ, trả `Request` (cho middleware) và **byte** của thân.
 *
 * ⚠️ Trả byte chứ không trả `string`: `isAuthenticatedInternalRequest` nhận
 * `Uint8Array` (F-01 — chữ ký buộc byte trên dây, không buộc một ảnh chiếu đã decode).
 * `Request` ở đây được dựng từ **chuỗi** để kiểm cả đường encode UTF-8 thật, và byte
 * trả về là kết quả encode **cùng** chuỗi đó — nếu hai đường này lệch nhau thì test
 * round-trip sẽ đỏ.
 */
async function signedRequest(params: {
  nonce?: string;
  timestampSeconds: number;
  path?: string;
  body?: string;
}): Promise<{ request: Request; body: Uint8Array; headers: Record<string, string> }> {
  const path = params.path ?? INTERNAL_PATH;
  const raw = params.body ?? JSON.stringify({ sub: 'sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const body = bytes(raw);
  const headers = await signRequest({
    method: 'POST',
    path,
    body,
    secret: SECRET,
    timestamp: String(params.timestampSeconds),
    nonce: params.nonce ?? createNonce(),
  });
  return {
    request: new Request(`https://auth.internal${path}`, { method: 'POST', headers, body: raw }),
    body,
    headers: { ...headers },
  };
}

/** Dựng schema bằng chính các file migration của `apps/auth`, dưới advisory lock. */
async function ensureSchema(): Promise<void> {
  const migrator = createPostgresClient(bindingFor(MIGRATOR_USER as string, MIGRATOR_PASSWORD));
  try {
    await migrator.unsafe('SELECT pg_advisory_lock($1)', [SCHEMA_SETUP_LOCK_KEY]);
    try {
      const existing = await migrator.unsafe<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'auth' AND table_name = 'internal_nonces'`,
      );
      if (existing.length > 0) {
        return;
      }
      // ⚠️ Thứ tự số trong tên file là thứ tự áp dụng. Migration không dùng
      // `CREATE TABLE IF NOT EXISTS` (README giải thích vì sao), nên re-runnable đến
      // từ việc kiểm tra ở trên — dưới lock, để hai tiến trình không cùng `CREATE`.
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .toSorted();
      for (const file of files) {
        await migrator.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      }
    } finally {
      await migrator.unsafe('SELECT pg_advisory_unlock($1)', [SCHEMA_SETUP_LOCK_KEY]);
    }
  } finally {
    await migrator.end({ timeout: 1 });
  }
}

/** Chạy `body` với một client runtime và một client migrator, rồi đóng cả hai. */
async function withStore(
  body: (runtime: ReturnType<typeof createPostgresClient>) => Promise<void>,
): Promise<void> {
  await ensureSchema();
  const migrator = createPostgresClient(bindingFor(MIGRATOR_USER as string, MIGRATOR_PASSWORD));
  const runtime = createPostgresClient(bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD));
  try {
    await migrator.unsafe('DELETE FROM auth.internal_nonces');
    await body(runtime);
  } finally {
    await runtime.end({ timeout: 1 });
    await migrator.end({ timeout: 1 });
  }
}

describe('internal-auth contract (auth-side view)', () => {
  it('signs and verifies round-trip', async () => {
    const nonce = createNonce();
    const body = bytes(JSON.stringify({ sub: 'sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    const headers = await signRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body,
      secret: SECRET,
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce,
    });
    const result = await verifyRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body,
      headers,
      secret: SECRET,
      now: String(Math.floor(Date.now() / 1000)),
      claimNonce: () => false,
    });
    expect(result.ok).toBe(true);
  });

  it('signInternalRequest returns exactly the byte array it signed', async () => {
    // ⚠️ Bất biến "ký byte nào, gửi byte ấy" là một **sự thật của cấu trúc** chỉ khi
    // hàm trả cả hai. Nếu nó trả mỗi `Headers`, call site phải tự encode lại body sau
    // khi ký — và ở đó nó có cơ hội encode một chuỗi khác (hoặc `JSON.stringify` lại
    // một object đã parse), tức gửi byte chưa từng được ký. Test này đóng đúng khoảng
    // đó: nó so mảng byte trả về với mảng byte được dùng để dựng chữ ký.
    const body = new TextEncoder().encode('{"sub":"sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
    const signed = await signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: INTERNAL_PATH,
      body,
      nowMs: Date.now(),
    });

    // Bản sao của mảng đầu vào: `toEqual` trên nội dung, không so identity (một bản
    // cài đặt copy sang buffer mới vẫn đúng).
    expect(signed.body).toEqual(body);

    // Và chữ ký trong header phải verify được với **chính** byte đó.
    const result = await verifyRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body: signed.body,
      headers: {
        [INTERNAL_TIMESTAMP_HEADER]: signed.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
        [INTERNAL_NONCE_HEADER]: signed.headers.get(INTERNAL_NONCE_HEADER) ?? '',
        [INTERNAL_SIGNATURE_HEADER]: signed.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '',
      },
      secret: SECRET,
      now: signed.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
      claimNonce: () => false,
    });
    expect(result.ok).toBe(true);

    // Mặt đối: một byte khác thì chữ ký đó KHÔNG còn hợp lệ. Không có assert này, một
    // bản cài đặt ký chuỗi rỗng (bỏ qua `body`) vẫn xanh ở trên.
    const different = await verifyRequest({
      method: 'POST',
      path: INTERNAL_PATH,
      body: new TextEncoder().encode('{"sub":"sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'),
      headers: {
        [INTERNAL_TIMESTAMP_HEADER]: signed.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
        [INTERNAL_NONCE_HEADER]: signed.headers.get(INTERNAL_NONCE_HEADER) ?? '',
        [INTERNAL_SIGNATURE_HEADER]: signed.headers.get(INTERNAL_SIGNATURE_HEADER) ?? '',
      },
      secret: SECRET,
      now: signed.headers.get(INTERNAL_TIMESTAMP_HEADER) ?? '',
      claimNonce: () => false,
    });
    expect(different).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('NONCE_CLAIM_CONNECT_TIMEOUT_SECONDS is positive and inside the request budget', () => {
    // ⚠️ Vì sao khoá một hằng số bằng test: không có assert nào khác phụ thuộc giá trị
    // này, nên ai đó đổi nó thành 30 (mặc định của driver) hoặc 0 sẽ không làm test nào
    // đỏ — mà 30 giây thì request đã bị cắt trước khi connect xong, còn 0 thì pool ném
    // ngay lập tức và mọi request hợp lệ thành `db_unreachable`. Bất biến thật là:
    // **dương** và **dưới ngân sách của `ACCOUNT_TIMEOUT_MS` (3s)**, vì vượt 3s là vô
    // nghĩa trên đường này (xem JSDoc của hằng số).
    expect(NONCE_CLAIM_CONNECT_TIMEOUT_SECONDS).toBeGreaterThan(0);
    expect(NONCE_CLAIM_CONNECT_TIMEOUT_SECONDS).toBeLessThan(3_000 / 1000);
    // Số nguyên giây: driver nhận `connect_timeout` theo giây, một giá trị thập phân
    // làm `postgres.js` ném ở tầng parse.
    expect(Number.isInteger(NONCE_CLAIM_CONNECT_TIMEOUT_SECONDS)).toBe(true);
  });

  it('dung cung mot khoa advisory voi cac spec PostgreSQL khac', () => {
    // Test trên **file nguồn**, không cần database — và nó phải chạy cả khi không có
    // PostgreSQL: thiếu nó thì hai spec lặng lẽ dùng hai khoá khác nhau và lock mất
    // tác dụng, mà triệu chứng chỉ là một suite đỏ ngẫu nhiên.
    const other = readFileSync(
      join(
        import.meta.dirname,
        '../../../libs/identity-auth-infrastructure/src/internal-nonces.spec.ts',
      ),
      'utf8',
    );
    const schemaKey = /SCHEMA_SETUP_LOCK_KEY = ([\d_]+)/u.exec(other);
    const suiteKey = /NONCE_SUITE_LOCK_KEY = ([\d_]+)/u.exec(other);
    expect(schemaKey).not.toBeNull();
    expect(suiteKey).not.toBeNull();
    expect(Number((schemaKey?.[1] ?? '').replaceAll('_', ''))).toBe(SCHEMA_SETUP_LOCK_KEY);
    expect(Number((suiteKey?.[1] ?? '').replaceAll('_', ''))).toBe(NONCE_SUITE_LOCK_KEY);
  });
});

describe('fail closed khi kho nonce khong goi duoc', () => {
  it('makeNonceGuard NEM, khong bao gio tra ve false', async () => {
    // ⚠️ `false` nghĩa là "nonce chưa từng thấy" — và `verifyRequest` coi đó là `ok`.
    // Một lỗi hạ tầng bị nuốt thành `false` biến mọi envelope đã ký thành replayable
    // trong suốt thời gian DB chết, và **không** test tuần tự nào bắt được.
    const guard = makeNonceGuard(UNREACHABLE_BINDING, DEFAULT_SKEW_SECONDS);
    // Kèm `ECONNREFUSED` để chứng minh request chết ở **bước kết nối** tới kho nonce,
    // không phải vì một lỗi khác trong guard — guard nuốt lỗi thành `false` thì vẫn là
    // lỗi nặng hơn, nhưng một test chỉ hỏi "có ném không" không phân biệt được hai ca.
    await expect(guard('nonce-unreachable', Math.floor(Date.now() / 1000))).rejects.toThrow(
      /ECONNREFUSED/u,
    );
  });

  it('isAuthenticatedInternalRequest dich loi DB thanh `db_unreachable`, khong phai `ok`', async () => {
    // Composition thật: request ký hợp lệ, chữ ký đúng, `claimNonce` ném vì DB chết.
    // Kết quả phải là từ chối — và là `db_unreachable` (⇒ 503 trong `main.ts`), không
    // phải một `ok` và cũng không phải `bad_signature` (⇒ 401), vì hai mã đó nói sai
    // về nguyên nhân và 401 sẽ khiến người vận hành đi tìm lỗi chữ ký.
    const { request, body } = await signedRequest({
      timestampSeconds: Math.floor(Date.now() / 1000),
    });
    const result = await isAuthenticatedInternalRequest({
      secret: SECRET,
      request,
      body,
      nowMs: Date.now(),
      hyperdrive: UNREACHABLE_BINDING,
    });
    expect(result).toEqual({ ok: false, reason: 'db_unreachable' });
  });

  it('chu ky SAI khong cham toi kho nonce — `bad_signature`, khong phai `db_unreachable`', async () => {
    // ⚠️ Đây là thứ tự kiểm của `verifyRequest`, và thứ tự mới là bảo vệ: callback
    // `claimNonce` chỉ chạy SAU khi chữ ký được chứng minh. Nếu nó chạy trước, một kẻ
    // đọc được nonce thật từ proxy log hay `wrangler tail` có thể gửi envelope với
    // chữ ký giả và **đốt** nonce đó; request thật sau đó rơi vào `replayed_nonce` dù
    // chưa từng bị replay, và kẻ tấn công không cần secret.
    //
    // Với store không gọi được, một chữ ký sai vẫn phải ra `bad_signature`: nếu ra
    // `db_unreachable` thì hoặc store đã bị chạm trước khi xác thực, hoặc mã lỗi đang
    // che mất nguyên nhân thật.
    const { request, body } = await signedRequest({
      timestampSeconds: Math.floor(Date.now() / 1000),
    });
    const forged = new Request(request.url, request);
    forged.headers.set('x-ecoma-internal-signature', `v1=${'0'.repeat(64)}`);

    const result = await isAuthenticatedInternalRequest({
      secret: SECRET,
      request: forged,
      body,
      nowMs: Date.now(),
      hyperdrive: UNREACHABLE_BINDING,
    });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('khong co nhanh "bo qua replay guard": claimNonce luon tro vao kho nonce', () => {
    // ⚠️ Test này thay cho một test CŨ đang ghim điều ngược lại. Bản cũ cho
    // `isAuthenticatedInternalRequest` nhận `hyperdrive: null` và ghim rằng request vẫn
    // được **chấp nhận** (`ok: true`) — tức là ghim một cửa sổ replay vô hạn làm "hành vi
    // hiện tại", trong khi tiêu đề của chính nó lại nói "từ chối". Giao thức nói ngược
    // lại: khi không thực hiện được chống replay bền thì phải từ chối request, không được
    // đi vòng qua guard.
    //
    // Cách sửa không phải là đổi nhánh `null` thành từ chối, mà là **bỏ hẳn nhánh đó**:
    // `loadAuthConfig` ném khi binding Hyperdrive thiếu, nên `null` không tới được, và
    // tham số giờ là `{ connectionString: string }` không nullable. "Không có kho nonce"
    // trở thành lỗi type thay vì hành vi lúc chạy.
    //
    // Vì đây là bất biến về **cấu trúc** (không còn nhánh nào để chạy), test đọc nguồn:
    // một test hành vi không phân biệt được "không có nhánh" với "có nhánh nhưng chưa
    // được chạm tới". Cùng cách những assert migration trong repo này làm.
    const source = readFileSync(join(import.meta.dirname, 'account-client.ts'), 'utf8');

    expect(source).toMatch(/hyperdrive: \{ connectionString: string \};/u);
    expect(source).not.toMatch(/hyperdrive: \{ connectionString: string \} \| null/u);
    // Không được có callback "coi như nonce chưa từng thấy" nào lọt vào `claimNonce`.
    expect(source).not.toMatch(/: \(\) => false/u);
    expect(source).not.toMatch(/claimNonce:\s*[^,\n]*\?/u);
    expect(source).toMatch(/claimNonce: makeNonceGuard\(/u);
  });
});

describe.skipIf(!available)('makeNonceGuard tren PostgreSQL that', () => {
  // Giữ khoá suite cho hết vòng đời — xem JSDoc của `NONCE_SUITE_LOCK_KEY`. Spec
  // bên lib dọn và đếm **toàn bảng** `auth.internal_nonces`, nên hai suite không được
  // chạm cùng bảng cùng lúc.
  let suiteLock: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    suiteLock = postgres({
      host: HOST as string,
      port: Number(PORT as string),
      user: MIGRATOR_USER as string,
      password: MIGRATOR_PASSWORD ?? '',
      database: DATABASE as string,
      max: 1,
      prepare: false,
    });
    await suiteLock.unsafe('SELECT pg_advisory_lock($1)', [NONCE_SUITE_LOCK_KEY]);
  }, 30_000);

  afterAll(async () => {
    if (suiteLock === undefined) {
      return;
    }
    await suiteLock.unsafe('SELECT pg_advisory_unlock($1)', [NONCE_SUITE_LOCK_KEY]);
    await suiteLock.end({ timeout: 1 });
  });

  it('lan dau chap nhan, envelope y nguyen bi tu choi la replayed_nonce', async () => {
    await withStore(async () => {
      const envelopeTimestamp = Math.floor(Date.now() / 1000);
      const nonce = createNonce();
      const binding = bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD);
      const guard = (): ((n: string, t: number) => Promise<boolean>) =>
        makeNonceGuard(binding, DEFAULT_SKEW_SECONDS);

      const first = await verifyRequest({
        method: 'POST',
        path: INTERNAL_PATH,
        body: bytes('{"sub":"sub_1"}'),
        headers: await signRequest({
          method: 'POST',
          path: INTERNAL_PATH,
          body: bytes('{"sub":"sub_1"}'),
          secret: SECRET,
          timestamp: String(envelopeTimestamp),
          nonce,
        }),
        secret: SECRET,
        now: String(envelopeTimestamp),
        claimNonce: guard(),
      });
      expect(first.ok).toBe(true);

      // ⚠️ Envelope **y nguyên** — cùng nonce, cùng timestamp, cùng body, cùng chữ
      // ký. Đây là replay theo đúng nghĩa: không phải một lần thử lại nghiệp vụ với
      // envelope mới.
      const replay = await verifyRequest({
        method: 'POST',
        path: INTERNAL_PATH,
        body: bytes('{"sub":"sub_1"}'),
        headers: await signRequest({
          method: 'POST',
          path: INTERNAL_PATH,
          body: bytes('{"sub":"sub_1"}'),
          secret: SECRET,
          timestamp: String(envelopeTimestamp),
          nonce,
        }),
        secret: SECRET,
        now: String(envelopeTimestamp),
        claimNonce: guard(),
      });
      expect(replay).toEqual({ ok: false, reason: 'replayed_nonce' });
    });
  });

  it('retry nghiep vu hop le: envelope MOI, cung payload — duoc chap nhan', async () => {
    // ⚠️ Phân biệt với test trên, và đây là chỗ dễ làm hỏng nhất khi "sửa cho test
    // replay xanh": hai lần gửi **cùng nội dung nghiệp vụ** nhưng envelope mới (nonce
    // mới) là một lần thử lại hợp lệ, không phải replay. Siết nonce tới mức chặn luôn
    // trường hợp này là **làm yếu business idempotency để replay test xanh** — đúng
    // thứ task cấm. Nonce chỉ chống envelope trùng; idempotency nghiệp vụ là chuyện
    // của khoá nghiệp vụ (`event_id`), không phải của nonce.
    await withStore(async () => {
      const envelopeTimestamp = Math.floor(Date.now() / 1000);
      const binding = bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD);
      const payload = '{"sub":"sub_2","outcome":"verified"}';

      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await verifyRequest({
          method: 'POST',
          path: INTERNAL_PATH,
          body: bytes(payload),
          headers: await signRequest({
            method: 'POST',
            path: INTERNAL_PATH,
            body: bytes(payload),
            secret: SECRET,
            timestamp: String(envelopeTimestamp),
            nonce: createNonce(),
          }),
          secret: SECRET,
          now: String(envelopeTimestamp),
          claimNonce: makeNonceGuard(binding, DEFAULT_SKEW_SECONDS),
        });
        expect(result.ok).toBe(true);
      }
    });
  });

  it('TTL neo theo timestamp cua ENVELOPE, khong theo dong ho cua verifier', async () => {
    // ⚠️ Envelope được ký với timestamp **lùi về quá khứ** (trong cửa sổ skew) để
    // phân biệt hai cách neo. Neo đúng: `expires_at = timestamp + skew + buffer`, nên
    // khoảng cách tới timestamp của envelope đúng bằng `skew + buffer` bất kể ta chạy
    // test lúc nào. Neo sai (`now + skew + buffer`): khoảng cách đó lớn hơn đúng bằng
    // độ lùi, và test này đỏ. Không có test nào khác bắt được — cả hai cách đều cho
    // một nonce "sống đủ lâu" trong mọi kịch bản tuần tự.
    //
    // Vì sao neo theo envelope mới đúng: `verifyRequest` chấp nhận khi
    // `|now − timestamp| ≤ skew`, nên cửa sổ replay của envelope kết thúc tại
    // `timestamp + skew`. Neo theo `now` của verifier thì khi đồng hồ verifier chậm
    // (`now = timestamp − skew`), TTL `now + skew + buffer = timestamp + buffer` **ngắn
    // hơn** cửa sổ, và prune mở lại một cửa sổ replay thay vì đóng nó.
    await withStore(async (runtime) => {
      const now = Math.floor(Date.now() / 1000);
      const envelopeTimestamp = now - 60;
      const nonce = createNonce();

      const result = await verifyRequest({
        method: 'POST',
        path: INTERNAL_PATH,
        body: bytes(''),
        headers: await signRequest({
          method: 'POST',
          path: INTERNAL_PATH,
          body: bytes(''),
          secret: SECRET,
          timestamp: String(envelopeTimestamp),
          nonce,
        }),
        secret: SECRET,
        now: String(now),
        claimNonce: makeNonceGuard(
          bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD),
          DEFAULT_SKEW_SECONDS,
        ),
      });
      expect(result.ok).toBe(true);

      const rows = await runtime.unsafe<{ offset_seconds: number; alive: boolean }>(
        `SELECT EXTRACT(EPOCH FROM expires_at)::float8 - $1::float8 AS offset_seconds,
                expires_at > now() AS alive
           FROM auth.internal_nonces WHERE nonce = $2`,
        [envelopeTimestamp, nonce],
      );
      const stored = rows[0];
      if (stored === undefined) {
        throw new Error('verifyRequest bao ok nhung khong co dong nonce nao duoc ghi');
      }

      // Neo theo envelope: offset = skew + buffer, cộng/trừ dung sai đồng hồ giữa
      // test và database. Neo theo `now` sẽ lệch thêm 60s và rơi ra ngoài khoảng này.
      const expected = DEFAULT_SKEW_SECONDS + NONCE_TTL_BUFFER_SECONDS;
      expect(Math.abs(stored.offset_seconds - expected)).toBeLessThanOrEqual(2);

      // Nonce phải còn sống qua hết cửa sổ replay của chính envelope đó
      // (`timestamp + skew`). Đây là bất biến mà prune dựa vào.
      const boundary = await runtime.unsafe<{ still_alive: boolean }>(
        `SELECT expires_at > to_timestamp($1::float8 + $2::float8) AS still_alive
           FROM auth.internal_nonces WHERE nonce = $3`,
        [envelopeTimestamp, DEFAULT_SKEW_SECONDS, nonce],
      );
      expect(boundary[0]?.still_alive).toBe(true);
    });
  });

  it('isAuthenticatedInternalRequest chap nhan mot lan roi tu choi envelope do', async () => {
    // Ghép tầng composition thật với store thật: `main.ts` gọi đúng hàm này cho
    // `POST /internal/session/verified`, rồi dịch `ok:false` thành 401 và
    // `db_unreachable` thành 503. Đây là đường mà một request nội bộ thật đi qua.
    await withStore(async () => {
      const binding = bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD);
      const nowMs = Date.now();
      const nonce = createNonce();
      const { request, body } = await signedRequest({
        nonce,
        timestampSeconds: Math.floor(nowMs / 1000),
      });

      const first = await isAuthenticatedInternalRequest({
        secret: SECRET,
        request,
        body,
        nowMs,
        hyperdrive: binding,
      });
      expect(first).toEqual({ ok: true, nonce });

      const replay = await isAuthenticatedInternalRequest({
        secret: SECRET,
        request,
        body,
        nowMs,
        hyperdrive: binding,
      });
      expect(replay).toEqual({ ok: false, reason: 'replayed_nonce' });

      // Đúng **một** hàng được ghi cho nonce đó: một lần chấp nhận, không phải hai.
      const runtime = createPostgresClient(binding);
      try {
        const rows = await runtime.unsafe<{ count: string }>(
          `SELECT count(*)::text AS count FROM auth.internal_nonces WHERE nonce = $1`,
          [nonce],
        );
        expect(rows[0]?.count).toBe('1');
      } finally {
        await runtime.end({ timeout: 1 });
      }
    });
  });

  it('passes a non-default skewSeconds to both verifyRequest and makeNonceGuard', async () => {
    // ⚠️ Hai bên phải dùng **cùng một** skew: TTL của nonce neo theo
    // `timestamp + skew + buffer`, nên nếu `verifyRequest` nhận một skew còn
    // `makeNonceGuard` nhận một skew khác thì cửa sổ replay và vòng đời nonce lệch
    // nhau — và lệch theo hướng TTL ngắn hơn nghĩa là prune xoá nonce **còn hiệu lực**,
    // replay trong cửa sổ thành công. Test này ghim đúng cặp tham số đó.
    await withStore(async (runtime) => {
      const now = Math.floor(Date.now() / 1000);
      const envelopeTimestamp = now - 60;
      const nonce = createNonce();
      const customSkew = 120;
      const binding = bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD);

      const result = await verifyRequest({
        method: 'POST',
        path: INTERNAL_PATH,
        body: bytes(''),
        headers: await signRequest({
          method: 'POST',
          path: INTERNAL_PATH,
          body: bytes(''),
          secret: SECRET,
          timestamp: String(envelopeTimestamp),
          nonce,
        }),
        secret: SECRET,
        now: String(now),
        skewSeconds: customSkew,
        claimNonce: makeNonceGuard(binding, customSkew),
      });
      expect(result.ok).toBe(true);

      const rows = await runtime.unsafe<{ offset_seconds: number }>(
        `SELECT EXTRACT(EPOCH FROM expires_at)::float8 - $1::float8 AS offset_seconds
           FROM auth.internal_nonces WHERE nonce = $2`,
        [envelopeTimestamp, nonce],
      );
      const stored = rows[0];
      if (stored === undefined) {
        throw new Error('expected nonce row');
      }
      const expected = customSkew + NONCE_TTL_BUFFER_SECONDS;
      expect(Math.abs(stored.offset_seconds - expected)).toBeLessThanOrEqual(2);
    });
  });
});
