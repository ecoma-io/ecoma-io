import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateAppSecret,
  generateBase64Key32,
  generateEs256SigningKeyPem,
  generateHexKey64,
  generateInternalHmacSecret,
  generatePostgresPassword,
  isConfigKeyMissing,
  lookupPostgresPassword,
  readRootHostFromEnv,
  upsertLocalEnv,
} from './local-env.js';
import type { ExecResult } from './pulumi-context.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-spec-'));
  cleanup.push(dir);
  return dir;
}

/** ExecResult hình đúng CLI: chỉ cần status/stdout/stderr cho các pure parser. */
function execResult(
  overrides: Partial<{ status: number | null; stdout: string; stderr: string }> = {},
): ExecResult {
  return { status: 0, stdout: '', stderr: '', ...overrides };
}

describe('isConfigKeyMissing', () => {
  it('matches the canonical CLI missing-key messages case-insensitively', () => {
    expect(
      isConfigKeyMissing(
        execResult({ status: 1, stderr: "error: no value for the key 'postgres:password'" }),
      ),
    ).toBe(true);
    expect(
      isConfigKeyMissing(
        execResult({ status: 1, stderr: 'configuration key "postgres:password" not found' }),
      ),
    ).toBe(true);
  });

  it('is false for unrelated failures (wrong passphrase, backend errors)', () => {
    // Fail-closed là điểm của hàm này: sai passphrase exit != 0 nhưng KHÔNG
    // được nhận nhầm là "chưa có key" — regen secret trên lỗi đó là đè giá trị
    // đang sống trong state.
    expect(
      isConfigKeyMissing(execResult({ status: 1, stderr: 'failed to decrypt secret value' })),
    ).toBe(false);
    expect(isConfigKeyMissing(execResult({ status: 1, stderr: '' }))).toBe(false);
  });
});

describe('secret generators', () => {
  it('postgres password is 24 bytes of base64url', () => {
    const password = generatePostgresPassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(new Set([generatePostgresPassword(), password]).size).toBe(2);
  });

  it('app secret and internal HMAC secret are 32 bytes of base64url and differ across calls', () => {
    for (const secret of [generateAppSecret(), generateInternalHmacSecret()]) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(generateInternalHmacSecret()).not.toBe(generateInternalHmacSecret());
  });

  it('hex key is exactly 64 lowercase hex characters', () => {
    expect(generateHexKey64()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('base64 key decodes to exactly 32 bytes', () => {
    const key = generateBase64Key32();
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(Buffer.from(key, 'base64').length).toBe(32);
  });

  it('ES256 signing key is a PKCS#8 PEM without a trailing newline', async () => {
    // `requireSecret` của app từ chối whitespace đầu/cuối — PEM kết thúc bằng
    // '\n' là lỗi boot WIC đã đo thật (#249).
    const pem = await generateEs256SigningKeyPem();
    expect(pem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/u);
    expect(pem.endsWith('-----END PRIVATE KEY-----')).toBe(true);
    expect(pem.endsWith('\n')).toBe(false);
  });
});

describe('lookupPostgresPassword', () => {
  it('found: trims the plaintext value on exit 0', () => {
    const lookup = lookupPostgresPassword(execResult({ status: 0, stdout: 's3cret\n' }));
    expect(lookup).toEqual({ state: 'found', password: 's3cret' });
  });

  it('empty stdout on exit 0 is missing, not found', () => {
    expect(lookupPostgresPassword(execResult({ status: 0, stdout: '\n' }))).toEqual({
      state: 'missing',
    });
  });

  it('the `[secret]` masking string is an error, never a password', () => {
    const lookup = lookupPostgresPassword(execResult({ status: 0, stdout: '[secret]' }));
    expect(lookup).toMatchObject({ state: 'error', detail: expect.stringContaining('[secret]') });
  });

  it('missing key on non-zero exit is missing (three-state contract)', () => {
    expect(
      lookupPostgresPassword(
        execResult({ status: 1, stderr: "no value for the key 'postgres:password'" }),
      ),
    ).toEqual({ state: 'missing' });
  });

  it('real errors never embed the raw command output (leak guard)', () => {
    // stdout của `config get` khi exit 0 CHÍNH LÀ mật khẩu: nếu CLI đổi hành vi
    // exit-code, nhét raw output vào error string là đường leak thật.
    const lookup = lookupPostgresPassword(
      execResult({ status: 1, stdout: 'SUPER-SECRET', stderr: 'boom' }),
    );
    expect(lookup).toMatchObject({
      state: 'error',
      detail: expect.stringMatching(/^(?!.*SUPER-SECRET)(?!.*boom).*$/su),
    });
  });
});

describe('upsertLocalEnv', () => {
  it('creates the file with only the owned keys when it does not exist', () => {
    const root = tempWorktree();
    const { envPath } = upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:44301', NOT_OWNED: 'x' });
    expect(readFileSync(envPath, 'utf8')).toBe('ROOT_HOST=fbi.com:44301\n');
  });

  it('merges byte-preservingly: foreign lines keep their exact bytes and position', () => {
    const root = tempWorktree();
    const original = ['MY_VAR=keep me  ', '# comment', 'ROOT_HOST=old:80', 'OTHER=1', ''].join(
      '\n',
    );
    writeFileSync(join(root, '.env'), original, 'utf8');
    upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:44301' });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(
      ['MY_VAR=keep me  ', '# comment', 'ROOT_HOST=fbi.com:44301', 'OTHER=1', ''].join('\n'),
    );
  });

  it('adds a previously absent owned key at the end without a misplaced blank line', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'OTHER=1\n', 'utf8');
    upsertLocalEnv(root, { ROOT_DOMAIN: 'fbi.com:44301' });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('OTHER=1\nROOT_DOMAIN=fbi.com:44301\n');
  });

  it('refuses values containing newlines (structure corruption guard)', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'ROOT_HOST=ok\n', 'utf8');
    expect(() => upsertLocalEnv(root, { ROOT_HOST: 'evil\nINJECTED=1' })).toThrow(/newline/u);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('ROOT_HOST=ok\n');
  });
});

describe('readRootHostFromEnv', () => {
  it('returns undefined for a missing file or an empty value', () => {
    expect(readRootHostFromEnv(tempWorktree())).toBeUndefined();
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'ROOT_HOST=\n', 'utf8');
    expect(readRootHostFromEnv(root)).toBeUndefined();
  });

  it('reads the value and survives values containing `=`', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'OTHER=x\nROOT_HOST=fbi.com:44301\n', 'utf8');
    expect(readRootHostFromEnv(root)).toBe('fbi.com:44301');
    const root2 = tempWorktree();
    writeFileSync(join(root2, '.env'), 'ROOT_HOST=a=b=c\n', 'utf8');
    expect(readRootHostFromEnv(root2)).toBe('a=b=c');
  });
});
