/**
 * PostgreSQL client factory — mỗi isolate một Pool từ Hyperdrive connection
 * string. Không node-local state nào khác: Pool sống theo isolate, có thể mất
 * bất cứ lúc nào, mọi truy vấn tự chịu retry phía caller.
 *
 * ⚠️ Migration KHÔNG đi qua client này (Hyperdrive không hỗ trợ advisory
 * lock); migration chạy từ CI runner bằng `db/apply.mts` với chuỗi kết nối
 * trực tiếp.
 */
import { Pool } from 'pg';

/**
 * Tạo Pool cho một isolate. Worker mỗi lần cold start gọi một lần; binding
 * Hyperdrive đổi connection string theo deploy.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Workers không có timer dài hạn: socket idle bị đóng là chuyện bình
    // thường, pg tự mở lại khi query kế tiếp. Max 5 kết nối/isolate là đủ cho
    // broker (mọi query đều ngắn).
    max: 5,
    // Hyperdrive khuyến nghị tắt keepalive dài hạn trên Workers.
    keepAlive: false,
    // statement_timeout chặn query treo làm isolate kẹt. 15s dư cho mọi query
    // broker (đều là index lookup/insert nhỏ).
    statement_timeout: 15_000,
  });
}
