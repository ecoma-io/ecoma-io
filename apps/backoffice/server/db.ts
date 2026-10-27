/**
 * Đọc `env` của Worker ra khỏi context của request — phần **duy nhất** của
 * lớp truy cập DB cũ (`db.ts` trước tách layer) phụ thuộc `h3` ({@link H3Event}).
 *
 * Mọi phần framework-agnostic (đọc binding Hyperdrive, dựng pool `pg` theo
 * giới hạn Hyperdrive, đường pool Node local) đã chuyển sang
 * `@ecoma-io/backoffice-infrastructure`; caller ở đây đọc `env`/runtimeConfig
 * từ request rồi truyền **giá trị thường** vào các hàm của lib
 * (`backofficeHyperdrive`, `withBackofficePool`, `backofficeNodeDatabaseUrl`).
 *
 * ## Vì sao hàm này nằm ở app, không ở lib
 *
 * `H3Event` là kiểu của h3 — một lib `type:infrastructure` không được ràng buộc
 * vào framework serving của một app (`libs/backoffice-infrastructure` chạy được
 * với bất kỳ caller nào có `env`, kể cả Worker không h3). Đường đọc `_platform`
 * dưới đây lại là chi tiếtNitro/h3 (`event.context.cloudflare.env`), nên nó ở
 * đúng chỗ của nó: composition layer.
 */

import type { H3Event } from 'h3';

/**
 * Đọc `env` của Worker ra khỏi context của request.
 *
 * ⚠️ **Không** đọc binding qua `useRuntimeConfig(event).cloudflare.env` như
 * `apps/account` làm: preset `cloudflare-module` của Nitro 2.13.4 **không**
 * populate `runtimeConfig.cloudflare` (config inline của `useRuntimeConfig` chỉ
 * có `app`/`nitro`/`appSecret`/`public`), nên đường đó luôn trả `undefined` và
 * mọi route sẽ fail closed vô ích. Đo trên bundle thật: `useRuntimeConfig(e)`
 * resolve `e.context.nitro.runtimeConfig` từ `ir` — không có khoá `cloudflare`.
 *
 * `env` của Worker đi vào request qua `_platform`:
 * `nitropack/dist/presets/cloudflare/runtime/_module-handler.mjs` truyền
 * `_platform.cloudflare = { request, env, context, url }`, và
 * `nitropack/dist/runtime/internal/app.mjs` (`onRequest`) trải `_platform` ra
 * `event.context` — nên `event.context.cloudflare.env` là `env` thật của Worker.
 *
 * @returns `env` của Worker, hoặc `undefined` khi request không đi qua preset
 *   Cloudflare (ví dụ test dựng h3 app trực tiếp).
 */
export function readWorkerEnv(event: H3Event): unknown {
  const context = event.context as Record<string, unknown>;
  const platform = context['cloudflare'] as { env?: unknown } | undefined;
  return platform?.env;
}
