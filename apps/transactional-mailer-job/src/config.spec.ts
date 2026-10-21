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
    // Lease bằng trần chờ một request provider là cấu hình vô nghĩa: mơ hồ persist-denied
    // chỉ phát hiện được sau ít nhất một full request — tới lúc đó lease đã hết hạn, nên
    // lời đánh giá cửa sổ ở làn persist-denied luôn quá muộn và đường "còn trong cửa sổ ⇒
    // auto-resend" chết âm thầm. Bắt ở loader, message chỉ nêu tên env var.
    expect(() =>
      loadMailerJobConfig({
        ...baseEnv(),
        MAIL_PROVIDER_TIMEOUT_MS: '10000',
        MAIL_JOB_EXECUTION_LEASE_MS: '10000',
      }),
    ).toThrow(MailerJobConfigError);
  });

  it('rejects an execution lease smaller than the provider timeout', () => {
    expect(() =>
      loadMailerJobConfig({
        ...baseEnv(),
        MAIL_PROVIDER_TIMEOUT_MS: '30000',
        MAIL_JOB_EXECUTION_LEASE_MS: '10000',
      }),
    ).toThrow(MailerJobConfigError);
  });
});
