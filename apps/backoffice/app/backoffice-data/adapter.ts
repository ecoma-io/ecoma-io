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

/**
 * Bảng factory theo chế độ dữ liệu — seam cho workstream B: khi backend thật có
 * mặt, một mode mới (ví dụ `'realtime'`) sẽ vào đây dưới dạng một entry mới trỏ
 * vào factory thật thay vì để mode đó rơi về unavailable.
 *
 * ⚠️ `'unavailable'` không có entry trong bảng vì nó không phải giá trị cấu hình
 * mà là **trạng thái fail-closed**: mọi mode không có entry — hôm nay là mọi thứ
 * ngoài `'prototype'` — đều qua fallback `createUnavailableBackofficeAdapter()`
 * bên dưới. Ngữ nghĩa fail-closed KHÔNG đổi: chỉ `'prototype'` mở mock, mọi mode
 * khác đều unavailable.
 *
 * ⚠️ Khoá dùng hằng `BACKOFFICE_PREVIEW_DATA_MODE` chứ không literal `'prototype'`
 * (nguyên tắc "so với hằng" của bản if trước): bảng được ép kiểu đủ mọi khoá của
 * `BackofficeDataMode` qua khai báo kiểu dưới đây, nên đổi giá trị mode ở
 * `data-mode.ts` mà không đổi ánh xạ là lỗi type — thay vì adapter lặng lẽ rơi về
 * unavailable và staging mất mẫu không có tín hiệu nào.
 */
const ADAPTER_FACTORIES = {
  [BACKOFFICE_PREVIEW_DATA_MODE]: () => createMockBackofficeAdapter(),
} as unknown as Readonly<Record<BackofficeDataMode, () => BackofficeDataAdapter>>;

export function createBackofficeAdapter(mode: BackofficeDataMode): BackofficeDataAdapter {
  // Lấy factory trong bảng, thiếu thì fallback, rồi **gọi factory một lần** —
  // một biến trung gian cho phép gán `createUnavailableBackofficeAdapter` (không
  // gọi sẵn) làm fallback, nhờ đó không có ngoặc nào nhầm cặp thứ tự gọi.
  const factory = ADAPTER_FACTORIES[mode] ?? createUnavailableBackofficeAdapter;

  return factory();
}
