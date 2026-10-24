/**
 * Khung chung của 3 read route (`/api/staff`, `/api/roles`,
 * `/api/permissions`) — issue #99.
 *
 * ## Vì sao có một khung
 *
 * Ba route có **cùng** đường đi: đọc principal server-side → đọc binding DB →
 * dựng pool → đọc ảnh assignment → `requirePermission` → đọc dữ liệu →
 * trả JSON. Ba bản sao của đường đi đó là ba chỗ để quên một nhánh fail-closed
 * (đặc biệt nhánh `503` khi DB unreachable và nhánh audit trước khi `403`), và
 * "đường đi giống nhau" là điều kiện để test dùng chung một bộ case cho cả
 * ba route.
 *
 * ⚠️ Khung này **không** gom việc đọc dữ liệu: mỗi route vẫn tự gọi query
 * của mình (staff / roles / permissions là ba bảng khác nhau), và mỗi route
 * tự khai permission của mình. Khung chỉ gom phần **giống nhau**:
 * principal, pool, ảnh assignment, enforcement, mapping lỗi.
 *
 * ## Thứ tự fail-closed
 *
 * 1. Principal không verify được ⇒ `401` (ADR-0011 §1 — caller chưa đăng
 *    nhập; middleware authn gắn principal trước route, vắng nghĩa là không có
 *    phiên) — trước cả việc mở pool.
 * 2. Binding `DB_BACKOFFICE` vắng ⇒ `503` — Worker chưa có DB thì không có
 *    đường đọc nào trả lời được.
 * 3. `requirePermission` deny ⇒ `403` **sau khi** audit đã ghi (audit trước
 *    throw là quy tắc của workstream B, module này không sửa).
 * 4. DB unreachable giữa chừng ⇒ `503`.
 */

import { createError, type H3Event } from 'h3';
import type { Pool, PoolClient } from 'pg';

import type { CatalogPermission } from '@ecoma-io/backoffice-domain';

import { requirePermission, type PrincipalAuthorization } from './authorization';
import { backofficeHyperdrive, readWorkerEnv, withBackofficePool } from './db';
import { requirePrincipal } from './principal';
import { loadPrincipalAuthorization } from './queries';

/**
 * Đọc ảnh assignment của principal bằng **một** client của pool — cùng một
 * connection cho ảnh assignment và audit. `requirePermission` nhận `Client`
 * của `pg` (không phải `Pool`), nên callback lấy client này rồi `release()`
 * trong `finally` — connection trở về pool kể cả khi callback ném, không rò
 * connection tới khi pool cạn.
 */
async function withPoolClient<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

/**
 * Chạy phần đọc của một read route dưới enforcement.
 *
 * @param permission Permission catalog mà route hỏi — **định danh có thật
 *   trong catalog** (SR-020/invariant 10): `staff.read` / `role.read` /
 *   `permission.read`, seed ở `0003_permission_catalog_seed.sql` theo
 *   ADR-0010.
 * @param read Hàm đọc dữ liệu — nhận client của **runtime role** (credential
 *   Hyperdrive), trả payload của route.
 */
export async function withReadEnforcement<T>(
  event: H3Event,
  permission: CatalogPermission,
  read: (client: PoolClient) => Promise<T>,
): Promise<T> {
  // 1. Principal — không có phiên hợp lệ thì `401` (ADR-0011 §1), chưa mở pool.
  const principal = requirePrincipal(event);

  // 2. Binding — Worker chưa có DB thì `503`, không phải "trả rỗng".
  const hyperdrive = backofficeHyperdrive(readWorkerEnv(event));
  if (hyperdrive === null) {
    throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
  }

  try {
    return await withBackofficePool(hyperdrive, (pool) =>
      withPoolClient(pool, async (client) => {
        // 3. Ảnh assignment — đọc bằng **runtime role**, cùng lượt đọc với
        //    `staff.status` (invariant 5).
        const authorization = await loadPrincipalAuthorization(client, principal.actorSub);
        const principalAuthorization: PrincipalAuthorization = {
          assignments: authorization.assignments,
          actorSub: principal.actorSub,
        };

        // 4. Enforcement — deny ⇒ `403` sau khi audit đã ghi (module của
        //    workstream B, không sửa ở đây).
        await requirePermission(permission, principalAuthorization, client);

        // 5. Đọc dữ liệu của route — cùng client với enforcement.
        return read(client);
      }),
    );
  } catch (error) {
    return failClosedOnDatabaseError(error);
  }
}

/**
 * Dịp lỗi DB thành `503`.
 *
 * ⚠️ `requirePermission` ném `H3Error` có `statusCode` — lỗi đó đã là câu trả
 * lời cuối cùng của route (403/503) và **không** được đổi thành 503. Vì vậy
 * hàm này chỉ bắt lỗi **không** phải `H3Error`: đó là lỗi driver (`pg`) hoặc
 * lỗi hình dạng dữ liệu, và cả hai đều là "không trả lời được" ⇒ `503`.
 *
 * ⚠️ **Không** nối message của lỗi vào log/response: message của `pg` có thể
 * chứa connection string.
 */
export function failClosedOnDatabaseError(error: unknown): never {
  if (isHttpError(error)) {
    throw error;
  }
  throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
}

/**
 * Kiểm lỗi có phải `H3Error` (đã mang `statusCode`) không.
 *
 * Không dùng `instanceof` vì `h3` có thể bị bundle lại thành nhiều bản khác
 * nhau trong bundle Worker — nhận diện theo **hình dạng** (`statusCode` là số)
 * là cách bền qua bundle boundary.
 */
function isHttpError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  );
}
