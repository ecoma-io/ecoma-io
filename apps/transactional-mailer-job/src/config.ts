/**
 * Loader cấu hình của worker `transactional-mailer-job`.
 *
 * ⚠️ **Fail-closed, không default ngầm** (`03-operations.md` §3): mọi giá trị vận hành ở
 * đây là một lease, một ngân sách hay một trần — thiếu mục nào thì bound tương ứng ở
 * `01-architecture.md` §9/§11 **không** có hiệu lực, nên thiếu là lỗi khởi động, không
 * phải giá trị "tạm được". Một default ngầm ở đường execution là một ngân sách tự chọn
 * mà không ai review.
 *
 * ⚠️ Module này chỉ **đọc và kiểm** `env`; nó không giữ secret vào biến module scope nào
 * ngoài giá trị trả về, và không log gì — mọi thông báo lỗi chỉ nêu **tên biến** cấu hình,
 * không bao giờ giá trị của nó (`MAIL_PROVIDER_TOKEN` là bearer credential).
 */

/** Shape của `env` mà Worker nhận từ binding + secrets. */
export type MailerJobEnv = Readonly<Record<string, unknown>>;

/** Lớp lỗi riêng của cấu hình — để composition root bắt được khác lỗi hạ tầng. */
export class MailerJobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerJobConfigError';
  }
}

/** Worker Secret chọn provider — `resend` là provider thật v1, `fake` chỉ test/dev. */
export const PROVIDER_KIND_ENV = 'MAIL_PROVIDER_KIND';

/** Worker Secret trần chờ của **một** request provider (ms). */
export const PROVIDER_TIMEOUT_ENV = 'MAIL_PROVIDER_TIMEOUT_MS';

/** Hex 64 ký tự chữ thường — hình của một khoá HMAC-SHA-256. */
const HEX_KEY_64 = /^[0-9a-f]{64}$/u;

/** Giá trị hợp lệ của {@link PROVIDER_KIND_ENV}. */
const PROVIDER_KIND_VALUES = ['resend', 'fake'] as const;

/**
 * Cấu hình đã kiểm — mirror `MailerJobConfig` đã chốt shape; loader là nơi sinh nó.
 *
 * `timeoutMs` của provider ở đây là **trần ms của một request**, không phải mốc tuyệt đối:
 * orchestration (`processMailCommand`) mới là nơi ghép `now + providerTimeoutMs` với
 * `leaseExpiresAt` bằng `Math.min` (`mail-provider-port.ts`).
 */
/**
 * Cấu hình provider Resend — mirror cấu trúc của `ResendProviderConfig` ở adapter
 * (`libs/transactional-mailer-job-infrastructure/src/resend-mail-provider.ts`); spec
 * `resend-mail-provider.spec.ts` đối chiếu field của hai phía để lệch tên là đỏ ngay.
 */
export type ResendProviderConfig = {
  readonly endpoint: string;
  readonly token: string;
  readonly from: string;
  readonly timeoutMs: number;
};

export interface LoadedMailerJobConfig {
  readonly provider:
    | {
        readonly kind: 'resend';
        readonly resend: ResendProviderConfig;
      }
    | { readonly kind: 'fake' };
  readonly maxExecutionAttempts: number;
  readonly executionLeaseMs: number;
  readonly reportLeaseMs: number;
  readonly maxReportAttempts: number;
  readonly sweepBatchLimit: number;
  readonly providerTimeoutMs: number;
  readonly quarantineHmacKeyHex: string;
}

/**
 * Nạp và kiểm toàn bộ cấu hình của worker.
 *
 * Không cache ở module: `queue()` và `scheduled()` là hai đường kích hoạt độc lập, mỗi lần
 * chạy đọc `env` của chính nó. `env` của một isolate không đổi, nhưng không cache cũng có
 * chi phí đáng kể nào — loader là thuần, không I/O.
 *
 * @throws {MailerJobConfigError} Với **mọi** cấu hình thiếu/sai.
 */
export function loadMailerJobConfig(env: MailerJobEnv): LoadedMailerJobConfig {
  const maxExecutionAttempts = requirePositiveInteger(env, 'MAIL_JOB_MAX_EXECUTION_ATTEMPTS');
  const executionLeaseMs = requirePositiveInteger(env, 'MAIL_JOB_EXECUTION_LEASE_MS');
  const reportLeaseMs = requirePositiveInteger(env, 'MAIL_JOB_REPORT_LEASE_MS');
  const maxReportAttempts = requirePositiveInteger(env, 'MAIL_JOB_MAX_REPORT_ATTEMPTS');
  const sweepBatchLimit = requirePositiveInteger(env, 'MAIL_JOB_SWEEP_BATCH_LIMIT');
  const providerTimeoutMs = requirePositiveInteger(env, PROVIDER_TIMEOUT_ENV);
  const quarantineHmacKeyHex = requireHexKey(env, 'MAIL_QUARANTINE_HMAC_KEY');

  const provider = loadProvider(env, providerTimeoutMs);

  return {
    provider,
    // Ngân sách B của một generation phải >= `max_retries + 1` (= 4): Queue cho 3 retry,
    // nên một ngân sách nhỏ hơn 4 là worker từ chối nhiều hơn platform cho phép — cấu hình
    // mâu thuẫn với `max_retries` của wrangler.jsonc.
    maxExecutionAttempts:
      maxExecutionAttempts >= 4
        ? maxExecutionAttempts
        : raiseConfig(
            'MAIL_JOB_MAX_EXECUTION_ATTEMPTS phai >= 4 (max_retries + 1 cua Queue consumer)',
          ),
    executionLeaseMs,
    reportLeaseMs,
    maxReportAttempts,
    sweepBatchLimit,
    providerTimeoutMs,
    quarantineHmacKeyHex,
  };
}

/** Đọc nhóm biến provider theo `MAIL_PROVIDER_KIND`. */
function loadProvider(
  env: MailerJobEnv,
  providerTimeoutMs: number,
): LoadedMailerJobConfig['provider'] {
  const kind = env[PROVIDER_KIND_ENV];
  if (typeof kind !== 'string' || !(PROVIDER_KIND_VALUES as readonly string[]).includes(kind)) {
    throw new MailerJobConfigError(
      `${PROVIDER_KIND_ENV} phai la mot trong: ${PROVIDER_KIND_VALUES.join(', ')}`,
    );
  }
  if (kind === 'fake') {
    // Fake provider KHÔNG cần endpoint/token/from, và KHÔNG được có nó — một env mang
    // credential thật nhưng kind=fake là dấu hiệu môi trường nhầm lẫn: credential production
    // tồn tại ở nơi không bao giờ dùng tới nó (03-operations.md §1.1, PW4/PW5).
    for (const [variableName, value] of [
      ['MAIL_PROVIDER_ENDPOINT', env['MAIL_PROVIDER_ENDPOINT']] as const,
      ['MAIL_PROVIDER_TOKEN', env['MAIL_PROVIDER_TOKEN']] as const,
    ]) {
      if (typeof value === 'string' && value.length > 0) {
        throw new MailerJobConfigError(
          `${variableName} phai KHONG dat khi ${PROVIDER_KIND_ENV}=fake; credential ton tai o moi truong khong dung no la leak`,
        );
      }
    }
    return { kind: 'fake' };
  }
  const endpoint = requireNonEmptyString(env, 'MAIL_PROVIDER_ENDPOINT');
  const token = requireNonEmptyString(env, 'MAIL_PROVIDER_TOKEN');
  const from = requireNonEmptyString(env, 'MAIL_PROVIDER_FROM');
  return {
    kind: 'resend',
    resend: { endpoint, token, from, timeoutMs: providerTimeoutMs },
  };
}

/** Đọc một biến bắt buộc, phải là chuỗi khác rỗng — không trim, giữ nguyên văn. */
function requireNonEmptyString(env: MailerJobEnv, variableName: string): string {
  const raw = env[variableName];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new MailerJobConfigError(
      `${variableName} chua duoc dat; worker khong chay khong co gia tri nay`,
    );
  }
  if (raw.trim() === '') {
    throw new MailerJobConfigError(`${variableName} chi chua khoang trang`);
  }
  return raw;
}

/** Đọc một giá trị vận hành bắt buộc: số nguyên dương, không mặc định. */
function requirePositiveInteger(env: MailerJobEnv, variableName: string): number {
  const raw = env[variableName];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new MailerJobConfigError(
      `${variableName} chua duoc dat; operational value khong co gia tri mac dinh`,
    );
  }
  if (!/^\d+$/u.test(raw)) {
    throw new MailerJobConfigError(`${variableName} phai la chuoi chu so thap phan`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new MailerJobConfigError(`${variableName} phai la so nguyen duong (>= 1)`);
  }
  return parsed;
}

/** Đọc khoá HMAC quarantine: 64 hex chữ thường — hình mà `computeQuarantineId` nhận. */
function requireHexKey(env: MailerJobEnv, variableName: string): string {
  const raw = requireNonEmptyString(env, variableName);
  if (!HEX_KEY_64.test(raw)) {
    throw new MailerJobConfigError(
      `${variableName} phai la 64 hex chu thuong (khoa HMAC-SHA-256 32 byte)`,
    );
  }
  return raw;
}

/** Helper ném có kiểu — dùng ở chỗ cần biểu thức giá trị. */
function raiseConfig(message: string): never {
  throw new MailerJobConfigError(message);
}
