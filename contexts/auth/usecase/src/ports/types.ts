/**
 * Application contracts dùng chung của tầng usecase auth.
 * Brand các identifier để tránh nhầm lẫn giữa các loại id/handle/hash.
 * Không phục vụ trực tiếp HTTP DTO, DB record hay domain snapshot.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Id của AuthorizationTransaction (base64url ≥ 43 ký tự). */
export type TransactionId = Brand<string, 'TransactionId'>;
/** Handle X/Y/Z đã derive (HMAC base64url) — chỉ tồn tại trong bộ nhớ, at-rest chỉ lưu hash. */
export type Handle = Brand<string, 'Handle'>;
/** Handle đã hash SHA-256 để lưu DB. */
export type HandleHash = Brand<string, 'HandleHash'>;
/** Authorization code (handle Z) — chỉ xuất hiện cho client, at-rest chỉ lưu hash. */
export type AuthorizationCode = Brand<string, 'AuthorizationCode'>;
/** Subject của account (định danh ổn định). */
export type Subject = Brand<string, 'Subject'>;
/** OAuth client id. */
export type ClientId = Brand<string, 'ClientId'>;
/** Grant id. */
export type GrantId = Brand<string, 'GrantId'>;
/** Idempotency event id (ví dụ event block của session verification). */
export type EventId = Brand<string, 'EventId'>;
/** Signing key id (kid). */
export type Kid = Brand<string, 'Kid'>;

/** Vòng đời của AuthorizationTransaction — mirror của auth-domain state machine. */
export type AuthorizationTransactionState =
  | 'pending_browser'
  | 'browser_confirmed'
  | 'awaiting_consent'
  | 'ready_to_complete'
  | 'completed'
  | 'denied';

export type { Brand } from '@ecoma-io/domain-primitives';

export type ConsentDecision = 'approve' | 'deny';

/**
 * Kết quả CAS: 'won' hoặc 'lost' — cố ý không phân biệt consumed/expired/unknown
 * để tránh oracle thông tin (bất biến từ legacy).
 */
export type CasOutcome = 'won' | 'lost';

export type AccountStatus = 'active' | 'suspended' | 'deleted';

/** Dữ liệu client theo cách Application Layer nhìn thấy (không phải DB row). */
export interface ClientRecord {
  readonly id: ClientId;
  readonly isActive: boolean;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
}

/** Dữ liệu grant theo cấu trúc mà pure functions của auth-domain chấp nhận. */
export interface GrantRecord {
  readonly id: GrantId;
  readonly subject: Subject;
  readonly clientId: ClientId;
  readonly scopes: readonly string[];
  readonly isActive: boolean;
}
