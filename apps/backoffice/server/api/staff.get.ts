/**
 * `GET /api/staff` — danh sách staff directory, qua enforcement của
 * workstream B (issue #99); issue #325 thêm merge `displayName`.
 *
 * Permission: `staff.read` — định danh có thật trong sealed catalog
 * (`0003_permission_catalog_seed.sql`, ADR-0010). Không phát minh permission.
 *
 * Trả `{ staff: Array<StaffRow & { displayName: string | null }> }` — đúng
 * những cột allowlist của {@link listStaff} (`sub`, `status`) cộng tên hiển
 * thị đọc từ `account` qua batch contract (`GET /internal/account/profiles`).
 * Không nhân bản hồ sơ vào DB backoffice; không fallback từ email (lý do đầy
 * đủ ở `docs/services/backoffice/03-onboarding.md`).
 *
 * ## Hai chế độ lỗi trong cùng route
 *
 * - **Enforcement fail-closed** (issue #99, giữ nguyên): principal không verify
 *   được ⇒ `503` (ADR-0010 — không `401`); binding DB vắng / DB unreachable ⇒
 *   `503`; `can()` deny ⇒ `403` sau khi audit đã ghi. Xem {@link withReadEnforcement}.
 * - **Display controlled-degrade** (issue #325): khi `account` không trả lời
 *   được (binding `ACCOUNT_SERVICE` vắng, unreachable, HTTP lỗi, body sai
 *   contract), sổ staff **vẫn trả 200** với `displayName: null` cho mọi
 *   người — kèm một dòng log `staff.account_degraded`. Lý do: sổ staff là
 *   bề mặt *hiển thị*, không phải enforcement; mất tên không được biến thành
 *   mất cả công cụ, và `null` là giá trị thật của contract ("chưa đặt tên")
 *   chứ không phải dữ liệu bịa.
 */

import { defineEventHandler } from 'h3';
import type { PoolClient } from 'pg';

import {
  accountClientConfig,
  fetchAccountProfiles,
  listStaff,
} from '@ecoma-io/backoffice-infrastructure';
import { cachedDisplayName, storeDisplayNames } from '@ecoma-io/backoffice-application';

import { readWorkerEnv } from '../db';
import { writeLog } from '../log';
import { withReadEnforcement } from '../read-route';

export default defineEventHandler((event) =>
  withReadEnforcement(event, 'staff.read', async (client: PoolClient) => {
    const staff = await listStaff(client);
    const nowMs = Date.now();

    // Merge chỉ phủ những sub chưa có tên tươi trong cache — một lần mở sổ với
    // N staff nhưng M người đã có tên trong TTL tạo một batch cho đúng N−M sub.
    const missingSubs = staff
      .map((row) => row.sub)
      .filter((sub) => cachedDisplayName(sub, nowMs) === undefined);

    if (missingSubs.length > 0) {
      const config = accountClientConfig(readWorkerEnv(event));
      const result = config === null ? null : await fetchAccountProfiles(config, missingSubs);

      if (result !== null && result.ok) {
        storeDisplayNames(result.profiles, nowMs);
      } else {
        // Controlled degrade: sổ staff vẫn chạy, tên để `null`, hạ tầng lỗi được
        // ghi thành **một** dòng log riêng — điều tra bắt đầu từ đây chứ không từ
        // các dòng "displayName null" lặp theo số hàng.
        const reason =
          config === null ? 'account_client_unconfigured' : (result as { reason: string }).reason;
        writeLog({
          event: 'staff.account_degraded',
          route: '/api/staff',
          method: 'GET',
          status: 200,
          reason,
        });
      }
    }

    return {
      staff: staff.map((row) => {
        const cached = cachedDisplayName(row.sub, nowMs);
        return { ...row, displayName: cached === undefined ? null : cached };
      }),
    };
  }),
);
