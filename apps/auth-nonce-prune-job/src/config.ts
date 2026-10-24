/**
 * Loader cấu hình của cron Worker `auth-nonce-prune-job`.
 *
 * ⚠️ **Fail-closed theo đúng hợp đồng của job cũ** (`.github/workflows/identity-nonce-prune.yaml`
 * — biến `missing` ở đầu `PRUNE_SCRIPT`): thiếu cấu hình là **đỏ mỗi lần chạy**, không phải
 * "bỏ qua run này". Đoạn comment đầu của `PRUNE_SCRIPT` đã khẳng định: một job dọn dữ
 * liệu không chạy được là
 * một lỗi cần thấy, không phải một lần bỏ qua. Ở Worker, "đỏ" là `throw` — lỗi của handler
 * `scheduled()` được Cron runtime ghi lại ở **Past events** của Cron dashboard (docs
 * `runtime-apis/handlers/scheduled/`: "the first waitUntil to fail is observed and recorded").
 *
 * ⚠️ Module này chỉ **đọc và kiểm** `env`; nó không log gì và không bao giờ giữ connection
 * string vào biến module scope nào ngoài giá trị trả về. Thông báo lỗi chỉ nêu **tên binding**
 * cấu hình, không bao giờ giá trị của nó — `connectionString` của Hyperdrive là admin-path
 * credential (migrator-level), đúng thứ bị cấm vào log (SR-001, invariant 9).
 *
 * Nguồn các tài liệu:
 * - `docs/services/auth-nonce-prune-job/01-architecture.md` §6 (config, caps, outcomes)
 * - `docs/services/auth/03-operations.md` §3.3 (cơ chế cũ mà job này thay thế)
 * - `docs/overview/04-platform-facts.md` HD1–HD16 (đường Hyperdrive), WK4 (trần cron)
 */

/**
 * Pattern của `env` Worker: mapping của binding + biến cấu hình Workers, vậy nên
 * khai `unknown` — loader tự kiểm từng binding cần ở runtime.
 */
export type PruneJobEnv = Readonly<Record<string, unknown>>;

/** Lớp lỗi riêng của cấu hình — để composition root bắt khác với lỗi lớp statement. */
export class PruneJobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PruneJobConfigError';
  }
}

/** Tên Hyperdrive binding của `db-auth` — schema `auth`, role pruner `ecoma_auth_nonce_pruner`. */
export const DB_AUTH_BINDING = 'DB_AUTH';

/** Tên Hyperdrive binding của `db-account` — schema `account`, role `ecoma_account_nonce_pruner`. */
export const DB_ACCOUNT_BINDING = 'DB_ACCOUNT';

/**
 * Shape tối thiểu của một binding Hyperdrive ở `env` — chỉ phần mà `pg` cần.
 *
 * Kết nối được dựng bằng driver `pg` qua pool với `connectionString` của binding này —
 * pattern `apps/account/server/utils/db.ts`.
 */
export interface HyperdriveBindingLike {
  readonly connectionString: string;
}

// ── Cap của lô — hằng số TẬP TRUNG, không override qua env ─────────────────────────
// Cả bốn cap này là **hằng số của thuật toán**, không phải cấu hình môi trường: script cũ
// (`PRUNE_SCRIPT`) cũng đặt chúng trong chính script để không bao giờ bị "một lần sửa YAML
// xoá dòng env" gỡ mất biên mà không có gì đỏ. Đặt chúng ở config (không phải inline nhiều
// nơi) là để spec đối chiếu trần thời gian tổng không lại trôi; **không** thêm env var nào
// cho override — một override chưa ai review là một ngân sách tự điền.

/** Số hàng mỗi lô. Giữ nguyên từ script cũ (20 000): đủ nhỏ để khoá hàng không giữ lâu, đủ lớn để backlog thường trực drain trong vài lô. */
export const BATCH_SIZE = 20_000;

/** Số lô tối đa mỗi run, mỗi kho. Giữ nguyên từ script cũ. */
export const MAX_BATCHES = 50;

/**
 * Trần thời gian của VÒNG LÔ (kể từ khi Worker bắt đầu run), mỗi kho.
 *
 * Trần đặt theo mốc **tổng wall-clock** của Cron invocation — WK4: trần `scheduled()` là
 * **15 phút** (900 giây) wall-clock, hai kho chạy **song song** qua `Promise.all` nên
 * tổng thời gian run = `max(kho1, kho2)`, KHÔNG phải `sum` — song song hai bên không nhân
 * đôi nhu cầu trần, chỉ cần **một kho** nằm dưới 900s là đủ.
 *
 * Bảng tính đường xấu nhất **một kho** (mỗi lần gọi `pg` bị bao bởi `statement_timeout`
 * 60s + `lock_timeout` 30s + `connect_timeout` 10s, retry tối đa `MAX_ATTEMPTS` với
 * backoff 5s + 10s → một call ≤ 3 × 70 + 15 = **225 giây**; script cũ ghi mốc cùng một
 * cách — `docs/services/auth/03-operations.md` §3.3):
 *
 *   phần                   ≤ …
 *   checkpoint cuối trần   ≤ MAX_SECONDS  (chỉ số này khống chế thời lượng của vòng lô,
 *                                        tính từ khi handler bắt đầu — preflight chiếm
 *                                        chỗ của trần với cùng cách tính của script
 *                                        cũ: `SECONDS - started` gồm cả preflight)
 *   một lô cuối đang chạy  ≤ 225s
 *   backlog probe          ≤ 225s
 *   ─────────────────────────────────────────────────────
 *   tổng một kho           ≤ MAX_SECONDS + 450s
 *
 * Hai kho chạy song song ⇒ tổng run của invocation ≤ `max(kho1, kho2)` ≤
 * `MAX_SECONDS + 450`. Chừa 50 giây slack (jitter của cron + phần chạy trước hai mốc
 * trên): MAX_SECONDS = 400 → tổng ≤ 850 giây < 900 giây trần WK4. Cùng cách tính, script
 * cũ chiếm 600 + 450 = 1050 giây trên một trần `timeout-minutes: 25` (1500 giây) của
 * GitHub; con số 400 ở đây là vì trần Worker (900) nhỏ hơn trần GitHub (1500).
 *
 * ⚠️ Trần này không phải một đối chiếu checkpoint chặt: vòng lô kiểm trần **trước** mỗi
 * lô (cùng hình script cũ), nên một lô bắt đầu ngay trước mốc có thể kéo xa hơn
 * `MAX_SECONDS` tới hết lô đó, cộng một lô cuối ≤ 225s và một probe ≤ 225s — tất cả đã
 * nằm trong bảng tính trên. Preflight treo (3 lần retry + backoff) cũng chiếm ngân sách
 * cùng một trần, theo đúng học thuyết "phí của preflight bị trừ khỏi trần của vòng lô".
 */
export const MAX_SECONDS = 400;

/** Trần thử một call transport (postgres connection-class errors) mỗi kho — giữ nguyên từ script cũ. */
export const MAX_ATTEMPTS = 3;

/**
 * `statement_timeout` của **một lô**, giây. Giữ nguyên từ script cũ (60, giá trị đếm từ
 * lô 20 000 trên bảng hình trăm nghìn tới vài triệu hàng).
 */
export const STATEMENT_TIMEOUT_SECONDS = 60;

/**
 * `lock_timeout` của **một lô**, giây. Việc một DELETE chậm giữ khoá cho tới hết statement
 * timeout là đường xấu nhất bình thường; chờ lock lâu hơn 30s nghĩa là đang chờ một transaction
 * khác làm ngược — abort nhanh hơn là giữ khoá lâu hơn.
 */
export const LOCK_TIMEOUT_SECONDS = 30;

/** `connect_timeout` của một connection `pg` mới, giây. Giữ nguyên từ script cũ (PGCONNECT_TIMEOUT=10). */
export const CONNECT_TIMEOUT_SECONDS = 10;

/** Backoff giữa hai lần thử lại, giây, tuyến tính theo lần thứ (`attempt * 5`). Giữ nguyên từ script cũ. */
export function retryBackoffSeconds(attempt: number): number {
  return attempt * 5;
}

/** Chung một số trần cấu hình ở dạng số nguyên, kiểm ở load: giá trị phải dương. */
function assertPositive(configured: number, name: string): void {
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new PruneJobConfigError(`${name} must be a positive integer (>= 1)`);
  }
}

/**
 * Nạp và kiểm cấu hình của Worker: hai Hyperdrive binding bắt buộc.
 *
 * ⚠️ **Không default ngầm**: một binding missing không được rơi về "skip kho đó rồi trả
 * ok" — đúng kịch bản `outcome=not_configured` của script cũ muốn tránh. `throw` ở đây là
 * lỗi của handler `scheduled()` → cron invocation đỏ, thấy ở Past events.
 *
 * ⚠️ Validate cả cap, vì các mùa sau có thể chỉnh hằng số — chỉnh hằng số là thay đổi
 * thuật toán, phải được review. loader chỉ chức năng một việc: từ chối giá trị vô nghĩa
 * trước khi chạy — mỗi kho có cap trần riêng, không đổi theo env.
 *
 * @throws {PruneJobConfigError} Khi thiếu bất kỳ binding nào, hoặc cap vô nghĩa.
 */
export function loadPruneJobConfig(env: PruneJobEnv): {
  readonly dbAuth: HyperdriveBindingLike;
  readonly dbAccount: HyperdriveBindingLike;
} {
  assertPositive(BATCH_SIZE, 'BATCH_SIZE');
  assertPositive(MAX_BATCHES, 'MAX_BATCHES');
  assertPositive(MAX_SECONDS, 'MAX_SECONDS');
  assertPositive(MAX_ATTEMPTS, 'MAX_ATTEMPTS');
  assertPositive(STATEMENT_TIMEOUT_SECONDS, 'STATEMENT_TIMEOUT_SECONDS');
  assertPositive(LOCK_TIMEOUT_SECONDS, 'LOCK_TIMEOUT_SECONDS');
  assertPositive(CONNECT_TIMEOUT_SECONDS, 'CONNECT_TIMEOUT_SECONDS');

  return {
    dbAuth: requireHyperdriveBinding(env, DB_AUTH_BINDING),
    dbAccount: requireHyperdriveBinding(env, DB_ACCOUNT_BINDING),
  };
}

/**
 * Đọc một Hyperdrive binding bắt buộc: phải là object mang `connectionString` là string
 * khác rỗng. Giá trị `connectionString` **không** được rơi ra log hay message lỗi — lỗi
 * chỉ nêu tên binding.
 *
 * Sự khác nhau giữa "binding missing" và "binding present nhưng sai shape" không phải hai
 * outcome riêng: cả hai đều là cấu hình thiếu/sai → `not_configured`, cùng `throw` —
 * không có đường "sai shape thì thử lần nữa" nào phải được trình bày.
 */
function requireHyperdriveBinding(env: PruneJobEnv, name: string): HyperdriveBindingLike {
  const bindingValue = env[name];
  if (typeof bindingValue !== 'object' || bindingValue === null) {
    throw new PruneJobConfigError(
      `${name} is not bound: the Hyperdrive binding is missing from the Worker env`,
    );
  }
  const connectionString = (bindingValue as { connectionString?: unknown }).connectionString;
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new PruneJobConfigError(
      `${name} cannot read connectionString (binding has the wrong shape)`,
    );
  }
  return bindingValue as HyperdriveBindingLike;
}
