/**
 * ModelOffer — aggregate root của bounded context `llm-marketplace`.
 *
 * Vòng đời:
 *
 * ```
 * draft --activate--> active <--deactivate/activate--> inactive
 *   |                   |                                  |
 *   +-------------------+---------retire------------------+--> retired (terminal)
 * ```
 *
 * Quy tắc đã chốt cho lib này:
 * - `activate` chỉ hợp lệ từ `draft` hoặc `inactive`; gọi lại khi đang `active`
 *   trả `offer_already_active` — **không** im lặng thành công. Trạng thái là dữ
 *   liệu audit; một operation "thành công" mà không đổi gì sẽ che mất lỗi gọi
 *   lặp ở application layer.
 * - `deactivate` chỉ hợp lệ từ `active`; gọi lại khi đang `inactive` trả
 *   `offer_already_inactive`.
 * - `retire` hợp lệ từ mọi trạng thái chưa `retired`; `retired` là terminal và
 *   mọi operation làm đổi trạng thái sau đó trả `offer_retired`.
 * - `draft → inactive` không hợp lệ: offer chưa từng phục vụ thì không có nghĩa
 *   "đang tắt".
 * - Activation yêu cầu **đồng thời** verdict operational eligibility hợp lệ của
 *   đúng Seller tenant **và** ít nhất một endpoint pool `healthy` của chính
 *   offer. Marketplace không tự tính eligibility (ADR-0018 §3).
 *
 * Aggregate là class bất biến-mutable hỗn hợp: mutation method đổi state nội bộ
 * và trả `LlmMarketplaceDomainError | undefined` (pattern của `account-domain`);
 * mọi dữ liệu đi ra qua getter hoặc {@link ModelOffer.snapshot}. Guard thuần
 * (shape, capability, pool, eligibility verdict) nằm ở các module thuần còn lại
 * của lib và được aggregate gọi lại — aggregate không tái định nghĩa invariant.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';

import {
  llmMarketplaceDomainError,
  type LlmMarketplaceDomainError,
  type LlmMarketplaceDomainErrorCode,
} from '../shared/errors';
import {
  isEpochMillis,
  isModelOfferId,
  isSellerTenantId,
  llmMarketplaceFailure,
  llmMarketplaceOk,
  MAX_PUBLIC_ALIAS_LENGTH,
  type LlmMarketplaceResult,
  type ModelOfferId,
  type SellerTenantId,
} from '../shared/shared';
import { createCapabilitySet, isCapability, type CapabilitySet } from '../capability/capability';
import {
  isEndpointPool,
  evaluateOfferEndpointHealth,
  type EndpointPool,
} from '../endpoint/endpoint';
import {
  assertEligibilityForTenant,
  evaluateActivationEligibility,
  isSellerOperationalEligibility,
  type SellerOperationalEligibility,
} from '../eligibility/eligibility';
import { isNormalizedModelId as isNormalizedModelIdValue } from '../model-identity/model-identity';

/** Trạng thái của model offer. `retired` là terminal. */
export type ModelOfferStatus = 'draft' | 'active' | 'inactive' | 'retired';

/** Giá trị canonical của `ModelOfferStatus`. */
export const MODEL_OFFER_STATUS: Readonly<Record<ModelOfferStatus, ModelOfferStatus>> =
  Object.freeze({
    draft: 'draft',
    active: 'active',
    inactive: 'inactive',
    retired: 'retired',
  });

/** Type guard cho `ModelOfferStatus`. */
export function isModelOfferStatus(value: unknown): value is ModelOfferStatus {
  return value === 'draft' || value === 'active' || value === 'inactive' || value === 'retired';
}

/**
 * Public alias của offer.
 *
 * Là tên customer-visible. Cùng
 * hình dạng với normalized model id: lowercase, không khoảng trắng. Unique
 * trong phạm vi marketplace được kiểm ở biên ghi (`assertPublicAliasUnique`),
 * không phải bất biến của một offer đơn lẻ.
 */
export function isPublicAlias(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PUBLIC_ALIAS_LENGTH &&
    /^[a-z0-9][a-z0-9._-]*$/u.test(value)
  );
}

/**
 * Snapshot toàn trạng thái của `ModelOffer` — dạng serialize được giữa aggregate
 * và storage/contract. `capabilities` là mảng label đã canonical (tăng dần).
 */
export interface ModelOfferSnapshot {
  readonly id: ModelOfferId;
  readonly sellerTenantId: SellerTenantId;
  /** Normalized model identity — canonical cho dedup/group. */
  readonly normalizedModelId: string;
  readonly status: ModelOfferStatus;
  readonly publicAlias: string | null;
  readonly capabilities: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Thời điểm activation gần nhất; `null` khi chưa từng active. */
  readonly activatedAt: number | null;
  /** Thời điểm deactivate gần nhất; `null` khi chưa từng deactivate. */
  readonly deactivatedAt: number | null;
  readonly retiredAt: number | null;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isEpochMillis(value);
}

function canonicalCapabilities(capabilities: readonly string[]): boolean {
  if (capabilities.length === 0) {
    return false;
  }
  if (!capabilities.every(isCapability)) {
    return false;
  }
  if (new Set(capabilities).size !== capabilities.length) {
    return false;
  }
  return capabilities.every(
    (capability, index) => index === 0 || capabilities[index - 1] <= capability,
  );
}

/**
 * Shape guard cho `ModelOfferSnapshot` đọc từ storage/contract. Ngoài shape từng
 * field, guard kiểm tính **tự nhất quán** của snapshot: timestamp của sự kiện
 * không nằm ngoài khoảng đã ghi nhận, và mỗi trạng thái chỉ đi cùng đúng bộ mốc
 * sự kiện của nó (draft chưa từng phục vụ; inactive chỉ đến từ active; retired
 * phải có mốc retire).
 */
export function isModelOfferSnapshot(value: unknown): value is ModelOfferSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ModelOfferSnapshot, unknown>>;
  if (
    !isModelOfferId(candidate.id) ||
    !isSellerTenantId(candidate.sellerTenantId) ||
    !isNormalizedModelIdValue(candidate.normalizedModelId) ||
    !isModelOfferStatus(candidate.status) ||
    !Array.isArray(candidate.capabilities) ||
    !canonicalCapabilities(candidate.capabilities) ||
    !isEpochMillis(candidate.createdAt) ||
    !isEpochMillis(candidate.updatedAt) ||
    (candidate.updatedAt as number) < candidate.createdAt
  ) {
    return false;
  }
  if (!(candidate.publicAlias === null || isPublicAlias(candidate.publicAlias))) {
    return false;
  }
  if (
    !isNullableTimestamp(candidate.activatedAt) ||
    !isNullableTimestamp(candidate.deactivatedAt) ||
    !isNullableTimestamp(candidate.retiredAt)
  ) {
    return false;
  }
  // Timestamp của sự kiện không được nằm ngoài khoảng đã ghi nhận.
  if (
    (candidate.activatedAt !== null && candidate.activatedAt > candidate.updatedAt) ||
    (candidate.deactivatedAt !== null && candidate.deactivatedAt > candidate.updatedAt) ||
    (candidate.retiredAt !== null && candidate.retiredAt > candidate.updatedAt)
  ) {
    return false;
  }
  switch (candidate.status) {
    case 'draft':
      // Draft chưa từng phục vụ: không có mốc activation/deactivation/retire.
      return (
        candidate.activatedAt === null &&
        candidate.deactivatedAt === null &&
        candidate.retiredAt === null
      );
    case 'active':
      return candidate.activatedAt !== null && candidate.retiredAt === null;
    case 'inactive':
      // Inactive chỉ đến từ `active → inactive`.
      return (
        candidate.activatedAt !== null &&
        candidate.deactivatedAt !== null &&
        candidate.retiredAt === null
      );
    case 'retired':
      return candidate.retiredAt !== null;
    default:
      return false;
  }
}

/** Nhãn helper nội bộ: dựng error từ taxonomy, không mang dữ liệu call site. */
function failure(code: LlmMarketplaceDomainErrorCode): LlmMarketplaceDomainError {
  return llmMarketplaceDomainError(code);
}

export class ModelOffer extends AggregateRoot<ModelOfferId> {
  readonly #sellerTenantId: SellerTenantId;
  readonly #normalizedModelId: string;
  #status: ModelOfferStatus;
  #publicAlias: string | null;
  #capabilities: CapabilitySet;
  readonly #createdAt: number;
  #updatedAt: number;
  #activatedAt: number | null;
  #deactivatedAt: number | null;
  #retiredAt: number | null;

  private constructor(snapshot: {
    id: ModelOfferId;
    sellerTenantId: SellerTenantId;
    normalizedModelId: string;
    status: ModelOfferStatus;
    publicAlias: string | null;
    capabilities: CapabilitySet;
    createdAt: number;
    updatedAt: number;
    activatedAt: number | null;
    deactivatedAt: number | null;
    retiredAt: number | null;
  }) {
    super(snapshot.id);
    this.#sellerTenantId = snapshot.sellerTenantId;
    this.#normalizedModelId = snapshot.normalizedModelId;
    this.#status = snapshot.status;
    this.#publicAlias = snapshot.publicAlias;
    this.#capabilities = snapshot.capabilities;
    this.#createdAt = snapshot.createdAt;
    this.#updatedAt = snapshot.updatedAt;
    this.#activatedAt = snapshot.activatedAt;
    this.#deactivatedAt = snapshot.deactivatedAt;
    this.#retiredAt = snapshot.retiredAt;
  }

  /**
   * Tạo model offer ở trạng thái `draft`.
   *
   * Guard:
   * - `id`, `sellerTenantId`, `createdAt` hợp lệ.
   * - `normalizedModelId` hợp lệ (lowercase canonical).
   * - `capabilities` qua `createCapabilitySet` (không rỗng, không trùng).
   * - `publicAlias` (nếu cấp) qua `isPublicAlias` và chưa được offer nào khác
   *   dùng (`invalid_public_alias` khi trùng).
   * - `existing` (nếu cấp) mọi phần tử là `ModelOffer`, không trùng `id`.
   *
   * @throws TypeError khi input vi phạm guard — aggregate không trả result cho
   * đường sinh, sai dữ liệu tạo là lỗi lập trình ở caller.
   */
  public static issue(args: {
    id: ModelOfferId;
    sellerTenantId: SellerTenantId;
    normalizedModelId: string;
    capabilities: unknown;
    publicAlias?: unknown;
    createdAt: number;
    /** Offer đã có — dùng cho guard trùng `id` và alias. */
    existing?: readonly ModelOffer[];
  }): ModelOffer {
    if (!isModelOfferId(args.id)) {
      throw new TypeError('ModelOffer.issue: model offer ID is not valid.');
    }
    if (!isSellerTenantId(args.sellerTenantId)) {
      throw new TypeError('ModelOffer.issue: seller tenant ID is not valid.');
    }
    if (!isNormalizedModelIdValue(args.normalizedModelId)) {
      throw new TypeError('ModelOffer.issue: normalized model ID is not valid.');
    }
    if (!isEpochMillis(args.createdAt)) {
      throw new TypeError('ModelOffer.issue: timestamp is not a valid epoch millisecond value.');
    }
    const capabilities = createCapabilitySet(args.capabilities);
    if (!capabilities.ok) {
      throw new TypeError(`ModelOffer.issue: ${capabilities.error.message}`);
    }
    const publicAlias = args.publicAlias ?? null;
    if (publicAlias !== null && !isPublicAlias(publicAlias)) {
      throw new TypeError('ModelOffer.issue: public alias is not valid.');
    }
    const existing = args.existing ?? [];
    if (!Array.isArray(existing)) {
      throw new TypeError('ModelOffer.issue: the domain context is ambiguous.');
    }
    if (!existing.every((offer) => offer instanceof ModelOffer)) {
      throw new TypeError('ModelOffer.issue: the existing offer record is not valid.');
    }
    if (existing.some((offer) => offer.id === args.id)) {
      throw new TypeError('ModelOffer.issue: the model offer ID is duplicated.');
    }
    if (publicAlias !== null) {
      for (const offer of existing) {
        if (
          offer.id !== args.id &&
          offer.#publicAlias !== null &&
          offer.#publicAlias === publicAlias
        ) {
          throw new TypeError('ModelOffer.issue: public alias is not valid.');
        }
      }
    }
    return new ModelOffer({
      id: args.id,
      sellerTenantId: args.sellerTenantId,
      normalizedModelId: args.normalizedModelId,
      status: 'draft',
      publicAlias,
      capabilities: capabilities.value,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      activatedAt: null,
      deactivatedAt: null,
      retiredAt: null,
    });
  }

  /**
   * Tái lập aggregate từ snapshot đã lưu.
   *
   * Guard: snapshot qua {@link isModelOfferSnapshot} — một snapshot không tự nhất
   * quán (status lệch bộ mốc sự kiện, capability không canonical) là dữ liệu hỏng
   * và bị từ chối, không âm thầm sửa.
   *
   * @throws TypeError khi snapshot không hợp lệ.
   */
  public static reconstitute(snapshot: ModelOfferSnapshot): ModelOffer {
    if (!isModelOfferSnapshot(snapshot)) {
      throw new TypeError('ModelOffer snapshot is not valid.');
    }
    const capabilities = createCapabilitySet(snapshot.capabilities);
    if (!capabilities.ok) {
      throw new TypeError('ModelOffer snapshot is not valid.');
    }
    return new ModelOffer({
      ...snapshot,
      capabilities: capabilities.value,
    });
  }

  /** Toàn bộ trạng thái hiện tại dưới dạng snapshot serialize được. */
  public snapshot(): ModelOfferSnapshot {
    return Object.freeze({
      id: this.id,
      sellerTenantId: this.#sellerTenantId,
      normalizedModelId: this.#normalizedModelId,
      status: this.#status,
      publicAlias: this.#publicAlias,
      capabilities: Object.freeze([...this.#capabilities.capabilities]),
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      activatedAt: this.#activatedAt,
      deactivatedAt: this.#deactivatedAt,
      retiredAt: this.#retiredAt,
    });
  }

  public sellerTenantId(): SellerTenantId {
    return this.#sellerTenantId;
  }

  public normalizedModelId(): string {
    return this.#normalizedModelId;
  }

  public status(): ModelOfferStatus {
    return this.#status;
  }

  public publicAlias(): string | null {
    return this.#publicAlias;
  }

  /** Tập capability hiện tại — bản đã canonical, không mutate được từ ngoài. */
  public capabilities(): CapabilitySet {
    return this.#capabilities;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public updatedAt(): number {
    return this.#updatedAt;
  }

  public activatedAt(): number | null {
    return this.#activatedAt;
  }

  public deactivatedAt(): number | null {
    return this.#deactivatedAt;
  }

  public retiredAt(): number | null {
    return this.#retiredAt;
  }

  /**
   * Gán hoặc đổi public alias.
   *
   * Chỉ hợp lệ khi offer còn `draft`: alias là tên customer-visible, nên đổi nó
   * sau khi offer đã phục vụ sẽ làm hỏng consumer đang gọi theo tên cũ. Sau
   * activation, thao tác trả `public_alias_immutable`.
   *
   * Guard thêm: alias hợp lệ, chưa được offer khác dùng, `assignedAt >=
   * offer.updatedAt`.
   */
  public assignPublicAlias(args: {
    publicAlias: unknown;
    assignedAt: number;
    /** Offer khác trong marketplace — dùng cho guard unique alias. */
    existing?: readonly ModelOffer[];
  }): LlmMarketplaceDomainError | undefined {
    if (!isPublicAlias(args.publicAlias)) {
      return failure('invalid_public_alias');
    }
    if (!isEpochMillis(args.assignedAt)) {
      return failure('invalid_timestamp');
    }
    if (this.#status === 'retired') {
      return failure('offer_retired');
    }
    if (this.#status !== 'draft') {
      return failure('public_alias_immutable');
    }
    if (args.assignedAt < this.#updatedAt) {
      return failure('timestamp_regression');
    }
    const existing = args.existing ?? [];
    if (!Array.isArray(existing)) {
      return failure('ambiguous_context');
    }
    if (!existing.every((offer) => offer instanceof ModelOffer)) {
      return failure('invalid_model_offer');
    }
    if (
      existing.some(
        (offer) =>
          offer.id !== this.id &&
          offer.#publicAlias !== null &&
          offer.#publicAlias === args.publicAlias,
      )
    ) {
      return failure('invalid_public_alias');
    }
    this.#publicAlias = args.publicAlias;
    this.#updatedAt = args.assignedAt;
    return undefined;
  }

  /**
   * Thay tập capability.
   *
   * Chỉ hợp lệ khi offer chưa `retired` (`offer_retired`). Offer đang `active`
   * được phép đổi capability: capability là dữ liệu filter, không phải cam kết
   * hợp đồng, và một capability bị gỡ không làm offer ngừng phục vụ các request
   * không yêu cầu nó. Guard: tập mới hợp lệ, `updatedAt >= offer.updatedAt`.
   */
  public replaceCapabilities(args: {
    capabilities: unknown;
    updatedAt: number;
  }): LlmMarketplaceDomainError | undefined {
    if (!isEpochMillis(args.updatedAt)) {
      return failure('invalid_timestamp');
    }
    if (this.#status === 'retired') {
      return failure('offer_retired');
    }
    if (args.updatedAt < this.#updatedAt) {
      return failure('timestamp_regression');
    }
    const capabilities = createCapabilitySet(args.capabilities);
    if (!capabilities.ok) {
      return capabilities.error;
    }
    this.#capabilities = capabilities.value;
    this.#updatedAt = args.updatedAt;
    return undefined;
  }

  /**
   * Activate offer (`draft | inactive → active`).
   *
   * Guard, theo thứ tự (fail closed):
   * 1. `activatedAt` hợp lệ và không lùi so với `offer.updatedAt`.
   * 2. `retired` ⇒ `offer_retired`; `active` ⇒ `offer_already_active`;
   *    `draft`/`inactive` được tiếp tục.
   * 3. Verdict hợp lệ và **đúng** `sellerTenantId` — shape hỏng ⇒
   *    `invalid_eligibility_verdict`, lệch tenant ⇒ `eligibility_tenant_mismatch`.
   * 4. Verdict `eligible`, không blocker và không cũ hơn `offer.createdAt` —
   *    ngược lại `seller_not_eligible`.
   * 5. `pools` không rỗng, mọi pool hợp lệ và thuộc đúng offer (lệch ⇒
   *    `pool_offer_mismatch`), và có ít nhất một pool `healthy` — ngược lại
   *    `endpoint_pool_not_healthy` (hoặc `endpoint_pool_missing` khi rỗng).
   *
   * Activation không idempotent: gọi lại trên offer đang active là lỗi domain.
   */
  public activate(args: {
    /** Verdict từ `llm-seller-governance` — marketplace chỉ tiêu thụ. */
    eligibility: SellerOperationalEligibility;
    /** Toàn bộ endpoint pool của offer tại thời điểm activation. */
    pools: readonly EndpointPool[];
    activatedAt: unknown;
  }): LlmMarketplaceDomainError | undefined {
    if (!isEpochMillis(args.activatedAt)) {
      return failure('invalid_timestamp');
    }
    if (this.#status === 'retired') {
      return failure('offer_retired');
    }
    if (this.#status === 'active') {
      return failure('offer_already_active');
    }
    if (args.activatedAt < this.#updatedAt) {
      return failure('timestamp_regression');
    }
    if (!isSellerOperationalEligibility(args.eligibility)) {
      return failure('invalid_eligibility_verdict');
    }
    const verdictCheck = assertEligibilityForTenant(args.eligibility, this.#sellerTenantId);
    if (!verdictCheck.ok) {
      return verdictCheck.error;
    }
    const eligibility = evaluateActivationEligibility(
      verdictCheck.value,
      this.#sellerTenantId,
      this.#createdAt,
    );
    if (!eligibility.eligible) {
      return failure('seller_not_eligible');
    }
    const health = evaluateOfferEndpointHealth(this.id, args.pools);
    if (!health.ok) {
      return health.error;
    }
    if (!health.value.hasHealthyPool) {
      return failure('endpoint_pool_not_healthy');
    }
    this.#status = 'active';
    this.#activatedAt = args.activatedAt;
    this.#updatedAt = args.activatedAt;
    return undefined;
  }

  /**
   * Deactivate offer (`active → inactive`).
   *
   * Guard: `deactivatedAt` hợp lệ và không lùi; offer `retired` ⇒ `offer_retired`;
   * offer không `active` ⇒ `offer_already_inactive` khi đang `inactive`, còn
   * `draft` ⇒ `invalid_offer_transition`.
   */
  public deactivate(args: { deactivatedAt: unknown }): LlmMarketplaceDomainError | undefined {
    if (!isEpochMillis(args.deactivatedAt)) {
      return failure('invalid_timestamp');
    }
    if (this.#status === 'retired') {
      return failure('offer_retired');
    }
    if (this.#status === 'inactive') {
      return failure('offer_already_inactive');
    }
    if (this.#status !== 'active') {
      return failure('invalid_offer_transition');
    }
    if (args.deactivatedAt < this.#updatedAt) {
      return failure('timestamp_regression');
    }
    this.#status = 'inactive';
    this.#deactivatedAt = args.deactivatedAt;
    this.#updatedAt = args.deactivatedAt;
    return undefined;
  }

  /**
   * Retire offer — terminal từ mọi trạng thái chưa `retired`.
   *
   * Guard: `retiredAt` hợp lệ và không lùi; offer đã `retired` ⇒ `offer_retired`.
   * Không có operation nào đưa offer ra khỏi `retired`.
   */
  public retire(args: { retiredAt: unknown }): LlmMarketplaceDomainError | undefined {
    if (!isEpochMillis(args.retiredAt)) {
      return failure('invalid_timestamp');
    }
    if (this.#status === 'retired') {
      return failure('offer_retired');
    }
    if (args.retiredAt < this.#updatedAt) {
      return failure('timestamp_regression');
    }
    this.#status = 'retired';
    this.#retiredAt = args.retiredAt;
    this.#updatedAt = args.retiredAt;
    return undefined;
  }
}

/**
 * Khẳng định public alias chưa được offer **khác** dùng.
 *
 * Tách khỏi aggregate để adapter dùng ở biên ghi khi hai thao tác chạy trong hai
 * transaction khác nhau.
 */
export function assertPublicAliasUnique(
  alias: unknown,
  existing: readonly ModelOffer[],
  selfId?: ModelOfferId,
): LlmMarketplaceResult<string> {
  if (!isPublicAlias(alias)) {
    return llmMarketplaceFailure('invalid_public_alias');
  }
  if (!Array.isArray(existing) || !existing.every((offer) => offer instanceof ModelOffer)) {
    return llmMarketplaceFailure('invalid_model_offer');
  }
  if (
    existing.some(
      (offer) =>
        offer.id !== selfId && offer.publicAlias() !== null && offer.publicAlias() === alias,
    )
  ) {
    return llmMarketplaceFailure('invalid_public_alias');
  }
  return llmMarketplaceOk(alias);
}

/**
 * Offer có đang phục vụ customer không: `active` **và** còn pool healthy.
 *
 * Đây là view thuần; caller phải truyền đúng tập pool của offer. Pool lệch
 * offer trả `false` (fail closed) thay vì tính tiếp trên dữ liệu sai.
 */
export function isModelOfferServing(offer: ModelOffer, pools: readonly EndpointPool[]): boolean {
  if (!(offer instanceof ModelOffer) || offer.status() !== 'active') {
    return false;
  }
  if (!Array.isArray(pools) || !pools.every(isEndpointPool)) {
    return false;
  }
  if (pools.some((pool) => pool.offerId !== offer.id)) {
    return false;
  }
  const health = evaluateOfferEndpointHealth(offer.id, pools);
  return health.ok && health.value.serving;
}

/** Tên trạng thái đích của một activation hợp lệ — dùng cho test/đọc hiểu. */
export const MODEL_OFFER_ACTIVATABLE_STATUSES: readonly ModelOfferStatus[] = Object.freeze([
  'draft',
  'inactive',
]);
