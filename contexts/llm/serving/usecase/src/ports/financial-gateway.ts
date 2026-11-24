/**
 * Port financial gateway — hydrate state tài chính + commit kết quả domain
 * TRONG MỘT persistence transaction (hợp đồng "Kịch bản A").
 *
 * Hợp đồng Kịch bản A — MỘT DB transaction cho cả ba store billing của một
 * tenant (QuotaLedger + FinancialGateway + ServingJournal cùng một database):
 * - Mọi persistence operation mà `work` thực hiện qua BẤT KỲ port nào trong
 *   thời gian transaction mở (quota reserve/settle/release, journal
 *   recordAdmission/recordFinalization, financial commit) PHẢI tham gia cùng
 *   DB transaction đó — không store nào được ghi ngoài nó.
 * - Atomicity: commit tất cả hoặc rollback tất cả — không tồn tại trạng thái
 *   một store đã ghi mà store kia chưa.
 * - Lý do: compensation phức tạp giữa các store bị loại bỏ; `convertEcToUc`
 *   hai pha tự atomic vì nằm trọn trong một transaction.
 *
 * Gateway tự giải quyết billing account id từ tenant, derive wallet id, đảm
 * bảo wallet row tồn tại (`ensureWalletRow`), rồi hydrate book, replay credit
 * grant còn thiếu, và truyền `LoadedFinancialState` (đã replay) vào `work`.
 * Transaction commit chỉ khi `work` resolve; ném → rollback.
 *
 * Replay credit grant (`creditGrant` cho grant `credited` chưa có transaction
 * trong ledger) là trách nhiệm gateway load — state trả về luôn đã replay xong,
 * và commit sẽ persist cả transaction replay. Book là aggregate thuần của
 * llm-financial-domain; usecase chỉ gọi operation qua lib rồi commit diff.
 */
import type { FinancialBook } from '@ecoma-io/llm-financial-domain';

/** State tài chính đã hydrate (wallet row đã đảm bảo, grants đã replay). */
export interface LoadedFinancialState {
  readonly book: FinancialBook;
  readonly walletFencingToken: string;
  /** Wallet id đã derive từ billing account; dùng cho reserve/settle/release. */
  readonly walletId: string;
  /** Billing account id của tenant (gateway giải quyết từ tenant). */
  readonly billingAccountId: string;
}

/** Persist mọi transaction lib mới post (diff theo transaction_id đã biết). */
export interface FinancialCommitInput {
  readonly book: FinancialBook;
  /** Transaction id đã nằm trong book load — chỉ transaction KHÁC được persist. */
  readonly knownTransactionIds: ReadonlySet<string>;
  /** Reservation state cần upsert (reserve/settle/release thay đổi nó). */
  readonly reservations: readonly import('@ecoma-io/llm-financial-domain').Reservation[];
  /** Charge mới post bởi settle — idempotent theo charge_id. */
  readonly charges: readonly import('@ecoma-io/llm-financial-domain').CustomerCharge[];
}

export interface FinancialGateway {
  /**
   * Mở transaction gateway, giải quyết billing account + wallet từ tenant,
   * đảm bảo wallet row, hydrate book + replay credit grant còn thiếu, rồi chạy
   * `work` với state đã replay. Commit chỉ khi `work` resolve; ném → rollback.
   *
   * Kịch bản A: trong suốt thời gian transaction mở, mọi persistence operation
   * mà `work` gọi qua bất kỳ port nào (QuotaLedger, ServingJournal) phải tham
   * gia cùng DB transaction này; commit tất cả hoặc rollback tất cả.
   */
  inTransaction<T>(
    input: { tenantId: string },
    work: (state: LoadedFinancialState) => Promise<T>,
  ): Promise<T>;
  /** Commit diff (transaction lib mới, reservation upsert, charge insert) trong transaction đang mở. */
  commit(input: FinancialCommitInput): Promise<void>;
}
