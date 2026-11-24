/**
 * Aggregate `BrowserSession` — phiên trình duyệt trên Account app.
 *
 * Persisted states: `anonymous → authenticated → revoked`. `expired` không
 * phải trạng thái persisted — TTL là thuộc tính thời gian (`isLive`), hết hạn
 * là outcome của việc kiểm tra, không phải transition (prune/reaper là follow-up
 * của infrastructure).
 *
 * Invariants (khớp reference):
 * - Phiên authenticated luôn có cặp `acr` + `authnAt` (cùng có hoặc cùng
 *   không — khớp CHECK `(acr IS NULL) = (authn_at IS NULL)`).
 * - **ACR là giá trị tối đại (maximal) của tập assurance đã đạt** — chuỗi ACR
 *   lồng nhau (`email-otp` ⊂ `{email-otp,mfa}` ⊂ cả ba, xem `acrSetFor`) nên
 *   một URN tối đại tái tạo lossless tập đầy đủ. Tập ACR của session =
 *   `acrSetFor` tính từ giá trị này; kiểm assurance = membership trên tập đó
 *   (không rank).
 * - **Absolute TTL 7d kế thừa qua rotation**: `absoluteExpiresAt` bất biến —
 *   rotation tạo phiên mới kế thừa mốc của phiên cũ (không reset), nên chuỗi
 *   rotation không kéo dài lifetime tuyệt đối. Mọi đường tạo/extend phiên
 *   authenticated đều bị chặn vượt mốc.
 * - Rotation là behavior trên **cặp phiên**: phiên cũ phải live, phiên mới
 *   được dựng hoàn tất **trước** khi phiên cũ bị thu hồi (không partial
 *   mutation nếu constructor phiên mới throw). Chỉ từ phiên authenticated.
 * - Policy hết hạn/re-auth tái dùng `session-policy` hiện có.
 *
 * Session TTL: idle 12h sliding; absolute 7d từ thời điểm authenticated đầu
 * tiên của chuỗi; anonymous 600s.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

import { ACR, acrSetFor, isAcr } from '../authentication/acr';
import type { Acr } from '../authentication/acr';
import { domainError } from '../shared/errors';
import type { DomainError } from '../shared/errors';
import { requiresReauthentication } from '../authentication/session-policy';
import type { ReauthenticationRule } from '../authentication/session-policy';

/** Session ref — định danh phiên, dạng hash của cookie value. */
export type SessionRef = Brand<string, 'SessionRef'>;

export const ANONYMOUS_SESSION_TTL_SECONDS = 600;
export const AUTHENTICATED_IDLE_TTL_SECONDS = 12 * 3600;
export const AUTHENTICATED_ABSOLUTE_TTL_SECONDS = 7 * 24 * 3600;

export const BROWSER_SESSION_STATE = {
  Anonymous: 'anonymous',
  Authenticated: 'authenticated',
  Revoked: 'revoked',
} as const;
export type BrowserSessionState =
  (typeof BROWSER_SESSION_STATE)[keyof typeof BROWSER_SESSION_STATE];

export const BROWSER_SESSION_TRANSITIONS: Record<
  BrowserSessionState,
  readonly BrowserSessionState[]
> = {
  anonymous: [BROWSER_SESSION_STATE.Authenticated, BROWSER_SESSION_STATE.Revoked],
  authenticated: [BROWSER_SESSION_STATE.Revoked],
  revoked: [],
};

export interface BrowserSessionSnapshot {
  readonly sessionRef: SessionRef;
  readonly state: BrowserSessionState;
  readonly acr: Acr | null;
  readonly authnAt: number | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Mốc tuyệt đối bất biến, kế thừa qua rotation — `null` khi chưa authenticated. */
  readonly absoluteExpiresAt: number | null;
  readonly revokedAt: number | null;
  /** Session_ref của phiên trước đó nếu phiên này sinh từ rotation. */
  readonly rotatedFrom: SessionRef | null;
}

const BROWSER_SESSION_STATES: ReadonlySet<string> = new Set(Object.values(BROWSER_SESSION_STATE));

export class BrowserSession extends AggregateRoot<SessionRef> {
  #state: BrowserSessionState;
  #acr: Acr | null;
  #authnAt: number | null;
  readonly #createdAt: number;
  #expiresAt: number;
  /** Mốc tuyệt đối bất biến sau khi được gán lần đầu (kế thừa qua rotation). */
  #absoluteExpiresAt: number | null;
  #revokedAt: number | null;
  readonly #rotatedFrom: SessionRef | null;

  private constructor(args: {
    sessionRef: SessionRef;
    state: BrowserSessionState;
    acr: Acr | null;
    authnAt: number | null;
    createdAt: number;
    expiresAt: number;
    absoluteExpiresAt: number | null;
    revokedAt: number | null;
    rotatedFrom: SessionRef | null;
  }) {
    super(args.sessionRef);
    // Invariant pair: acr và authnAt cùng null hoặc cùng có.
    if ((args.acr === null) !== (args.authnAt === null)) {
      throw new TypeError('BrowserSession: acr và authnAt phải cùng có hoặc cùng không.');
    }
    if (!Number.isFinite(args.createdAt) || !Number.isFinite(args.expiresAt)) {
      throw new TypeError('BrowserSession: timestamp phải là số hữu hạn.');
    }
    if (args.expiresAt <= args.createdAt) {
      throw new TypeError('BrowserSession: expiresAt phải sau createdAt.');
    }
    // Mốc tuyệt đối phải hữu hạn và nằm sau createdAt. Parity: phiên đã từng
    // Authenticated (acr !== null — bao gồm revoked authenticated) bắt buộc có
    // Mốc; session chưa từng xác thực (kể cả revoked anonymous) thì không được
    // Có (không domain path tạo ra — snapshot như vậy từ DB là dữ liệu hỏng).
    if (args.absoluteExpiresAt !== null) {
      if (!Number.isFinite(args.absoluteExpiresAt) || args.absoluteExpiresAt <= args.createdAt) {
        throw new TypeError('BrowserSession: absoluteExpiresAt không hợp lệ.');
      }
      if (args.acr === null) {
        throw new TypeError('BrowserSession: session chưa xác thực không có absoluteExpiresAt.');
      }
    } else if (args.acr !== null) {
      throw new TypeError('BrowserSession: phiên đã xác thực phải có absoluteExpiresAt.');
    }
    // State/kind parity: authenticated ⟹ có bằng chứng; anonymous ⟹ không có.
    if (args.state === BROWSER_SESSION_STATE.Authenticated && args.acr === null) {
      throw new TypeError('BrowserSession: state authenticated phải có bằng chứng xác thực.');
    }
    if (args.state === BROWSER_SESSION_STATE.Anonymous && args.acr !== null) {
      throw new TypeError('BrowserSession: state anonymous không được có bằng chứng xác thực.');
    }
    // Absolute TTL: idle expiry không được vượt mốc tuyệt đối (mốc kế thừa qua
    // Rotation nên chuỗi rotation không kéo dài lifetime tuyệt đối).
    if (
      args.acr !== null &&
      args.absoluteExpiresAt !== null &&
      args.expiresAt > args.absoluteExpiresAt
    ) {
      throw new TypeError('BrowserSession: vượt quá absolute TTL của phiên authenticated.');
    }
    // Pair invariant + format + ordering: acr là enum; authnAt không sau
    // ExpiresAt. authnAt CÓ THỂ trước createdAt — rotation kế thừa bằng chứng
    // Xác thực của phiên cũ (khớp reference: rotate không re-authenticate).
    if (args.acr !== null && !isAcr(args.acr)) {
      throw new TypeError('BrowserSession: acr không hợp lệ.');
    }
    if (args.authnAt !== null && args.authnAt > args.expiresAt) {
      throw new TypeError('BrowserSession: authnAt phải không sau expiresAt.');
    }
    this.#state = args.state;
    this.#acr = args.acr;
    this.#authnAt = args.authnAt;
    this.#createdAt = args.createdAt;
    this.#expiresAt = args.expiresAt;
    this.#absoluteExpiresAt = args.absoluteExpiresAt;
    this.#revokedAt = args.revokedAt;
    this.#rotatedFrom = args.rotatedFrom;
  }

  /** Phiên mới bắt đầu là anonymous (cookie `__Host-`, TTL ngắn). */
  public static startAnonymous(args: {
    sessionRef: SessionRef;
    now: number;
    ttlSeconds?: number;
  }): BrowserSession {
    if (typeof args.sessionRef !== 'string' || args.sessionRef.length === 0) {
      // Không validation thì snapshot() tạo snapshot mà reconstitute() từ chối.
      throw new TypeError('BrowserSession.startAnonymous: sessionRef không hợp lệ.');
    }
    return new BrowserSession({
      absoluteExpiresAt: null,
      acr: null,
      authnAt: null,
      createdAt: args.now,
      expiresAt: args.now + (args.ttlSeconds ?? ANONYMOUS_SESSION_TTL_SECONDS) * 1000,
      revokedAt: null,
      rotatedFrom: null,
      sessionRef: args.sessionRef,
      state: BROWSER_SESSION_STATE.Anonymous,
    });
  }

  public static reconstitute(snapshot: BrowserSessionSnapshot): BrowserSession {
    if (
      typeof snapshot.sessionRef !== 'string' ||
      snapshot.sessionRef.length === 0 ||
      !BROWSER_SESSION_STATES.has(snapshot.state) ||
      !Number.isFinite(snapshot.createdAt) ||
      !Number.isFinite(snapshot.expiresAt) ||
      (snapshot.authnAt !== null && !Number.isFinite(snapshot.authnAt)) ||
      (snapshot.absoluteExpiresAt !== null && !Number.isFinite(snapshot.absoluteExpiresAt))
    ) {
      throw new TypeError('BrowserSession snapshot không hợp lệ.');
    }
    // RevokedAt phải khớp state (khớp CHECK parity của reference), hữu hạn, và
    // Không trước createdAt — revoke() của chính aggregate chỉ ghi giá trị hợp lệ.
    if ((snapshot.revokedAt === null) !== (snapshot.state !== BROWSER_SESSION_STATE.Revoked)) {
      throw new TypeError('BrowserSession snapshot không hợp lệ: revokedAt không khớp state.');
    }
    if (
      snapshot.revokedAt !== null &&
      (!Number.isFinite(snapshot.revokedAt) || snapshot.revokedAt < snapshot.createdAt)
    ) {
      throw new TypeError('BrowserSession snapshot không hợp lệ: revokedAt không hợp lệ.');
    }
    return new BrowserSession({ ...snapshot });
  }

  public sessionRef(): SessionRef {
    return this.id;
  }

  public state(): BrowserSessionState {
    return this.#state;
  }

  public acr(): Acr | null {
    return this.#acr;
  }

  public authnAt(): number | null {
    return this.#authnAt;
  }

  public createdAt(): number {
    return this.#createdAt;
  }

  public expiresAt(): number {
    return this.#expiresAt;
  }

  /** Mốc tuyệt đối bất biến kế thừa qua rotation — `null` khi chưa authenticated. */
  public absoluteExpiresAt(): number | null {
    return this.#absoluteExpiresAt;
  }

  public revokedAt(): number | null {
    return this.#revokedAt;
  }

  public rotatedFrom(): SessionRef | null {
    return this.#rotatedFrom;
  }

  public kind(): 'anonymous' | 'authenticated' {
    // Pair invariant đảm bảo acr ⟺ đã từng authenticated — đúng cả khi
    // Revoked (kind gốc không mất đi).
    return this.#acr === null ? 'anonymous' : 'authenticated';
  }

  /** Now không hợp lệ không được chết lặng như "live" — dữ liệu hỏng không live. */
  public isLive(now: number): boolean {
    return Number.isFinite(now) && this.#revokedAt === null && now < this.#expiresAt;
  }

  /**
   * Revoke idempotent — lần gọi sau không đổi revokedAt. Lý do revoke là ngữ
   * cảnh của caller (audit log ở infrastructure), domain chỉ quyết định trạng
   * thái — không nhận tham số lý do.
   */
  public revoke(now: number): void {
    if (this.#revokedAt === null && Number.isFinite(now)) {
      this.#revokedAt = now;
      this.#state = BROWSER_SESSION_STATE.Revoked;
    }
  }

  /**
   * Anonymous → authenticated: gán bằng chứng xác thực. Guard: đang anonymous,
   * live. **Initial authentication chỉ cấp ACR `email-otp`** — `mfa` /
   * `phishing-resistant` chỉ đạt được qua {@link stepUp} sau khi xác minh yếu
   * tố thứ hai; cấp trực tiếp qua input là escalation trái phép → domain error.
   * Cặp acr + authnAt luôn cùng được gán; mốc tuyệt đối được đặt một lần
   * (authnAt + 7d) và bất biến từ đây.
   *
   * Mặc định (không `extendsTtlSeconds`) idle TTL chuyển sang mốc authenticated
   * 12 giờ — phiên không giữ nguyên TTL ẩn danh 600 giây sau khi xác thực.
   */
  public authenticate(
    acr: Acr,
    authnAt: number,
    args?: { extendsTtlSeconds?: number },
  ): undefined | DomainError {
    if (this.#state !== BROWSER_SESSION_STATE.Anonymous) {
      return domainError('invalid_transition');
    }
    if (acr !== ACR.EmailOtp) {
      // Initial authentication không bao giờ cấp mfa/phishing-resistant —
      // Bằng chứng yếu tố thứ hai chưa được xác minh tại bước này.
      return domainError('invalid_transition');
    }
    if (!isAcr(acr) || !Number.isFinite(authnAt)) {
      return domainError('invalid_transition');
    }
    if (this.#revokedAt !== null) {
      return domainError('session_revoked');
    }
    if (authnAt >= this.#expiresAt) {
      // Phiên chết vì TTL, không phải thu hồi — caller phân biệt được hai nguyên nhân.
      return domainError('session_expired');
    }
    // ExtendsTtlSeconds không hợp lệ thì không mutation — Math.max lan truyền
    // NaN thành expiresAt = NaN và làm phiên chết vĩnh viễn.
    if (
      args?.extendsTtlSeconds !== undefined &&
      (!Number.isFinite(args.extendsTtlSeconds) || args.extendsTtlSeconds <= 0)
    ) {
      return domainError('invalid_transition');
    }
    const absoluteExpiresAt = authnAt + AUTHENTICATED_ABSOLUTE_TTL_SECONDS * 1000,
      proposedExpiry =
        args?.extendsTtlSeconds === undefined
          ? Math.max(this.#expiresAt, authnAt + AUTHENTICATED_IDLE_TTL_SECONDS * 1000)
          : Math.max(this.#expiresAt, authnAt + args.extendsTtlSeconds * 1000);
    if (proposedExpiry > absoluteExpiresAt) {
      return domainError('session_expired');
    }
    this.#state = BROWSER_SESSION_STATE.Authenticated;
    this.#acr = acr;
    this.#authnAt = authnAt;
    this.#expiresAt = proposedExpiry;
    this.#absoluteExpiresAt = absoluteExpiresAt;
    return undefined;
  }

  /**
   * Step-up: thêm yếu tố thứ hai vào phiên **đã authenticated** mà không mất
   * claims đã đạt. Tập mới tính bằng `acrSetFor` từ bằng chứng email-otp đã có
   * + secondFactor mới; guard fail-closed: tập mới phải chứa ACR tối đại hiện
   * tại — step-up không bao giờ hạ claim (một session đã passkey không bị
   * stepUp('totp') đẩy xuống mfa). Guard: đang authenticated, live, bằng chứng
   * email-otp tồn tại. Cập nhật cả `authnAt` (bằng chứng yếu tố thứ hai là
   * bằng chứng xác thực mới nhất) — idle TTL có thể được extend tương tự
   * `authenticate`.
   */
  public stepUp(
    secondFactor: 'totp' | 'passkey',
    authnAt: number,
    args?: { extendsTtlSeconds?: number },
  ): undefined | DomainError {
    if (this.#state !== BROWSER_SESSION_STATE.Authenticated || this.#acr === null) {
      return domainError('invalid_transition');
    }
    // Runtime strict: chỉ totp | passkey — giá trị lạ không bao giờ được map
    // Thành ACR (một giá trị tùy ý rơi vào nhánh else là escalation).
    if (secondFactor !== 'totp' && secondFactor !== 'passkey') {
      return domainError('invalid_transition');
    }
    if (!Number.isFinite(authnAt)) {
      return domainError('invalid_transition');
    }
    if (this.#revokedAt !== null) {
      return domainError('session_revoked');
    }
    if (authnAt >= this.#expiresAt) {
      return domainError('session_expired');
    }
    // Xem authenticate: extendsTtlSeconds không hợp lệ thì không mutation.
    if (
      args?.extendsTtlSeconds !== undefined &&
      (!Number.isFinite(args.extendsTtlSeconds) || args.extendsTtlSeconds <= 0)
    ) {
      return domainError('invalid_transition');
    }
    const nextSet = acrSetFor({ emailOtp: true, secondFactor }),
      next = [...nextSet].pop();
    if (next === undefined) {
      return domainError('invalid_transition');
    }
    // Fail-closed: tập mới phải chứa ACR tối đại hiện tại — không downgrade.
    if (
      ![
        ...acrSetFor({
          emailOtp: true,
          secondFactor:
            this.#acr === ACR.Mfa ? 'totp' : this.#acr === ACR.PhishingResistant ? 'passkey' : null,
        }),
      ].every((a) => nextSet.has(a))
    ) {
      return domainError('invalid_transition');
    }
    const proposedExpiry =
      args?.extendsTtlSeconds === undefined
        ? this.#expiresAt
        : Math.max(this.#expiresAt, authnAt + args.extendsTtlSeconds * 1000);
    // Mốc tuyệt đối KHÔNG đổi khi step-up — 7d kể từ authenticate đầu tiên.
    if (proposedExpiry > (this.#absoluteExpiresAt ?? Number.POSITIVE_INFINITY)) {
      return domainError('session_expired');
    }
    this.#acr = next;
    this.#authnAt = authnAt;
    this.#expiresAt = proposedExpiry;
    return undefined;
  }

  /**
   * Re-authentication cần hay không — delegate sang session-policy hiện có.
   * Tập ACR của session được tính lossless từ ACR tối đại persisted qua
   * `acrSetFor` (chuỗi lồng nhau — xem JSDoc class).
   */
  public requiresReauthentication(rule: ReauthenticationRule, now: number): boolean {
    if (this.#authnAt === null || this.#acr === null) {
      return true;
    }
    // Tập đầy đủ từ bằng chứng: email-otp luôn đạt (điều kiện authenticated),
    // Yếu tố thứ hai suy ra từ ACR tối đại.
    const secondFactor =
      this.#acr === ACR.EmailOtp ? undefined : this.#acr === ACR.Mfa ? 'totp' : 'passkey';
    const sessionAcrs = acrSetFor({ emailOtp: true, secondFactor });
    return requiresReauthentication(sessionAcrs, this.#authnAt, now, rule);
  }

  /**
   * Rotation — behavior trên cặp phiên: phiên cũ phải live và authenticated;
   * phiên mới kế thừa bằng chứng xác thực (acr + authnAt) **và mốc tuyệt đối**
   * (`absoluteExpiresAt` bất biến — chuỗi rotation không kéo dài lifetime
   * tuyệt đối) + TTL idle mới. Phiên mới được dựng hoàn tất trước khi phiên cũ
   * thu hồi — constructor của phiên mới throw thì phiên cũ không đổi (không
   * partial mutation). Guard vi phạm → domain error; CAS thật nằm ở DB.
   */
  public static rotate(
    old: BrowserSession,
    args: { newSessionRef: SessionRef; now: number; ttlSeconds?: number },
  ): BrowserSession | DomainError {
    if (old.#state !== BROWSER_SESSION_STATE.Authenticated) {
      return domainError('invalid_transition');
    }
    if (
      !Number.isFinite(args.now) ||
      typeof args.newSessionRef !== 'string' ||
      args.newSessionRef.length === 0
    ) {
      return domainError('invalid_transition');
    }
    if (!old.isLive(args.now)) {
      // State Authenticated + !isLive ⟹ chỉ còn khả năng hết hạn (revoked đã
      // Bị guard trên bắt; parity revokedAt⟺state enforce ở constructor).
      return domainError('session_expired');
    }
    // Dựng phiên mới TRƯỚC khi thu hồi phiên cũ — constructor có thể throw
    // (vượt mốc tuyệt đối), khi đó phiên cũ chưa bị đổi.
    const next = new BrowserSession({
      absoluteExpiresAt: old.#absoluteExpiresAt,
      acr: old.#acr,
      authnAt: old.#authnAt,
      createdAt: args.now,
      expiresAt: Math.min(
        args.now + (args.ttlSeconds ?? AUTHENTICATED_IDLE_TTL_SECONDS) * 1000,
        old.#absoluteExpiresAt ?? Number.POSITIVE_INFINITY,
      ),
      revokedAt: null,
      rotatedFrom: old.sessionRef(),
      sessionRef: args.newSessionRef,
      state: BROWSER_SESSION_STATE.Authenticated,
    });
    old.revoke(args.now);
    return next;
  }

  public snapshot(): BrowserSessionSnapshot {
    return {
      absoluteExpiresAt: this.#absoluteExpiresAt,
      acr: this.#acr,
      authnAt: this.#authnAt,
      createdAt: this.#createdAt,
      expiresAt: this.#expiresAt,
      revokedAt: this.#revokedAt,
      rotatedFrom: this.#rotatedFrom,
      sessionRef: this.id,
      state: this.#state,
    };
  }
}
