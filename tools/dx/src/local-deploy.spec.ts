import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  localDeploy,
  classifyStackOutput,
  DEPLOY_STEPS,
  upsertLocalEnv,
  isConfigKeyMissing,
} from './local-deploy.js';
import { resolveContext, type LocalDeployContext } from './pulumi-context.js';
import { worktreeNamespace } from './deploy-namespace.js';

const cleanup: string[] = [];

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-deploy-spec-'));
  cleanup.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('DEPLOY_STEPS', () => {
  it('thứ tự contract: platform → outputs → env → home → smoke', () => {
    expect(DEPLOY_STEPS).toEqual([
      'platform-up',
      'read-outputs',
      'update-env',
      'home-up',
      'smoke-https',
    ]);
  });
});

describe('resolveContext', () => {
  it('mỗi worktree một namespace, stack và state backend riêng', () => {
    const a = resolveContext(tempWorktree());
    const b = resolveContext(tempWorktree());
    expect(a.namespace).not.toBe(b.namespace);
    expect(a.stackName).not.toBe(b.stackName);
    expect(a.stateUrl).not.toBe(b.stateUrl);
  });

  it('stack name tuân contract local-<ns> và state nằm trong worktree (ngoài Git)', () => {
    const root = tempWorktree();
    const ctx: LocalDeployContext = resolveContext(root);
    expect(ctx.stackName).toBe(`local-${worktreeNamespace(root)}`);
    expect(ctx.stateUrl.startsWith(`file://${root}`)).toBe(true);
  });
});

describe('upsertLocalEnv', () => {
  it('file chưa tồn tại → tạo mới với đúng một key', () => {
    const root = tempWorktree();
    const { envPath } = upsertLocalEnv(root, 'fbi.com:40000');
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('ROOT_HOST=fbi.com:40000\n');
  });

  it('key đã có → thay đúng dòng đó, giữ nguyên mọi key khác', () => {
    const root = tempWorktree();
    writeFileSync(
      join(root, '.env'),
      ['# comment giữ nguyên', 'OTHER_KEY=keepme', 'ROOT_HOST=fbi.com:1', 'TRAILING=yes'].join(
        '\n',
      ),
      'utf8',
    );
    upsertLocalEnv(root, 'fbi.com:40001');
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40001');
    expect(content).toContain('# comment giữ nguyên');
    expect(content).toContain('OTHER_KEY=keepme');
    expect(content).toContain('TRAILING=yes');
    expect(content).not.toContain('fbi.com:1');
  });

  it('key chưa có trong file hiện hữu → thêm cuối, không xoá gì', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'ONLY=one', 'utf8');
    upsertLocalEnv(root, 'fbi.com:40002');
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ONLY=one');
    expect(content).toContain('ROOT_HOST=fbi.com:40002');
  });

  it('chạy hai lần với port khác nhau → giá trị cuối thắng, không nhân bản dòng', () => {
    const root = tempWorktree();
    upsertLocalEnv(root, 'fbi.com:40003');
    upsertLocalEnv(root, 'fbi.com:40004');
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content.match(/ROOT_HOST=/gu)?.length).toBe(1);
    expect(content).toContain('ROOT_HOST=fbi.com:40004');
  });
});

describe('localDeploy previewOnly', () => {
  it('previewOnly không bao giờ ghi .env — dù preview thành công hay thất bại', () => {
    const root = tempWorktree();
    // Exit code của preview tuỳ môi trường (máy có pulumi + daemon → preview
    // thành công thật; máy không có → fail nhanh), nhưng bất biến phải giữ ở
    // CẢ HAI: port do Docker cấp chỉ tồn tại sau up thật, nên `.env` không
    // bao giờ được ghi trong preview mode.
    localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('missing passphrase → exit 1 TRƯỚC khi chạm Pulumi, không tạo state dir', () => {
    const root = tempWorktree();
    const saved = process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    try {
      const exit = localDeploy({ worktreeRoot: root, previewOnly: true });
      expect(exit).toBe(1);
      // Fail-early nghĩa là KHÔNG có thư mục state nào được tạo ra — mutation
      // chưa bắt đầu thì không để lại dấu vết nửa chừng.
      expect(existsSync(join(root, '.pulumi-local-state'))).toBe(false);
      expect(existsSync(join(root, '.env'))).toBe(false);
    } finally {
      if (saved !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE = saved;
    }
  });
});

describe('classifyStackOutput — local-status state machine', () => {
  it('exit 0 + `{}` (stack init, chưa từng up) → no-outputs, KHÔNG phải deployed', () => {
    const result = classifyStackOutput({ status: 0, stdout: '{}\n', stderr: '' });
    expect(result).toEqual({ state: 'no-outputs' });
  });

  it('exit 0 + outputs đầy đủ → deployed kèm outputs', () => {
    const outputs = { traefikHostPort: 34942, namespace: 'wtest' };
    const result = classifyStackOutput({
      status: 0,
      stdout: `${JSON.stringify(outputs)}\n`,
      stderr: '',
    });
    expect(result).toEqual({ state: 'deployed', outputs });
  });

  it('exit != 0 + "no stack named" → no-stack (chưa init — KHÔNG phải backend error)', () => {
    const result = classifyStackOutput({
      status: 6,
      stdout: '',
      stderr: "error: no stack named 'local-wabc' found",
    });
    expect(result).toEqual({ state: 'no-stack' });
  });

  it('exit != 0 + backend không mở được → backend-error (exit code của status phải khác 0)', () => {
    const result = classifyStackOutput({
      status: 1,
      stdout: '',
      stderr: 'error: unable to open state directory "file:///x": no such file or directory',
    });
    expect(result.state).toBe('backend-error');
    // Extract bằng cast để tránh `expect` trong if (vitest/no-conditional-expect);
    // state đã được assert ngay trên nên cast này luôn đúng.
    const detail = (result as { detail?: string }).detail ?? '';
    expect(detail).toContain('unable to open state directory');
  });

  it('exit 0 + stdout không phải JSON → parse-error (không nuốt thành no-outputs)', () => {
    const result = classifyStackOutput({ status: 0, stdout: 'not-json{{', stderr: '' });
    expect(result.state).toBe('parse-error');
  });

  it('exit != 0 + lỗi không nhận diện được → backend-error với dòng lỗi đầu, KHÔNG phải no-stack', () => {
    const result = classifyStackOutput({
      status: 1,
      stdout: '',
      stderr: 'error: something unprecedented went wrong',
    });
    expect(result.state).toBe('backend-error');
    const detail = (result as { detail?: string }).detail ?? '';
    expect(detail).toContain('something unprecedented');
  });
});

describe('isConfigKeyMissing — secret regen guard', () => {
  it('CLI báo "no value for the key" → true (được phép regen)', () => {
    expect(
      isConfigKeyMissing({
        status: 1,
        stdout: '',
        stderr: 'error: no value for the key postgres:password',
      }),
    ).toBe(true);
    // Biến thể message của CLI: "configuration key ... not found"
    expect(
      isConfigKeyMissing({
        status: 1,
        stdout: '',
        stderr: 'error: configuration key "postgres:password" not found',
      }),
    ).toBe(true);
  });

  it('sai passphrase (secret không giải được) → false — phải fail, KHÔNG regen', () => {
    // Lỗi decrypt của sai passphrase có dạng này — exit != 0 nhưng KHÔNG phải
    // "key missing". Guard cũ gộp nhánh → regen đè secret tốt. Đây chính là
    // regression mà review bắt.
    expect(
      isConfigKeyMissing({
        status: 1,
        stdout: '',
        stderr:
          'error: could not decrypt configuration value: cipher: message authentication failed',
      }),
    ).toBe(false);
  });

  it('lỗi khác (backend hỏng, lock) → false', () => {
    expect(
      isConfigKeyMissing({
        status: 1,
        stdout: '',
        stderr: 'error: could not open state directory',
      }),
    ).toBe(false);
  });

  it('status 0 nhưng stdout rỗng → false về pattern... nhưng caller vẫn regen qua nhánh stdout rỗng', () => {
    // Guard hai lớp: isConfigKeyMissing chỉ nhận diện chữ ký; nhánh regen của
    // caller vẫn là `stdout rỗng` SAU KHI đã pass qua guard throw. Case status 0
    // + rỗng không thể xảy ra trên CLI thật (exit 0 luôn kèm giá trị) nhưng
    // hợp đồng của helper là nhận diện chữ ký, không quyết định regen.
    expect(isConfigKeyMissing({ status: 0, stdout: '', stderr: '' })).toBe(false);
  });
});
