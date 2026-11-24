import type { ClientId, Subject } from './types.js';

/**
 * Port truy vấn account status — fail-closed.
 * Bất biến từ legacy: MỌI kết quả khác 'active' (kể cả throw/network error đã được
 * port normalize) đều chặn issuance. Port trả về union này chứ không throw cho
 * trạng thái không xác định — 'unknown' fail-closed ở use case.
 */
export type AccountStatusCheck =
  | { readonly status: 'active' }
  | { readonly status: 'suspended' | 'deleted' }
  | { readonly status: 'unknown' };

export interface AccountStatusChecker {
  check(subject: Subject): Promise<AccountStatusCheck>;
}

/**
 * Port kiểm tra revocation 3 tầng (subject / client / token) — conservative:
 * bất kỳ match nào = revoked; lỗi hệ thống = 'unavailable' (fail-closed ở issuance).
 */
export type RevocationCheckResult = 'not_revoked' | 'revoked' | 'unknown' | 'unavailable';

export interface RevocationChecker {
  checkAtIssuance(input: { subject: Subject; clientId: ClientId }): Promise<RevocationCheckResult>;
}
