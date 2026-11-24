/**
 * Cấu hình ký và gate `pre-commit`: commit chưa tồn tại lúc hook chạy, nên
 * thứ duy nhất kiểm được là cấu hình — và cấu hình chính là nguyên nhân gốc
 * của việc mất chữ ký: `git rebase`/`amend` tái tạo commit bằng `commit.gpgsign`
 * hiện hành, nên một lần drift cấu hình âm thầm bỏ chữ ký đi mà không báo lỗi.
 *
 * `user.signingkey` chỉ được kiểm tồn tại khi `gpg.format=ssh`: ở `openpgp`/`x509`
 * nó là key ID hoặc tên, không phải đường dẫn file, nên `existsSync` sẽ báo sai.
 *
 * `readConfig` tiêm vào để test không cần git thật; mặc định đọc `git config`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { ROOT_DIR, gitEnv } from './utils.js';

/** `gpg.format` mà git chấp nhận; xem `git help config`. */
export const SIGNING_FORMATS = ['openpgp', 'x509', 'ssh'] as const;

export type ConfigProblem = string;

/**
 * Cấu hình ký có đủ để git ký commit không.
 *
 * Trả về danh sách mọi vấn đề tìm thấy — một lần gọi khẳng định tất cả thay vì
 * dừng ở vấn đề đầu tiên.
 */
export function checkSigningConfig(
  readConfig: (key: string) => string | undefined = defaultConfigReader(),
): ConfigProblem[] {
  const problems: ConfigProblem[] = [],
    gpgSign = readConfig('commit.gpgsign');
  if (gpgSign !== 'true') {
    problems.push(
      `commit.gpgsign must be "true" (current: ${describe(gpgSign)}); git would create unsigned commits.`,
    );
  }

  const format = readConfig('gpg.format');
  if (
    format !== undefined &&
    !SIGNING_FORMATS.includes(format as (typeof SIGNING_FORMATS)[number])
  ) {
    problems.push(
      `gpg.format must be one of ${SIGNING_FORMATS.join(', ')} (current: ${describe(format)}).`,
    );
  }

  // Chỉ `ssh` mới trỏ user.signingkey tới một file trên đĩa.
  if (format === 'ssh') {
    const key = readConfig('user.signingkey');
    if (key === undefined || key === '') {
      problems.push('gpg.format is "ssh" but user.signingkey is not set.');
    } else if (!existsSync(key)) {
      problems.push(`user.signingkey points at a missing file: ${key}`);
    }
  }

  return problems;
}

/**
 * Reader mặc định: `git config --get`, trả `undefined` khi key không được set.
 *
 * Export để test đọc được config từ một repository thật; mặc định là repository
 * này.
 */
export function defaultConfigReader(cwd: string = ROOT_DIR): (key: string) => string | undefined {
  return (key) => {
    try {
      const value = execFileSync('git', ['config', '--get', key], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return value.trim() === '' ? undefined : value.trim();
    } catch {
      // Git không chạy được hoặc key chưa set: cả hai đều nghĩa là "không đọc được
      // Giá trị", và caller sẽ tự phân biệt qua kết quả của checkSigningConfig.
      return undefined;
    }
  };
}

function describe(value: string | undefined): string {
  return value === undefined ? 'unset' : `"${value}"`;
}
