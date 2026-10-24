/**
 * SQL của `auth` cho `db-auth` — phần KHÔNG nằm trong `identity-auth-infrastructure`.
 *
 * ## Ranh giới
 *
 * `libs/identity-auth-infrastructure` sở hữu các hàm CAS có test parity với migration
 * (`consumeHandleXAndBindIdentity`, `advanceTransactionWithHandle`, `consumeHandleY`,
 * …). Các truy vấn CÒN LẠI — nạp client đăng ký, nạp/tạo grant, kiểm thu hồi — chưa có
 * nhà ở đó, và bản sao trong app này là chỗ tạm của chúng: cùng một cú pháp tham số
 * hoá, cùng bộ luật (không giá trị nào từ request chạm chuỗi SQL), nhưng không có
 * parity test song song migration vì các bảng liên quan (`oauth_clients`,
 * `client_redirect_uris`, `oauth_grants`, `client_grant_scopes`, `token_revocations`)
 * được ghim bằng integration test PG ở `main.spec.ts` thay vì file-level.
 *
 * ⚠️ **Mỗi hàm bọc đúng MỘT câu SQL**, trừ `grantInserts` — ba INSERT của consent
 * `approve` (decision → grant → scopes) PHẢI đi trong cùng một `client.begin` của
 * caller để "đã consume Y" và "grant tồn tại" là MỘT sự kiện (§5.1.5b); hàm này
 * chỉ cung cấp các câu lệnh cho caller ghép.
 */

import type {
  AuthGrant,
  AuthorizationTransactionRecord,
  NewAuthorizationCode,
  NewAuthorizationTransaction,
  RegisteredClient,
} from '@ecoma-io/identity-auth-application';
import {
  insertAuthorizationCode as insertAuthorizationCodeRow,
  insertTransaction,
  findTransactionByHandleX,
  transitionTransaction,
} from '@ecoma-io/identity-auth-infrastructure';
import type { PostgresClientLike, Queryable } from '@ecoma-io/identity-auth-infrastructure';
import type {
  AuthorizationTransactionState,
  RevocationCheckResult,
} from '@ecoma-io/identity-auth-domain';

/** Hàng `oauth_clients` + redirect URI gom sẵn — hình dạng `findClient` trả. */
interface ClientRow {
  client_id: string;
  client_type: string;
  status: string;
  allowed_scopes: string[];
  redirect_uris: string[];
}

/**
 * Nạp client đăng ký kèm mọi redirect URI và scope được phép.
 *
 * ⚠️ Chỉ trả client khi còn `active`: một client `disabled` KHÔNG được đi qua
 * `/authorize`, kể cả khi mọi tham số đúng (`assertUsableClient`). Nạp về rồi
 * lọc ở tầng trên cũng được — nhưng nạp về một hàng disabled để tầng trên
 * quyết định là làm `findClient` thành "tra bảng", còn lọc ở đây làm nó thành
 * "tra bảng HỢP LỆ". Đặt chính sách vào đúng một tầng.
 */
export async function findRegisteredClient(
  client: PostgresClientLike,
  clientId: string,
): Promise<RegisteredClient | undefined> {
  const rows = await client.unsafe<ClientRow>(
    `SELECT c.client_id, c.client_type, c.status,
            c.allowed_scopes,
            coalesce(array_agg(r.redirect_uri ORDER BY r.redirect_uri)
                      FILTER (WHERE r.redirect_uri IS NOT NULL), '{}') AS redirect_uris
       FROM auth.oauth_clients c
       LEFT JOIN auth.client_redirect_uris r ON r.client_id = c.client_id
      WHERE c.client_id = $1
      GROUP BY c.client_id, c.client_type, c.status, c.allowed_scopes`,
    [clientId],
  );
  const row = rows[0];
  if (row === undefined || row.status !== 'active') {
    return undefined;
  }
  return {
    client_id: row.client_id,
    client_type: row.client_type === 'confidential' ? 'confidential' : 'public',
    redirect_uris: row.redirect_uris,
    allowed_scopes: row.allowed_scopes,
    isActive: true,
  };
}

/** Hàng `oauth_grants` như PostgreSQL trả về. */
interface GrantRow {
  id: string;
  sub: string;
  client_id: string;
  status: string;
  scopes: string[];
}

/**
 * Nạp grant HIỆN HÀNH của một cặp `(sub, client)`.
 *
 * Index unique `oauth_grants_active_sub_client_idx` (0003) bảo đảm tối đa MỘT hàng
 * active — nếu hai hàng lọt qua index hỏng thì hàng đầu tiên vẫn không phải tình
 * trạng "hai đáp án" mà caller có thể diễn giải: `$limit 1` + `status = 'active'`
 * là hợp đồng đọc của bảng này.
 *
 * ⚠️ Trả kèm `id`: application layer dùng nó làm `jti` của provider Grant
 * (xem `oidc/interaction.ts` — hai vế thu hồi phải trỏ cùng một định danh).
 */
export async function findActiveGrant(
  client: PostgresClientLike,
  params: { readonly sub: string; readonly clientId: string },
): Promise<(AuthGrant & { readonly id: string }) | undefined> {
  const rows = await client.unsafe<GrantRow>(
    `SELECT g.id, g.sub, g.client_id, g.status,
            coalesce(array_agg(s.scope ORDER BY s.scope) FILTER (WHERE s.scope IS NOT NULL), '{}') AS scopes
       FROM auth.oauth_grants g
       LEFT JOIN auth.client_grant_scopes s ON s.grant_id = g.id
      WHERE g.sub = $1 AND g.client_id = $2 AND g.status = 'active'
      GROUP BY g.id, g.sub, g.client_id, g.status
      LIMIT 1`,
    [params.sub, params.clientId],
  );
  const row = rows[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    account_id: row.sub,
    client_id: row.client_id,
    scopes: row.scopes,
    isActive: row.status === 'active',
  };
}

/** Dữ liệu để mở grant mới — caller (`consent/decide` approve) đã có đủ mọi trường. */
export interface NewGrantInput {
  readonly sub: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  /** `oauth_consent_decisions.id` — liên kết audit; NULL khi consent record bị retention xoá. */
  readonly consentDecisionId: string | undefined;
  readonly now: Date;
}

/** INSERT `oauth_grants` — trả `id` mới để gọi hai câu lệnh còn lại tham chiếu. */
export async function insertGrant(tx: Queryable, input: NewGrantInput): Promise<string> {
  const rows = await tx.unsafe<{ id: string }>(
    `INSERT INTO auth.oauth_grants (sub, client_id, status, consent_decision_id, granted_at)
     VALUES ($1, $2, 'active', $3, $4)
     RETURNING id`,
    [input.sub, input.clientId, input.consentDecisionId, input.now],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('INSERT oauth_grants returned no id');
  }
  return row.id;
}

/** INSERT toàn bộ scope của một grant — PK composite chặn trùng. */
export async function insertGrantScopes(
  tx: Queryable,
  params: { readonly grantId: string; readonly scopes: readonly string[] },
): Promise<void> {
  // `unnest($2::text[])` — một câu cho mọi scope; tham số hoá toàn bộ, không nối chuỗi.
  await tx.unsafe(
    `INSERT INTO auth.client_grant_scopes (grant_id, scope)
     SELECT $1, scope FROM unnest($2::text[]) AS scope
     ON CONFLICT (grant_id, scope) DO NOTHING`,
    [params.grantId, [...params.scopes]],
  );
}

/** INSERT consent decision — hàng audit LỊCH SỬ, không phải quyền hiện hành (§3.4). */
export async function insertConsentDecision(
  tx: Queryable,
  params: {
    readonly sub: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly grantedScopes: readonly string[];
    readonly decision: 'approve' | 'deny';
    readonly authorizationTransactionId: string;
    readonly now: Date;
  },
): Promise<string> {
  const rows = await tx.unsafe<{ id: string }>(
    `INSERT INTO auth.oauth_consent_decisions (
        sub, client_id, redirect_uri, granted_scopes, decision,
        authorization_transaction_id, decided_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.sub,
      params.clientId,
      params.redirectUri,
      [...params.grantedScopes],
      params.decision,
      params.authorizationTransactionId,
      params.now,
    ],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('INSERT oauth_consent_decisions returned no id');
  }
  return row.id;
}

/**
 * Đọc quyết định consent ĐÃ COMMIT của một authorization transaction.
 *
 * ⚠️ Đây là nguồn sự thật duy nhất của "quyết định nào đã thắng" — KHÔNG PHẢI
 * cột `event_id` của `authorization_transactions`: khối bốn cột `event_*` là
 * idempotency key của event PUSH account→auth (§5.1.5a), quyết định consent
 * là contract khác với định danh riêng (`oauth_consent_decisions`, §5.1.5b).
 * Replay decide (cùng Y + cùng decision) và từ chối decision khác đều đối
 * chiếu qua bảng này, cùng transaction `db-auth` với CAS consume-Y nên giá
 * trị luôn khớp trạng thái consume.
 */
export async function findCommittedConsentDecision(
  client: PostgresClientLike,
  params: { readonly authorizationTransactionId: string },
): Promise<'approve' | 'deny' | undefined> {
  const rows = await client.unsafe<{ decision: string }>(
    `SELECT decision FROM auth.oauth_consent_decisions
      WHERE authorization_transaction_id = $1
      ORDER BY decided_at ASC
      LIMIT 1`,
    [params.authorizationTransactionId],
  );
  const decision = rows[0]?.decision;
  return decision === 'approve' || decision === 'deny' ? decision : undefined;
}

/**
 * Kiểm thu hồi ở ba mức lồng nhau của `token_revocations` (§6.4).
 *
 * ⚠️ Append-only: mọi hàng là bằng chứng thu hồi còn hiệu lực — không có cột
 * "đã gỡ" nào để lọc, nên `SELECT ... LIMIT 1` đúng nghĩa là "đã từng bị thu hồi".
 *
 * ⚠️ `revoked_scopes` ở đây KHÔNG được suy diễn thành "thu hồi một phần ⇒ vẫn cấp
 * phần còn lại": một hàng thu hồi scope một phần kèm câu trả lời "vẫn cấp" là một
 * phép suy diễn chính sách không có gì ghim. Bất kỳ hàng nào khớp phạm vi đều trả
 * `revoked` — bảo thủ hơn, và chỉ có thể nới lỏng bằng một quyết định được kiểm.
 *
 * ⚠️ Một hàng chỉ có `token_hash` (subject_ref NULL, grant_id NULL) KHÔNG khớp câu
 * nào ở đây — nó không vô hiệu được việc cấp mới, chỉ có nghĩa khi tra theo hash
 * token cụ thể (introspection/verify). Đó là hình dạng hợp lệ của schema (0011);
 * nếu một runbook ghi mức token mà không có grant_id, hãy ghi kèm grant_id để
 * mức token thực sự chặn cả lần phát hành kế tiếp.
 */
export async function checkRevocationAtIssuance(
  client: PostgresClientLike,
  params: {
    readonly sub: string;
    readonly clientId: string;
    /** Grant đang dùng để cấp — bắt buộc để mức `token` (theo grant) có tác dụng. */
    readonly grantId?: string;
  },
): Promise<RevocationCheckResult> {
  const rows = await client.unsafe<{ id: string }>(
    `SELECT id FROM auth.token_revocations
      WHERE (level = 'subject' AND subject_ref = $1)
         OR (level = 'client' AND subject_ref = $1 AND client_id = $2)
         OR ($3::uuid IS NOT NULL AND level = 'token' AND grant_id = $3::uuid)
      LIMIT 1`,
    [params.sub, params.clientId, params.grantId ?? null],
  );
  return rows.length > 0 ? 'revoked' : 'not_revoked';
}

/* ------------------------------------------------------------------------- */
/* Audit — SR-010: append-only `authorization_audit_events`                   */
/* ------------------------------------------------------------------------- */

/**
 * Một hàng audit, allowlist cột của migration `0008`.
 *
 * ⚠️ KHÔNG BAO GIỜ đưa token, code, `code_verifier`, handle, secret hay
 * `account_session_ref` vào `details` — kể cả dạng hash (SR-002, invariant 20):
 * hash của handle trong audit biến audit thành nguồn đối chiếu cho kẻ đọc được
 * log. Allowlist đây là điểm enforce tầng ứng dụng; bảng enforce tầng DB bằng
 * CHECK `event_type` và thu quyền UPDATE/DELETE (0009).
 */
export interface AuditEventInput {
  /** Giá trị thuộc CHECK allowlist của `0008` — ngoài danh sách là lỗi DB, chủ ý. */
  readonly eventType: string;
  readonly subjectRef?: string;
  readonly clientId?: string;
  readonly authorizationTransactionId?: string;
  readonly authorizationCodeId?: string;
  readonly grantId?: string;
  readonly kid?: string;
  readonly outcome?: string;
  readonly errorCode?: string;
  readonly details?: Record<string, string | number | boolean | null>;
}

/**
 * INSERT một hàng audit.
 *
 * ⚠️ Đây là câu lệnh append thuần — không ON CONFLICT, không UPSERT: audit là
 * bằng chứng, hai hàng giống hệt nhau cho hai lần thử là ĐÚNG dữ liệu. Cột do
 * allowlist interface ghim; mọi giá trị đi qua bind parameter, không có chuỗi
 * request nào chạm SQL (cùng bộ luật với mọi hàm khác của file này).
 *
 * Nhận `Queryable` (không phải `PostgresClientLike`) để gọi được trong một
 * `client.begin(tx)` — audit của consent decide là CÙNG sự kiện với CAS nên
 * phải đi qua tx của nó.
 */
export async function insertAuditEvent(client: Queryable, event: AuditEventInput): Promise<void> {
  await client.unsafe(
    `INSERT INTO auth.authorization_audit_events
       (event_type, subject_ref, client_id, authorization_transaction_id,
        authorization_code_id, grant_id, kid, outcome, error_code, details)
     VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10::jsonb)`,
    [
      event.eventType,
      event.subjectRef ?? null,
      event.clientId ?? null,
      event.authorizationTransactionId ?? null,
      event.authorizationCodeId ?? null,
      event.grantId ?? null,
      event.kid ?? null,
      event.outcome ?? null,
      event.errorCode ?? null,
      event.details === undefined ? null : JSON.stringify(event.details),
    ],
  );
}

/* ------------------------------------------------------------------------- */
/* AuthStore — cài đặt interface của application layer bằng các hàm ở trên.  */
/* ------------------------------------------------------------------------- */

/**
 * Tham số dựng store — tường minh thay vì đọc biến toàn cục.
 *
 * `client` là pool của isolate (xem `oidc/provider.ts` về vòng đời runtime).
 */
export interface AuthorizationStoreDeps {
  readonly client: PostgresClientLike;
}

/** Cài đặt `AuthStore` của application layer cho `db-auth`. */
export function createAuthorizationStore(
  deps: AuthorizationStoreDeps,
): import('@ecoma-io/identity-auth-application').AuthStore {
  const { client } = deps;
  return {
    async findTransactionByHandleX(params) {
      return findTransactionByHandleX(client, params);
    },

    async createTransaction(record: NewAuthorizationTransaction): Promise<void> {
      await insertTransaction(client, record);
    },

    async transition(params: {
      transactionId: string;
      from: AuthorizationTransactionState;
      to: AuthorizationTransactionState;
      at: Date;
    }): Promise<boolean> {
      return transitionTransaction(client, params);
    },

    async insertAuthorizationCode(code: NewAuthorizationCode): Promise<void> {
      await insertAuthorizationCodeRow(client, code);
    },

    async findGrant(params: { accountId: string; clientId: string }) {
      const grant = await findActiveGrant(client, {
        sub: params.accountId,
        clientId: params.clientId,
      });
      // Structural typing: object có thừa `id` vẫn khớp `AuthGrant`.
      return grant;
    },

    async findClient(clientId: string) {
      return findRegisteredClient(client, clientId);
    },

    async checkRevocation(params: { accountId: string; clientId: string }) {
      return checkRevocationAtIssuance(client, {
        sub: params.accountId,
        clientId: params.clientId,
      });
    },
  };
}

/**
 * Transaction record đọc lại từ store — alias tiện cho handler của `main.ts`,
 * giữ import của file này tập trung ở một chỗ.
 */
export type { AuthorizationTransactionRecord };
