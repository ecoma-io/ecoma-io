import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  localStackSecrets,
  localStackSecretsKeys,
  runLocalStackStep,
  validateStepTarget,
  LocalStackStepUsageError,
  resolveIdentityInternalSecret,
  type LocalStackStep,
} from './local-stack-step.js';
import { exec, ensureStack, pulumiEnv, pulumiRun, resolveContext } from './pulumi-context.js';
import { acquireLocalDeployLock } from './../../local-runtime/local-lock.js';
import type { ExecResult } from './pulumi-context.js';

/**
 * Spec hành vi của execution boundary Nx (`local-stack-step`) — mock đúng
 * MỘT biên: `exec`/`pulumiRun`/`ensureStack` (Pulumi CLI) và lock (host state).
 * Toàn bộ orchestration logic (validate tổ hợp, secrets per-stack, đọc .env,
 * thứ tự config set rồi up, lỗi → exit 1) vẫn chạy THẬT trong test — không cần
 * Docker hay Pulumi.
 */
vi.mock('./pulumi-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pulumi-context.js')>();
  return {
    ...actual,
    exec: vi.fn<typeof actual.exec>(),
    pulumiRun: vi.fn<typeof actual.pulumiRun>(),
    ensureStack: vi.fn<typeof actual.ensureStack>(),
  };
});

vi.mock('./../../local-runtime/local-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./../../local-runtime/local-lock.js')>();
  return {
    ...actual,
    acquireLocalDeployLock: vi.fn<typeof actual.acquireLocalDeployLock>(() => () => undefined),
  };
});

const execMock = vi.mocked(exec);
const pulumiRunMock = vi.mocked(pulumiRun);
const lockMock = vi.mocked(acquireLocalDeployLock);

const cleanup: string[] = [];

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-stack-step-spec-'));
  cleanup.push(dir);
  return dir;
}

const SAVE_PASSPHRASE = process.env.PULUMI_CONFIG_PASSPHRASE;

afterEach(() => {
  if (SAVE_PASSPHRASE === undefined) delete process.env.PULUMI_CONFIG_PASSPHRASE;
  else process.env.PULUMI_CONFIG_PASSPHRASE = SAVE_PASSPHRASE;
  vi.resetAllMocks();
  // Mock lock trả no-op theo mặc định của factory; resetAllMocks xoá
  // implementation → cài lại cho test kế tiếp.
  lockMock.mockImplementation(() => () => undefined);
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function happyExec(): void {
  execMock.mockImplementation((_command, args) => {
    if (args[0] === 'config' && args[1] === 'get') {
      return { status: 1, stdout: '', stderr: 'error: no value for the key' } satisfies ExecResult;
    }
    return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
  });
  pulumiRunMock.mockReturnValue(undefined);
}

describe('validateStepTarget — combinatorial guard', () => {
  it('env and smoke are platform-only', () => {
    expect(() => validateStepTarget('home-deploy', 'env')).toThrowError(LocalStackStepUsageError);
    expect(() => validateStepTarget('auth-deploy', 'smoke')).toThrowError(LocalStackStepUsageError);
    expect(() => validateStepTarget('platform-deploy', 'env')).not.toThrow();
    expect(() => validateStepTarget('platform-deploy', 'smoke')).not.toThrow();
    for (const project of [
      'platform-deploy',
      'home-deploy',
      'backoffice-deploy',
      'account-deploy',
      'auth-deploy',
    ]) {
      expect(() => validateStepTarget(project, 'up')).not.toThrow();
    }
  });

  it('up on a non-deploy project name is rejected by the up path (no state touched)', async () => {
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    happyExec();
    const root = tempWorktree();
    // `up` cho project lạ KHÔNG nằm trong lane — vẫn chạy được ở mức hàm (Nx là
    // nơi quyết định project nào gọi), nhưng thiếu ROOT_HOST trong .env nên nó
    // phải dừng TRƯỚC khi chạm Pulumi.
    const exit = await runLocalStackStep('not-a-lane-project', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
  });
});

describe('runLocalStackStep up — unit project path', () => {
  it('writes per-stack secrets via stdin then runs up (order: ensureStack → config set → up)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40010\n', 'utf8');
    happyExec();

    const exit = await runLocalStackStep('backoffice-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);

    // Lock bao trọn phần mutate.
    expect(lockMock).toHaveBeenCalledTimes(1);

    // Secrets: hai key của backoffice, giá trị qua stdin (không argv).
    const configSets = execMock.mock.calls.filter(([, args]) => args[1] === 'set');
    expect(configSets.map(([, args]) => args[2])).toEqual([
      'namespace:runtimePassword',
      'namespace:migratorPassword',
    ]);
    for (const call of configSets) {
      expect(call[1]).toContain('--plaintext');
      expect(call[4]).toEqual({ input: expect.any(String) });
    }

    // up: đúng 1 lần, platformStackRef trỏ platform của cùng worktree.
    const upCalls = pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0][1]).toBe('backoffice-deploy');
    const stackRefArg = upCalls[0][2].find((arg) => arg.startsWith('namespace:platformStackRef='));
    expect(stackRefArg).toMatch(
      /^namespace:platformStackRef=organization\/platform-deploy\/local-w/u,
    );
    expect(upCalls[0][5]?.prepareStack).toBe(true);
  });

  it('auth reads the internal HMAC secret from the account stack config (cross-process invariant)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40011\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      // `pulumi config get namespace:internalHmacSecret --stack .../account-deploy/...`
      if (args[1] === 'get') {
        const stackRef = args[args.indexOf('--stack') + 1] ?? '';
        if (stackRef.includes('account-deploy')) {
          return {
            status: 0,
            stdout: 'shared-hmac-value-32-chars-min!!\n',
            stderr: '',
          } satisfies ExecResult;
        }
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('auth-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);

    const authSets = execMock.mock.calls.filter(
      ([, args]) =>
        args[1] === 'set' && (args[args.indexOf('--stack') + 1] ?? '').includes('auth-deploy'),
    );
    const keys = authSets.map(([, args]) => args[2]);
    expect(keys).toContain('namespace:internalSecret');
    const internalSet = authSets.find(([, args]) => args[2] === 'namespace:internalSecret');
    // CÙNG giá trị với secret account đã persist — invariant envelope HMAC.
    expect(internalSet?.[4]).toEqual({ input: 'shared-hmac-value-32-chars-min!!' });
    // issuer/audience suy từ ROOT_HOST của .env.
    const issuerSet = authSets.find(([, args]) => args[2] === 'namespace:issuer');
    expect(issuerSet?.[4]).toEqual({ input: 'https://auth.fbi.com:40011' });
  });

  it('auth up FAILS when the account secret is unreadable (dependsOn violated → no silent half-wired stack)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40012\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 6,
          stdout: '',
          stderr: "error: no stack named 'organization/account-deploy/local-x' found",
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('auth-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    // Không ensureStack, không up — auth không được phép lên nửa chừng thiếu secret.
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
  });

  it('missing ROOT_HOST in .env → exit 1 BEFORE touching Pulumi (env step was skipped upstream)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    happyExec();
    const exit = await runLocalStackStep('home-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
  });

  it('config set failure → exit 1 and NO pulumi up (partial secret state must not deploy)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40013\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return { status: 1, stdout: '', stderr: 'error: no value' } satisfies ExecResult;
      }
      if (args[1] === 'set') {
        return { status: 1, stdout: '', stderr: 'boom: backend unavailable' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('backoffice-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    expect(pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up')).toHaveLength(0);
  });
});

describe('runLocalStackStep up — platform path', () => {
  it('resolves postgres password BEFORE up and streams the up', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key postgres:password',
        } satisfies ExecResult;
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return { status: 1, stdout: '', stderr: 'Error: No such volume' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);
    const upCalls = pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0][1]).toBe('platform-deploy');
    // Platform up KHÔNG mang platformStackRef (chính nó là nguồn).
    expect(upCalls[0][2].join(' ')).not.toContain('platformStackRef=organization');
  });
});

describe('runLocalStackStep env', () => {
  it('reads outputs and writes .env with ROOT_HOST + POSTGRES_PASSWORD from canonical config', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    mkdirSync(join(root, '.pulumi-local-state'), { recursive: true });
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return { status: 0, stdout: 'canonical-pw\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockImplementation((_dir, _project, args) => {
      if (args[0] === 'stack' && args[1] === 'output') {
        return `${JSON.stringify({ traefikHostPort: 40020 })}\n`;
      }
      return undefined;
    });

    const exit = await runLocalStackStep('platform-deploy', 'env', { worktreeRoot: root });
    expect(exit).toBe(0);
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40020');
    expect(content).toContain('POSTGRES_PASSWORD=canonical-pw');
    // env là read-only đối với state: KHÔNG up, KHÔNG ensureStack.
    expect(pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up')).toHaveLength(0);
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
  });

  it('worktree never deployed (no state dir) → exit 1, nothing read', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    happyExec();
    const exit = await runLocalStackStep('platform-deploy', 'env', { worktreeRoot: root });
    expect(exit).toBe(1);
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.env'))).toBe(false);
  });
});

describe('runLocalStackStep smoke', () => {
  it('runs the smoke script with the ROOT_HOST from .env', async () => {
    const nodeCalls: Array<[string, string]> = [];
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40030\n', 'utf8');
    execMock.mockImplementation((command, args) => {
      if (command === 'node') {
        // Script smoke không được chạy thật trong test — mock chỉ GHI NHẬN lệnh
        // rồi trả xanh; assert nằm ngoài mock (xen `nodeCalls`).
        nodeCalls.push([String(args[0]), String(args[1])]);
        return { status: 0, stdout: 'ok\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });

    const exit = await runLocalStackStep('platform-deploy', 'smoke', { worktreeRoot: root });
    expect(exit).toBe(0);
    expect(nodeCalls).toHaveLength(1);
    expect(nodeCalls[0][0]).toMatch(/local-smoke\.mjs$/u);
    expect(nodeCalls[0][1]).toBe('fbi.com:40030');
  });

  it('smoke script failure → exit 1 (chain fails loudly at the leaf)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40031\n', 'utf8');
    execMock.mockReturnValue({ status: 1, stdout: '', stderr: 'timeout' } satisfies ExecResult);
    const exit = await runLocalStackStep('platform-deploy', 'smoke', { worktreeRoot: root });
    expect(exit).toBe(1);
  });
});

describe('localStackSecrets — per-stack secret contract', () => {
  const base = { rootHost: 'fbi.com:1', identityInternalSecret: 'shared', signingKeyPem: 'PEM' };

  it('account and auth receive the SAME internal secret value', () => {
    const account = localStackSecrets('account-deploy', base);
    const auth = localStackSecrets('auth-deploy', base);
    const accountSecret = account.find(([k]) => k === 'namespace:internalHmacSecret')?.[1];
    const authSecret = auth.find(([k]) => k === 'namespace:internalSecret')?.[1];
    expect(accountSecret).toBe('shared');
    expect(authSecret).toBe('shared');
  });

  it('every secret key is unique per stack (no accidental overwrite inside one stack)', () => {
    for (const project of ['account-deploy', 'auth-deploy', 'backoffice-deploy']) {
      const keys = localStackSecretsKeys(project, base);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('platform has NO per-stack secrets (its password lives in the postgres:password path)', () => {
    expect(localStackSecrets('platform-deploy', base)).toEqual([]);
    expect(localStackSecrets('home-deploy', base)).toEqual([]);
  });
});

describe('resolveIdentityInternalSecret — persistence contract', () => {
  const ctx = resolveContext(tempWorktree());
  const env = pulumiEnv(ctx, { kind: 'inline', value: 'unit-test-pass' });

  it('account generates a fresh secret (it runs first)', () => {
    const a = resolveIdentityInternalSecret('account-deploy', ctx, env);
    const b = resolveIdentityInternalSecret('account-deploy', ctx, env);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(a?.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b); // sinh ngẫu nhiên mỗi lần — account persist giá trị của nó
  });

  it('non-identity projects get an empty string (no secret needed)', () => {
    expect(resolveIdentityInternalSecret('home-deploy', ctx, env)).toBe('');
    expect(resolveIdentityInternalSecret('backoffice-deploy', ctx, env)).toBe('');
    expect(resolveIdentityInternalSecret('platform-deploy', ctx, env)).toBe('');
  });
});

describe('step type surface', () => {
  it('exactly three steps exist (up, env, smoke) — adding one requires touching this spec', async () => {
    const mod = await import('./local-stack-step.js');
    expect(mod.LOCAL_STACK_STEPS).toEqual(['up', 'env', 'smoke']);
    const step: LocalStackStep = 'up';
    expect(['up', 'env', 'smoke']).toContain(step);
  });
});
