/**
 * Lấy principal của request từ **server-side context** — không bao giờ từ
 * body/query/header do client kiểm soát.
 *
 * ## Vì sao principal lấy từ `event.context`
 *
 * `01-architecture.md` §5 (T-10 confused deputy): "Trusted mapping từ token
 * subject (`sub`) sang Account ID và sang staff context diễn ra server-side từ
 * token đã xác thực; client không supply được principal, role, permission hay
 * scope". Ở giai đoạn này **chưa** có tầng xác thực OIDC trong
 * `apps/backoffice` (việc đó thuộc lane wiring sau — issue #99 KHÔNG dựng
 * tầng xác thực mới), nên principal chỉ có thể đến từ context mà một tầng
 * xác thực server-side đã gắn vào.
 *
 * ⚠️ Vì vậy context này **không** phải header do client gửi: `event.context` là
 * nơi middleware của chính app (tương lai) sẽ gắn principal sau khi verify
 * token. Route đọc được nó, không tự verify, và **fail closed** khi nó vắng.
 *
 * ## Vì sao vắng principal ⇒ `503` chứ không phải `401`
 *
 * ADR-0010 (đã merge, `docs/services/backoffice/adr/0010-permission-naming-and-read-catalog.md`):
 * "trong giai đoạn này, principal không verify được được xử lý theo đường
 * **503** (unavailable) thay vì 401; 401 không được dùng cho đường này".
 *
 * Lý do: `401` mang nghĩa "caller chưa xác thực" — một khẳng định về danh
 * tính. Ở giai đoạn này, việc thiếu principal là **hệ thống chưa dựng được
 * đường xác thực**, tức "không trả lời được" chứ không phải "caller sai" —
 * cùng ngữ nghĩa với `503` mà `requirePermission` dùng cho actor sai định
 * dạng, và cùng ngữ nghĩa với `503` của `account` khi binding DB vắng.
 *
 * ⚠️ Route **không** đọc `sub` từ query/body/header. Đọc header `x-actor-sub`
 * ở đây là đường confused deputy: client tự chọn danh tính, và `SR-001` cấm
 * đúng thứ đó.
 */

import { createError } from 'h3';
import type { H3Event } from 'h3';

import { isBackofficeAccountId } from '@ecoma-io/backoffice-domain';

/**
 * Khoá context mà tầng xác thực server-side sẽ gắn principal vào.
 *
 * ⚠️ Đây là **hợp đồng giữa các lớp trong cùng app**, chưa phải contract với
 * service khác: giá trị ở `event.context` chỉ có ý nghĩa khi chính middleware
 * của app gắn nó. Tới lúc đó, key này được middleware đó đọc lại — nếu một
 * tầng sau này đổi tên key, route này và middleware phải đổi cùng lúc.
 */
export const PRINCIPAL_CONTEXT_KEY = 'backofficePrincipal';

/**
 * Principal đã verify, dạng tối thiểu mà route cần.
 *
 * ⚠️ `actorSub` là `sub` đã verify server-side. Route **không** tin nó chỉ vì
 * nó nằm trong context: {@link readPrincipal} kiểm lại hình dạng bằng
 * `isBackofficeAccountId` trước khi dùng, và `requirePermission` kiểm lại lần
 * nữa ở đầu checkpoint.
 */
export interface VerifiedPrincipal {
  readonly actorSub: string;
}

/**
 * Đọc principal từ context; `null` khi vắng hoặc sai hình dạng.
 *
 * Hàm này **không** ném lỗi — caller quyết định phản hồi (route đọc trả
 * `503`; `requirePermission` tự kiểm lại và ném `503` khi actor sai định
 * dạng).
 */
export function readPrincipal(event: H3Event): VerifiedPrincipal | null {
  const context = event.context as Record<string, unknown>;
  const principal = context[PRINCIPAL_CONTEXT_KEY] as { actorSub?: unknown } | undefined;
  if (principal === undefined || principal === null || typeof principal !== 'object') {
    return null;
  }
  const actorSub = principal.actorSub;
  if (typeof actorSub !== 'string' || !isBackofficeAccountId(actorSub)) {
    return null;
  }
  return { actorSub };
}

/**
 * Đọc principal hoặc fail closed với `503` (ADR-0010).
 *
 * @throws {H3Error} `503` khi context không có principal verify được.
 */
export function requirePrincipal(event: H3Event): VerifiedPrincipal {
  const principal = readPrincipal(event);
  if (principal === null) {
    throw createError({ statusCode: 503, statusMessage: 'authorization unavailable' });
  }
  return principal;
}
