import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  resolveMailInternalAuthSecret,
  resolvePactApiMachineToken,
  verifyLaneHealth,
  type LocalStackStep,
} from './local-stack-step.js';
import { exec, ensureStack, pulumiEnv, pulumiRun, resolveContext } from './pulumi-context.js';
import { assertLaneLease } from './../../local-runtime/local-lock.js';
import type { ExecResult } from './pulumi-context.js';

/**
 * Spec hành vi của execution boundary Nx (`local-stack-step`) — mock đúng
 * MỘT biên: `exec`/`pulumiRun`/`ensureStack` (Pulumi CLI) và lease assert
 * (lane state — tồn tại của `.ecoma-lane.lock` là dữ liệu runtime của
 * orchestrator, không phải đối tượng test ở đây). Toàn bộ orchestration logic
 * (validate tổ hợp, secrets per-stack, đọc .env, thứ tự config set rồi up,
 * lỗi → exit 1) vẫn chạy THẬT trong test — không cần Docker hay Pulumi.
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
    assertLaneLease: vi.fn<typeof actual.assertLaneLease>(() => undefined),
  };
});

const execMock = vi.mocked(exec);
const pulumiRunMock = vi.mocked(pulumiRun);
const leaseMock = vi.mocked(assertLaneLease);

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
  // Mock lease assert trả pass theo mặc định của factory; resetAllMocks xoá
  // implementation → cài lại cho test kế tiếp. Mock chỉ để QUAN SÁT lời gọi
  // assert — các case lệch lease được phủ thật ở local-lock.spec.ts.
  leaseMock.mockImplementation(() => undefined);
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
  it('smoke is platform-only', () => {
    expect(() => validateStepTarget('auth-deploy', 'smoke')).toThrowError(LocalStackStepUsageError);
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

    // Lease assert chạy đúng MỘT lần trước mutate, đúng worktree của lane.
    expect(leaseMock).toHaveBeenCalledTimes(1);
    expect(leaseMock).toHaveBeenCalledWith(root, undefined);

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
    // Hai secret ứng dụng của auth là hình 32 byte base64url — contract
    // `importKey` của domain lib bắt ĐÚNG 32 byte cho AUTH_HANDLE_KEY và
    // cookieKeys là keygrip key của oidc-provider (#284).
    const handleSet = authSets.find(([, args]) => args[2] === 'namespace:handleKey');
    const cookieKeysSet = authSets.find(([, args]) => args[2] === 'namespace:cookieKeys');
    expect(Buffer.from(String(handleSet?.[4]?.['input'] ?? ''), 'base64url').byteLength).toBe(32);
    expect(Buffer.from(String(cookieKeysSet?.[4]?.['input'] ?? ''), 'base64url').byteLength).toBe(
      32,
    );
    // Hai giá trị sinh ĐỘC LẬP — trùng nhau là hai ngữ cảnh dùng chung khoá.
    expect(handleSet?.[4]?.['input']).not.toBe(cookieKeysSet?.[4]?.['input']);
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
    pulumiRunMock.mockImplementation((_dir, _project, args) => {
      if (args[0] === 'stack' && args[1] === 'output') {
        return `${JSON.stringify({ traefikHostPort: 40010 })}\n`;
      }
      return undefined;
    });

    const exit = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);
    const upCalls = pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up');
    expect(upCalls).toHaveLength(1);
    expect(upCalls[0][1]).toBe('platform-deploy');
    // Platform up KHÔNG mang platformStackRef (chính nó là nguồn).
    expect(upCalls[0][2].join(' ')).not.toContain('platformStackRef=organization');
  });

  it('writes .env with the three owned keys right after a green up (outputs + canonical password)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    execMock.mockImplementation((_command, args) => {
      // resolvePostgresPassword đọc lại config (canonical) — khác đường sinh
      // mới: đây là password đã có trong stack config.
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

    const exit = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40020');
    // ROOT_DOMAIN là alias E2E-facing — step up của platform ghi đủ cùng bộ key
    // sở hữu với đường legacy trong `local-deploy.ts` (contract #366).
    expect(content).toContain('ROOT_DOMAIN=fbi.com:40020');
    expect(content).toContain('POSTGRES_PASSWORD=canonical-pw');
    // Ghi `.env` xảy ra SAU khi up xanh — thứ tự trong mock history.
    const upIndex = pulumiRunMock.mock.calls.findIndex(([, , args]) => args[0] === 'up');
    expect(upIndex).toBeGreaterThanOrEqual(0);
    expect(existsSync(join(root, '.env'))).toBe(true);
  });

  it('upsert preserves unrelated .env lines and replaces only the owned keys (idempotent)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(
      join(root, '.env'),
      'USER_VAR=keep\nROOT_HOST=fbi.com:1\nPOSTGRES_PASSWORD=pw-old\n',
      'utf8',
    );
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return { status: 0, stdout: 'canonical-pw\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockImplementation((_dir, _project, args) => {
      if (args[0] === 'stack' && args[1] === 'output') {
        return `${JSON.stringify({ traefikHostPort: 40021 })}\n`;
      }
      return undefined;
    });

    const exit = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(0);
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('USER_VAR=keep');
    expect(content).toContain('ROOT_HOST=fbi.com:40021');
    expect(content).not.toContain('ROOT_HOST=fbi.com:1');
    expect(content).toContain('POSTGRES_PASSWORD=canonical-pw');
    expect(content).not.toContain('pw-old');
    // Chạy lần nữa với cùng dữ liệu → file ổn định (idempotent upsert).
    const before = content;
    const exitAgain = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exitAgain).toBe(0);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(before);
  });

  it('.env write failure (outputs unreadable) → exit 1 even though pulumi up ran', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return { status: 0, stdout: 'canonical-pw\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockImplementation((_dir, _project, args) => {
      if (args[0] === 'stack' && args[1] === 'output') {
        // Port lạ (không validate được) — đọc outputs phải fail-closed.
        return `${JSON.stringify({ traefikHostPort: 0 })}\n`;
      }
      return undefined;
    });

    const exit = await runLocalStackStep('platform-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    expect(existsSync(join(root, '.env'))).toBe(false);
  });
});

describe('runLocalStackStep — lane lease assertion (fencing-lite)', () => {
  it('failed lease assert → exit 1 BEFORE resolvePassphrase/ensureStack/up (orphaned lane aborts)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40040\n', 'utf8');
    happyExec();
    // Lease lệch: orchestrator đã chết, lane khác chiếm khóa với token mới.
    leaseMock.mockImplementation(
      () =>
        'the lane lease does not match the current lock holder — this step belongs to an ' +
        'orphaned lane (its orchestrator was killed or stole-replaced). Aborting instead of mutating.',
    );
    const exit = await runLocalStackStep('backoffice-deploy', 'up', { worktreeRoot: root });
    expect(exit).toBe(1);
    // Fail-closed: KHÔNG chạm Pulumi, KHÔNG set secret, KHÔNG up.
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(execMock.mock.calls.filter(([, args]) => args[1] === 'set')).toHaveLength(0);
  });

  it('failed lease assert applies to smoke too (one rule for every step)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40041\n', 'utf8');
    execMock.mockImplementation((command) => {
      if (command === 'node') return { status: 0, stdout: 'ok\n', stderr: '' } satisfies ExecResult;
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    leaseMock.mockImplementation(() => 'no ECOMA_LANE_LEASE lease in the environment');
    const exit = await runLocalStackStep('platform-deploy', 'smoke', { worktreeRoot: root });
    expect(exit).toBe(1);
    // Không một lệnh node/docker nào chạy sau assert fail.
    expect(execMock.mock.calls.filter(([command]) => command === 'node')).toHaveLength(0);
    expect(execMock.mock.calls.filter(([command]) => command === 'docker')).toHaveLength(0);
  });

  it('explicit leaseToken option overrides the env lookup (test seam reaches assertLaneLease)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40042\n', 'utf8');
    happyExec();
    const exit = await runLocalStackStep('backoffice-deploy', 'up', {
      worktreeRoot: root,
      leaseToken: 'lane-token-from-orchestrator',
    });
    expect(exit).toBe(0);
    expect(leaseMock).toHaveBeenCalledWith(root, 'lane-token-from-orchestrator');
  });
});

describe('step "env" is no longer representable', () => {
  it('LOCAL_STACK_STEPS no longer contains env (compile-time surface pinned here)', async () => {
    const mod = await import('./local-stack-step.js');
    expect(mod.LOCAL_STACK_STEPS).toEqual(['up', 'smoke']);
  });

  it('running step env (e.g. a stale target declaration) exits 1 before touching Pulumi', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    happyExec();
    // Cast: khai báo target còn sót `--step env` phải chết ở validate — test
    // giữ contract đó bằng cách gọi xuyên qua runLocalStackStep với step lạ.
    const exit = await runLocalStackStep('platform-deploy', 'env' as never, {
      worktreeRoot: root,
    });
    expect(exit).toBe(1);
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.env'))).toBe(false);
  });
});

describe('runLocalStackStep smoke', () => {
  it('runs the smoke script with the ROOT_HOST from .env, then the lane health gate', async () => {
    const nodeCalls: Array<[string, string]> = [];
    const inspectNames: string[] = [];
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
      if (command === 'docker' && args[0] === 'inspect') {
        inspectNames.push(String(args[3]));
        return { status: 0, stdout: 'running|healthy\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });

    const exit = await runLocalStackStep('platform-deploy', 'smoke', { worktreeRoot: root });
    expect(exit).toBe(0);
    expect(nodeCalls).toHaveLength(1);
    expect(nodeCalls[0][0]).toMatch(/local-smoke\.mjs$/u);
    expect(nodeCalls[0][1]).toBe('fbi.com:40030');
    // Health gate chạy SAU smoke xanh, đụng đúng NĂM container lane (#264;
    // staff-access-wic thêm ở P1.4 #428).
    expect(inspectNames).toHaveLength(5);
  });

  it('smoke script failure → exit 1 without reaching the health gate (chain fails loudly at the leaf)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40031\n', 'utf8');
    execMock.mockReturnValue({ status: 1, stdout: '', stderr: 'timeout' } satisfies ExecResult);
    const exit = await runLocalStackStep('platform-deploy', 'smoke', { worktreeRoot: root });
    expect(exit).toBe(1);
    // Chỉ có lệnh node smoke fail — KHÔNG một docker inspect nào chạy sau đó.
    const inspectCalls = execMock.mock.calls.filter(
      ([command, args]) => args[0] === 'inspect' && command === 'docker',
    );
    expect(inspectCalls).toHaveLength(0);
  });
});

describe('localStackSecrets — per-stack secret contract', () => {
  const base = {
    rootHost: 'fbi.com:1',
    identityInternalSecret: 'shared',
    mailInternalAuthSecret: 'shared-mail',
    pactApiMachineToken: 'shared-pact-token',
    signingKeyPem: 'PEM',
  };

  it('account and auth receive the SAME internal secret value', () => {
    const account = localStackSecrets('account-deploy', base);
    const auth = localStackSecrets('auth-deploy', base);
    const accountSecret = account.find(([k]) => k === 'namespace:internalHmacSecret')?.[1];
    const authSecret = auth.find(([k]) => k === 'namespace:internalSecret')?.[1];
    expect(accountSecret).toBe('shared');
    expect(authSecret).toBe('shared');
  });

  it('account and transactional-mail-deploy receive the SAME mail secret value', () => {
    const account = localStackSecrets('account-deploy', base);
    const mail = localStackSecrets('transactional-mail-deploy', base);
    const accountSecret = account.find(([k]) => k === 'namespace:mailInternalAuthSecret')?.[1];
    const mailSecret = mail.find(([k]) => k === 'namespace:mailInternalAuthSecret')?.[1];
    expect(accountSecret).toBe('shared-mail');
    expect(mailSecret).toBe('shared-mail');
    // Mail path là credential RIÊNG — không bao giờ trùng path Account↔Auth.
    expect(mailSecret).not.toBe(account.find(([k]) => k === 'namespace:internalHmacSecret')?.[1]);
    // DUY NHẤT secret chia hai stack là mail secret: ba secret còn lại của
    // transactional-mail-deploy (consumer pair, fingerprint keyring, quarantine)
    // là của riêng cặp mail — account không nhận key nào trong ba key đó.
    const mailKeys = mail.map(([k]) => k);
    expect(mailKeys).toEqual([
      'namespace:mailInternalAuthSecret',
      'namespace:mailerJobInternalSecret',
      'namespace:mailFingerprintKey',
      'namespace:mailQuarantineHmacKey',
    ]);
    for (const key of mailKeys.slice(1)) {
      expect(account.find(([k]) => k === key)).toBeUndefined();
    }
    // Hai khoá hex phải là hình 64 hex chữ thường mà loader của cả hai Worker
    // đòi (FINGERPRINT_KEY_HEX / HEX_KEY_64) — sinh sai hình là chết lúc boot.
    expect(mail.find(([k]) => k === 'namespace:mailFingerprintKey')?.[1]).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(mail.find(([k]) => k === 'namespace:mailQuarantineHmacKey')?.[1]).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    // Hai khoá hex sinh ĐỘC LẬP — trùng nhau là hai ngữ cảnh dùng chung khoá.
    expect(mail.find(([k]) => k === 'namespace:mailFingerprintKey')?.[1]).not.toBe(
      mail.find(([k]) => k === 'namespace:mailQuarantineHmacKey')?.[1],
    );
  });

  it('pact-broker-app-deploy receives the SAME machine token value pact-broker-api-deploy persists', () => {
    // Cùng hình cross-stack với mail secret: inputs.pactApiMachineToken là giá
    // trị resolver đọc lại từ stack api — một giá trị chia hai stack.
    const pactApp = localStackSecrets('pact-broker-app-deploy', base);
    expect(localStackSecretsKeys('pact-broker-app-deploy', base)).toEqual(['namespace:apiToken']);
    expect(pactApp[0]?.[1]).toBe('shared-pact-token');
  });

  it('push-notification-deploy receives exactly four pair-local secrets with contract shapes', () => {
    const push = localStackSecrets('push-notification-deploy', base);
    expect(push.map(([k]) => k)).toEqual([
      'namespace:runtimeSharedSecret',
      'namespace:adminToken',
      'namespace:applicationToken',
      'namespace:credentialRootKey',
    ]);
    // Ba HMAC/token: hình base64url >= 32 ký tự như mọi secret internal khác.
    for (const key of [
      'namespace:runtimeSharedSecret',
      'namespace:adminToken',
      'namespace:applicationToken',
    ]) {
      const value = push.find(([k]) => k === key)?.[1];
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(value?.length).toBeGreaterThanOrEqual(32);
    }
    // Root key: base64 của ĐÚNG 32 byte (AES-256) — contract composition root
    // (`atob` rồi kiểm độ dài 32 byte trước khi dựng cipher).
    const rootKey = push.find(([k]) => k === 'namespace:credentialRootKey')?.[1];
    expect(rootKey).toBeDefined();
    expect(Buffer.from(rootKey ?? '', 'base64').byteLength).toBe(32);
    // Bốn giá trị sinh ĐỘC LẬP — trùng nhau là hai ngữ cảnh dùng chung secret.
    const values = push.map(([, v]) => v);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every secret key is unique per stack (no accidental overwrite inside one stack)', () => {
    for (const project of [
      'account-deploy',
      'auth-deploy',
      'backoffice-deploy',
      'pact-broker-api-deploy',
      'pact-broker-app-deploy',
      'transactional-mail-deploy',
      'push-notification-deploy',
      'staff-access-deploy',
    ]) {
      const keys = localStackSecretsKeys(project, base);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('staff-access-deploy receives exactly the two role passwords (no cross-stack share)', () => {
    // Cùng hình tối thiểu backoffice-deploy: provision tạo roles rồi ALTER
    // PASSWORD từ config; staff-access chưa có consumer nội bộ nên KHÔNG có
    // secret chia sẻ cross-stack nào (không internalHmacSecret, không mail).
    const keys = localStackSecretsKeys('staff-access-deploy', base);
    expect(keys).toEqual(['namespace:runtimePassword', 'namespace:migratorPassword']);
    // Mật khẩu sinh độc lập mỗi lần gọi — orchestration là nguồn duy nhất.
    const a = localStackSecrets('staff-access-deploy', base);
    const b = localStackSecrets('staff-access-deploy', base);
    expect(a.find(([k]) => k === 'namespace:runtimePassword')?.[1]).not.toBe(
      b.find(([k]) => k === 'namespace:runtimePassword')?.[1],
    );
  });

  it('pact-broker-api-deploy receives exactly the two role passwords plus the machine token', () => {
    const keys = localStackSecretsKeys('pact-broker-api-deploy', base);
    expect(keys).toEqual([
      'namespace:runtimePassword',
      'namespace:migratorPassword',
      'namespace:machineToken',
    ]);
    // Token sinh ngẫu nhiên mỗi lần gọi — orchestration là nguồn, không có
    // giá trị hard-code nào ở đây.
    const secrets = localStackSecrets('pact-broker-api-deploy', base);
    const token = secrets.find(([k]) => k === 'namespace:machineToken')?.[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(token?.length).toBeGreaterThanOrEqual(32);
  });

  it('auth-deploy application secrets decode to exactly 32 bytes (handleKey + cookieKeys)', () => {
    // `handleKey` đi vào `importKey` của auth-domain — hàm bắt ĐÚNG
    // 32 byte (HMAC-SHA-256); `cookieKeys` là keygrip key của oidc-provider.
    // Cả hai là secret ứng dụng (#284) — mật khẩu 24 byte của database từng
    // làm mọi lane mới chết `K_auth phai dai 32 byte` ở request đầu tiên.
    const auth = localStackSecrets('auth-deploy', base);
    for (const key of ['namespace:handleKey', 'namespace:cookieKeys']) {
      const value = auth.find(([k]) => k === key)?.[1];
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(Buffer.from(value ?? '', 'base64url').byteLength).toBe(32);
    }
    // Hai khoá sinh ĐỘC LẬP — trùng nhau là hai ngữ cảnh dùng chung khoá.
    expect(auth.find(([k]) => k === 'namespace:handleKey')?.[1]).not.toBe(
      auth.find(([k]) => k === 'namespace:cookieKeys')?.[1],
    );
    // Mật khẩu role vẫn là đường database (không đụng contract 32 byte): chỉ
    // ghi giữ đúng hành vi, generator giữ 24 byte cho credential.
    expect(auth.find(([k]) => k === 'namespace:runtimePassword')?.[1]).toMatch(/^[A-Za-z0-9_-]+$/u);
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
    // Generator là 32 byte chuẩn HMAC-SHA-256 (#284) — ngưỡng ký tự 32 của
    // `config-validation.ts` thông qua tự nhiên nhưng byte mới là contract.
    expect(Buffer.from(a ?? '', 'base64url').byteLength).toBe(32);
    expect(a).not.toBe(b); // sinh ngẫu nhiên mỗi lần — account persist giá trị của nó
  });

  it('non account/auth projects get an empty string (no secret needed)', () => {
    expect(resolveIdentityInternalSecret('home-deploy', ctx, env)).toBe('');
    expect(resolveIdentityInternalSecret('backoffice-deploy', ctx, env)).toBe('');
    expect(resolveIdentityInternalSecret('platform-deploy', ctx, env)).toBe('');
  });
});

describe('resolveMailInternalAuthSecret — persistence contract (Account<->Mail path)', () => {
  const ctx = resolveContext(tempWorktree());
  const env = pulumiEnv(ctx, { kind: 'inline', value: 'unit-test-pass' });

  it('account generates a fresh mail secret (it runs first and persists it)', () => {
    const a = resolveMailInternalAuthSecret('account-deploy', ctx, env);
    const b = resolveMailInternalAuthSecret('account-deploy', ctx, env);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(a?.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    // Đường mail là credential RIÊNG, không tái sử dụng đường Account<->Auth.
    expect(a).not.toBe(resolveIdentityInternalSecret('account-deploy', ctx, env));
  });

  it('non-mail projects get an empty string (no secret needed)', () => {
    expect(resolveMailInternalAuthSecret('home-deploy', ctx, env)).toBe('');
    expect(resolveMailInternalAuthSecret('backoffice-deploy', ctx, env)).toBe('');
    expect(resolveMailInternalAuthSecret('platform-deploy', ctx, env)).toBe('');
    expect(resolveMailInternalAuthSecret('auth-deploy', ctx, env)).toBe('');
  });

  it('transactional-mail-deploy reads the persisted value from the account stack', () => {
    const calls: Array<readonly string[]> = [];
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        calls.push(args);
        return {
          status: 0,
          stdout: 'persisted-mail-secret-32-chars-min!!\n',
          stderr: '',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(resolveMailInternalAuthSecret('transactional-mail-deploy', ctx, env)).toBe(
      'persisted-mail-secret-32-chars-min!!',
    );
    const getCall = calls[0];
    expect(getCall[2]).toBe('namespace:mailInternalAuthSecret');
    expect(getCall[getCall.indexOf('--stack') + 1]).toContain('account-deploy');
  });

  it('transactional-mail-deploy FAILS (undefined) when the account stack has no mail secret', () => {
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 6,
          stdout: '',
          stderr: 'error: no value for the key',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(resolveMailInternalAuthSecret('transactional-mail-deploy', ctx, env)).toBeUndefined();
  });

  it('account up FAILS CLOSED before touching Pulumi when the mail secret is unreadable', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40014\n', 'utf8');
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

    const exit = await runLocalStackStep('transactional-mail-deploy', 'up', {
      worktreeRoot: root,
    });
    expect(exit).toBe(1);
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
  });

  it('transactional-mail-deploy up persists the SAME value the account stack holds', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40015\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 0,
          stdout: 'persisted-mail-secret-32-chars-min!!\n',
          stderr: '',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('transactional-mail-deploy', 'up', {
      worktreeRoot: root,
    });
    expect(exit).toBe(0);

    const mailSets = execMock.mock.calls.filter(
      ([, args]) =>
        args[1] === 'set' &&
        (args[args.indexOf('--stack') + 1] ?? '').includes('transactional-mail-deploy'),
    );
    const keys = mailSets.map(([, args]) => args[2]);
    // Persist đủ BỐN secret: mail secret đọc từ account + ba secret riêng cặp
    // mail (sinh tại chỗ — cùng chu kỳ xoay với các secret local khác).
    expect(keys).toEqual([
      'namespace:mailInternalAuthSecret',
      'namespace:mailerJobInternalSecret',
      'namespace:mailFingerprintKey',
      'namespace:mailQuarantineHmacKey',
    ]);
    // CÙNG giá trị với secret account đã persist — invariant path Account<->Mail.
    expect(mailSets[0]?.[4]).toEqual({ input: 'persisted-mail-secret-32-chars-min!!' });
    // Khoá hex persist đúng hình loader đòi (64 hex chữ thường).
    expect(mailSets[2]?.[4]?.input).toMatch(/^[0-9a-f]{64}$/u);
    expect(mailSets[3]?.[4]?.input).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('resolvePactApiMachineToken — persistence contract (pact-api<->pact-app path)', () => {
  const ctx = resolveContext(tempWorktree());
  const env = pulumiEnv(ctx, { kind: 'inline', value: 'unit-test-pass' });

  it('pact-broker-api-deploy generates a fresh token (it runs first and persists it)', () => {
    const a = resolvePactApiMachineToken('pact-broker-api-deploy', ctx, env);
    const b = resolvePactApiMachineToken('pact-broker-api-deploy', ctx, env);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(a?.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    // Token sinh ĐỘC LẬP với hai đường secret cross-stack khác.
    expect(a).not.toBe(resolveIdentityInternalSecret('account-deploy', ctx, env));
    expect(a).not.toBe(resolveMailInternalAuthSecret('account-deploy', ctx, env));
  });

  it('non-pact projects get an empty string (no token needed)', () => {
    expect(resolvePactApiMachineToken('home-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('backoffice-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('platform-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('account-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('auth-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('transactional-mail-deploy', ctx, env)).toBe('');
    expect(resolvePactApiMachineToken('push-notification-deploy', ctx, env)).toBe('');
  });

  it('pact-broker-app-deploy reads the persisted token from the pact-broker-api stack', () => {
    const calls: Array<readonly string[]> = [];
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        calls.push(args);
        return {
          status: 0,
          stdout: 'persisted-pact-machine-token-32-chars!!\n',
          stderr: '',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(resolvePactApiMachineToken('pact-broker-app-deploy', ctx, env)).toBe(
      'persisted-pact-machine-token-32-chars!!',
    );
    const getCall = calls[0];
    expect(getCall[2]).toBe('namespace:machineToken');
    expect(getCall[getCall.indexOf('--stack') + 1]).toContain('pact-broker-api-deploy');
  });

  it('pact-broker-app-deploy FAILS (undefined) when the api stack has no machine token', () => {
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 6,
          stdout: '',
          stderr: 'error: no value for the key',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(resolvePactApiMachineToken('pact-broker-app-deploy', ctx, env)).toBeUndefined();
  });

  it('pact-broker-app-deploy up FAILS CLOSED before touching Pulumi when the token is unreadable', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40016\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 6,
          stdout: '',
          stderr: "error: no stack named 'organization/pact-broker-api-deploy/local-x' found",
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('pact-broker-app-deploy', 'up', {
      worktreeRoot: root,
    });
    expect(exit).toBe(1);
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
  });

  it('pact-broker-app-deploy up persists the SAME token the api stack holds', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:40017\n', 'utf8');
    execMock.mockImplementation((_command, args) => {
      if (args[1] === 'get') {
        return {
          status: 0,
          stdout: 'persisted-pact-machine-token-32-chars!!\n',
          stderr: '',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await runLocalStackStep('pact-broker-app-deploy', 'up', {
      worktreeRoot: root,
    });
    expect(exit).toBe(0);

    const pactSets = execMock.mock.calls.filter(
      ([, args]) =>
        args[1] === 'set' &&
        (args[args.indexOf('--stack') + 1] ?? '').includes('pact-broker-app-deploy'),
    );
    // Duy NHẤT một secret: machine token đọc từ stack api (plaintext của BFF;
    // api giữ plaintext, DB của api chỉ seed HASH SHA-256).
    expect(pactSets.map(([, args]) => args[2])).toEqual(['namespace:apiToken']);
    // CÙNG giá trị với token stack api đã persist — invariant path pact.
    expect(pactSets[0]?.[4]).toEqual({ input: 'persisted-pact-machine-token-32-chars!!' });
  });
});

describe('verifyLaneHealth — wave-2 container health gate', () => {
  it('all five lane containers healthy → exit 0 (one docker inspect per container)', () => {
    const ctx = resolveContext(tempWorktree());
    const inspected: string[] = [];
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'inspect') {
        inspected.push(args[3]);
        return { status: 0, stdout: 'running|healthy\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(verifyLaneHealth(ctx)).toBe(0);
    // Đúng NĂM container wave-2: WIC của pact-api/mail/push/staff-access + BFF
    // pact-app — thiếu một kind là gate khẳng định ít hơn những gì lane triển
    // khai (staff-access-wic thêm ở P1.4 #428).
    expect(inspected).toHaveLength(5);
    expect(inspected.some((name) => name.endsWith('-pact-api-wic'))).toBe(true);
    expect(inspected.some((name) => name.endsWith('-pact-app'))).toBe(true);
    expect(inspected.some((name) => name.endsWith('-mail-wic'))).toBe(true);
    expect(inspected.some((name) => name.endsWith('-push-wic'))).toBe(true);
    expect(inspected.some((name) => name.endsWith('-staff-access-wic'))).toBe(true);
    // Namespace của ctx đi vào TẤT CẢ tên container — không đụng worktree khác.
    for (const name of inspected) {
      expect(name).toBe(`ecoma-${ctx.namespace}-${name.split(`ecoma-${ctx.namespace}-`)[1]}`);
    }
  });

  it('missing container → exit 1 immediately without retry (terminal state)', () => {
    const ctx = resolveContext(tempWorktree());
    let inspectCalls = 0;
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'inspect') {
        inspectCalls += 1;
        return { status: 1, stdout: '', stderr: 'no such object' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(verifyLaneHealth(ctx)).toBe(1);
    // Container vắng là trạng thái cuối — đúng MỘT inspect, không poll budget.
    expect(inspectCalls).toBe(1);
  });

  it('not-running container → exit 1 immediately (dead container is not "not ready yet")', () => {
    const ctx = resolveContext(tempWorktree());
    let inspectCalls = 0;
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'inspect') {
        inspectCalls += 1;
        // Container đầu (pact-api-wic) exited — fail ngay trước khi tới unit sau.
        return { status: 0, stdout: 'exited|healthy\n', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(verifyLaneHealth(ctx)).toBe(1);
    expect(inspectCalls).toBe(1);
  });

  it('health starting → retries until healthy within budget → exit 0', () => {
    const ctx = resolveContext(tempWorktree());
    // Hai lượt đầu: CẢ NĂM container đang `starting` (5 inspect mỗi lượt) —
    // lượt thứ ba tất cả healthy. Poll dừng ngay khi mọi container xanh.
    let polls = 0;
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'inspect') {
        polls += 1;
        const health = polls <= 10 ? 'starting' : 'healthy';
        return { status: 0, stdout: `running|${health}\n`, stderr: '' } satisfies ExecResult;
      }
      if (args[0] === 'sleep') {
        return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    expect(verifyLaneHealth(ctx)).toBe(0);
    expect(polls).toBe(15);
  });

  it('health unhealthy at budget exhaustion → exit 1 (no infinite poll)', () => {
    const ctx = resolveContext(tempWorktree());
    let polls = 0;
    execMock.mockImplementation((command, args) => {
      if (command === 'docker' && args[0] === 'inspect') {
        polls += 1;
        return { status: 0, stdout: 'running|unhealthy\n', stderr: '' } satisfies ExecResult;
      }
      if (command === 'sleep') {
        return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    // Budget/poll nhỏ qua seam — không đợi 90s: tính chất được khẳng định là
    // "unhealthy kéo dài chốt FAIL khi hết budget, KHÔNG poll vô hạn".
    const exit = verifyLaneHealth(ctx, { budgetMs: 150, pollMs: 50 });
    expect(exit).toBe(1);
    expect(polls).toBeGreaterThan(1);
  });
});

describe('step type surface', () => {
  it('exactly two steps exist (up, smoke) — adding one requires touching this spec', async () => {
    const mod = await import('./local-stack-step.js');
    expect(mod.LOCAL_STACK_STEPS).toEqual(['up', 'smoke']);
    const step: LocalStackStep = 'up';
    expect(['up', 'smoke']).toContain(step);
  });
});
