import {
  base64UrlToBytes,
  bytesToBase64Url,
  type AuthorizationTransactionState,
} from '@ecoma-io/identity-auth-domain';

import type { AuthorizationCodeRow } from './authorization-code-cas';
import type {
  NewAuthorizationCode,
  NewAuthorizationTransaction,
} from '@ecoma-io/identity-auth-application';
import type { PostgresClientLike } from './postgres';

/**
 * Adapter cho `auth.authorization_transactions` và `auth.authorization_codes`
 * (C1 — #298).
 *
 * ⚠️ Đây là phần HẸP cần để chứng minh hợp đồng persistence trên PostgreSQL
 * thật — KHÔNG phải một repository tổng quát cho mọi bảng của `db-auth`. Mỗi
 * hàm ở đây bọc đúng MỘT câu SQL, và câu SQL là bản chép của quy ước trong
 * migration (`0002`/`0011` cho transaction, `0004` cho code) — lệch tên cột
 * chỉ lộ ra khi chạy với schema thật, nên integration test áp chính các file
 * migration đó.
 *
 * ⚠️ **Codec duy nhất giữa `bytea` và base64url.** Domain trả mọi hash dưới
 * dạng chuỗi base64url; cột `handle_*`/`browser_binding_hash`/`event_payload_hash`
 * của schema là `bytea`. Bốn hướng chuyển đổi đều đi qua `bytesToBase64Url`/
 * `base64UrlToBytes` của domain — KHÔNG có module nào tự encode thứ hai, vì
 * hai bản codec là hai chỗ có thể lệch nhau và chỗ lệch là một so khớp hash
 * sai âm thầm.
 *
 * ⚠️ **Mapper duy nhất row → DTO.** `mapTransactionRow` là chỗ DUY NHẤT dịch
 * hàng PostgreSQL thành `AuthorizationTransactionRecord` của application.
 * Sửa hình dạng DTO mà quên mapper là lỗi typecheck ngay, đúng ý C1.
 */

/** Cột `bytea` đọc về phải là Buffer/Uint8Array — hình dạng postgres.js trả. */
function byteaToBase64Url(value: unknown, column: string): string {
  // postgres.js decode `bytea` thành Buffer (kế thừa Uint8Array). Bất kỳ hình
  // dạng khác là lỗi hợp đồng của driver, không phải dữ liệu xấu — ném thay
  // vì diễn giải.
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`cot ${column} phai la bytea (Uint8Array), nhan duoc hinh dang khac`);
  }
  return bytesToBase64Url(value);
}

function base64UrlToBytea(value: string): Uint8Array {
  // `base64UrlToBytes` ném `AuthConfigurationError` cho chuỗi sai format —
  // đúng hành vi: hash sai format là lỗi của caller, không phải dữ liệu DB.
  return base64UrlToBytes(value);
}

/** Hàng thô của `authorization_transactions` như postgres.js trả về. */
interface RawTransactionRow {
  transaction_id: string;
  handle_hash_x: Uint8Array;
  state: string;
  client_id: string;
  redirect_uri: string;
  requested_scopes: string[];
  code_challenge: string;
  code_challenge_method: string;
  browser_binding_hash: Uint8Array;
  key_version: number;
  expires_at: Date;
  sub: string | null;
  authn_level: string | null;
  authn_at: Date | null;
  account_session_ref: string | null;
  client_state: string | null;
  nonce: string | null;
}

/**
 * Mapper DUY NHẤT row PostgreSQL → `AuthorizationTransactionRecord`.
 *
 * ⚠️ `state` được cast qua `AuthorizationTransactionState` sau khi CHECK của
 * schema đã chặn giá trị lạ (`0011`). Một hàng lọt qua CHECK sai (không thể,
 * trừ khi constraint bị drop) sẽ giữ nguyên chuỗi của nó — tầng application
 * sẽ từ chối tại `assertBrowserConfirmed`/`canTransition` thay vì im lặng.
 */
function mapTransactionRow(row: RawTransactionRow): AuthorizationTransactionRowDto {
  return {
    transaction_id: row.transaction_id,
    handle_hash_x: byteaToBase64Url(row.handle_hash_x, 'handle_hash_x'),
    state: row.state as AuthorizationTransactionState,
    client_id: row.client_id,
    redirect_uri: row.redirect_uri,
    requested_scopes: row.requested_scopes,
    code_challenge: row.code_challenge,
    code_challenge_method: row.code_challenge_method,
    browser_binding_hash: byteaToBase64Url(row.browser_binding_hash, 'browser_binding_hash'),
    key_version: row.key_version,
    expires_at: row.expires_at,
    sub: row.sub,
    authn_level: row.authn_level,
    authn_at: row.authn_at,
    account_session_ref: row.account_session_ref,
    client_state: row.client_state,
    nonce: row.nonce,
  };
}

/** Re-export dạng type public để caller không import từ application hai lần. */
export type AuthorizationTransactionRowDto =
  import('@ecoma-io/identity-auth-application').AuthorizationTransactionRecord;

/**
 * Tạo transaction mới.
 *
 * Cột `created_at` nhận DEFAULT `now()` của DB — không truyền thời gian từ
 * caller, vì mốc tạo thuộc về database (đồng hồ duy nhất mọi hàng cùng nhìn).
 */
export async function insertTransaction(
  client: PostgresClientLike,
  record: NewAuthorizationTransaction,
): Promise<void> {
  await client.unsafe(
    `
      INSERT INTO auth.authorization_transactions (
        transaction_id, state, handle_hash_x, browser_binding_hash, key_version,
        client_id, redirect_uri, requested_scopes, client_state, nonce,
        code_challenge, code_challenge_method, expires_at
      )
      VALUES (
        $1, 'pending_browser', $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12
      )
    `,
    [
      record.transaction_id,
      base64UrlToBytea(record.handle_hash_x),
      base64UrlToBytea(record.browser_binding_hash),
      record.key_version,
      record.client_id,
      record.redirect_uri,
      record.requested_scopes,
      record.client_state,
      record.nonce,
      record.code_challenge,
      record.code_challenge_method,
      record.expires_at,
    ],
  );
}

/**
 * Tìm transaction theo BĂM handle X.
 *
 * ⚠️ KHÔNG lọc theo `handle_x_consumed_at` hay `expires_at` ở đây: việc "còn
 * dùng được" là điều kiện CỦA TỪNG hành động (confirm, consume), không phải
 * của việc tra cứu — lọc sớm ở tra cứu là biến một lý do từ chối có tên
 * ("đã dùng", "hết hạn") thành "không tìm thấy", mất khả năng trả lỗi đúng.
 */
export async function findTransactionByHandleX(
  client: PostgresClientLike,
  params: { handleXHash: string },
): Promise<AuthorizationTransactionRowDto | undefined> {
  const rows = await client.unsafe<RawTransactionRow>(
    `
      SELECT transaction_id, handle_hash_x, state, client_id, redirect_uri,
             requested_scopes, code_challenge, code_challenge_method,
             browser_binding_hash, key_version, expires_at, sub, authn_level,
             authn_at, account_session_ref, client_state, nonce
        FROM auth.authorization_transactions
       WHERE handle_hash_x = $1
    `,
    [base64UrlToBytea(params.handleXHash)],
  );
  const row = rows[0];
  return row === undefined ? undefined : mapTransactionRow(row);
}

/**
 * Chuyển trạng thái CÓ ĐIỀU KIỆN — CAS của transaction.
 *
 * ⚠️ `expires_at > $4` nằm TRONG cùng câu UPDATE: một transaction hết hạn
 * KHÔNG được chuyển sang trạng thái cho phép tiếp tục (§5.1.2 hàng 12). Kiểm
 * expiry ở tầng đọc trước rồi mới UPDATE là hai câu — giữa chúng một request
 * khác đã có thể chuyển trạng thái.
 *
 * ⚠️ Trả `false` cho 0 hàng: trạng thái khác CAS từ chối, hoặc hết hạn, hoặc
 * ID không tồn tại. Caller ánh xạ cả ba thành một lỗi duy nhất — phân biệt ở
 * đây là oracle cho client dò ID.
 */
export async function transitionTransaction(
  client: PostgresClientLike,
  params: {
    transactionId: string;
    from: AuthorizationTransactionState;
    to: AuthorizationTransactionState;
    at: Date;
  },
): Promise<boolean> {
  const updated = await client.unsafe<{ transaction_id: string }>(
    `
      UPDATE auth.authorization_transactions
         SET state = $2
       WHERE transaction_id = $1
         AND state = $3
         AND expires_at > $4
      RETURNING transaction_id
    `,
    [params.transactionId, params.to, params.from, params.at],
  );
  return updated.length === 1;
}

/**
 * Ghi authorization code mới.
 *
 * Cột được liệt kê TÊN và khớp `0004_authorization_codes.sql`: `code_hash`,
 * `authorization_transaction_id`, `sub`, `client_id`, `redirect_uri`,
 * `code_challenge`, `code_challenge_method`, `granted_scopes` (text[]),
 * `nonce` (nullable), `expires_at`. `id` nhận DEFAULT của DB; `issued_at` và
 * `consumed_at`/`consumed_by` mặc định đúng trạng thái "chưa tiêu thụ".
 */
export async function insertAuthorizationCode(
  client: PostgresClientLike,
  code: NewAuthorizationCode,
): Promise<void> {
  await client.unsafe(
    `
      INSERT INTO auth.authorization_codes (
        code_hash, authorization_transaction_id, sub, client_id, redirect_uri,
        code_challenge, code_challenge_method, granted_scopes, nonce, expires_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10
      )
    `,
    [
      code.code_hash,
      code.authorization_transaction_id,
      code.sub,
      code.client_id,
      code.redirect_uri,
      code.code_challenge,
      code.code_challenge_method,
      code.granted_scopes,
      code.nonce,
      code.expires_at,
    ],
  );
}

export type { AuthorizationCodeRow };
