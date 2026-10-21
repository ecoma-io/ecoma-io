import { describe, expect, it } from 'vitest';

import { loadMailerJobConfig, MailerJobConfigError } from './config';

/**
 * Env tối thiểu hợp lệ cho loader — từng test override đúng biến cần kiểm.
 * Provider `fake` để không cần credential endpoint/token/from.
 */
function baseEnv(): Record<string, string> {
  return {
    MAIL_PROVIDER_KIND: 'fake',
    MAIL_PROVIDER_TIMEOUT_MS: '10000',
    MAIL_JOB_MAX_EXECUTION_ATTEMPTS: '4',
    MAIL_JOB_EXECUTION_LEASE_MS: '30000',
    MAIL_JOB_REPORT_LEASE_MS: '10000',
    MAIL_JOB_MAX_REPORT_ATTEMPTS: '5',
    MAIL_JOB_SWEEP_BATCH_LIMIT: '20',
    MAIL_JOB_PROVIDER_CALL_SAFE_WINDOW_MS: '86400000',
    MAIL_QUARANTINE_HMAC_KEY: 'a'.repeat(64),
  };
}

describe('execution lease vs provider timeout cross-check', () => {
  it('accepts an execution lease exactly one ms above the provider timeout', () => {
    // Biên `>` là giá trị nhỏ nhất vẫn hợp lệ — loader chặn ở `<=`, một đảo dấu hay
    // hạ bất đẳng thức xuống `<` sẽ làm test này đỏ.
    const config = loadMailerJobConfig({
      ...baseEnv(),
      MAIL_PROVIDER_TIMEOUT_MS: '10000',
      MAIL_JOB_EXECUTION_LEASE_MS: '10001',
    });
    expect(config.executionLeaseMs).toBe(10_001);
  });

  it('rejects an execution lease equal to the provider timeout', () => {
    // Ghim bất đẳng thức gia hạn §9.2.1 ở loader: `mail-provider-port` dựng deadline của
    // một request provider bằng `min(now + providerTimeoutMs, lease_expires_at)` (protected
    // overlap giữa các generation). Lease == trần chờ sập deadline về lease expiry — không
    // còn chỗ cho một lời gọi trọn vẹn: mọi request bị cắt ngắn ở lease expiry, theo
    // contract adapter (`deadlineMs <= now`) trả `rejected`/`retryable` ⇒ RETRY, chưa bao
    // giờ tới làn ambiguity. Chặn ở boot, message chỉ nêu tên env var.
    expect(() =>
      loadMailerJobConfig({
        ...baseEnv(),
        MAIL_PROVIDER_TIMEOUT_MS: '10000',
        MAIL_JOB_EXECUTION_LEASE_MS: '10000',
      }),
    ).toThrow(MailerJobConfigError);
  });

  it('rejects an execution lease smaller than the provider timeout', () => {
    // Cùng bất đẳng thức gia hạn §9.2.1 — lease nhỏ hơn trần chờ thì mọi request provider
    // bị cắt với `rejected`/`retryable` ⇒ RETRY; cấu hình vô nghĩa phải chết ở boot.
    expect(() =>
      loadMailerJobConfig({
        ...baseEnv(),
        MAIL_PROVIDER_TIMEOUT_MS: '30000',
        MAIL_JOB_EXECUTION_LEASE_MS: '10000',
      }),
    ).toThrow(MailerJobConfigError);
  });
});
