/**
 * Các bước dữ liệu dùng chung của lane local deploy — tách khỏi `local-deploy.ts`
 * (orchestration monolith) và `local-stack-step.ts` (execution boundary của Nx
 * Task Graph) để cả hai đường dùng MỘT nguồn logic duy nhất.
 *
 * Mỗi hàm tại đây là MỘT biến đổi dữ liệu có kiểm fail-closed:
 *
 * - `resolvePlatformUp`: đảm bảo stack + password PostgreSQL (canonical config),
 *   trả password cho caller đồng bộ vào `.env`.
 * - `resolvePlatformEnv`: đọc outputs platform, trả port Traefik đã validate —
 *   KHÔNG đụng password (caller tự ghi `.env`, tách taint-flow khỏi password).
 *
 * Các secret generator (`generatePostgresPassword`,
 * `generateInternalHmacSecret`, `generateEs256SigningKeyPem`) và hàm thuần
 * (`resolvePostgresPassword`, `upsertLocalEnv`) vẫn sống trong
 * `local-deploy.ts` / `pulumi-context.ts` — module này import từ đó thay vì
 * định nghĩa lại (hai bản tự dựng là chỗ trôi lệch).
 */

import { join } from 'node:path';

import { ensureStack, pulumiRun, type LocalDeployContext } from './pulumi-context.js';
import { resolvePostgresPassword } from './local-deploy.js';

export {
  generateEs256SigningKeyPem,
  generateInternalHmacSecret,
  generatePostgresPassword,
} from './local-deploy.js';

/** Thư mục của một deploy project (tuyệt đối, không phụ thuộc cwd). */
function deployProjectDir(project: string, rootDir: string): string {
  return join(rootDir, 'deploys', project);
}

/** Kết quả chuẩn bị platform up — password để caller đồng bộ vào `.env`. */
export type PlatformUpResolution =
  | { ok: true; postgresPassword: string; generated: boolean }
  | { ok: false; error: string };

/**
 * Chuẩn bị stack platform cho step `up`: ensureStack + password PostgreSQL.
 *
 * KHÔNG chạy `pulumi up` ở đây — caller quyết định lệnh up của mình (hai đường
 * orchestration dùng chung phần chuẩn bị, tách phần thực thi).
 */
export function resolvePlatformUp(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  rootDir: string,
): PlatformUpResolution {
  try {
    ensureStack(deployProjectDir('platform-deploy', rootDir), 'platform-deploy', ctx, env);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const resolution = resolvePostgresPassword(ctx, env);
  if (!resolution.ok) return { ok: false, error: resolution.error };
  return { ok: true, postgresPassword: resolution.password, generated: resolution.generated };
}

/** Kết quả đọc outputs platform — port Traefik đã validate (nguồn của `.env`). */
export type PlatformEnvResolution =
  | { ok: true; traefikHostPort: number }
  | { ok: false; error: string };

/**
 * Đọc outputs platform và trả port Traefik đã validate.
 *
 * Hàm này CHỈ đọc outputs — không đụng password: `resolvePostgresPassword` và
 * `upsertLocalEnv` là việc của caller (`local-stack-step` step `env`). Tách này
 * vừa đúng trách nhiệm (helper outputs thì chỉ đọc outputs) vừa giữ taint-flow
 * của CodeQL sạch: string trả về được dựng từ number đã validate, không đi qua
 * cùng scope với password access.
 */
export function resolvePlatformEnv(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
  rootDir: string,
): PlatformEnvResolution {
  const platformDir = deployProjectDir('platform-deploy', rootDir);
  const stdout = pulumiRun(
    platformDir,
    'platform-deploy',
    ['stack', 'output', '--json'],
    ctx,
    env,
    {
      prepareStack: false,
    },
  );
  let outputs: Record<string, unknown>;
  try {
    outputs = JSON.parse(stdout ?? '') as Record<string, unknown>;
  } catch {
    return { ok: false, error: `Outputs của platform stack không parse được JSON:\n${stdout}` };
  }
  const rawPort = outputs['traefikHostPort'];
  // Port đo được là số nguyên dương — giá trị lạ ở đây sẽ sinh `host:NaN` ở
  // smoke, chặn tại nguồn như bản hard-coded.
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort <= 0) {
    return {
      ok: false,
      error: `Output traefikHostPort không hợp lệ: ${JSON.stringify(rawPort)} — platform chưa up đầy đủ?`,
    };
  }
  return { ok: true, traefikHostPort: rawPort };
}
