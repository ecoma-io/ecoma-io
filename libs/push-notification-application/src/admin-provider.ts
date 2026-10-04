/**
 * Admin API — provider lifecycle, credential rotation, emergency hold, provider test.
 *
 * Canonical: `docs/services/push-notification/02-requirements.md` FR-017 (capability list),
 * FR-018 (provider test), FR-020 (audit) · `03-operations.md` §6 (provider operations),
 * §7.2 (credential rotation) · `01-architecture.md` §5.3 (provider, one active primary).
 *
 * ⚠️ **Bốn thứ ở đây không phải CRUD.** Chúng là những phép biến đổi có **invariant toàn cục**
 * mà `Admin API` `MUST` từ chối cấu hình phá vỡ (`03-operations.md` §6.1):
 *
 * 1. **Một active primary per `(app, transport)`.** Tuyên bố primary là một **thay thế** trong
 *    `push_app_provider_mappings`, và guard thật là partial unique index
 *    `push_app_provider_mappings_one_primary` — không phải một kiểm read-then-write ở đây.
 * 2. **`disable` ≠ `emergency hold`** (§6.3 vs §6.5). `disable` chỉ dừng routing delivery mới;
 *    `hold` chặn **cả** delivery đã materialize chưa bắt đầu. Gộp hai trục làm mất đúng tính
 *    năng mà `hold` tồn tại để có.
 * 3. **Rotation không đảo thứ tự** (§7.2): **không** revoke credential cũ trước khi credential
 *    mới validate thành công, và **không** retire VAPID key cũ khi còn subscription `active`
 *    tham chiếu nó.
 * 4. **Mọi thao tác đều audit** (FR-020) — 12 event đóng, secret không bao giờ vào audit.
 */

import {
  canRetireEncryptionKey,
  selectPrimaryProvider,
  type ProviderRoutingFact,
} from '@ecoma-io/push-notification-domain';
import type { PushNotificationConfig } from './config-port';
import type { IdGenerator } from './create-notification';
import type { ProviderMappingRecord, PushNotificationPorts } from './ports';
import {
  AUDIT_EVENT,
  PROVIDER_TEST_RESULT,
  type AuditEvent,
  type ProviderCredentialRecord,
  type ProviderRecord,
  type ProviderTestResult,
  type SubscriptionRecord,
} from './records';

/* -------------------------------------------------------------------------------------- */
/* Dependency và kết quả                                                                     */
/* -------------------------------------------------------------------------------------- */

/** Dependency chung của mọi use case admin — actor đã xác thực là **tham số**, không phải env. */
export interface AdminDeps {
  readonly config: PushNotificationConfig;
  readonly ports: PushNotificationPorts;
  readonly ids: IdGenerator;
}

/**
 * Lý do từ chối một use case admin — vocabulary **đóng**, tách khỏi `REQUEST_REJECTION` của
 * Application API và khỏi `reason` của claim.
 *
 * ⚠️ Tách riêng vì cả hai nhóm kia đều đã là **hợp đồng** với một consumer khác: `reason` của
 * claim là vocabulary mà delivery plane **MUST** xử lý đủ, còn `REQUEST_REJECTION` mô tả lỗi
 * của Application API. Trộn lời gọi Admin API vào một trong hai sẽ làm một consumer phải hiểu
 * thêm một nhánh không thuộc contract của nó.
 */
export const ADMIN_REJECTION = {
  /** `provider_id` không tồn tại trong `app` của request. */
  ProviderNotFound: 'provider_not_found',
  /** `subscription_id` không tồn tại trong `app` của request. */
  SubscriptionNotFound: 'subscription_not_found',
  /** Provider thuộc `app` khác — FR-007 cấm dùng chéo app. */
  AppMismatch: 'app_mismatch',
  /** `status` hiện tại không phải giá trị mà `expected` yêu cầu. */
  StateMismatch: 'state_mismatch',
  /** `enable` một provider đang emergency hold — phải release hold trước. */
  ProviderHeld: 'provider_held',
  /** Đã có intent `pending`/`publishing` cho `delivery_id` (chống dồn intent, §6.1). */
  OpenOutboxIntent: 'open_outbox_intent',
  /** Precondition domain của administrative recovery không thoả — kèm `detail` của domain. */
  RecoveryPreconditionFailed: 'recovery_precondition_failed',
  /** `delivery_id` không tồn tại. */
  DeliveryNotFound: 'delivery_not_found',
  /** Ghi audit/D1 thất bại — thao tác chưa xảy ra nên không trả `200`. */
  StorageFailure: 'storage_failure',
} as const;

export type AdminRejection = (typeof ADMIN_REJECTION)[keyof typeof ADMIN_REJECTION];

/** Kết quả chung của use case admin. */
export type AdminResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: AdminRejection; readonly detail: string };

/* -------------------------------------------------------------------------------------- */
/* create                                                                                     */
/* -------------------------------------------------------------------------------------- */

/** Input của `POST /admin/v1/providers`. */
export interface CreateProviderCommand {
  readonly app: string;
  readonly providerId: string;
  readonly transport: ProviderRecord['transport'];
  readonly type: ProviderRecord['type'];
  readonly name: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  /** Tuyên bố provider này là primary của scope ngay khi tạo hay không. */
  readonly makePrimary: boolean;
  readonly actor: string;
}

/**
 * `POST /admin/v1/providers` — tạo provider.
 *
 * ⚠️ Provider mới sinh ở `status = 'disabled'`, **không** phải `enabled`. §6.1 nói chỉ
 * `disabled → enabled` sau khi pass configuration schema · credential availability ·
 * credential validity · provider connectivity · test delivery — mà control plane không
 * tự chạy provider test (FR-018 là một Admin API operation riêng, có audit). Sinh ở
 * `enabled` sẽ cho một provider **chưa** credential vào routing production.
 */
export async function createProvider(
  deps: AdminDeps,
  command: CreateProviderCommand,
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  const { ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const created = await ports.providers.insert({
    providerId: command.providerId,
    app: command.app,
    transport: command.transport,
    type: command.type,
    name: command.name,
    configuration: command.configuration,
    now,
  });

  if (command.makePrimary) {
    const mapping = await claimPrimary(deps, created, command.actor, now);
    if (!mapping.ok) {
      // Provider đã tồn tại nhưng không thể tuyên bố primary. Trả lỗi **kèm cả hai** để
      // operator biết việc gì đã xảy ra: xoá provider là một thao tác quản trị khác, và
      // im lặng coi như cả hai đều không xảy ra là một trạng thái không tồn tại.
      return {
        ok: false,
        reason: mapping.reason,
        detail: `provider ${created.providerId} đã tạo nhưng tuyên bố primary thất bại: ${mapping.detail}`,
      };
    }
  }

  await appendAudit(
    deps,
    AUDIT_EVENT.ProviderCreated,
    command.actor,
    'push_provider',
    created.providerId,
    now,
    {
      app: created.app,
      transport: created.transport,
      type: created.type,
    },
  );

  return { ok: true, value: created };
}

/* -------------------------------------------------------------------------------------- */
/* read single                                                                                */
/* -------------------------------------------------------------------------------------- */

/**
 * `GET /admin/v1/providers/:id` — xem configuration và trạng thái của một provider (§4.2,
 * FR-017 "xem configuration").
 *
 * ⚠️ **Không có audit event cho lần đọc này**: audit là nhật ký của hành động **đổi** state
 * (FR-020 liệt kê đúng các event ghi); một GET không đổi gì và ghi nó sẽ làm nhật ký vận hành
 * nhấn nhá bằng nhiễu. Ranh giới secret vẫn giữ nguyên: record trả về là `ProviderRecord` —
 * credential nằm ở bảng riêng và **không bao giờ** đi kèm, kể cả khi đã giải mã.
 *
 * ⚠️ Không tìm thấy → `provider_not_found`, cùng vocabulary với các use case admin khác;
 * `findById` của repository không lọc `app` (quy ước đã ghi ở `ports.ts`), nên việc kiểm
 * `app` là của use case — đọc một provider của app khác phải **trông như** không tồn tại.
 */
export async function getProvider(
  deps: AdminDeps,
  input: { readonly app: string; readonly providerId: string },
): Promise<AdminResult<ProviderRecord>> {
  const provider = await deps.ports.providers.findById(input.providerId);
  if (provider === null || provider.app !== input.app) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.ProviderNotFound,
      detail: 'Provider không tồn tại trong app này.',
    };
  }
  return { ok: true, value: provider };
}

/* -------------------------------------------------------------------------------------- */
/* update configuration                                                                       */
/* -------------------------------------------------------------------------------------- */

/**
 * `PATCH /admin/v1/providers/:id` — đổi `name`/`configuration`.
 *
 * ⚠️ Không đụng `status`, `emergency_hold`, `is_primary`. Cả ba đều là trục có invariant riêng
 * và có operation riêng (`set-provider-status`, `set-provider-hold`, `claim-primary`) — để
 * `PATCH` chạm vào chúng là đường vòng qua audit event và qua guard của index.
 */
export async function updateProvider(
  deps: AdminDeps,
  input: {
    readonly app: string;
    readonly providerId: string;
    readonly name: string;
    readonly configuration: Readonly<Record<string, unknown>>;
    readonly actor: string;
  },
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  const now = nowOverride ?? deps.ports.clock.now();
  const updated = await deps.ports.providers.updateConfiguration({
    app: input.app,
    providerId: input.providerId,
    name: input.name,
    configuration: input.configuration,
    now,
  });
  if (updated === null) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.ProviderNotFound,
      detail: 'Provider không tồn tại trong app này.',
    };
  }
  await appendAudit(
    deps,
    AUDIT_EVENT.ProviderUpdated,
    input.actor,
    'push_provider',
    updated.providerId,
    now,
    {
      app: updated.app,
      transport: updated.transport,
    },
  );
  return { ok: true, value: updated };
}

/* -------------------------------------------------------------------------------------- */
/* enable / disable                                                                           */
/* -------------------------------------------------------------------------------------- */

/**
 * `PATCH /admin/v1/providers/:id` với `status` — bật/tắt provider.
 *
 * ⚠️ `expected` là trạng thái **phải** có trước khi đổi, và nó nằm **trong** statement ghi
 * (`SetProviderStatusInput.expected`). Đó là guarded conditional write: hai admin bật/tắt
 * cùng scope chạy đồng thời thì đúng một thắng, và tài liệu không cần giả định row locking.
 *
 * ⚠️ Enable **không** tự làm provider thành primary. `is_primary` thuộc
 * `push_app_provider_mappings` và có operation riêng; gộp hai việc khiến một admin "enable"
 * hiểu nhầm là đã thay primary của scope.
 */
export async function setProviderStatus(
  deps: AdminDeps,
  input: {
    readonly app: string;
    readonly providerId: string;
    readonly status: ProviderRecord['status'];
    readonly expected: ProviderRecord['status'];
    readonly actor: string;
  },
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  const { ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const current = await ports.providers.findById(input.providerId);
  const mismatch = checkProviderScope(current, input.app);
  if (mismatch !== null) {
    return mismatch;
  }
  // Chặn enable khi còn emergency hold: một provider `enabled` nhưng đang hold là một trạng
  // thái mà routing chấp nhận nhưng claim chặn — hai tầng quyết định lệch nhau, và bản đồ
  // metric của provider sẽ báo "routing OK" trong khi mọi delivery đều bị
  // `ineligible_provider_hold`. §6.1 yêu cầu release hold là bước độc lập.
  if (input.status === 'enabled' && (current as ProviderRecord).emergencyHold) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.ProviderHeld,
      detail: 'Provider đang emergency hold — phải release hold trước khi enable.',
    };
  }

  const updated = await ports.providers.setStatus({
    app: input.app,
    providerId: input.providerId,
    status: input.status,
    expected: input.expected,
    now,
  });
  if (updated === null) {
    // `findById` vừa thấy provider và `expected` phải khớp trong statement — nên `null` ở đây
    // là race giữa hai lời gọi. Đó là `state_mismatch`, không phải "không tồn tại": trả
    // `provider_not_found` sẽ bảo operator rằng provider biến mất.
    return {
      ok: false,
      reason: ADMIN_REJECTION.StateMismatch,
      detail: 'Trạng thái provider đã đổi sau khi đọc — thao tác không được áp dụng.',
    };
  }

  await appendAudit(
    deps,
    updated.status === 'enabled' ? AUDIT_EVENT.ProviderEnabled : AUDIT_EVENT.ProviderDisabled,
    input.actor,
    'push_provider',
    updated.providerId,
    now,
    { app: updated.app, transport: updated.transport, previous_status: input.expected },
  );
  return { ok: true, value: updated };
}

/* -------------------------------------------------------------------------------------- */
/* emergency hold / release                                                                   */
/* -------------------------------------------------------------------------------------- */

/**
 * `POST /admin/v1/providers/:id/hold` — emergency hold/revoke (`03-operations.md` §6.5).
 *
 * ⚠️ **Không** phải alias của `disable`: hold giữ nguyên `status`, chỉ đặt `emergency_hold`,
 * và nó chặn delivery **đã materialize** chưa bắt đầu (`409 ineligible_provider_hold`) trong
 * khi `disable` chỉ dừng routing mới. `MUST NOT` khẳng định hold thu hồi được một request
 * provider đã accept — §6.5 nói rõ chỉ chặn được phần chưa gửi.
 *
 * ⚠️ Hold **idempotent**: gọi lại khi đã hold trả `200` với cùng record, không phải lỗi. Runbook
 * §15.7 là một quy trình nhiều bước có thể chạy lại, và một lời gọi lặp phải không tạo ra một
 * audit record nói dối.
 */
export async function holdProvider(
  deps: AdminDeps,
  input: { readonly app: string; readonly providerId: string; readonly actor: string },
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  return applyHold(deps, input.actor, input.app, input.providerId, true, nowOverride);
}

/**
 * `POST /admin/v1/providers/:id/release` — bỏ emergency hold.
 *
 * ⚠️ Không bỏ `disable` một cách ngầm: một provider `disabled` sau khi release hold vẫn
 * `disabled`, và routing mới vẫn dừng. Bỏ cả hai trong một lời gọi sẽ khiến một runbook tưởng
 * rằng provider đã trở lại phục vụ trong khi nó không.
 */
export async function releaseProvider(
  deps: AdminDeps,
  input: { readonly app: string; readonly providerId: string; readonly actor: string },
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  return applyHold(deps, input.actor, input.app, input.providerId, false, nowOverride);
}

async function applyHold(
  deps: AdminDeps,
  actor: string,
  app: string,
  providerId: string,
  hold: boolean,
  nowOverride?: number,
): Promise<AdminResult<ProviderRecord>> {
  const { ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const current = await ports.providers.findById(providerId);
  const mismatch = checkProviderScope(current, app);
  if (mismatch !== null) {
    return mismatch;
  }
  const existing = current as ProviderRecord;
  if (existing.emergencyHold === hold) {
    // Đã ở trạng thái đích: trả `200` với record hiện tại và **không** ghi audit. Một audit
    // record cho một thay đổi không xảy ra là bằng chứng sai, và audit là bằng chứng cho
    // operator (§15.7 cần đọc được đúng những lần hold **thật**).
    return { ok: true, value: existing };
  }

  const updated = await ports.providers.setEmergencyHold({ app, providerId, hold, now });
  if (updated === null) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.StateMismatch,
      detail: 'Trạng thái hold đã đổi sau khi đọc — thao tác không được áp dụng.',
    };
  }

  await appendAudit(
    deps,
    hold ? AUDIT_EVENT.ProviderHeld : AUDIT_EVENT.ProviderReleased,
    actor,
    'push_provider',
    providerId,
    now,
    { app, transport: updated.transport, status: updated.status },
  );
  return { ok: true, value: updated };
}

/* -------------------------------------------------------------------------------------- */
/* primary mapping — một active primary per (app, transport)                                  */
/* -------------------------------------------------------------------------------------- */

/**
 * Tuyên bố primary cho `(app, transport)`.
 *
 * ⚠️ **Thay thế, không cộng dồn.** Xoá mapping primary cũ rồi tạo mapping mới **trong cùng một
 * `db.batch()`** — nếu hai lệnh đó là hai transaction, có một khoảng thời gian scope không có
 * primary, và routing trong khoảng đó sẽ là `no_provider` cho một scope vốn đang phục vụ tốt.
 *
 * ⚠️ Trước khi tuyên bố, `selectPrimaryProvider` phải trả **không phải `ambiguous`**. Đó là
 * cổng chặn của §6.1: một cấu hình tạo ambiguity là thứ `MUST` bị từ chối, vì routing fail
 * safely sẽ dừng giao thông cho scope đó thay vì đoán.
 *
 * ⚠️ Guard **thật** vẫn là partial unique index `push_app_provider_mappings_one_primary`: hai
 * admin tuyên bố primary cho cùng scope chạy đồng thời thì lệnh thứ hai bị D1 từ chối, và
 * `setPrimaryMapping` trả `null`. Đó là race hợp lệ, không phải lỗi.
 */
export async function claimProviderPrimary(
  deps: AdminDeps,
  input: { readonly app: string; readonly providerId: string; readonly actor: string },
  nowOverride?: number,
): Promise<AdminResult<ProviderMappingRecord>> {
  const { ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const provider = await ports.providers.findById(input.providerId);
  const mismatch = checkProviderScope(provider, input.app);
  if (mismatch !== null) {
    return mismatch;
  }
  // Narrow: `checkProviderScope` trả `null` **chỉ** khi record khác `null` **và** `app` khớp.
  const target = provider as ProviderRecord;
  if (target.emergencyHold || target.status === 'disabled') {
    // Tuyên bố một provider không eligible làm primary là cách **duy nhất** để scope rơi
    // vào trạng thái mà routing vẫn fail-safe (`ambiguous`/`no_provider`) sau khi mapping cũ
    // đã bị xoá. §6.1 nói `Admin API` MUST từ chối cấu hình tạo ambiguity — cấu hình này tạo
    // ra chính xác điều đó.
    return {
      ok: false,
      reason: target.emergencyHold ? ADMIN_REJECTION.ProviderHeld : ADMIN_REJECTION.StateMismatch,
      detail: 'Provider không eligible — không thể là primary của scope.',
    };
  }

  // Cổng chặn ambiguity của §6.1: **sau** khi tuyên bố provider này, scope sẽ có provider
  // này là eligible **cộng** mọi provider eligible khác. Nếu còn một provider eligible nữa
  // thì scope thành `ambiguous` — mà routing fail-safe sẽ dừng giao thông cho một scope vốn
  // đang phục vụ tốt. Đây là kiểm **cấu hình**, và nó dùng lại đúng hàm mà routing dùng, nên
  // "ambiguous" ở đây và "ambiguous" lúc route là **cùng một định nghĩa**.
  const facts = await ports.providers.listByScope(input.app, target.transport);
  const others = facts.filter((fact: ProviderRoutingFact) => fact.providerId !== target.providerId);
  const remaining = selectPrimaryProvider(others, input.app, target.transport);
  if (remaining.ok) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.StateMismatch,
      detail: `Scope đã có provider eligible khác (${remaining.provider.providerId}) — tuyên bố primary lúc này sẽ tạo ambiguity.`,
    };
  }
  if (!remaining.ok && remaining.reason !== 'no_provider') {
    // `malformed_provider`/`malformed_selector`/`ambiguous`: danh sách fact hỏng hoặc scope
    // **đã** ambiguous. Cả hai đều là cấu hình mà §6.1 cấm — nhưng khác nhau: `ambiguous`
    // là một scope đang chạy production với lỗi cấu hình, nên detail phải nói rõ.
    return {
      ok: false,
      reason: ADMIN_REJECTION.StateMismatch,
      detail: `Scope không ở trạng thái có thể tuyên bố primary: ${remaining.reason}.`,
    };
  }

  const mapping = await ports.providers.setPrimaryMapping({
    mappingId: deps.ids.next(),
    app: input.app,
    transport: target.transport,
    providerId: target.providerId,
    now,
  });
  if (mapping === null) {
    // Partial unique index `push_app_provider_mappings_one_primary` chặn: một admin khác đã
    // tuyên bố primary cho scope này giữa lúc đọc và lúc ghi. Đây là race hợp lệ, **không**
    // phải lỗi cấu hình — nhưng nó cũng có thể là việc mapping cũ của scope đã bị xoá bởi
    // một lời gọi khác, nên không được coi là thành công im lặng.
    return {
      ok: false,
      reason: ADMIN_REJECTION.StateMismatch,
      detail: 'Tuyên bố primary bị index chặn — scope đã có admin khác tuyên bố trước.',
    };
  }

  await appendAudit(
    deps,
    AUDIT_EVENT.ProviderUpdated,
    input.actor,
    'push_provider',
    target.providerId,
    now,
    {
      app: input.app,
      transport: target.transport,
      change: 'primary_mapping',
    },
  );
  return { ok: true, value: mapping };
}

/** Nội bộ của `createProvider` — cùng luật với `claimProviderPrimary`. */
async function claimPrimary(
  deps: AdminDeps,
  provider: ProviderRecord,
  actor: string,
  now: number,
): Promise<AdminResult<ProviderMappingRecord>> {
  return claimProviderPrimary(
    deps,
    { app: provider.app, providerId: provider.providerId, actor },
    now,
  );
}

/* -------------------------------------------------------------------------------------- */
/* credential rotation                                                                        */
/* -------------------------------------------------------------------------------------- */

/** Input của `POST /admin/v1/providers/:id/rotate-credential`. */
export interface RotateCredentialCommand {
  readonly app: string;
  readonly providerId: string;
  readonly credentialId: string;
  /** VAPID key id mới — subscription **mới** sẽ dùng key này (§7.2). */
  readonly vapidKeyId: string;
  readonly publicKey: string;
  /** Private key **plaintext**; chỉ tồn tại trong stack của use case này, không vào log/audit. */
  readonly privateKey: string;
  /** `vapid_key_id` cần retire sau khi key mới đã phục vụ — có thể `null` (chưa có key cũ nào). */
  readonly retireVapidKeyId: string | null;
  readonly actor: string;
}

/**
 * `POST /admin/v1/providers/:id/rotate-credential` — rotate VAPID key pair (`03-operations.md` §7.2).
 *
 * ⚠️ **Không** revoke credential cũ ở đây. §7.2 cấm đảo thứ tự (`revoke old → deploy new`
 * khi deployment mới chưa xác nhận), và subscription cũ **giữ** `vapid_key_id` cũ. Việc
 * retire là một bước **sau**, khi đếm được 0 subscription `active` tham chiếu key cũ — thứ mà
 * `canRetireEncryptionKey`/`countActiveSubscriptionReferences` cung cấp cho một operation
 * riêng.
 *
 * ⚠️ Private key được **mã hoá ngay** bằng `CredentialCipher` và không đi qua audit. Cột
 * `credential_ciphertext` nhận byte mã hoá; `publicKey` đi vào record vì client cần nó ở tầng
 * application và nó **không** phải secret (`01-architecture.md` §9).
 */
export async function rotateCredential(
  deps: AdminDeps,
  command: RotateCredentialCommand,
  nowOverride?: number,
): Promise<
  AdminResult<{ readonly vapidKeyId: string; readonly retiredVapidKeyId: string | null }>
> {
  const { ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const provider = await ports.providers.findById(command.providerId);
  const mismatch = checkProviderScope(provider, command.app);
  if (mismatch !== null) {
    return mismatch;
  }

  // Mã hoá **trước** khi ghi bất kỳ thứ gì: một lỗi ở `encrypt` khiến rotation dừng lại mà
  // không để lại một credential `active` mà không có ciphertext.
  const encrypted = await ports.credentialCipher.encrypt(command.privateKey);
  const credential = await ports.providerCredentials.insert({
    credentialId: command.credentialId,
    providerId: command.providerId,
    app: command.app,
    vapidKeyId: command.vapidKeyId,
    publicKey: command.publicKey,
    credentialCiphertext: encrypted.ciphertext,
    credentialEncryptionVersion: encrypted.version,
    now,
  });

  // Cổng chặn retire của key cũ (§7.2): chỉ retire khi **không còn** subscription `active`
  // nào tham chiếu nó. Nếu còn, rotation vẫn thành công (key mới đã phục vụ subscription
  // mới) — chỉ là **không** retire key cũ, và việc đó là đúng.
  let retiredVapidKeyId: string | null = null;
  if (command.retireVapidKeyId !== null) {
    const references = await ports.providerCredentials.countActiveSubscriptionReferences(
      command.app,
      command.retireVapidKeyId,
    );
    if (references === 0) {
      const previous = await ports.providerCredentials.findByVapidKeyId(
        command.app,
        command.providerId,
        command.retireVapidKeyId,
      );
      if (previous !== null) {
        const retired = await ports.providerCredentials.setStatus({
          app: command.app,
          credentialId: previous.credentialId,
          status: 'retired',
          expected: 'active',
          now,
        });
        if (retired !== null) {
          retiredVapidKeyId = command.retireVapidKeyId;
        }
      }
    }
  }

  await appendAudit(
    deps,
    AUDIT_EVENT.CredentialRotated,
    command.actor,
    'push_provider_credential',
    credential.credentialId,
    now,
    {
      app: command.app,
      provider_id: command.providerId,
      new_vapid_key_id: command.vapidKeyId,
      // `retired_vapid_key_id` là `null` khi key cũ **còn** subscription `active` tham chiếu —
      // một kết quả **đúng** của §7.2, không phải thiếu sót. Audit phải phân biệt "chưa retire
      // vì còn tham chiếu" với "đã retire", nên hai nhánh ghi hai giá trị khác nhau; ghi
      // `"none"` cho cả hai sẽ làm một người đọc audit kết luận sai.
      retired_vapid_key_id: retiredVapidKeyId ?? 'skipped_still_referenced',
    },
  );

  return { ok: true, value: { vapidKeyId: credential.vapidKeyId, retiredVapidKeyId } };
}

/**
 * Kiểm tra một encryption key version còn retire được không (FR-006, §7.3).
 *
 * ⚠️ Đây là **cổng chặn** của `K1 → K2`, không phải hành động retire. Hành vi retire (reencrypt
 * record) là một background job vận hành riêng và `MUST NOT` được suy ra từ hàm này — cùng
 * lý do §5.6 nói lease expiry chỉ làm delivery claimable lại chứ không tự chuyển state.
 */
export async function checkEncryptionKeyRetirement(
  deps: AdminDeps,
  keyId: string,
): Promise<{ readonly canRetire: boolean; readonly versionsInUse: readonly string[] }> {
  const versionsInUse = await deps.ports.providerCredentials.listEncryptionVersionsInUse();
  return { canRetire: canRetireEncryptionKey(keyId, versionsInUse), versionsInUse };
}

/* -------------------------------------------------------------------------------------- */
/* provider test (FR-018)                                                                     */
/* -------------------------------------------------------------------------------------- */

/** Kết quả một lần provider test — phân loại của FR-018, không suy ra từ HTTP code. */
export interface ProviderTestOutcome {
  readonly result: ProviderTestResult;
  readonly providerId: string;
  readonly subscriptionId: string;
  /** Thời gian đo được (epoch millis) — `03-operations.md` §10.2 metric provider latency. */
  readonly durationMs: number;
  /** Chi tiết đã **sanitize**: không response body, không endpoint, không secret. */
  readonly detail: string;
}

/** Port gọi provider — chỉ tồn tại cho provider test, không nằm trong đường serving. */
export interface ProviderProbe {
  /**
   * Gửi một test delivery tới một subscription **đã authorization** (FR-018).
   *
   * ⚠️ Đây là port của **control plane**, nhưng provider SDK thuộc delivery worker
   * (`docs/services/web-push-notification-job`). Vì vậy adapter chỉ có hai lựa chọn hợp lệ:
   * gọi provider trực tiếp, hoặc **không implement** port này và trả
   * `configuration_invalid`. Control plane `MUST NOT` giả vờ đã test khi chưa gọi được
   * provider — FR-018 nói test gồm "actual delivery".
   */
  sendTestDelivery(input: {
    readonly endpoint: string;
    readonly p256dh: string;
    readonly auth: string;
    readonly vapidKeyId: string;
    readonly privateKey: string;
    readonly timeoutMs: number;
    readonly payloadJson: string;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly classification: ProviderTestResult; readonly detail: string }
  >;
}

/** Input của `POST /admin/v1/providers/:id/test`. */
export interface ProviderTestCommand {
  readonly app: string;
  readonly providerId: string;
  readonly subscriptionId: string;
  readonly actor: string;
  /** Payload test — không chứa dữ liệu nhạy cảm không cần thiết (FR-018). */
  readonly payloadJson: string;
}

/**
 * `POST /admin/v1/providers/:id/test` — configuration test + actual test delivery (FR-018).
 *
 * ⚠️ **Phân loại 5 giá trị** là điều FR-018 đòi và là lý do `ProviderTestResult` tồn tại: gộp
 * `configuration_invalid` với `authentication_failed` mất một nhánh remediation (§15.3: 401/403
 * → credential path).
 *
 * ⚠️ **Test có audit record** (FR-018, FR-020) — kể cả khi test fail, vì một test fail lặp
 * lại là bằng chứng cho incident §15.3.
 *
 * ⚠️ Target subscription phải thuộc **cùng app** với provider. Kiểm này ở đây, trước khi gọi
 * provider, vì FR-007 cấm dùng chéo app và một test delivery sang app khác là một gửi thật
 * tới một endpoint thật của một app khác.
 */
export async function runProviderTest(
  deps: AdminDeps,
  probe: ProviderProbe,
  command: ProviderTestCommand,
  nowOverride?: number,
): Promise<AdminResult<ProviderTestOutcome>> {
  const { config, ports } = deps;
  const now = nowOverride ?? ports.clock.now();

  const provider = await ports.providers.findById(command.providerId);
  const providerMismatch = checkProviderScope(provider, command.app);
  if (providerMismatch !== null) {
    return providerMismatch;
  }
  const target = provider as ProviderRecord;

  const subscription = await ports.subscriptions.findById(command.subscriptionId);
  const subscriptionMismatch = checkSubscriptionScope(subscription, command.app);
  if (subscriptionMismatch !== null) {
    return subscriptionMismatch;
  }
  const targetSubscription = subscription as SubscriptionRecord;

  // Provider phục vụ **một** transport (FR-005: scope là `App + Transport`). Test một
  // subscription thuộc transport khác sẽ đo một đường giao thông mà routing không bao giờ
  // chọn, và một `delivery_accepted` ở đó **không** nói gì về provider của scope thật — đó là
  // một test xanh giả, thứ tệ hơn một test đỏ vì nó dừng operator bỏ một lỗi thật.
  if (targetSubscription.transport !== target.transport) {
    await appendAudit(
      deps,
      AUDIT_EVENT.ProviderUpdated,
      command.actor,
      'push_provider',
      command.providerId,
      now,
      {
        app: command.app,
        test_result: PROVIDER_TEST_RESULT.SubscriptionInvalid,
        subscription_id: command.subscriptionId,
      },
    );
    return {
      ok: true,
      value: {
        result: PROVIDER_TEST_RESULT.SubscriptionInvalid,
        providerId: command.providerId,
        subscriptionId: command.subscriptionId,
        durationMs: 0,
        detail: 'Target subscription khác transport mà provider phục vụ.',
      },
    };
  }

  const credential = await ports.providerCredentials.findByVapidKeyId(
    command.app,
    command.providerId,
    targetSubscription.vapidKeyId,
  );
  if (credential === null || credential.status !== 'active') {
    await appendAudit(
      deps,
      AUDIT_EVENT.ProviderUpdated,
      command.actor,
      'push_provider',
      command.providerId,
      now,
      {
        app: command.app,
        test_result: PROVIDER_TEST_RESULT.ConfigurationInvalid,
        subscription_id: command.subscriptionId,
      },
    );
    return {
      ok: true,
      value: {
        result: PROVIDER_TEST_RESULT.ConfigurationInvalid,
        providerId: command.providerId,
        subscriptionId: command.subscriptionId,
        durationMs: 0,
        detail: 'Không resolve được credential active cho vapid_key_id của target.',
      },
    };
  }

  const privateKey = await ports.credentialCipher.decrypt(
    credential.credentialCiphertext,
    credential.credentialEncryptionVersion,
  );
  // Đo thời gian **thật** của lần gọi provider: hai mốc lấy từ `clock` chứ không phải từ
  // `nowOverride`, vì `nowOverride` là mốc logic của use case (dùng để test) và một mốc cố
  // định sẽ cho `durationMs = 0` cho mọi lần chạy trong test — tức metric provider latency
  // (§10.2) sẽ được kiểm bằng một con số không có nghĩa.
  const startedAt = await ports.clock.now();
  const probeOutcome = await probe.sendTestDelivery({
    endpoint: targetSubscription.endpoint,
    p256dh: targetSubscription.p256dh,
    auth: targetSubscription.auth,
    vapidKeyId: credential.vapidKeyId,
    privateKey,
    timeoutMs: config.engineering.providerTestTimeoutMs,
    payloadJson: command.payloadJson,
  });
  const durationMs = Math.max(0, (await ports.clock.now()) - startedAt);

  const outcome: ProviderTestOutcome = probeOutcome.ok
    ? {
        result: PROVIDER_TEST_RESULT.DeliveryAccepted,
        providerId: command.providerId,
        subscriptionId: command.subscriptionId,
        durationMs,
        detail: 'Provider nhận test delivery.',
      }
    : {
        result: probeOutcome.classification,
        providerId: command.providerId,
        subscriptionId: command.subscriptionId,
        durationMs,
        detail: probeOutcome.detail,
      };

  await appendAudit(
    deps,
    AUDIT_EVENT.ProviderUpdated,
    command.actor,
    'push_provider',
    command.providerId,
    now,
    {
      app: command.app,
      test_result: outcome.result,
      subscription_id: command.subscriptionId,
      duration_ms: outcome.durationMs,
    },
  );

  return { ok: true, value: outcome };
}

/* -------------------------------------------------------------------------------------- */
/* Helpers dùng chung                                                                          */
/* -------------------------------------------------------------------------------------- */

/**
 * Kiểm tra provider của một request Admin.
 *
 * ⚠️ `providers.findById` cố ý **không** lọc `app` — xem `DeviceRepository.findById`. Nên
 * `null` ở đây có hai nguyên nhân thật sự khác nhau về đối diện operator: không tồn tại, hoặc
 * tồn tại ở app khác. Ở **Admin API** (đã authenticated + authorized theo app) phân biệt
 * được là đúng — khác hẳn private delivery runtime API, nơi phân biệt đó là loại tiết lộ mà
 * `401` cấm.
 *
 * ⚠️ `app` được kiểm **ở đây**, không ở repository: nếu repository lọc `app` thì một provider
 * ở app khác ra `not_found`, và operator mất khả năng phân biệt "sai id" với "sai app" — hai
 * nguyên nhân với hai cách sửa khác nhau.
 */
function checkProviderScope(
  provider: ProviderRecord | null,
  app: string,
): { readonly ok: false; readonly reason: AdminRejection; readonly detail: string } | null {
  if (provider === null) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.ProviderNotFound,
      detail: 'Provider không tồn tại.',
    };
  }
  if (provider.app !== app) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.AppMismatch,
      detail: 'Provider thuộc app khác — FR-007 cấm dùng chéo app.',
    };
  }
  return null;
}

/**
 * Cùng kiểm scope cho `Push Subscription` — `subscriptions.findById` cũng không lọc `app`.
 *
 * ⚠️ Trả `subscription_not_found` (không phải `provider_not_found`): hai entity này có hai
 * remediation khác nhau, và gộp chúng khiến một `404` của Admin API không chỉ ra được
 * operator cần tra subscription hay provider.
 */
function checkSubscriptionScope(
  subscription: SubscriptionRecord | null,
  app: string,
): { readonly ok: false; readonly reason: AdminRejection; readonly detail: string } | null {
  if (subscription === null) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.SubscriptionNotFound,
      detail: 'Subscription không tồn tại.',
    };
  }
  if (subscription.app !== app) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.AppMismatch,
      detail: 'Subscription thuộc app khác — FR-007 cấm dùng chéo app.',
    };
  }
  return null;
}

/**
 * Ghi audit — **mọi** use case admin đều đi qua đây, nên không có đường nào ghi audit với shape
 * khác.
 *
 * ⚠️ `detail` chỉ nhận mã/scope: `AuditRecordInput.detail` có kiểu `Record<string, string |
 * number | boolean>`, nên không có chỗ cho một payload lọt vào mà không bị type chặn (FR-020:
 * secret `MUST NOT` ghi vào audit).
 */
async function appendAudit(
  deps: AdminDeps,
  event: AuditEvent,
  actor: string,
  entityType: string,
  entityId: string,
  now: number,
  detail: Readonly<Record<string, string | number | boolean>>,
): Promise<void> {
  await deps.ports.audit.append({
    auditId: `${entityType}:${event}:${entityId}:${now}`,
    event,
    actor,
    entityType,
    entityId,
    detail,
    now,
  });
}

/* -------------------------------------------------------------------------------------- */
/* VAPID public key distribution                                                              */
/* -------------------------------------------------------------------------------------- */

/** Một VAPID key đang phục vụ — thứ duy nhất mà client/autocomplete cần để subscribe. */
export interface VapidPublicKeyView {
  readonly vapidKeyId: string;
  readonly publicKey: string;
  /** Chỉ key `active` mới được client dùng để subscribe; `retired` chỉ để đối chiếu. */
  readonly status: ProviderCredentialRecord['status'];
}

/**
 * `GET /admin/v1/providers/:id/credentials` — phân phối **public** VAPID key theo scope
 * `(app, provider)`.
 *
 * ⚠️ **Đây là đường đóng gap phân phối public key của task §7.** Client không thể tự biết
 * public key ứng với `vapid_key_id` mà nó phải gửi khi subscribe (FR-003); không có đường
 * đọc nào thì `vapid_key_id` phải được trao đổi ngoài band — một gap vận hành thật. Public
 * key **được phép** công khai theo design (browser nhận nó trong mỗi `applicationServerKey`),
 * nên trả qua Admin API cho Backoffice truy xuất là đúng ranh giới.
 *
 * ⚠️ **Private key tuyệt đối không ở đây**: `listByProvider` trả
 * `ProviderCredentialRecord` — record giữ `credentialCiphertext` (đã mã hoá) và `publicKey`,
 * không có plaintext. Projection bên dưới chỉ lấy hai field an toàn, nên ngay cả khi ai đó
 * thêm field vào record thì view trả ra vẫn là tập đóng `{vapidKeyId, publicKey, status}`.
 */
export async function listVapidPublicKeys(
  deps: AdminDeps,
  input: { readonly app: string; readonly providerId: string },
): Promise<AdminResult<readonly VapidPublicKeyView[]>> {
  const provider = await deps.ports.providers.findById(input.providerId);
  if (provider === null || provider.app !== input.app) {
    return {
      ok: false,
      reason: ADMIN_REJECTION.ProviderNotFound,
      detail: 'Provider không tồn tại trong app này.',
    };
  }
  const credentials = await deps.ports.providerCredentials.listByProvider(
    input.app,
    input.providerId,
  );
  return {
    ok: true,
    value: credentials.map((credential) => ({
      vapidKeyId: credential.vapidKeyId,
      publicKey: credential.publicKey,
      status: credential.status,
    })),
  };
}
