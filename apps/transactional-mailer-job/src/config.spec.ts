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

describe('provider call safe window ceiling', () => {
  it('accepts exactly the 24h documented ceiling', () => {
    const config = loadMailerJobConfig({ ...baseEnv() });
    expect(config.providerCallSafeWindowMs).toBe(86_400_000);
  });

  it('rejects a window above the 24h ceiling with a config error', () => {
    // Loader fail-closed ở giá trị lớn nhất của cửa sổ tin được — một find-and-replace
    // trần hay đảo dấu so sánh sẽ làm test này đỏ.
    expect(() =>
      loadMailerJobConfig({ ...baseEnv(), MAIL_JOB_PROVIDER_CALL_SAFE_WINDOW_MS: '86400001' }),
    ).toThrow(MailerJobConfigError);
  });

  it('rejects a window not larger than the provider timeout', () => {
    // Cửa sổ <= trần chờ của một request provider là cấu hình vô nghĩa: mọi mơ hồ đều
    // được phát hiện sau ít nhất một full request ⇒ luôn ngoài cửa sổ ⇒ in-window
    // auto-resend chết âm thầm. Kiểm chéo này chặn cấu hình mâu thuẫn ở loader.
    expect(() =>
      loadMailerJobConfig({
        ...baseEnv(),
        MAIL_PROVIDER_TIMEOUT_MS: '10000',
        MAIL_JOB_PROVIDER_CALL_SAFE_WINDOW_MS: '10000',
      }),
    ).toThrow(MailerJobConfigError);
  });
});
