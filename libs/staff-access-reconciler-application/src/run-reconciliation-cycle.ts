import type { OutboxReconcileRepository } from './outbox-reconcile-repository';

export interface ReconciliationCycleDeps {
  readonly outbox: OutboxReconcileRepository;
  /** Tuổi tối đa của `published_at` trước khi row bị coi là stale (ms). */
  readonly staleAfterMs: number;
  /** Trần số row một lượt quét. */
  readonly limit: number;
  /** Clock injection cho test — production dùng `Date.now()`. */
  readonly clock?: { now(): number };
}

export interface ReconciliationCycleResult {
  readonly stalePublished: number;
  readonly limit: number;
  readonly staleAfterMs: number;
  readonly staleEventIds: readonly string[];
}

/**
 * Một lượt reconciliation: quét outbox đã publish quá ngưỡng, expose tín hiệu
 * điều tra (metric + log) — **không redrive** trong PR đầu.
 *
 * ⚠️ **Alert-only (issue #453).** Job này KHÔNG tự redrive nếu chưa có settle
 * path. Lý do: schema 0004 không có cột settle từ phía consumer — không có cách
 * biết row nào thực sự đã được consume, chỉ biết row đã được publish. Redrive
 * ngầm ở đây sẽ publish duplicate mà không có bằng chứng delivery thất bại thật.
 * Redrive vẫn là con đường vận hành đã có của relay (`replay(event_id)`, P2.2)
 * do operator gọi sau khi điều tra.
 *
 * ⚠️ **Ngưỡng `published_at` là proxy alert-only, không phải bằng chứng delivery
 * rớt.** Row cũ hơn ngưỡng có thể đã được consume bình thường — job chỉ phát
 * tín hiệu để điều tra, không kết luận. Khi cơ chế settle của ADR-0014 (cột
 * settle consumer-side) xuất hiện, thay proxy bằng điều kiện settle thật — đó
 * là PR sau, và khi đó mới có thể redrive có chọn lọc.
 *
 * ⚠️ **Không log payload body.** Kết quả chỉ mang `event_id`/`event_type`/tuổi
 * publish — envelope đã commit trong outbox là nguồn sự thật, không lọt ra log.
 *
 * ⚠️ **Không throw khi quét rỗng** — no-op thuần, cùng pattern relay.
 */
export async function runReconciliationCycle(
  deps: ReconciliationCycleDeps,
  nowMsOverride?: number,
): Promise<ReconciliationCycleResult> {
  const nowMs = nowMsOverride ?? deps.clock?.now() ?? Date.now();

  const stale = await deps.outbox.listStalePublished({
    nowMs,
    staleAfterMs: deps.staleAfterMs,
    limit: deps.limit,
  });

  return {
    stalePublished: stale.length,
    limit: deps.limit,
    staleAfterMs: deps.staleAfterMs,
    staleEventIds: stale.map((row) => row.event_id),
  };
}
