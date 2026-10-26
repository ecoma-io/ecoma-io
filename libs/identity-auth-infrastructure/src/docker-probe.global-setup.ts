/**
 * `globalSetup` của Vitest cho `identity-auth-infrastructure` — probe Docker
 * **một lần** mỗi lần chạy, trước khi bất kỳ worker/spec file nào khởi động.
 *
 * Đây là shell mỏng, copy có chủ đích của probe app-owned
 * `apps/auth/tests/integrations/docker-probe.global-setup.ts` (06-testing.md §6:
 * hai harness giống hệt nhau ở hai deploy unit là cố ý, không chia sẻ
 * test-support qua ranh giới deploy unit). Spec colocated của lib
 * (`src/*.spec.ts`) tự import harness PostgreSQL thật từ `apps/auth` — n_spin
 * app sở hữu database — nên probe này chỉ bảo đảm Docker **có** trước khi chạy;
 * bản thân harness app tự probe lại và NÉM nếu Docker biến mất giữa chừng.
 */

import { probeDocker } from './docker-probe';

export default async function setup(): Promise<void> {
  await probeDocker();
}
