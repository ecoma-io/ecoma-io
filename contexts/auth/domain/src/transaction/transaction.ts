import { AggregateRoot } from '@ecoma-io/domain-primitives';

import { OAuthProtocolError } from '../shared/errors';
import type { TransactionId } from './handle';

/**
 * Trạng thái của một authorization transaction.
 *
 * ⚠️ Tập trạng thái này là HỮU HẠN và chuyển tiếp là MỘT CHIỀU — không có
 * đường quay lui. Đó là điều làm cho "code chỉ được cấp một lần" trở thành hệ
 * quả của state machine thay vì một kiểm tra rời có thể quên (hàng 9 của bảng 5.1.2).
 *
 * Nhánh `denied` là kết thúc KHÔNG cấp code, nhưng vẫn phải qua Z + cookie để
 * dựng `error=access_denied` tới `redirect_uri`: chỉ `auth` được dựng OAuth
 * error redirect (invariant 12).
 */
export type AuthorizationTransactionState =
  | 'pending_browser'
  | 'browser_confirmed'
  | 'awaiting_consent'
  | 'ready_to_complete'
  | 'completed'
  | 'denied';

/** Trạng thái mà một handle Z có thể được tiêu thụ. */
export const COMPLETABLE_STATES: ReadonlySet<AuthorizationTransactionState> = new Set([
  'ready_to_complete',
  'denied',
]);

/**
 * `browser_confirmed` là ĐIỀU KIỆN TIÊN QUYẾT, không phải bước kiểm tra thông
 * thường: request chưa qua `/authorize/confirm` bị từ chối TRƯỚC KHI đọc bất
 * kỳ trường nào khác (FR-016q, SR-013a). Đây là chốt chặn duy nhất chống việc
 * attacker chiếm handle X rồi đẩy kết quả xác minh bằng session của chính hắn.
 */
export function assertBrowserConfirmed(state: AuthorizationTransactionState): void {
  if (state === 'pending_browser') {
    throw OAuthProtocolError.directInvalidRequest('transaction chua duoc browser xac nhan');
  }
}

export function isTerminal(state: AuthorizationTransactionState): boolean {
  return state === 'completed' || state === 'denied';
}

/**
 * Bảng chuyển tiếp hợp lệ. Dùng để chặn việc ghi một trạng thái không thể đạt
 * tới — một bug trong lớp repository có thể vô tình reset transaction về
 * `pending_browser` và làm nó dùng lại được.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<AuthorizationTransactionState, ReadonlySet<AuthorizationTransactionState>>
> = {
  pending_browser: new Set(['browser_confirmed']),
  browser_confirmed: new Set(['awaiting_consent', 'ready_to_complete', 'denied']),
  awaiting_consent: new Set(['ready_to_complete', 'denied']),
  ready_to_complete: new Set(['completed', 'denied']),
  // `completed` và `denied` là đích — không có đường ra.
  completed: new Set<AuthorizationTransactionState>(),
  denied: new Set<AuthorizationTransactionState>(),
};

export function canTransition(
  from: AuthorizationTransactionState,
  to: AuthorizationTransactionState,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertTransition(
  from: AuthorizationTransactionState,
  to: AuthorizationTransactionState,
): void {
  if (!canTransition(from, to)) {
    throw OAuthProtocolError.directInvalidRequest(
      `khong chuyen trang thai hop le: ${from} -> ${to}`,
    );
  }
}

/**
 * Aggregate Root của authorization transaction — state machine một chiều,
 * encapsulate trạng thái sau hai điều kiện tiền quyết (FR-016q):
 *
 * 1. **browser_confirmed là điều kiện tiên quyết**: request chưa qua
 *    `/authorize/confirm` bị từ chối TRƯỚC KHI đọc bất kỳ trường nào khác —
 *    chốt chặn duy nhất chống attacker chiếm handle X rồi đẩy kết quả xác minh
 *    bằng session của chính hắn.
 * 2. **Terminal là terminal**: `completed`/`denied` không có đường ra, nên
 *    "code chỉ được cấp một lần" là hệ quả của state machine.
 *
 * ⚠️ Aggregate này KHÔNG giữ dữ liệu nghiệp vụ của transaction (client, scope,
 * PKCE challenge…): những giá trị đó là payload imutable của record, do tầng
 * application lưu/đọc cùng state. Aggregate chỉ sở hữu điều aggregate thực sự
 * kiểm soát — vòng đời. Consistency boundary của nó là **ràng buộc chuyển
 * trạng thái**, không phải một blob dữ liệu.
 *
 * Equality theo identity của `AggregateRoot`/`Entity`: hai transaction cùng id
 * là cùng transaction, bất kể trạng thái.
 */
export class AuthorizationTransaction extends AggregateRoot<string> {
  #state: AuthorizationTransactionState;

  private constructor(id: string, state: AuthorizationTransactionState) {
    super(id);
    this.#state = state;
  }

  /**
   * Tạo transaction mới ở trạng thái khởi đầu `pending_browser`.
   *
   * @param id `TransactionId` — brand của {@link ./handle} bảo đảm định dạng.
   */
  public static start(id: TransactionId): AuthorizationTransaction {
    return new AuthorizationTransaction(id, 'pending_browser');
  }

  /**
   * Tái dựng transaction từ persistence.
   *
   * @throws OAuthProtocolError (`invalid_request`) khi state đọc từ DB không
   *   thuộc tập trạng thái — dữ liệu hỏng không được reconstitute thành object
   *   "hợp lệ" rồi phát hiện muộn ở thời điểm transition.
   */
  public static reconstitute(
    id: TransactionId,
    state: AuthorizationTransactionState,
  ): AuthorizationTransaction {
    assertKnownState(state);
    return new AuthorizationTransaction(id, state);
  }

  public get state(): AuthorizationTransactionState {
    return this.#state;
  }

  public get isTerminal(): boolean {
    return isTerminal(this.#state);
  }

  /** Transaction đã qua `/authorize/confirm` chưa — điều kiện tiên quyết FR-016q. */
  public get isBrowserConfirmed(): boolean {
    return this.#state !== 'pending_browser';
  }

  /** Handle Z có thể được tiêu thụ ở trạng thái hiện tại không. */
  public get isCompletable(): boolean {
    return COMPLETABLE_STATES.has(this.#state);
  }

  /**
   * Chuyển trạng thái thô — DÀNH CHO NỘI BỘ aggregate (mọi named behavior đều
   * đi qua đây). Application layer KHÔNG điều khiển state bằng method này; nó
   * dùng các behavior có tên intent: {@link confirmBrowser}, {@link requestConsent},
   * {@link markReadyToComplete}, {@link complete}, {@link deny}.
   *
   * Delegate bảng chuyển tiếp cho {@link assertTransition} (pure function),
   * nên aggregate và bản pure dùng chung một bảng — không có bản sao để lệch.
   *
   * @throws OAuthProtocolError khi transition không hợp lệ.
   */
  public transitionTo(to: AuthorizationTransactionState): void {
    assertTransition(this.#state, to);
    this.#state = to;
  }

  /**
   * Browser xác nhận kết quả xác minh — duy nhất đường từ `pending_browser` đi
   * tiếp. Guard của nó CHÍNH là điều kiện tiên quyết FR-016q: transaction chưa
   * qua `/authorize/confirm` không có method nào đọc được payload nghiệp vụ,
   * và method này là chốt chặn duy nhất chống attacker chiếm handle X rồi đẩy
   * kết quả xác minh bằng session của chính hắn.
   */
  public confirmBrowser(): void {
    this.transitionTo('browser_confirmed');
  }

  /**
   * Consent được yêu cầu — transaction chờ quyết định của user.
   *
   * @throws OAuthProtocolError khi chưa qua browser confirm.
   */
  public requestConsent(): void {
    this.transitionTo('awaiting_consent');
  }

  /**
   * Chuẩn bị hoàn tất: mọi điều kiện cấp code đã thoả — handle Z có thể được
   * tiêu thụ để đổi lấy authorization code (hoặc từ chối).
   *
   * @throws OAuthProtocolError khi chưa qua browser confirm.
   */
  public markReadyToComplete(): void {
    this.transitionTo('ready_to_complete');
  }

  /**
   * Hoàn tất — cấp code. Terminal: "code chỉ được cấp một lần" là hệ quả của
   * state machine (terminal không có đường ra), không phải một kiểm tra rời có
   * thể quên.
   *
   * @throws OAuthProtocolError khi chưa qua browser confirm hoặc transaction
   *   không ở trạng thái hoàn tất được.
   */
  public complete(): void {
    this.transitionTo('completed');
  }

  /**
   * Từ chối cấp code (user denial, grant hỏng giữa chừng…) — vẫn đi qua trạm
   * này để dựng `error=access_denied` tới `redirect_uri` (invariant 12).
   * Terminal như {@link complete}.
   *
   * @throws OAuthProtocolError khi chưa qua browser confirm.
   */
  public deny(): void {
    this.transitionTo('denied');
  }

  /**
   * Assertion tiền quyết `/authorize/complete` (FR-016q, SR-013a).
   *
   * @throws OAuthProtocolError khi transaction chưa qua browser confirm.
   */
  public assertBrowserConfirmed(): void {
    assertBrowserConfirmed(this.#state);
  }
}

/** @throws OAuthProtocolError khi state không thuộc tập hợp lệ. */
function assertKnownState(state: AuthorizationTransactionState): void {
  if (!(state in ALLOWED_TRANSITIONS)) {
    throw OAuthProtocolError.directInvalidRequest(`trang thai khong hop le: ${String(state)}`);
  }
}
