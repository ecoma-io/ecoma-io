import { describe, expect, it, vi } from 'vitest';

import { AuthConfigurationError } from '@ecoma-io/auth-domain';

import { createPostgresClient, type PostgresClientLike } from './postgres';

/**
 * `createPostgresClient` — kiểm **đường ống của option xuống driver**, không cần PostgreSQL.
 *
 * ⚠️ Vì sao vẫn cần một file riêng dù `internal-nonces.spec.ts` đã chạy trên PG thật:
 * mọi lời gọi `createPostgresClient(binding)` ở đó đều **bỏ trống** `options`, nên không có gì
 * bắt được hai lỗi đúng của đoạn spread ở đây:
 *
 *  - ghi sai tên option của driver (`connect_timout` thay vì `connect_timeout`) — driver nhận
 *    một key lạ, im lặng dùng mặc định 30s, và test PG vẫn xanh vì nó chỉ hỏi "kết nối được
 *    không";
 *  - điều kiện `=== undefined` bị đảo, khiến `connect_timeout` **luôn** được đặt, kể cả khi
 *    caller không nêu — tức đường authorization-code bị đổi hành vi ngoài ý muốn.
 *
 * Loại lỗi thứ hai đặc biệt khó thấy: `connect_timeout: undefined` vẫn là một key **có mặt**
 * trong object truyền cho driver, và `postgres.js` bỏ qua nó vì `.filter(([, v]) => v)`. Test
 * vì vậy kiểm **sự vắng mặt của key**, không kiểm "khác `undefined`".
 */

/**
 * Bản ghi các lời gọi `postgres()` — `vi.hoisted` vì factory của `vi.mock` được đẩy lên trên
 * mọi khai báo top-level, nên biến này phải tồn tại trước cả factory.
 */
const { driverCalls } = vi.hoisted(() => ({
  driverCalls: [] as Array<{ binding: unknown; options: Record<string, unknown> | undefined }>,
}));

vi.mock('postgres', () => ({
  default: (binding: unknown, options?: Record<string, unknown>) => {
    driverCalls.push({ binding, options });
    // Object tối thiểu đủ để `as unknown as PostgresClientLike` ở factory đi qua; không
    // method nào được gọi trong file này.
    const stub: Record<string, unknown> = {};
    return stub;
  },
}));

/** Binding Hyperdrive tối thiểu — factory chỉ đọc `connectionString`. */
const BINDING = { connectionString: 'postgres://hyperdrive.invalid/db-auth' };

/**
 * Options của lời gọi driver gần nhất.
 *
 * Ném khi không có lời gọi nào, để một test lỡ quên gọi factory thất bại ở đúng chỗ đó thay
 * vì trả `undefined` rồi đỏ ở một assert khác khó đọc hơn.
 */
function lastDriverOptions(): Record<string, unknown> {
  const call = driverCalls.at(-1);
  if (call === undefined || call.options === undefined) {
    throw new Error('driver was not called with an options object');
  }
  return call.options;
}

describe('createPostgresClient — plumbing of the connect timeout', () => {
  it('routes connectTimeoutSeconds to the driver option connect_timeout', () => {
    driverCalls.length = 0;
    createPostgresClient(BINDING, { connectTimeoutSeconds: 2 });

    expect(driverCalls).toHaveLength(1);
    // ⚠️ So **đúng tên key**. Một tên sai (`connect_timout`) vẫn "truyền được một số xuống
    // driver" và vẫn xanh ở mọi test khác; chỉ assert theo tên mới bắt được.
    expect(lastDriverOptions()['connect_timeout']).toBe(2);
  });

  it('does not set connect_timeout at all when the caller omits the option', () => {
    driverCalls.length = 0;
    createPostgresClient(BINDING);

    // ⚠️ `in` chứ không `toBeUndefined()`: `connect_timeout: undefined` là một key **có mặt**,
    // và đó chính là hình dạng của lỗi "điều kiện bị đảo" mà test này tồn tại để bắt.
    expect('connect_timeout' in lastDriverOptions()).toBe(false);
  });

  it('rejects a timeout that would silently disable the fail-fast path', () => {
    driverCalls.length = 0;
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => createPostgresClient(BINDING, { connectTimeoutSeconds: bad })).toThrow(
        AuthConfigurationError,
      );
    }
    // Không được gọi driver với một giá trị đã biết là sai: `connect_timeout: 0` khiến driver
    // không giới hạn việc mở connection, tức tham số này mất đúng tác dụng của nó.
    expect(driverCalls).toHaveLength(0);
  });

  it('still refuses a binding without a connection string', () => {
    driverCalls.length = 0;
    expect(() => createPostgresClient({ connectionString: '' })).toThrow(AuthConfigurationError);
    expect(driverCalls).toHaveLength(0);
  });

  it('returns the driver client unchanged', () => {
    driverCalls.length = 0;
    const client: PostgresClientLike = createPostgresClient(BINDING);
    expect(client).toBeDefined();
    expect(driverCalls).toHaveLength(1);
  });
});
