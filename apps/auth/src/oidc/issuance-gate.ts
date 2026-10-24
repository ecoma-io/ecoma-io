/**
 * Gate cấp phát token — logic thuần, để test được tách khỏi composition.
 *
 * Nhiệm vụ: kiểm account status (§6.0) + true revocation status + grant status
 * (§5.1.0 điều kiện 3 và 4) tại thời điểm PHÁT HÀNH (SR-015/FR-020). Composition
 * thật nằm ở `oidc/runtime.ts` (wiring AccountClient + postgresClient của isolate);
 * bên dưới hàm `createIssuanceGateFromDeps` nhận mọi phần phụ thuộc qua tham số —
 * test testcontainers về mid-flow status-change dùng cùng hàm này với checkStatus
 * stub, còn production wiring dùng đúng tham số thật của nó.
 */

import type { PostgresClientLike } from '@ecoma-io/identity-auth-infrastructure';
import {
  checkRevocationAtIssuance,
  findActiveGrant,
  insertAuditEvent,
} from '../authorization-store';
import { allowsIssuance } from '@ecoma-io/identity-auth-contracts';
import type { AccountStatusResponseValue } from '@ecoma-io/identity-contracts';
import type { IssuanceGate } from './adapter';

/**
 * Phần phụ thuộc của gate — `checkStatus` là hàm đã ghi `nowMs` ở runtime thật,
 * và ở test là stub trả trực tiếp trạng thái mong muốn.
 */
export interface IssuanceGateDeps {
  readonly postgresClient: PostgresClientLike;
  readonly checkStatus: (accountId: string) => Promise<AccountStatusResponseValue>;
}

/**
 * Dựng IssuanceGate từ các phần phụ thuộc — đúng hợp đồng "NÉM = chặn" của
 * `adapter.ts` (createAdapterFactory truyền gate này vào `PostgresAdapter`).
 */
export function createIssuanceGateFromDeps(deps: IssuanceGateDeps): IssuanceGate {
  const { postgresClient, checkStatus } = deps;
  return {
    assertIssuable: async ({ accountId, clientId, grantId }) => {
      // ⚠️ Phân biệt CHÍNH XÁC hai nhóm lỗi: policy denial (audit
      // `token_issue_denied`) khác hạ tầng chết (Account unreachable, DB
      // chết) — nhãn `access_denied` cho một lỗi hạ tầng là sai dữ liệu audit
      // và tạo ra cảnh báo giả cho người đọc audit. Hạ tầng NÉM nguyên trạng.
      const status = await checkStatus(accountId);
      if (!allowsIssuance(status)) {
        await denyAudit(
          postgresClient,
          accountId,
          clientId,
          grantId ?? undefined,
          'account_status',
        );
        throw new Error(`issuance gate: account status "${status}" does not allow token issuance`);
      }
      // Điều kiện 4a — revocation ba mức (subject / client / token-by-grant).
      const revocation = await checkRevocationAtIssuance(postgresClient, {
        sub: accountId,
        clientId,
        grantId: grantId ?? undefined,
      });
      // ⚠️ `!== 'not_revoked'` chứ không phải `=== 'revoked'`: bất kỳ giá trị nào
      // ngoài "không thu hồi" (kể cả một giá trị union tương lai) phải chặn —
      // cùng quy ước fail-closed với session-verified-handler.ts.
      if (revocation !== 'not_revoked') {
        await denyAudit(postgresClient, accountId, clientId, grantId ?? undefined, 'revocation');
        throw new Error('issuance gate: token da bi revoke (subject/client/grant)');
      }
      // Điều kiện 4 (§5.1.0) — grant còn hiệu lực. `oauth_grants` là quyền hiện
      // hành (§3.4) và là nơi thu hồi grant sống (`status = 'revoked'`, 0003):
      // một grant bị thu hồi KHÔNG cần hàng `token_revocations` nào để bị chặn —
      // phủ đúng hàng 9 và hàng 14 của state machine (docs/services/auth §5.1.2)
      // cho trường hợp "grant thu hồi giữa consent-decide và resume, không có
      // kiện revocation nào được ghi". Chỉ áp dụng khi artifact mang `grantId`:
      // authorization code và refresh rotation luôn mang; AccessToken JWT không
      // persist qua adapter (deviation đã ghi ở `adapter.ts`) nên không tới được
      // phép kiểm này.
      if (grantId !== null) {
        const grant = await findActiveGrant(postgresClient, {
          sub: accountId,
          clientId,
        });
        if (grant === undefined || grant.id !== grantId) {
          // `findActiveGrant` trả active(sub, client) theo index unique 0003 —
          // tối đa MỘT hàng; id khác grantId hoặc không có hàng đều nghĩa là
          // grant đang cấp đã rời trạng thái active.
          await denyAudit(postgresClient, accountId, clientId, grantId, 'grant_revoked');
          throw new Error('issuance gate: grant mat hieu luc');
        }
      }
      // Hàng "đã cấp" — fire-and-forget: mất hàng audit không được biến một
      // issuance thành công thành 5xx (SR-010 là quan sát, không phải điều
      // kiện cấp — AGENTS.md: observability không là dependency serving path).
      try {
        await insertAuditEvent(postgresClient, {
          eventType: 'token_issued',
          subjectRef: accountId,
          clientId,
          grantId: grantId ?? undefined,
          outcome: 'success',
        });
      } catch (error: unknown) {
        // oxlint-disable-next-line no-console
        console.error('audit write failed', error);
      }
    },
  };
}

/**
 * Audit hàng bị chặn cấp — cũng fire-and-forget (try/catch riêng): lỗi audit
 * KHÔNG được thay đổi lỗi nghiệp vụ đang lan (vẫn là chặn issuance,
 * fail-closed giữ nguyên).
 */
async function denyAudit(
  postgresClient: PostgresClientLike,
  accountId: string,
  clientId: string,
  grantId: string | null | undefined,
  reason: string,
): Promise<void> {
  try {
    await insertAuditEvent(postgresClient, {
      eventType: 'token_issue_denied',
      subjectRef: accountId,
      clientId,
      grantId: grantId ?? undefined,
      outcome: 'denied',
      errorCode: 'access_denied',
      details: { reason },
    });
  } catch (error: unknown) {
    // oxlint-disable-next-line no-console
    console.error('audit write failed', error);
  }
}
