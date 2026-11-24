/**
 * `@ecoma-io/llm-financial-domain` — tầng domain thuần của bounded context
 * `llm-financial`: billing account/wallet, double-entry ledger, reservation,
 * settlement, seller payable, conversion, hold, budget escrow/lease,
 * reconciliation, financial audit và sponsor funding (ADR-0028).
 *
 * Thuần khiết:
 * - **Không** import Nx project khác (kể cả `llm-seller-pricing-domain`).
 * - **Không** SQL, **Không** Node builtin, **Không** I/O.
 * - Mọi tham số thời gian do caller truyền vào; domain không đọc đồng hồ.
 * - Không provider SDK, không HTTP client, không DB driver, không ORM.
 * - Không payment gateway, không microservice, không persistence.
 *
 * ## Không thuộc lib này (bắt buộc ghi rõ)
 *
 * - **Provider cost** — ownership còn **OPEN** (OB-7).
 *   Không có account, ledger entry, payable hay type nào ở đây đại diện cho chi
 *   phí provider. Provider usage (`llm-usage`) ≠ provider cost ≠ seller payable.
 * - **Payout execution** — `payout`/`payment` sở hữu việc chi tiền. Lib chỉ giữ
 *   `payout_evidence_ref` opaque và từ chối `paid` khi thiếu evidence.
 * - **Fiat payment** — deposit chỉ nhận `payment_reference` opaque; lib không
 *   khởi tạo hay xác nhận giao dịch thanh toán.
 * - **Tax calculation / withholding rate** — ADR-0008 để rate OPEN; lib không
 *   có hàm tính thuế và không có state `tax withheld`.
 * - **Customer price / pricing policy** — `llm-seller-pricing` sở hữu; settlement nhận
 *   `chargeAmount` và `seller` share do caller cung cấp.
 *
 * ## Ràng buộc chưa chốt — không âm thầm chốt trong lib này
 *
 * - **Conversion ratio và fee**: ADR-0005/ADR-0006 để OPEN. `convertEcToUc` nhận
 *   `ratio` do caller cấp, đòi kết quả nguyên chính xác, không có default 1:1 và
 *   không áp fee.
 * - **Provider cost ownership**: OPEN. Không có API nào ở đây nhận hay trả
 *   provider cost.
 * - **Tax withholding**: OPEN. Payout chỉ xảy ra khi caller cấp evidence.
 * - **Overdraft**: ADR-0004 loại trừ âm balance; lib không có cờ overdraft.
 */

export {
  LLM_FINANCIAL_DOMAIN_ERROR_MESSAGES,
  type LlmFinancialDomainError,
  type LlmFinancialDomainErrorCode,
  llmFinancialDomainError,
  isLlmFinancialDomainError,
} from './shared/errors';

export {
  type FinancialOk,
  type FinancialFailure,
  type FinancialResult,
  financialOk,
  financialFailure,
  MAX_OPAQUE_ID_LENGTH,
  isOpaqueId,
  isEpochMillis,
  isRecord,
  freezeArray,
  type BillingAccountId,
  type WalletId,
  type DepositId,
  type ReservationId,
  type SettlementId,
  type ChargeId,
  type RefundId,
  type PayableId,
  type ConversionId,
  type LedgerTransactionId,
  type LedgerEntryId,
  type FencingToken,
  type IdempotencyKey,
  type AccountOwnerRef,
  type TenantRef,
  type ActorRef,
  type PayoutEvidenceRef,
  isBillingAccountId,
  isWalletId,
  isDepositId,
  isReservationId,
  isSettlementId,
  isChargeId,
  isRefundId,
  isPayableId,
  isConversionId,
  isLedgerTransactionId,
  isLedgerEntryId,
  isFencingToken,
  isIdempotencyKey,
  isAccountOwnerRef,
  isTenantRef,
  isActorRef,
  isPayoutEvidenceRef,
  createBillingAccountId,
  createWalletId,
  createDepositId,
  createReservationId,
  createSettlementId,
  createChargeId,
  createRefundId,
  createPayableId,
  createConversionId,
  createLedgerTransactionId,
  createLedgerEntryId,
  createFencingToken,
  createIdempotencyKey,
  createAccountOwnerRef,
  createTenantRef,
  createActorRef,
  createPayoutEvidenceRef,
} from './shared/shared';

export {
  DENOMINATIONS,
  type Denomination,
  isDenomination,
  LEDGER_UNIT,
  MAX_MONEY_MAGNITUDE,
  type Money,
  type UcAmount,
  type EcAmount,
  readMoney,
  createMoney,
  zeroMoney,
  isMoney,
  addMoney,
  subtractMoney,
  compareMoney,
  isZeroMoney,
  sumMoney,
} from './money/money';

export {
  LEDGER_ACCOUNTS,
  type LedgerAccount,
  isLedgerAccount,
  LEDGER_DIRECTIONS,
  type LedgerDirection,
  isLedgerDirection,
  LEDGER_REFERENCE_TYPES,
  type LedgerReferenceType,
  isLedgerReferenceType,
  type LedgerReference,
  isLedgerReference,
  type LedgerLeg,
  type LedgerEntry,
  isLedgerEntry,
  type LedgerTransaction,
  isLedgerTransaction,
  type Ledger,
  createLedger,
  type CreateLedgerTransactionInput,
  createLedgerTransaction,
  type PostTransactionOutcome,
  postTransaction,
  isLedger,
  deriveWalletBalances,
  emptyBalances,
} from './ledger/ledger';

export {
  type WalletBalances,
  DEPOSIT_STATES,
  type DepositState,
  isDepositState,
  type Deposit,
  type Wallet,
  type BillingAccount,
  createWalletBalances,
  isWalletBalances,
  createWallet,
  isWallet,
  createBillingAccount,
  isBillingAccount,
  findWallet,
  findWalletByDenomination,
  replaceWallet,
  attachWallet,
  checkWalletInvariant,
  WalletAggregate,
} from './wallet/wallet';

export {
  type FinancialBook,
  openFinancialBook,
  addBillingAccount,
  findBillingAccount,
  locateWallet,
  replaceWalletInBook,
  type RequestedLeg,
  derivedTransactionId,
  derivedIdempotencyKey,
  type CommitTransactionInput,
  type CommitTransactionOutcome,
  commitTransaction,
  withLedger,
} from './book/book';

export {
  RESERVATION_STATES,
  type ReservationState,
  isReservationState,
  type Reservation,
  isReservation,
} from './reservation/reservation-record';

export {
  CHARGE_STATES,
  type ChargeState,
  isChargeState,
  type CustomerCharge,
  isCustomerCharge,
  refundableAmount,
  type Refund,
  isRefund,
  type AdjustmentDirection,
  isAdjustmentDirection,
  type ChargeAdjustment,
  isChargeAdjustment,
} from './charge/charge-record';

export {
  PAYABLE_STATES,
  type PayableState,
  isPayableState,
  type SellerPayable,
  isSellerPayable,
  latestPayable,
} from './payable/payable-record';

export {
  HOLD_SCOPES,
  type HoldScope,
  isHoldScope,
  type FinancialHold,
  isFinancialHold,
  isHoldActive,
  hasBlockingHold,
} from './hold/hold-record';

export {
  LEASE_STATES,
  type LeaseState,
  isLeaseState,
  type BudgetLease,
  isBudgetLease,
} from './lease/lease-record';

export {
  ESCROW_STATES,
  type EscrowState,
  isEscrowState,
  type BudgetEscrow,
  isBudgetEscrow,
} from './escrow/escrow-record';

export {
  type ConversionRatio,
  isConversionRatio,
  type ConversionAuthorizationEvidence,
  isConversionAuthorizationEvidence,
  type Conversion,
  isConversion,
} from './conversion/conversion-record';

export {
  AUDIT_ACTIONS,
  type AuditAction,
  isAuditAction,
  type FinancialAuditEntry,
  isFinancialAuditEntry,
} from './audit/audit-record';

export { referenceOf } from './ledger/ledger';

export {
  type ReserveInput,
  type ReservationOutcome,
  findReservation,
  reserve,
  type CaptureInput,
  capture,
  type ReleaseInput,
  release,
  ReservationAggregate,
} from './reservation/reservation';

export {
  type RegisterDepositInput,
  type CreditDepositInput,
  type ReverseDepositInput,
  type DepositOutcome,
  findDeposit,
  registerDeposit,
  creditDeposit,
  reverseDeposit,
  DepositAggregate,
} from './deposit/deposit';

export {
  type SettlementSellerShare,
  type SettleInput,
  type SettlementOutcome,
  findCharge,
  settle,
  isFullyRefunded,
} from './charge/settlement';
export { ChargeAggregate } from './charge/charge';

export {
  type AccruePayableInput,
  type SettlePayableInput,
  type MarkPayablePaidInput,
  type AdjustPayableInput,
  type PayableOutcome,
  currentPayable,
  accruePayable,
  settlePayable,
  markPayablePaid,
  adjustPayable,
  payableState,
  PayableAggregate,
} from './payable/payable';

export {
  type RefundChargeInput,
  type AdjustChargeInput,
  type CorrectionOutcome,
  refundCharge,
  adjustCharge,
} from './charge/correction';

export {
  type ConvertEcToUcInput,
  type ConversionOutcome,
  convertEcToUc,
  findConversion,
} from './conversion/conversion';

export {
  type OpenHoldInput,
  type ReleaseHoldInput,
  type HoldOutcome,
  findHold,
  openHold,
  releaseHold,
  activeHolds,
} from './hold/hold';

export {
  type OpenEscrowInput,
  type IssueLeaseInput,
  type RevokeLeaseInput,
  type CloseEscrowInput,
  type EscrowOutcome,
  type LeaseOutcome,
  findEscrow,
  findLease,
  isEscrowOpen,
  escrowState,
  openEscrow,
  issueLease,
  revokeLease,
  closeEscrow,
  escrowRemaining,
} from './escrow/escrow';
export { EscrowAggregate, LeaseAggregate } from './escrow/escrow-aggregate';

export {
  RECONCILIATION_STATUSES,
  type ReconciliationStatus,
  type ObservedBalances,
  type ReconcileWalletInput,
  type BalanceDiscrepancy,
  type ReconciliationReport,
  reconcileWallet,
  findConservationViolation,
} from './reconcile/reconcile';

export { type AppendAuditInput, appendAudit, readAudit } from './audit/audit';

export { type AdmissionAmountInput, admissionUpperBoundAmount } from './shared/admission-amount';

export {
  SPONSOR_STATUSES,
  type SponsorStatus,
  isSponsorStatus,
  FUNDING_AUTHORIZATION_STATUSES,
  type FundingAuthorizationStatus,
  isFundingAuthorizationStatus,
  SPONSOR_GRANT_STATES,
  type SponsorGrantState,
  isSponsorGrantState,
  type Sponsor,
  isSponsor,
  type SponsorFundingAuthorization,
  isSponsorFundingAuthorization,
  type SponsorGrant,
  isSponsorGrant,
  findSponsor,
  findFundingAuthorization,
  findGrant,
  sponsorNetCredited,
  authorizationNetCredited,
  type RegisterSponsorInput,
  type SponsorSeedOutcome,
  registerSponsor,
  type AuthorizeFundingInput,
  type FundingAuthorizationOutcome,
  authorizeFunding,
  type RegisterGrantInput,
  type SponsorGrantOutcome,
  registerGrant,
  type CreditGrantInput,
  creditGrant,
  type ReverseGrantInput,
  reverseGrant,
  SponsorGrantAggregate,
} from './sponsor-grant/sponsor-grant';
