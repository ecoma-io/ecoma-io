import { createApp, toWebHandler, type WebHandler } from 'h3';
import type { Pool } from 'pg';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerifyRequestInput } from '@ecoma-io/identity-contracts';

import internalAuthMiddleware, { makeNonceGuard } from './internal-auth';
import { withRequestPool } from '../utils/db';
import { writeLog } from '../utils/logger';

/**
 * Test middleware internal-auth ở hai điểm nó có thể sai âm thầm.
 *
 * ⚠️ Phần lớn logic xác thực nằm trong `verifyRequest` của `@ecoma-io/identity-contracts`
 * và **đã** có test ở lib đó. Viết lại nó ở đây là sao chép logic có thể trôi lệch với
 * lib — nên test này chỉ kiểm những gì thuộc **app**: hợp đồng của callback `claimNonce`
 * mà app cấp cho lib, và cách middleware hành xử khi DB chết. Đường đi end-to-end
 * (h3 app thật + `signRequest` thật + PostgreSQL thật) nằm ở
 * `tests/integration/internal-auth-e2e.spec.ts` — ở đó chứ không ở đây vì unit test
 * không có container, và vì chính sự vắng mặt của đường end-to-end đã từng
 * làm lọt hai lỗi critical (pool bị `end()` trước khi `claimNonce` chạy; `event.path`
 * bị ghép query lần thứ hai).
 */

vi.mock('../utils/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/db')>();
  // `recordNonce` (dùng bởi `makeNonceGuard`) giữ bản thật; chỉ `withRequestPool`
  // bị mock để unit test điều khiển được lỗi DB mà middleware phải nuốt.
  return { ...actual, withRequestPool: vi.fn<() => Promise<unknown>>() };
});

vi.mock('../utils/logger', () => ({
  writeLog: vi.fn<(entry: Record<string, unknown>) => void>(),
}));

const mockedWriteLog = vi.mocked(writeLog);
const mockedWithRequestPool = vi.mocked(withRequestPool);

/**
 * Pool giả — chỉ cần `connect()` trả client có `query` và `release`.
 *
 * ⚠️ Ghi vào `mock.calls` để test đọc được SQL và tham số mà `recordNonce` thực
 * sự gửi xuống, thay vì chỉ kiểm "có gọi hay không".
 */
function fakePool(rowCount: number): Pool {
  const client = {
    query: vi.fn<
      (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>
    >(() => Promise.resolve({ rowCount, rows: [] })),
    release: vi.fn<() => void>(),
  };
  return {
    connect: vi.fn<() => Promise<typeof client>>(() => Promise.resolve(client)),
  } as unknown as Pool;
}

/**
 * Timestamp envelope cố định — test neo TTL theo mốc này chứ không theo đồng hồ.
 *
 * Chọn một epoch xa trong quá khứ là có chủ đích: nếu callback fallback về
 * `Date.now()` thì kết quả lệch T cố định này ngay, kể cả khi đồng hồ đúng.
 */
const ENVELOPE_TIMESTAMP = 1_700_000_000;

describe('makeNonceGuard', () => {
  it('reports a fresh nonce as unseen and a repeated one as seen', async () => {
    // `rowCount === 0` của `INSERT … ON CONFLICT DO NOTHING` nghĩa là đụng ràng buộc
    // UNIQUE ⇒ nonce đã có ⇒ đã thấy trước đó. `rowCount === 1` là nonce mới.
    const fresh = makeNonceGuard(fakePool(1), 300);
    const repeated = makeNonceGuard(fakePool(0), 300);

    await expect(fresh('nonce-a', ENVELOPE_TIMESTAMP)).resolves.toBe(false);
    await expect(repeated('nonce-a', ENVELOPE_TIMESTAMP)).resolves.toBe(true);
  });

  it('matches the widened claimNonce signature of the contract library', async () => {
    // `verifyRequest` gọi `claimNonce(nonce, timestampSeconds)` với timestamp đã qua
    // kiểm skew (hợp đồng mở rộng trong `libs/identity-contracts`). Gán guard vào
    // kiểu của lib và gọi với hai tham số: sai kiểu trả về hay sai kiểu tham số
    // (ví dụ `nonce: number`) đỏ lúc typecheck. ⚠️ TypeScript cho phép hàm **ít**
    // tham số gán vào kiểu **nhiều** tham số, nên việc thiếu tham số thứ hai không
    // bắt được ở đây — tham số đó được chứng minh ở test neo TTL bên dưới, nơi
    // giá trị lưu phải đúng theo đúng timestamp truyền vào.
    const guard: VerifyRequestInput['claimNonce'] = makeNonceGuard(fakePool(1), 300);
    await expect(guard('nonce-shape', ENVELOPE_TIMESTAMP)).resolves.toBe(false);
  });

  it('anchors expires_at to the envelope timestamp, not the verifier clock', async () => {
    // TTL = timestamp của envelope + skew + buffer — đúng công thức trong JSDoc của
    // `recordNonce` (`server/utils/db.ts`) và của `nonceExpiry` (`db/migrate.mts`).
    // Cửa sổ replay của envelope kết thúc tại `timestamp + skew`, nên mốc hết hạn
    // phải là mốc đó cộng buffer (prune chạy theo lô). Vì T ở đây cố định và không
    // đụng đồng hồ, assert **chính xác** được: fallback về `Date.now()` cho một giá
    // trị khác T + skew + buffer, và bỏ buffer cho giá trị thấp hơn đúng 60s.
    const pool = fakePool(1);
    await makeNonceGuard(pool, 300)('nonce-b', ENVELOPE_TIMESTAMP);

    const client = await pool.connect();
    const [sql, params] = client.query.mock.calls[0] ?? [];
    expect(sql).toContain('ON CONFLICT (nonce) DO NOTHING');
    expect(sql).toContain('account.internal_nonces');

    expect(Number(params?.[1])).toBe(ENVELOPE_TIMESTAMP + 300 + 60);
  });

  it('is a single statement, because check-then-insert loses atomicity', async () => {
    // Đọc-rồi-ghi cho hai request cùng nonce cùng thắng dưới tải đồng thời, tức
    // replay guard trở thành trang trí. Một `query` duy nhất là hình thức nguyên tử
    // mà `recordNonce` hứa; `connect` một lần chứng minh không có vòng SELECT trước.
    const pool = fakePool(1);
    await makeNonceGuard(pool, 300)('nonce-c', ENVELOPE_TIMESTAMP);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    const client = await pool.connect();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

/** Secret hợp lệ cho test — chỉ cần khác rỗng, middleware không soi nội dung. */
const SECRET = 'test-internal-hmac-secret-0123456789abcdef';

/**
 * Connection string giả trong message lỗi driver — không host thật nào bị chạm.
 *
 * `pg` thật có thể đặt connection string vào message lỗi (ví dụ khi auth fail),
 * và đúng thứ SR-001/invariant 9 cấm là thứ đó lọt vào log. Test dưới đây dùng
 * chuỗi này làm "mồi" để chứng minh middleware không bao giờ nối message lỗi
 * vào dòng log.
 */
const FAKE_CONNECTION_STRING =
  'postgres://ecoma_account_runtime:leaked-pw@10.0.0.9:5432/db-account';

describe('internal-auth middleware when the pool fails', () => {
  let handler: WebHandler;

  beforeAll(() => {
    const app = createApp();
    app.use(internalAuthMiddleware);
    handler = toWebHandler(app);
  });

  beforeEach(() => {
    // Config đủ cả secret lẫn binding để request đi tới được khối `withRequestPool`
    // — fail-closed ở hai nhánh config sẽ chặn trước và test này không còn kiểm
    // được gì về lỗi DB.
    vi.stubGlobal('useRuntimeConfig', () => ({
      internalHmacSecret: SECRET,
      internalAuthSkewSeconds: '',
      cloudflare: { env: { DB_ACCOUNT: { connectionString: 'postgres://stub-binding' } } },
    }));
    mockedWriteLog.mockClear();
    mockedWithRequestPool.mockReset();
  });

  it('answers 503 with a stable reason and never logs the driver message', async () => {
    // `withRequestPool` (toàn bộ `verifyRequest`, gồm cả `claimNonce` chạm DB) ném
    // lỗi driver thô — đúng thứ sẽ thoát ra h3 và bị Nitro `console.error` nguyên
    // object nếu middleware không bắt: message `pg` có thể chứa connection string,
    // và response thành 500 chứ không phải 503 như mọi call site DB khác.
    mockedWithRequestPool.mockRejectedValueOnce(
      new Error(`connect ECONNREFUSED ${FAKE_CONNECTION_STRING}`),
    );

    const response = await handler(new Request('http://localhost/internal/account/status'));

    // 503 + mã ổn định — khớp contract của `status.get.ts`/`ready.get.ts` với cùng
    // một sự cố ("DB không gọi được"), không phải 500 "lỗi server".
    expect(response.status).toBe(503);
    expect(mockedWriteLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'internal_auth.rejected',
        status: 503,
        reason: 'db_unreachable',
      }),
    );

    // Không một dòng log nào được chứa connection string từ message lỗi driver —
    // đó là toàn bộ mục đích của nhánh catch này.
    const allLogged = JSON.stringify(mockedWriteLog.mock.calls);
    expect(allLogged).not.toContain(FAKE_CONNECTION_STRING);
    expect(allLogged).not.toContain('leaked-pw');

    // Response cũng không được chứa nó (createError chỉ mang statusMessage).
    expect(await response.text()).not.toContain(FAKE_CONNECTION_STRING);
  });
});
