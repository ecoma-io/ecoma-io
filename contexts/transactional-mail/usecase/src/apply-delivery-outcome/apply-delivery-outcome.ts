/**
 * Use case ghi nhận outcome callback của delivery plane — orchestration thuần.
 *
 * Phân loại theo **thứ tự kiểm tra cố định** của §6.2.2 — không phụ thuộc thứ tự
 * callback đến (việc so sánh generation + trạng thái đã được domain aggregate
 * `MailMessage.applyOutcome` ghim; usecase chỉ đọc state hiện tại, gọi domain,
 * rồi persist conditional write):
 *
 * 1. không có delivery → `not-found`
 * 2. `dispatchGeneration` lệch → `stale` (kèm generation hiện tại để worker dừng vòng lặp)
 * 3. khớp và trạng thái đã bằng chính outcome đó → `duplicate`
 * 4. khớp và trạng thái ∈ {accepted, queued} → `applied`
 * 5. còn lại → `stale`
 *
 * ⚠️ `stale` KHÔNG phải success: worker đánh dấu report `superseded` và không retry.
 * Callback không bao giờ lùi trạng thái hay ghi đè outcome của generation mới hơn —
 * predicate chống lùi nằm trong conditional write của port.
 */

import type { Command } from '@ecoma-io/usecase-primitives';

import type { DeliveryId, MailErrorClass, MailOutcome } from '@ecoma-io/transactional-mail-domain';

import type { MailMessageStateReaderPort } from '../ports/message-state-reader.js';

export interface ApplyMailDeliveryOutcomeInput {
  readonly deliveryId: DeliveryId;
  readonly outcome: MailOutcome;
  /** Bắt buộc — không có đường nào suy nó ra từ `deliveryId`; đó chính là fencing. */
  readonly dispatchGeneration: number;
  /** Đã validate theo đúng năm giá trị canonical, hoặc `null`. */
  readonly errorClass: MailErrorClass | null;
  readonly nowMs: number;
}

/**
 * Kết quả phân loại — tường minh, caller (transport) map ra HTTP status:
 * `applied`/`duplicate` → 200, `stale` → 200 kèm cờ superseded, `not-found` → 404.
 */
export type ApplyMailDeliveryOutcomeResult =
  | { readonly result: 'not-found' }
  | { readonly result: 'applied' | 'duplicate'; readonly status: string }
  | {
      readonly result: 'stale';
      readonly status: string;
      readonly currentDispatchGeneration: number;
    };

/** Deps inject. */
export interface ApplyMailDeliveryOutcomeDeps {
  readonly stateReader: MailMessageStateReaderPort;
}

export class ApplyMailDeliveryOutcomeUseCase implements Command<
  ApplyMailDeliveryOutcomeInput,
  ApplyMailDeliveryOutcomeResult
> {
  readonly #deps: ApplyMailDeliveryOutcomeDeps;

  public constructor(deps: ApplyMailDeliveryOutcomeDeps) {
    this.#deps = deps;
  }

  public async execute(
    input: ApplyMailDeliveryOutcomeInput,
  ): Promise<ApplyMailDeliveryOutcomeResult> {
    if (!Number.isSafeInteger(input.dispatchGeneration) || input.dispatchGeneration < 1) {
      return { result: 'not-found' };
    }
    const current = await this.#deps.stateReader.findStateByDeliveryId(input.deliveryId);
    if (current === null) {
      return { result: 'not-found' };
    }
    // Fencing — generation lệch là stale, không ghi gì.
    if (current.dispatchGeneration !== input.dispatchGeneration) {
      return {
        result: 'stale',
        status: current.status,
        currentDispatchGeneration: current.dispatchGeneration,
      };
    }
    // Duplicate — cùng outcome trên cùng generation là no-op.
    if (current.status === input.outcome) {
      return { result: 'duplicate', status: current.status };
    }
    // Chỉ accepted/queued nhận outcome — predicate chống lùi trạng thái nằm cả ở
    // đây lẫn trong conditional write của port (hai lớp cùng chặn, phòng một lớp hỏng).
    if (current.status !== 'accepted' && current.status !== 'queued') {
      return {
        result: 'stale',
        status: current.status,
        currentDispatchGeneration: current.dispatchGeneration,
      };
    }
    const applied = await this.#deps.stateReader.applyOutcome(input);
    if (!applied) {
      // Race: bên khác đã ghi giữa read và write. Phân loại lại là stale — an toàn
      // hơn theo hướng không bao giờ `applied` giả (conditional write là nguồn thật).
      return {
        result: 'stale',
        status: current.status,
        currentDispatchGeneration: current.dispatchGeneration,
      };
    }
    return { result: 'applied', status: input.outcome };
  }
}

// Xác minh kiểu (type-level): use case bắt buộc tuân thủ Command primitive.
export type ApplyMailDeliveryOutcomeTypeCheck =
  ApplyMailDeliveryOutcomeUseCase extends Command<
    ApplyMailDeliveryOutcomeInput,
    ApplyMailDeliveryOutcomeResult
  >
    ? true
    : false;
