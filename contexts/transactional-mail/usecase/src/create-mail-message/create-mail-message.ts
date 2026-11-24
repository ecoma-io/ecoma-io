/**
 * Use case tạo mail message — orchestration thuần, không HTTP, không log (trừ alert
 * qua port `logAlert`).
 *
 * Thứ tự bảy bước là **hệ quả của tài liệu** (FR-001, §6.1), không phải lựa chọn
 * triển khai:
 *
 * 1. Chuẩn hoá `recipient` + `locale` + kiểm shape `variables` — trước rate limit:
 *    request không hợp lệ không được tiêu slot của bất kỳ ai.
 * 2. **Lookup trước**: replay (khớp fingerprint) → trả kết quả gốc, KHÔNG rate limit,
 *    KHÔNG render, KHÔNG tra template — replay là không ghi gì nên không được trả
 *    "bị giới hạn tần suất" (§6.3).
 * 3. Rate limit `principal` rồi `system` — principal bị từ chối trước system để một
 *    principal bị giới hạn không tiêu slot hệ thống.
 * 4. Chọn template version: `(name, locale)`, fallback `defaultLocale` một lần,
 *    version cao nhất thắng (§6.2).
 * 5. Parse schema → validate `variables` theo schema → render → đo payload (byte UTF-8).
 * 6. `createWithOutbox`; `already-exists` (request đồng thời thắng unique index) →
 *    đọc lại rồi so fingerprint với **row vừa đọc**, không stale read, không đệ quy.
 *
 * ⚠️ Module này KHÔNG đưa `recipient`/`variables`/tên template vào kết quả lỗi —
 * những thứ đó nhạy cảm (FR-007), và một error message free-form là đường rò của nó.
 */

import type { Command } from '@ecoma-io/usecase-primitives';

import { normalizeLocale, normalizeRecipient } from '@ecoma-io/transactional-mail-domain';

import { renderMail } from '../mail-render.js';
import { parseTemplateSchema, validateVariablesAgainstSchema } from '../template-schema.js';
import type {
  AuthenticatedPrincipal,
  MailMessageRepositoryPort,
  MailRateLimitPolicy,
  MailRateLimitStorePort,
  MailTemplateRepositoryPort,
} from '../ports/index.js';

/** Cấu hình do caller (HTTP layer) quyết định — mọi giá trị tường minh, không hard-code. */
export interface CreateMailMessageConfig {
  readonly rateLimitPrincipal: MailRateLimitPolicy;
  readonly rateLimitSystem: MailRateLimitPolicy;
  readonly rateLimitIdempotencyKey: MailRateLimitPolicy;
  /** Keyring fingerprint: tag của profile ký row mới + khoá hex của mọi profile còn verify được. */
  readonly fingerprintKeyring: {
    readonly currentProfile: string;
    readonly keysByProfile: ReadonlyMap<string, string>;
  };
  readonly defaultLocale: string;
  /** Ngưỡng payload render, byte UTF-8. */
  readonly maxRenderBytes: number;
  readonly nowMs: number;
  /** Id do caller sinh — tiền tố `msg_`/`obx_`/`dlv_` thuộc trách nhiệm tầng trên. */
  readonly messageId: string;
  readonly outboxId: string;
  readonly deliveryId: string;
  /** Principal do server kiểm soát — không bao giờ lấy từ body. */
  readonly principal: AuthenticatedPrincipal;
  readonly idempotencyKey: string;
  readonly request: {
    readonly template: string;
    readonly recipient: string;
    readonly locale?: string;
    readonly variables?: Record<string, unknown>;
    readonly correlationId?: string | null;
  };
}

/**
 * Kết quả của use case — đã phân loại theo mã lỗi public của FR-001.
 * Không nhánh nào mang giá trị bị từ chối (recipient, variables...).
 */
export type CreateMailMessageResult =
  | { readonly kind: 'created' }
  | { readonly kind: 'replay' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'template-not-found' }
  | {
      readonly kind: 'invalid';
      readonly field: 'recipient' | 'locale' | 'variables' | 'idempotency_key';
    }
  | { readonly kind: 'broken-schema' }
  | { readonly kind: 'unrenderable' }
  | { readonly kind: 'payload-too-large' }
  /**
   * Fail-closed: một row idempotency đã lưu mà KHÔNG verify được — tag không parse
   * được hay tag không còn trong keyring. KHÔNG phải `conflict`: trạng thái keyring,
   * không phải payload sai của caller.
   */
  | { readonly kind: 'service-unavailable' };

/** Alert probe `409` lặp trên cùng một key — token-hoá, không mang key gốc. */
export interface MailIdempotencyProbeAlert {
  readonly event: 'idempotency-fingerprint-mismatch';
  readonly principalId: string;
  readonly idempotencyKeyHash: string;
  readonly mismatchCount: number;
}

/** Nơi phát alert — chỉ nhận token đã sanitize. */
export type MailIdempotencyProbeAlertSink = (event: MailIdempotencyProbeAlert) => void;

/** Deps inject — mọi side effect đi qua port. */
export interface CreateMailMessageDeps {
  readonly messages: MailMessageRepositoryPort;
  readonly templates: MailTemplateRepositoryPort;
  readonly rateLimits: MailRateLimitStorePort;
  /** Nơi phát alert — inject để test quan sát được; chỉ truyền token đã sanitize. */
  readonly logAlert: MailIdempotencyProbeAlertSink;
  /** Hàm HMAC có khoá của canonical request — inject vì crypto là I/O của platform. */
  readonly computeFingerprint: (input: {
    readonly keyHex: string;
    readonly template: string;
    readonly locale: string;
    readonly recipient: string;
    readonly variables: Record<string, unknown>;
  }) => Promise<string>;
  /** Hàm hash idempotency key (SHA-256 hex) cho scope counter — key gốc không vào storage. */
  readonly hashIdempotencyKey: (key: string) => Promise<string>;
}

/** Input type của Command — trừ deps, mọi tham số nằm trong `config`. */
export type CreateMailMessageInput = CreateMailMessageConfig;

export class CreateMailMessageUseCase implements Command<
  CreateMailMessageInput,
  CreateMailMessageResult
> {
  readonly #deps: CreateMailMessageDeps;

  public constructor(deps: CreateMailMessageDeps) {
    this.#deps = deps;
  }

  public async execute(input: CreateMailMessageInput): Promise<CreateMailMessageResult> {
    const request = input.request;
    // `{}` và "không truyền variables" là CÙNG MỘT request nghiệp vụ (§6.3).
    const variables = request.variables ?? {};

    // Bước 1 — chuẩn hoá + shape. Trước rate limit.
    const recipient = normalizeRecipient(request.recipient);
    if (!recipient.ok) {
      return { kind: 'invalid', field: 'recipient' };
    }
    const locale = normalizeLocale(request.locale);
    // Locale không truyền = dùng default — cùng ngữ nghĩa "không có biến" của variables (§6.3).
    if (!locale.ok && locale.reason !== 'empty') {
      return { kind: 'invalid', field: 'locale' };
    }
    const fallback = locale.ok ? locale : normalizeLocale(input.defaultLocale);
    if (!fallback.ok) {
      throw new Error('default locale must normalize');
    }
    const resolvedLocale = fallback.value;
    if (typeof request.template !== 'string' || request.template.length === 0) {
      return { kind: 'invalid', field: 'variables' };
    }
    if (input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128) {
      return { kind: 'invalid', field: 'idempotency_key' };
    }

    const currentKey = input.fingerprintKeyring.keysByProfile.get(
      input.fingerprintKeyring.currentProfile,
    );
    if (currentKey === undefined) {
      // Lỗi cấu hình keyring — fail-fast, không fallback (bất biến "không hash trần").
      throw new Error(
        `fingerprint keyring missing current profile "${input.fingerprintKeyring.currentProfile}"`,
      );
    }
    const fingerprint = await this.#deps.computeFingerprint({
      keyHex: currentKey,
      template: request.template,
      locale: resolvedLocale,
      recipient: recipient.value,
      variables,
    });

    // Bước 2 — lookup trước. Replay dưới rate limit: không tiêu slot cho việc đã xong.
    const existing = await this.#deps.messages.findByIdempotencyKey(
      input.principal.id,
      input.idempotencyKey,
    );
    if (existing !== null) {
      return this.#compareFingerprint(input, existing.requestFingerprint, {
        template: request.template,
        locale: resolvedLocale,
        recipient: recipient.value,
        variables,
      });
    }

    // Bước 3 — rate limit: principal trước system.
    const principalLimit = await this.#deps.rateLimits.tryConsume({
      scope: `principal:${input.principal.id}`,
      ...input.rateLimitPrincipal,
      nowMs: input.nowMs,
    });
    if (principalLimit.kind === 'denied') {
      return {
        kind: 'rate-limited',
        retryAfterMs: this.#retryAfterMs(
          principalLimit.windowStartedAtMs,
          input.rateLimitPrincipal,
          input.nowMs,
        ),
      };
    }
    const systemLimit = await this.#deps.rateLimits.tryConsume({
      scope: 'system',
      ...input.rateLimitSystem,
      nowMs: input.nowMs,
    });
    if (systemLimit.kind === 'denied') {
      return {
        kind: 'rate-limited',
        retryAfterMs: this.#retryAfterMs(
          systemLimit.windowStartedAtMs,
          input.rateLimitSystem,
          input.nowMs,
        ),
      };
    }

    // Bước 4 — chọn template version, fallback locale một lần, version cao nhất thắng.
    let candidates = await this.#deps.templates.findActiveByNameAndLocale(
      request.template,
      resolvedLocale,
    );
    if (candidates.length === 0 && resolvedLocale !== input.defaultLocale) {
      candidates = await this.#deps.templates.findActiveByNameAndLocale(
        request.template,
        input.defaultLocale,
      );
    }
    const template = candidates.reduce<(typeof candidates)[number] | null>(
      (best, candidate) => (best === null || candidate.version > best.version ? candidate : best),
      null,
    );
    if (template === null) {
      return { kind: 'template-not-found' };
    }

    // Bước 5 — schema, validation theo schema, render, ngưỡng payload.
    const schema = parseTemplateSchema(template.variablesSchemaJson);
    if (!schema.ok) {
      return { kind: 'broken-schema' };
    }
    const validated = validateVariablesAgainstSchema(schema.schema, variables);
    if (!validated.ok) {
      return { kind: 'invalid', field: 'variables' };
    }
    const rendered = renderMail({
      subjectTemplate: template.subjectTemplate,
      bodyTemplate: template.bodyTemplate,
      variables: validated.normalized,
    });
    if (!rendered.ok) {
      return { kind: 'invalid', field: 'variables' };
    }
    // Ngưỡng đo trên byte UTF-8, không phải UTF-16 code unit (payload tiếng Việt).
    const renderBytes =
      new TextEncoder().encode(rendered.subject).length +
      new TextEncoder().encode(rendered.body).length;
    if (renderBytes > input.maxRenderBytes) {
      return { kind: 'payload-too-large' };
    }

    // Bước 6 — ghi.
    const write = await this.#deps.messages.createWithOutbox({
      messageId: input.messageId,
      outboxId: input.outboxId,
      deliveryId: input.deliveryId,
      app: input.principal.app,
      principalId: input.principal.id,
      templateId: template.id,
      templateName: template.name,
      templateVersion: template.version,
      locale: template.locale,
      recipient: recipient.value,
      subjectRendered: rendered.subject,
      bodyRendered: rendered.body,
      idempotencyKey: input.idempotencyKey,
      // Persist dạng `<profileTag>:<digest>` — tag nhận diện khoá đã ký row cho replay
      // keyring-aware sau rotation (FR-002).
      requestFingerprint: `${input.fingerprintKeyring.currentProfile}:${fingerprint}`,
      correlationId: request.correlationId ?? null,
      nowMs: input.nowMs,
    });

    if (write.kind === 'created') {
      return { kind: 'created' };
    }

    // `already-exists`: request đồng thời đã thắng unique index. So với ROW VỪA ĐỌC —
    // so với giá trị đọc trước INSERT (stale read) là sai. Không đệ quy: unique index
    // giữ bất biến nên một lần đọc nữa không đổi kết quả.
    const winner = await this.#deps.messages.findByIdempotencyKey(
      input.principal.id,
      input.idempotencyKey,
    );
    if (winner === null) {
      // Không xảy ra với unique index — nhưng fail-closed thay vì trả 'created' giả.
      return { kind: 'service-unavailable' };
    }
    return this.#compareFingerprint(input, winner.requestFingerprint, {
      template: request.template,
      locale: resolvedLocale,
      recipient: recipient.value,
      variables,
    });
  }

  /**
   * So fingerprint: khớp → `replay` (trả nguyên kết quả cũ, KHÔNG re-render theo
   * version hiện tại); lệch → tiêu slot counter theo key + alert, rồi `conflict`.
   *
   * Keyring-aware: replay đọc tag từ tiền tố của row rồi verify bằng đúng khoá của
   * tag đó — sau rotation row cũ vẫn replay được bằng khoá cũ (FR-002). Tag lạ hay
   * giá trị hỏng → `service-unavailable`, KHÔNG `conflict`.
   */
  async #compareFingerprint(
    input: CreateMailMessageInput,
    stored: string,
    current: {
      readonly template: string;
      readonly locale: string;
      readonly recipient: string;
      readonly variables: Record<string, unknown>;
    },
  ): Promise<CreateMailMessageResult> {
    const separator = stored.indexOf(':');
    if (separator <= 0 || separator === stored.length - 1) {
      return { kind: 'service-unavailable' };
    }
    const storedTag = stored.slice(0, separator);
    const storedDigest = stored.slice(separator + 1);
    const keyHex = input.fingerprintKeyring.keysByProfile.get(storedTag);
    if (keyHex === undefined) {
      return { kind: 'service-unavailable' };
    }
    const recomputed = await this.#deps.computeFingerprint({
      keyHex,
      template: current.template,
      locale: current.locale,
      recipient: current.recipient,
      variables: current.variables,
    });
    if (recomputed === storedDigest) {
      return { kind: 'replay' };
    }

    // Lệch fingerprint — tiêu slot theo key (key gốc KHÔNG vào storage, chỉ hash),
    // phát alert token-hoá, rồi `conflict`.
    const keyHash = await this.#deps.hashIdempotencyKey(input.idempotencyKey);
    const consumed = await this.#deps.rateLimits.tryConsume({
      scope: `idempotency-key:${input.principal.id}:${keyHash}`,
      ...input.rateLimitIdempotencyKey,
      nowMs: input.nowMs,
    });
    this.#deps.logAlert({
      event: 'idempotency-fingerprint-mismatch',
      principalId: input.principal.id,
      idempotencyKeyHash: keyHash,
      mismatchCount: consumed.hits,
    });
    if (consumed.kind === 'denied') {
      return {
        kind: 'rate-limited',
        retryAfterMs: this.#retryAfterMs(
          consumed.windowStartedAtMs,
          input.rateLimitIdempotencyKey,
          input.nowMs,
        ),
      };
    }
    return { kind: 'conflict' };
  }

  /** `Retry-After` = thời điểm cửa sổ đóng trừ nowMs, max 0 — cùng mốc `nowMs` với port. */
  #retryAfterMs(windowStartedAtMs: number, policy: MailRateLimitPolicy, nowMs: number): number {
    return Math.max(0, windowStartedAtMs + policy.windowMs - nowMs);
  }
}

// Xác minh kiểu (type-level): use case bắt buộc tuân thủ Command primitive.
export type CreateMailMessageTypeCheck =
  CreateMailMessageUseCase extends Command<CreateMailMessageInput, CreateMailMessageResult>
    ? true
    : false;
