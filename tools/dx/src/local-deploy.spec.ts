import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  localDeploy,
  DEPLOY_STEPS,
  upsertLocalEnv,
  type LocalDeployContext,
  resolveContext,
} from './local-deploy.js';
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
});
