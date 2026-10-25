/**
 * `globalSetup` của Vitest cho `apps/backoffice` — probe Docker **một lần** mỗi
 * lần chạy, trước khi bất kỳ worker/spec file nào khởi động.
 *
 * Vì sao không để từng spec tự probe (hình thức cũ): mỗi spec file chạy trong
 * worker riêng (pool `forks`, isolate) nên cache ở module scope hay
 * `globalThis` không vượt qua được ranh giới worker — đo được 2 probe cho 2
 * file, 6 probe cho 6 file. Probe là một container PostgreSQL thật, tự dựng
 * và huỷ: tốn vài giây và là nguồn flake không cần thiết.
 *
 * Kết quả được đăng ký qua `process.env` (worker kế thừa khi fork) trong
 * {@link probeDocker}; khi probe thất bại, harness in cảnh báo tiếng Anh (nêu
 * đúng số suite sẽ skip) và — nếu `ECOMA_REQUIRE_DOCKER=1` — ném lỗi làm
 * **toàn bộ** lần chạy đỏ, thay vì bỏ qua nửa suite với exit 0.
 */

import { probeDocker } from './harness.ts';

export default async function setup(): Promise<void> {
  await probeDocker();
}
