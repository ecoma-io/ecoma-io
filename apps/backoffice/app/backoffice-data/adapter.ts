/**
 * Điểm chọn adapter duy nhất cho backoffice.
 *
 * Sau khi phân giải `backofficeDataMode` từ runtime config (fail-closed), module
 * này ánh xạ chế độ sang thực thi adapter. Chỉ có `adapter.ts` được phép:
 * - import `mock-adapter` để chọn mock
 * - import `unavailable-adapter` để chọn trạng thái unavailable
 *
 * Ràng buộc: không sử dụng logic suy luận môi trường ở đây; không đọc request;
 * không có nhánh "fallback tự động" khác ngoài fail-closed.
 *
 * ⚠️ Import tĩnh: fixture vẫn nằm trong client bundle của mọi env, kể cả khi
 * `backofficeDataMode` = `'disabled'`. Gating ở đây chặn *dùng* fixture, không
 * chặn *phát bytes fixture tới browser*. Loại hẳn khỏi bundle là việc của build
 * (dynamic import theo nhánh mode / tách build theo env) — ngoài phạm vi PR gating
 * này, và được ghi nhận là giới hạn đã biết chứ không phải điều đã làm xong.
 */
import { BACKOFFICE_PREVIEW_DATA_MODE, type BackofficeDataMode } from './data-mode';
import { createMockBackofficeAdapter } from './mock-adapter';
import type { BackofficeDataAdapter } from './types';
import { createUnavailableBackofficeAdapter } from './unavailable-adapter';

export function createBackofficeAdapter(mode: BackofficeDataMode): BackofficeDataAdapter {
  // So với hằng của `data-mode.ts` chứ không viết lại literal: hai chỗ cùng khai
  // `'prototype'` thì "nguồn duy nhất" chỉ đúng ở trong comment, và đổi tên mode
  // ở một chỗ sẽ làm adapter lặng lẽ rơi về unavailable (fail-closed nên không lộ
  // dữ liệu — nhưng staging im lặng mất mẫu và không có tín hiệu nào báo sai).
  if (mode === BACKOFFICE_PREVIEW_DATA_MODE) {
    return createMockBackofficeAdapter();
  }

  return createUnavailableBackofficeAdapter();
}
