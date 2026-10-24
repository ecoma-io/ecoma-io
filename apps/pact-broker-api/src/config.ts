/**
 * Nạp cấu hình của Pact Broker API từ binding + secrets.
 *
 * Nguyên tắc giống `apps/auth/src/config.ts`: **thiếu cấu hình là lỗi, không
 * phải lý do đoán**. Mỗi `require` ném `PactBrokerConfigurationError` làm
 * request fail-closed thay vì chạy bằng default đoán được. Nhắc TÊN biến trong
 * message lỗi, KHÔNG BAO GIỜ nhắc giá trị.
 */

/** Shape của `env` mà Worker nhận từ binding + secrets. */
export interface PactBrokerEnv {
  /** Hyperdrive binding tới `db-pact-broker`. Không phải connection string. */
  HYPERDRIVE?: { connectionString: string };
  /**
   * Cờ bật outbound webhook execution. Mặc định TẮT (SR-006): cho tới khi có
   * SSRF guard, giá trị true chỉ được chấp nhận ở môi trường dev/test —
   * production không được phép true (kiểm bởi `webhooksEnabled`).
   */
  PACT_BROKER_WEBHOOKS_ENABLED?: string;
  /**
   * Origin của dashboard BFF được phép CORS. Để trống ⇒ không CORS nào được
   * bật (API không tin origin nào ngoài cùng origin).
   */
  PACT_BROKER_DASHBOARD_ORIGIN?: string;
}

/** Cấu hình đã kiểm, dùng bởi composition root. */
export interface PactBrokerConfig {
  readonly hyperdrive: { connectionString: string };
  /**
   * Outbound webhook execution có được chạy không. `false` = mọi đường execute
   * chỉ ghi `webhook_executions` với `succeeded = false` (hoặc không chạy) mà
   * KHÔNG mở kết nối ra ngoài. Schema webhook vẫn CRUD được — cấu hình được
   * lưu, delivery bị khoá.
   */
  readonly webhooksEnabled: boolean;
  /** Origin dashboard được CORS, hoặc `null` = không CORS. */
  readonly dashboardOrigin: string | null;
}

/**
 * Ném khi thiếu/giả cấu hình. Thông báo nêu TÊN biến để người vận hành biết
 * cấp cái gì — nhưng không bao giờ nêu giá trị (giống F-07 của auth).
 */
export class PactBrokerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PactBrokerConfigurationError';
  }
}

function requireHyperdrive(value: unknown): { connectionString: string } {
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new PactBrokerConfigurationError(
      'Hyperdrive binding to db-pact-broker is not bound; pact-broker-api fails closed',
    );
  }
  const cs = (value as { connectionString?: unknown }).connectionString;
  if (typeof cs !== 'string' || cs === '') {
    throw new PactBrokerConfigurationError(
      'the Hyperdrive binding has no connectionString; pact-broker-api fails closed',
    );
  }
  return { connectionString: cs };
}

/**
 * Parse cờ webhook — chỉ nhận 'true'/'false' tường minh; mọi giá trị khác bị
 * từ chối thay vì âm thầm hiểu là false (cùng bộ luật fail-closed với auth).
 */
function parseWebhooksEnabled(value: string | undefined): boolean {
  if (value === undefined || value === '') {
    return false; // default TẮT — SR-006
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new PactBrokerConfigurationError(
    'PACT_BROKER_WEBHOOKS_ENABLED accepts only "true" or "false"',
  );
}

/** Nạp và kiểm toàn bộ cấu hình. `undefined`/`null` coi như env rỗng. */
export function loadPactBrokerConfig(envInput: PactBrokerEnv | undefined | null): PactBrokerConfig {
  const env: PactBrokerEnv = envInput ?? {};
  const hyperdrive = requireHyperdrive(env.HYPERDRIVE);

  const webhooksEnabled = parseWebhooksEnabled(env.PACT_BROKER_WEBHOOKS_ENABLED);
  if (webhooksEnabled) {
    // SR-006: outbound HTTP do dữ liệu người dùng kiểm soát (URL webhook) là
    // bề mặt SSRF; không có guard thì không bật — kể cả khi secret nói true.
    // Đây là khoá cứng trong code, không phải cấu hình.
    throw new PactBrokerConfigurationError(
      'PACT_BROKER_WEBHOOKS_ENABLED=true is refused: no SSRF guard exists yet for outbound webhooks (SR-006)',
    );
  }

  const rawOrigin = env.PACT_BROKER_DASHBOARD_ORIGIN;
  let dashboardOrigin: string | null = null;
  if (rawOrigin !== undefined && rawOrigin !== '') {
    // Chỉ nhận origin hợp lệ (scheme + host), chặn prefix-string như
    // https://evil.comhttps://good.example (bất biến host parse bằng URL).
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
        throw new Error('the origin must not carry a path/query/hash');
      }
      dashboardOrigin = parsed.origin;
    } catch {
      throw new PactBrokerConfigurationError('PACT_BROKER_DASHBOARD_ORIGIN is not a valid origin');
    }
  }

  return { hyperdrive, webhooksEnabled, dashboardOrigin };
}
