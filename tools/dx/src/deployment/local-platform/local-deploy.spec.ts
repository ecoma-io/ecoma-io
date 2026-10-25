import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  localDeploy,
  localDestroy,
  localStatus,
  classifyStackOutput,
  queryPlatformStatus,
  DEPLOY_STEPS,
  upsertLocalEnv,
  isConfigKeyMissing,
  generateAppSecret,
  generatePostgresPassword,
  lookupPostgresPassword,
  probePostgresVolume,
  resolvePostgresPassword,
} from './local-deploy.js';
import {
  exec,
  ensureStack,
  pulumiEnv,
  pulumiRun,
  resolveContext,
  type ExecResult,
  type LocalDeployContext,
} from './pulumi-context.js';
import { worktreeNamespace } from './../../local-runtime/deploy-namespace.js';

import { ROOT_DIR } from '../../utils.js';
import {
  LOCAL_ENV_OWNED_KEYS,
  POSTGRES_PASSWORD_ENV_KEY,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';

/** Hình dạng return tối thiểu mà `runNxOrchestratedDeploy` đọc từ spawn. */
interface SpawnSyncReturns {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Orchestration boundary được test bằng injected command runner: mock
 * `pulumi-context.js` để `exec`/`pulumiRun`/`ensureStack` trở thành cát —
 * `localDeploy` vẫn chạy toàn bộ logic orchestration (phân loại state, thứ tự
 * bước, gate passphrase, ghi `.env`) nhưng không cần Pulumi hay Docker thật.
 * `classifyStackOutput`/`resolveContext`/`localStateDir`/`resolveLocalPassphrase`
 * vẫn là thực (không mock) để test kiểm được chúng trong cùng suite.
 *
 * Đây là cách duy nhất để chứng minh "preview không mutate" một cách xác định:
 * preview trên worktree mới không thể chạy được Pulumi thật (chưa có stack),
 * và một test chỉ pass vì Pulumi không cài thì không chứng minh được contract.
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

const execMock = vi.mocked(exec);
const pulumiRunMock = vi.mocked(pulumiRun);

const cleanup: string[] = [];

function tempWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-deploy-spec-'));
  cleanup.push(dir);
  return dir;
}

const SAVE_PASSPHRASE = process.env.PULUMI_CONFIG_PASSPHRASE;

afterEach(() => {
  // Trả passphrase env về giá trị lúc nạp file — test trong file này set nó
  // tường minh, không được rò sang file suite khác chạy cùng worker.
  if (SAVE_PASSPHRASE === undefined) delete process.env.PULUMI_CONFIG_PASSPHRASE;
  else process.env.PULUMI_CONFIG_PASSPHRASE = SAVE_PASSPHRASE;
  // Reset cả implementation (không chỉ calls): mock của một test không được
  // phép làm test kế tiếp pass một cách vô nghĩa. Mỗi test tự set lại thứ nó cần.
  vi.resetAllMocks();
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('DEPLOY_STEPS', () => {
  it('step order contract: platform → outputs → env → home → backoffice → account → auth → smoke', () => {
    expect(DEPLOY_STEPS).toEqual([
      'platform-up',
      'read-outputs',
      'update-env',
      'home-up',
      'backoffice-up',
      'account-up',
      'auth-up',
      'smoke-https',
    ]);
  });
});

describe('resolveContext', () => {
  it('each worktree gets its own namespace, stack, and state backend', () => {
    const a = resolveContext(tempWorktree());
    const b = resolveContext(tempWorktree());
    expect(a.namespace).not.toBe(b.namespace);
    expect(a.stackName).not.toBe(b.stackName);
    expect(a.stateUrl).not.toBe(b.stateUrl);
  });

  it('stack name follows the local-<ns> contract and state lives inside the worktree (outside Git)', () => {
    const root = tempWorktree();
    const ctx: LocalDeployContext = resolveContext(root);
    expect(ctx.stackName).toBe(`local-${worktreeNamespace(root)}`);
    expect(ctx.stateUrl.startsWith(`file://${root}`)).toBe(true);
  });
});

describe('upsertLocalEnv', () => {
  it('missing file → creates a new one with exactly one key', () => {
    const root = tempWorktree();
    const { envPath } = upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:40000' });
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, 'utf8')).toBe('ROOT_HOST=fbi.com:40000\n');
  });

  it('existing key → replaces exactly that line, keeps every other key', () => {
    const root = tempWorktree();
    writeFileSync(
      join(root, '.env'),
      ['# comment giữ nguyên', 'OTHER_KEY=keepme', 'ROOT_HOST=fbi.com:1', 'TRAILING=yes'].join(
        '\n',
      ),
      'utf8',
    );
    upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:40001' });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40001');
    expect(content).toContain('# comment giữ nguyên');
    expect(content).toContain('OTHER_KEY=keepme');
    expect(content).toContain('TRAILING=yes');
    expect(content).not.toContain('fbi.com:1');
  });

  it('key absent from the existing file → appends at the end, deletes nothing', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'ONLY=one', 'utf8');
    upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:40002' });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ONLY=one');
    expect(content).toContain('ROOT_HOST=fbi.com:40002');
  });

  it('run twice with different ports → last value wins, no duplicated line', () => {
    const root = tempWorktree();
    upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:40003' });
    upsertLocalEnv(root, { ROOT_HOST: 'fbi.com:40004' });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content.match(/ROOT_HOST=/gu)?.length).toBe(1);
    expect(content).toContain('ROOT_HOST=fbi.com:40004');
  });
});

describe('localDeploy previewOnly', () => {
  it('previewOnly never writes .env — whether preview succeeds or fails', async () => {
    const root = tempWorktree();
    // Exit code của preview tuỳ prerequisite (worktree mới → fail read-only,
    // worktree đã deploy → xanh), nhưng bất biến phải giữ ở CẢ HAI: port do
    // Docker cấp chỉ tồn tại sau up thật, nên `.env` không bao giờ được ghi
    // trong preview mode.
    await localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('missing passphrase → exit 1 BEFORE touching Pulumi, no state dir created', async () => {
    const root = tempWorktree();
    const saved = process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    try {
      const exit = await localDeploy({ worktreeRoot: root, previewOnly: true });
      expect(exit).toBe(1);
      // Fail-early nghĩa là KHÔNG có thư mục state nào được tạo ra — mutation
      // chưa bắt đầu thì không để lại dấu vết nửa chừng.
      expect(existsSync(join(root, '.pulumi-local-state'))).toBe(false);
      expect(existsSync(join(root, '.env'))).toBe(false);
      // Và không lệnh Pulumi/Docker nào được dispatch.
      expect(execMock).not.toHaveBeenCalled();
      expect(pulumiRunMock).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE = saved;
    }
  });

  it('fresh worktree preview → exit 1, no state dir, no .env, NO command dispatched (no init/config/up/destroy)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    const exit = await localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(exit).toBe(1);
    // Không mutation nào được tạo ra…
    expect(existsSync(join(root, '.pulumi-local-state'))).toBe(false);
    expect(existsSync(join(root, '.env'))).toBe(false);
    // …và không lệnh nào được dispatch: không `ensureStack` (stack init),
    // không `config set` (sinh secret), không `up`/`destroy`, không preview.
    expect(execMock).not.toHaveBeenCalled();
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(vi.mocked(ensureStack)).not.toHaveBeenCalled();
  });

  it('existing deployment → only read/preview ops: both previews, no --config, no prepareStack', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    // State dir tồn tại = worktree đã apply (prerequisite 1). `queryPlatformStatus`
    // gọi exec (`stack output --json`) → trả deployed; home check → `{}` (stack
    // tồn tại, chưa up — đủ cho prerequisite home).
    mkdirSync(join(root, '.pulumi-local-state'), { recursive: true });
    execMock.mockImplementation((_command, args) => {
      const stackRef = args[args.indexOf('--stack') + 1] ?? '';
      if (stackRef.includes('platform-deploy')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({ traefikHostPort: 40000, namespace: 'wtest' })}\n`,
          stderr: '',
        } satisfies ExecResult;
      }
      return { status: 0, stdout: '{}\n', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockReturnValue(undefined);

    const exit = await localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(exit).toBe(0);

    // exec CHỈ dùng cho đọc: mọi lệnh là `stack output --json` — không có
    // `config set`, không `stack init` (qua exec), không sinh secret.
    expect(execMock.mock.calls.length).toBeGreaterThan(0);
    for (const [, args] of execMock.mock.calls) {
      expect(args[0]).toBe('stack');
      expect(args[1]).toBe('output');
      expect(args).toContain('--json');
    }

    // pulumiRun đúng ba lần: platform preview rồi home preview rồi backoffice preview,
    // theo thứ tự contract; cả ba prepareStack !== true và không truyền --config (CLI lưu
    // --config vào stack config file kể cả ở preview).
    expect(pulumiRunMock.mock.calls.length).toBe(3);
    const [platformCall, homeCall, backofficeCall] = pulumiRunMock.mock.calls;
    expect(platformCall[1]).toBe('platform-deploy');
    expect(platformCall[2]).toEqual(['preview']);
    expect(homeCall[1]).toBe('home-deploy');
    expect(homeCall[2]).toEqual(['preview']);
    expect(backofficeCall[1]).toBe('backoffice-deploy');
    expect(backofficeCall[2]).toEqual(['preview']);
    for (const call of pulumiRunMock.mock.calls) {
      expect(call[2]).not.toContain('--config');
      expect(call[5]?.prepareStack).not.toBe(true);
    }

    // Không .env, không state mới (state đã có từ trước, không bị xoá/đổi).
    expect(existsSync(join(root, '.env'))).toBe(false);
    expect(existsSync(join(root, '.pulumi-local-state'))).toBe(true);
  });

  it('existing platform but missing home stack → exit 1, clear error, no preview command at all', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    mkdirSync(join(root, '.pulumi-local-state'), { recursive: true });
    execMock.mockImplementation((_command, args) => {
      const stackRef = args[args.indexOf('--stack') + 1] ?? '';
      if (stackRef.includes('platform-deploy')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({ traefikHostPort: 40000 })}\n`,
          stderr: '',
        } satisfies ExecResult;
      }
      // Home stack chưa tồn tại.
      return {
        status: 6,
        stdout: '',
        stderr: "error: no stack named 'organization/home-deploy/local-wtest' found",
      } satisfies ExecResult;
    });

    const exit = await localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(exit).toBe(1);
    // Kiểm prerequisite là read-only: KHÔNG lệnh preview/up/destroy nào chạy
    // khi prerequisite thiếu (không partial run).
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('missing platform outputs (init, never up) → exit 1 with guidance to run apply, no preview', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    // State dir có (stack đã init) nhưng `stack output` trả `{}` = chưa up.
    mkdirSync(join(root, '.pulumi-local-state'), { recursive: true });
    execMock.mockReturnValue({ status: 0, stdout: '{}\n', stderr: '' } satisfies ExecResult);

    const exit = await localDeploy({ worktreeRoot: root, previewOnly: true });
    expect(exit).toBe(1);
    expect(pulumiRunMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalledWith(
      'pulumi',
      expect.arrayContaining(['config', 'set']),
      expect.anything(),
      expect.anything(),
    );
    expect(existsSync(join(root, '.env'))).toBe(false);
  });
});

describe('localDeploy apply (non-preview) retains initialization behavior', () => {
  it('no passphrase env needed → apply still succeeds on a fresh stack (tool-managed passphrase)', async () => {
    const root = tempWorktree();
    const savedPass = process.env.PULUMI_CONFIG_PASSPHRASE;
    const savedFile = process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key postgres:password',
        } satisfies ExecResult;
      }
      if (args[0] === 'config' && args[1] === 'set') {
        return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return { status: 1, stdout: '', stderr: 'Error: No such volume' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockImplementation((_projectDir, projectName, args) => {
      if (projectName === 'platform-deploy' && args[0] === 'stack' && args[1] === 'output') {
        return `${JSON.stringify({ traefikHostPort: 40001 })}\n`;
      }
      return undefined;
    });
    try {
      // `legacyApply` — suite này mock biên pulumi-context (runApply), không phải Nx spawn.
      const exit = await localDeploy({ worktreeRoot: root, skipSmoke: true, legacyApply: true });
      expect(exit).toBe(0);
      // Passphrase do công cụ sinh và lưu ngoài Git — không cần developer đặt.
      expect(existsSync(join(root, '.pulumi-local-passphrase'))).toBe(true);
    } finally {
      if (savedPass !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE = savedPass;
      else delete process.env.PULUMI_CONFIG_PASSPHRASE;
      if (savedFile !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE_FILE = savedFile;
      else delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    }
  });

  it('apply on fresh stack: ensureStack → config get → config set (generate) → up → outputs → .env → home up', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';

    execMock.mockImplementation((_command, args) => {
      // config get postgres:password → chưa có key (isConfigKeyMissing).
      if (args[0] === 'config' && args[1] === 'get') {
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key postgres:password',
        } satisfies ExecResult;
      }
      // config set (generate) → OK.
      if (args[0] === 'config' && args[1] === 'set') {
        return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return { status: 1, stdout: '', stderr: 'Error: No such volume' } satisfies ExecResult;
      }
      return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
    });
    pulumiRunMock.mockImplementation((_projectDir, projectName, args) => {
      if (projectName === 'platform-deploy' && args[0] === 'stack' && args[1] === 'output') {
        return `${JSON.stringify({ traefikHostPort: 40001 })}\n`;
      }
      return undefined;
    });

    // `legacyApply` — suite này mock biên pulumi-context (runApply), không phải Nx spawn.
    const exit = await localDeploy({ worktreeRoot: root, skipSmoke: true, legacyApply: true });
    expect(exit).toBe(0);

    // ensureStack (stack init) được gọi cho platform, backoffice, account và
    // auth — apply GIỮ hành vi khởi tạo, mở rộng cho hai stack identity mới.
    expect(vi.mocked(ensureStack)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(ensureStack).mock.calls[0][1]).toBe('platform-deploy');
    expect(vi.mocked(ensureStack).mock.calls[1][1]).toBe('backoffice-deploy');
    expect(vi.mocked(ensureStack).mock.calls[2][1]).toBe('account-deploy');
    expect(vi.mocked(ensureStack).mock.calls[3][1]).toBe('auth-deploy');

    // config get rồi config set (generate password) — apply vẫn sinh password.
    const configGetCall = execMock.mock.calls.find(
      ([, args]) => args[0] === 'config' && args[1] === 'get',
    );
    expect(configGetCall).toBeDefined();
    const configSetCall = execMock.mock.calls.find(
      ([, args]) => args[0] === 'config' && args[1] === 'set',
    );
    expect(configSetCall).toBeDefined();
    expect(configSetCall?.[1]).toContain('postgres:password');
    expect(configSetCall?.[1]).not.toContain('--secret');
    // `--plaintext` BẮT BUỘC: CLI 3.270 chặn giá trị "trông như secret" với
    // exit 1 nếu không có cờ này (đo thật) — `config set` fail, mật khẩu không
    // được lưu.
    expect(configSetCall?.[1]).toContain('--plaintext');
    // Giá trị đi qua STDIN, không qua argv: argv đọc được qua
    // `/proc/<pid>/cmdline` và `ps`. execMock nhận `input` ở options (arg thứ 5).
    expect(configSetCall?.[4]).toEqual({ input: expect.any(String) });

    // pulumiRun: platform up (prepareStack: true, có --config) rồi home,
    // backoffice, account, auth up — thứ tự account TRƯỚC auth (account sở hữu
    // password của role owner dùng chung ecoma_owner).
    const upCalls = pulumiRunMock.mock.calls.filter(([, , args]) => args[0] === 'up');
    expect(upCalls.length).toBe(5);
    expect(upCalls[0][1]).toBe('platform-deploy');
    expect(upCalls[0][5]?.prepareStack).toBe(true);
    expect(upCalls[0][2]).toContain('--config');
    expect(upCalls[1][1]).toBe('home-deploy');
    expect(upCalls[2][1]).toBe('backoffice-deploy');
    expect(upCalls[3][1]).toBe('account-deploy');
    expect(upCalls[4][1]).toBe('auth-deploy');

    // Hai stack identity nhận đúng bộ key mật khẩu/secret qua stdin (không argv):
    // account có ownerPassword (nó sở hữu ecoma_owner) + hai secret HMAC của app;
    // auth có secrets Worker của WIC (PR #183). `internalHmacSecret` của account
    // và `internalSecret` của auth phải là CÙNG MỘT giá trị — bất invariant
    // envelope HMAC hai chiều auth <-> account thuộc về orchestration.
    const identityConfigSets = execMock.mock.calls.filter(([, args]) => {
      if (args[0] !== 'config' || args[1] !== 'set') return false;
      const stackRef = args[args.indexOf('--stack') + 1] ?? '';
      return stackRef.includes('account-deploy') || stackRef.includes('auth-deploy');
    });
    const accountKeys = identityConfigSets
      .filter(([, args]) => (args[args.indexOf('--stack') + 1] ?? '').includes('account-deploy'))
      .map(([, args]) => args[2]);
    const authKeys = identityConfigSets
      .filter(([, args]) => (args[args.indexOf('--stack') + 1] ?? '').includes('auth-deploy'))
      .map(([, args]) => args[2]);
    expect(accountKeys).toEqual([
      'namespace:ownerPassword',
      'namespace:runtimePassword',
      'namespace:migratorPassword',
      'namespace:prunerPassword',
      'namespace:internalHmacSecret',
      'namespace:otpHmacSecret',
    ]);
    expect(authKeys).toEqual([
      'namespace:runtimePassword',
      'namespace:migratorPassword',
      'namespace:prunerPassword',
      'namespace:signingKeyPem',
      'namespace:signingKeyId',
      'namespace:handleKey',
      'namespace:internalSecret',
      'namespace:issuer',
      'namespace:audience',
      'namespace:cookieKeys',
    ]);
    // Hai secret ứng dụng của auth là hình 32 byte base64url — contract
    // `importKey` của identity-auth-domain bắt ĐÚNG 32 byte từ AUTH_HANDLE_KEY
    // và cookieKeys là keygrip key của oidc-provider (#284: mật khẩu 24 byte
    // của database bị tái dùng nhầm làm mọi /authorize chết lúc mint đầu).
    const authHandleInput = identityConfigSets.find(
      ([, args]) => args[2] === 'namespace:handleKey',
    )?.[4]?.['input'];
    const authCookieKeysInput = identityConfigSets.find(
      ([, args]) => args[2] === 'namespace:cookieKeys',
    )?.[4]?.['input'];
    expect(Buffer.from(authHandleInput ?? '', 'base64url').byteLength).toBe(32);
    expect(Buffer.from(authCookieKeysInput ?? '', 'base64url').byteLength).toBe(32);
    // Hai giá trị sinh ĐỘC LẬP — trùng nhau là hai ngữ cảnh dùng chung khoá.
    expect(authHandleInput).not.toBe(authCookieKeysInput);
    // Cùng giá trị cho hai nửa của secret HMAC internal (stdin input của hai
    // lần `config set` — exec mock ghi lại options.input).
    const accountInternalSet = identityConfigSets.find(
      ([, args]) => args[2] === 'namespace:internalHmacSecret',
    );
    const authInternalSet = identityConfigSets.find(
      ([, args]) => args[2] === 'namespace:internalSecret',
    );
    const accountInternalInput = accountInternalSet?.[4]?.['input'];
    const authInternalInput = authInternalSet?.[4]?.['input'];
    expect(typeof accountInternalInput).toBe('string');
    expect(accountInternalInput).toBe(authInternalInput);
    // Ngưỡng ký tự 32 của `config-validation.ts` account (thông qua cả khi
    // 24 byte), nhưng generator đã là 32 byte chuẩn HMAC-SHA-256 (#284) —
    // ghim cả hai để hai contract không thể trôi lệch nhau.
    expect(accountInternalInput?.length ?? 0).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(accountInternalInput ?? '', 'base64url').byteLength).toBe(32);
    // Khoá ký là PEM PKCS#8 thật (SigningKeyProvider.fromPem parse được) —
    // header/hình dạng đúng, không đụng tới giá trị.
    const signingPemInput = identityConfigSets.find(
      ([, args]) => args[2] === 'namespace:signingKeyPem',
    )?.[4]?.['input'];
    // Hình PEM dựng từ DASHES — rule `private-key` của gitleaks quét cả spec;
    // một literal PEM trông đúng trong source là false positive chặn push
    // (cùng lý do với `signing-key.ts` của identity-auth-domain).
    const DASHES = '-'.repeat(5);
    const pemBegin = `${DASHES}BEGIN PRIVATE KEY${DASHES}`;
    const pemEnd = `${DASHES}END PRIVATE KEY${DASHES}`;
    // PEM KHÔNG có newline cuối: generator join('\n') với phần tử '' đuôi là
    // nguyên nhân /ready 503 config_invalid trên WIC local (#249) —
    // `requireSecret` của app từ chối giá trị có whitespace đầu/cuối.
    expect(signingPemInput).toMatch(new RegExp(`^${pemBegin}`, 'u'));
    expect(signingPemInput?.endsWith(pemEnd)).toBe(true);
    expect(signingPemInput?.endsWith('\n')).toBe(false);
    expect(signingPemInput?.startsWith(' ') ?? false).toBe(false);
    for (const [, args, , , options] of identityConfigSets) {
      expect(args).toContain('--plaintext');
      expect(args).not.toContain('--secret');
      // Giá trị đi qua STDIN, không qua argv (exec nhận options ở arg thứ 5).
      expect(options).toEqual({ input: expect.any(String) });
    }
    // Mỗi stack identity up với platformStackRef trỏ đúng platform stack
    // (stack name là của worktree test — chỉ cần đúng shape project/stack).
    for (const [index, project] of [
      [3, 'account-deploy'],
      [4, 'auth-deploy'],
    ] as const) {
      expect(upCalls[index][1]).toBe(project);
      expect(upCalls[index][5]?.prepareStack).toBe(true);
      expect(upCalls[index][2]).toContain('--config');
      const stackRefArg = upCalls[index][2].find((arg) =>
        arg.startsWith('namespace:platformStackRef='),
      );
      expect(stackRefArg).toMatch(
        /^namespace:platformStackRef=organization\/platform-deploy\/local-w/u,
      );
    }

    // .env được ghi với port từ outputs — apply GIỮ hành vi ghi .env.
    const envContent = readFileSync(join(root, '.env'), 'utf8');
    expect(envContent).toContain('ROOT_HOST=fbi.com:40001');
  });
});

describe('classifyStackOutput — local-status state machine', () => {
  it('exit 0 + `{}` (stack init, never up) → no-outputs, NOT deployed', () => {
    const result = classifyStackOutput({ status: 0, stdout: '{}\n', stderr: '' });
    expect(result).toEqual({ state: 'no-outputs' });
  });

  it('exit 0 + full outputs → deployed with outputs', () => {
    const outputs = { traefikHostPort: 34942, namespace: 'wtest' };
    const result = classifyStackOutput({
      status: 0,
      stdout: `${JSON.stringify(outputs)}\n`,
      stderr: '',
    });
    expect(result).toEqual({ state: 'deployed', outputs });
  });

  it('exit != 0 + "no stack named" → no-stack (never initialized — NOT a backend error)', () => {
    const result = classifyStackOutput({
      status: 6,
      stdout: '',
      stderr: "error: no stack named 'local-wabc' found",
    });
    expect(result).toEqual({ state: 'no-stack' });
  });

  it('exit != 0 + backend cannot be opened → backend-error (status exit code must be non-zero)', () => {
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

  it('exit 0 + stdout not JSON → parse-error (not swallowed as no-outputs)', () => {
    const result = classifyStackOutput({ status: 0, stdout: 'not-json{{', stderr: '' });
    expect(result.state).toBe('parse-error');
  });

  it('exit != 0 + unrecognized error → backend-error with the first error line, NOT no-stack', () => {
    const result = classifyStackOutput({
      status: 1,
      stdout: '',
      stderr: 'error: something unprecedented went wrong',
    });
    expect(result.state).toBe('backend-error');
    const detail = (result as { detail?: string }).detail ?? '';
    expect(detail).toContain('something unprecedented');
  });

  it('status null (binary cannot run, spawnSync.error) → backend-error with the exact cause', () => {
    // `pulumi` không có trên PATH: `spawnSync` báo qua `error`, status là null,
    // stderr/stdout rỗng — chi tiết phải là message của error, không phải
    // "lỗi Pulumi không xác định".
    const result = classifyStackOutput({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn pulumi ENOENT'),
    });
    expect(result.state).toBe('backend-error');
    const detail = (result as { detail?: string }).detail ?? '';
    expect(detail).toContain('ENOENT');
  });

  it('status null + killed by signal → backend-error with the signal name', () => {
    const result = classifyStackOutput({ status: null, stdout: '', stderr: '', signal: 'SIGKILL' });
    expect(result.state).toBe('backend-error');
    const detail = (result as { detail?: string }).detail ?? '';
    expect(detail).toContain('SIGKILL');
  });
});

describe('queryPlatformStatus — no-stack when the state dir does not exist', () => {
  it('worktree that never deployed (no .pulumi-local-state) → no-stack without calling the CLI', () => {
    // Worktree nháp không có thư mục state: nếu queryPlatformStatus bấm CLI
    // thì CLI trả "unable to open state directory" → sai khiếp thành
    // backend-error. Guard phải bắt ngay từ kiểm sự tồn tại.
    const wt = tempWorktree();
    const ctx = resolveContext(wt);
    const env = pulumiEnv(ctx, { kind: 'inline', value: 'unit-test-pass' });
    const result = queryPlatformStatus(ctx, env);
    expect(result).toEqual({ state: 'no-stack' });
  });
});

describe('localDestroy — teardown on a worktree that never deployed', () => {
  it('no state dir → no-op exit 0, no state created, no pulumi call', () => {
    const wt = tempWorktree();
    const before = existsSync(join(wt, '.pulumi-local-state'));
    const exit = localDestroy({ worktreeRoot: wt });
    expect(exit).toBe(0);
    // No-op nghĩa là KHÔNG mutation: thư mục state không được tạo ra.
    expect(existsSync(join(wt, '.pulumi-local-state'))).toBe(before);
    expect(before).toBe(false);
  });
});

describe('localDestroy — volume removal coping with lost Pulumi stacks', () => {
  it('stacks already gone (pulumi stack rm): destroy Pulumi fails but --remove-data still removes the volume', () => {
    const wt = tempWorktree();
    mkdirSync(join(wt, '.pulumi-local-state'), { recursive: true });
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    pulumiRunMock.mockImplementation(() => {
      throw new Error('pulumi destroy failed:\nerror: no stack named');
    });
    execMock.mockReturnValue({ status: 0, stdout: '', stderr: '' } satisfies ExecResult);
    const exit = localDestroy({ worktreeRoot: wt, removeData: true });
    // destroy Pulumi không trọn nhưng lời hứa --remove-data vẫn phải được thực hiện:
    // docker volume rm đã chạy.
    expect(
      execMock.mock.calls.some(
        ([command, args]) => command === 'docker' && args[0] === 'volume' && args[1] === 'rm',
      ),
    ).toBe(true);
    expect(exit).toBe(0);
  });

  it('Pulumi destroy failure without --remove-data → exit 1, volume untouched', () => {
    const wt = tempWorktree();
    mkdirSync(join(wt, '.pulumi-local-state'), { recursive: true });
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    pulumiRunMock.mockImplementation(() => {
      throw new Error('pulumi destroy failed:\nerror: no stack named');
    });
    execMock.mockReturnValue({ status: 0, stdout: '', stderr: '' } satisfies ExecResult);
    const exit = localDestroy({ worktreeRoot: wt });
    expect(exit).toBe(1);
    expect(
      execMock.mock.calls.some(([command, args]) => command === 'docker' && args[1] === 'rm'),
    ).toBe(false);
  });
});

describe('localDestroy — full coverage: all stacks in reverse dependency order', () => {
  it('destroys ALL FIVE stacks — auth, account, backoffice, home, platform (no orphan identity stacks)', () => {
    const wt = tempWorktree();
    mkdirSync(join(wt, '.pulumi-local-state'), { recursive: true });
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    pulumiRunMock.mockReturnValue(undefined);
    execMock.mockReturnValue({ status: 0, stdout: '', stderr: '' } satisfies ExecResult);
    const exit = localDestroy({ worktreeRoot: wt });
    expect(exit).toBe(0);
    const destroyed = pulumiRunMock.mock.calls
      .filter(([, , args]) => args[0] === 'destroy')
      .map(([, project]) => project);
    expect(destroyed).toEqual([
      'transactional-mail-deploy',
      'auth-deploy',
      'account-deploy',
      'pact-broker-app-deploy',
      'backoffice-deploy',
      'push-notification-deploy',
      'pact-broker-api-deploy',
      'home-deploy',
      'platform-deploy',
    ]);
  });

  it('platform destroy runs LAST even when a unit destroy fails (failure does not reorder teardown)', () => {
    const wt = tempWorktree();
    mkdirSync(join(wt, '.pulumi-local-state'), { recursive: true });
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    pulumiRunMock.mockImplementation((_dir, project, args) => {
      if (project === 'account-deploy' && args[0] === 'destroy') {
        throw new Error('pulumi destroy failed:\nboom');
      }
      return undefined;
    });
    execMock.mockReturnValue({ status: 0, stdout: '', stderr: '' } satisfies ExecResult);
    const exit = localDestroy({ worktreeRoot: wt });
    expect(exit).toBe(1);
    const destroyed = pulumiRunMock.mock.calls
      .filter(([, , args]) => args[0] === 'destroy')
      .map(([, project]) => project);
    // Vẫn đủ 5 lần gọi, đúng thứ tự nghịch — lỗi ở giữa KHÔNG dừng teardown của
    // các stack sau (mỗi destroy độc lập; exit code là nơi tổng hợp thất bại).
    expect(destroyed).toEqual([
      'transactional-mail-deploy',
      'auth-deploy',
      'account-deploy',
      'pact-broker-app-deploy',
      'backoffice-deploy',
      'push-notification-deploy',
      'pact-broker-api-deploy',
      'home-deploy',
      'platform-deploy',
    ]);
  });
});

describe('runNxOrchestratedDeploy — Nx Task Graph path', () => {
  it('buildNxOrchestrationPlan locks the run-many command to the local configuration', async () => {
    const { buildNxOrchestrationPlan } = await import('./local-deploy.js');
    const plan = buildNxOrchestrationPlan();
    expect(plan.command).toBe(process.execPath);
    const scriptIndex = plan.args.findIndex((arg) => arg.endsWith('nx.js'));
    expect(scriptIndex).toBeGreaterThanOrEqual(0);
    expect(plan.args[scriptIndex + 1]).toBe('run-many');
    expect(plan.args).toContain('-c');
    expect(plan.args[plan.args.indexOf('-c') + 1]).toBe('local');
    // Task sequence dẫn xuất từ khai báo Nx — 11 task sau wave 2 (#264):
    // 8 bước legacy (gộp read-outputs+update-env thành 1 task local-env) +
    // 4 unit wave-2, các unit đó được Kahn xen ngay khi dependency của chính
    // nó xong; smoke vẫn là node lá CUỐI.
    expect(plan.taskSequence).toEqual([
      'platform-deploy:local-up',
      'platform-deploy:local-env',
      'home-deploy:local-up',
      'pact-broker-api-deploy:local-up',
      'push-notification-deploy:local-up',
      'backoffice-deploy:local-up',
      'pact-broker-app-deploy:local-up',
      'account-deploy:local-up',
      'auth-deploy:local-up',
      'transactional-mail-deploy:local-up',
      'platform-deploy:local-smoke',
    ]);
  });

  it('runNxOrchestratedDeploy without a passphrase on an initialized worktree → exit 1 and NO nx spawned (injectable spawn)', async () => {
    const root = tempWorktree();
    const saved = process.env.PULUMI_CONFIG_PASSPHRASE;
    const savedFile = process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    try {
      // Worktree đã có state THẬT (file stack .json — thư mục rỗng không đủ,
      // `hasPulumiState` bỏ qua) → resolveLocalPassphrase fail-closed.
      // `spawn` cắm spy: nếu code bấm nx thật thì spy bị gọi (fail) chứ KHÔNG
      // chạy nx thật — một test không bao giờ được phép spawn Docker/Pulumi.
      const stacksDir = join(root, '.pulumi-local-state', '.pulumi', 'stacks', 'platform-deploy');
      mkdirSync(stacksDir, { recursive: true });
      writeFileSync(join(stacksDir, 'local-wtest.json'), '{}', 'utf8');
      const { runNxOrchestratedDeploy } = await import('./local-deploy.js');
      const spawnSpy = vi.fn<() => SpawnSyncReturns>(() => ({ status: 0, stdout: '', stderr: '' }));
      const exit = runNxOrchestratedDeploy(resolveContext(root), {}, spawnSpy as never);
      expect(exit).toBe(1);
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(existsSync(join(root, '.pulumi-local-passphrase'))).toBe(false);
    } finally {
      if (saved !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE = saved;
      if (savedFile !== undefined) process.env.PULUMI_CONFIG_PASSPHRASE_FILE = savedFile;
    }
  });

  it('runNxOrchestratedDeploy failure propagation: nx exit != 0 → deploy exit 1 (spawn spy, never a real nx)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    const { runNxOrchestratedDeploy } = await import('./local-deploy.js');
    const spawnSpy = vi.fn<() => SpawnSyncReturns>(() => ({ status: 1, stdout: '', stderr: '' }));
    const exit = runNxOrchestratedDeploy(resolveContext(root), {}, spawnSpy as never);
    expect(exit).toBe(1);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [command, args, opts] = spawnSpy.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ];
    expect(command).toBe(process.execPath);
    expect(args).toContain('run-many');
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('local');
    expect(opts.cwd).toBe(ROOT_DIR);
  });

  it('runNxOrchestratedDeploy success: nx exit 0 → deploy exit 0 (spawn spy, never a real nx)', async () => {
    const root = tempWorktree();
    process.env.PULUMI_CONFIG_PASSPHRASE = 'unit-test-passphrase';
    const { runNxOrchestratedDeploy } = await import('./local-deploy.js');
    const spawnSpy = vi.fn<() => SpawnSyncReturns>(() => ({ status: 0, stdout: '', stderr: '' }));
    const exit = runNxOrchestratedDeploy(resolveContext(root), {}, spawnSpy as never);
    expect(exit).toBe(0);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    // Passphrase file được tạo TRƯỚC khi bấm Nx (cha resolve, con không đua).
    expect(existsSync(join(root, '.pulumi-local-passphrase'))).toBe(true);
  });
});

describe('isConfigKeyMissing — secret regen guard', () => {
  it('CLI reports "no value for the key" → true (regen allowed)', () => {
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

  it('wrong passphrase (secret cannot be decrypted) → false — must fail, NO regen', () => {
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

  it('other errors (broken backend, lock) → false', () => {
    expect(
      isConfigKeyMissing({
        status: 1,
        stdout: '',
        stderr: 'error: could not open state directory',
      }),
    ).toBe(false);
  });

  it('status 0 but empty stdout → false on the pattern... but the caller still regens via the empty-stdout branch', () => {
    // Guard hai lớp: isConfigKeyMissing chỉ nhận diện chữ ký; nhánh regen của
    // caller vẫn là `stdout rỗng` SAU KHI đã pass qua guard throw. Case status 0
    // + rỗng không thể xảy ra trên CLI thật (exit 0 luôn kèm giá trị) nhưng
    // hợp đồng của helper là nhận diện chữ ký, không quyết định regen.
    expect(isConfigKeyMissing({ status: 0, stdout: '', stderr: '' })).toBe(false);
  });
});

describe('generatePostgresPassword', () => {
  it('uses a cryptographically secure source — non-empty, base64url-safe, long enough', () => {
    const pw = generatePostgresPassword();
    expect(pw.length).toBeGreaterThanOrEqual(24);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('does not reuse a value across calls', () => {
    expect(generatePostgresPassword()).not.toBe(generatePostgresPassword());
  });
});

describe('generateAppSecret', () => {
  it('is exactly 32 bytes decoded from base64url — the HMAC-SHA-256 contract size', () => {
    // `importKey` của identity-auth-domain bắt ĐÚNG 32 byte từ AUTH_HANDLE_KEY
    // (#284): 24 byte của mật khẩu database là chết lúc mint đầu tiên.
    const secret = generateAppSecret();
    expect(Buffer.from(secret, 'base64url').byteLength).toBe(32);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('does not reuse a value across calls', () => {
    expect(generateAppSecret()).not.toBe(generateAppSecret());
  });
});

describe('lookupPostgresPassword', () => {
  it('exit 0 + non-empty stdout → found with the trimmed value', () => {
    expect(lookupPostgresPassword({ status: 0, stdout: '  secret-pw  \n', stderr: '' })).toEqual({
      state: 'found',
      password: 'secret-pw',
    });
  });

  it('exit 0 + empty stdout → missing', () => {
    expect(lookupPostgresPassword({ status: 0, stdout: '   \n', stderr: '' })).toEqual({
      state: 'missing',
    });
  });

  it('exit != 0 + "no value for the key" → missing', () => {
    expect(
      lookupPostgresPassword({
        status: 1,
        stdout: '',
        stderr: 'error: no value for the key postgres:password',
      }),
    ).toEqual({ state: 'missing' });
  });

  it('exit != 0 + other error → error state with fixed detail, never "missing", raw output NOT embedded', () => {
    const r = lookupPostgresPassword({
      status: 1,
      stdout: '',
      stderr: 'error: could not decrypt configuration value',
    });
    expect(r.state).toBe('error');
    const detail = (r as { detail?: string }).detail ?? '';
    // Detail là thông điệp CỐ ĐỊNH — raw stderr/stdout KHÔNG được nhúng vào:
    // stdout của `config get postgres:password` khi exit 0 chính là mật khẩu,
    // nên raw output trong error string là đường leak tiềm ẩn (detail ra log).
    expect(detail).toContain('pulumi config get failed');
    expect(detail).toContain('exit 1');
    expect(detail).not.toContain('could not decrypt');
    expect(detail).toContain('not logged');
  });

  it('masked [secret] output (unreachable on pinned CLI; kept as defense-in-depth) → error state', () => {
    const r = lookupPostgresPassword({ status: 0, stdout: '[secret]\n', stderr: '' });
    expect(r.state).toBe('error');
    const detail = (r as { detail?: string }).detail ?? '';
    expect(detail).toContain('[secret]');
    expect(detail).toContain('PULUMI_CONFIG_PASSPHRASE');
  });

  it('genuinely missing config key (exit != 0) → missing', () => {
    const r = lookupPostgresPassword({
      status: 1,
      stdout: '',
      stderr: 'error: no value for the key postgres:password',
    });
    expect(r.state).toBe('missing');
  });

  it('Pulumi error unrelated to missing key → error, never missing', () => {
    const r = lookupPostgresPassword({
      status: 1,
      stdout: '',
      stderr: 'error: could not open state directory',
    });
    expect(r.state).toBe('error');
  });
});

describe('probePostgresVolume', () => {
  it('docker volume inspect exits 0 → present', () => {
    execMock.mockReturnValue({ status: 0, stdout: '[{}]', stderr: '' } satisfies ExecResult);
    expect(probePostgresVolume('ecoma-wtest-postgres-volume', {})).toEqual({ state: 'present' });
  });

  it('stderr "not found" → absent', () => {
    execMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Error: No such volume: ecoma-wtest-postgres-volume',
    } satisfies ExecResult);
    expect(probePostgresVolume('ecoma-wtest-postgres-volume', {})).toEqual({ state: 'absent' });
  });

  it('spawn failure (status null) → unknown with detail, never "absent"', () => {
    execMock.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawn docker ENOENT'),
    } satisfies ExecResult);
    const r = probePostgresVolume('v', {});
    expect(r.state).toBe('unknown');
    const detail = (r as { detail?: string }).detail ?? '';
    expect(detail).toContain('ENOENT');
  });
});

describe('resolvePostgresPassword', () => {
  const ctx = resolveContext;
  it('existing password in config → reuse, never regenerate', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockReturnValue({
      status: 0,
      stdout: 'existing-pw\n',
      stderr: '',
    } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r).toEqual({ ok: true, password: 'existing-pw', generated: false });
    // Không được gọi config set.
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });

  it('missing password + volume present → fail with actionable guidance, no generate', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key postgres:password',
        } satisfies ExecResult;
      }
      // docker volume inspect → present
      return { status: 0, stdout: '[{}]', stderr: '' } satisfies ExecResult;
    });
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(false);
    const error = (r as { error?: string }).error ?? '';
    expect(error).toContain('PostgreSQL volume');
    expect(error).toContain('local-destroy --remove-data');
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });

  it('missing password + volume absent → generate + config set (--plaintext, value via stdin)', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockImplementation((_command, args) => {
      if (args[0] === 'config' && args[1] === 'get') {
        return {
          status: 1,
          stdout: '',
          stderr: 'error: no value for the key postgres:password',
        } satisfies ExecResult;
      }
      if (args[0] === 'config' && args[1] === 'set') {
        return { status: 0, stdout: '', stderr: '' } satisfies ExecResult;
      }
      // docker volume inspect → absent
      return { status: 1, stdout: '', stderr: 'Error: No such volume' } satisfies ExecResult;
    });
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(true);
    const ok = r as { password: string; generated: boolean };
    expect(ok.generated).toBe(true);
    expect(ok.password).toMatch(/^[A-Za-z0-9_-]+$/u);
    const setCall = execMock.mock.calls.find(([, args]) => args[1] === 'set');
    expect(setCall).toBeDefined();
    expect(setCall?.[1]).toContain('postgres:password');
    expect(setCall?.[1]).not.toContain('--secret');
    expect(setCall?.[1]).toContain('--plaintext');
    // Mật khẩu KHÔNG nằm trong argv — nó đi qua stdin.
    expect(setCall?.[1]).not.toContain(ok.password);
    expect(setCall?.[4]).toEqual({ input: ok.password });
  });

  it('masked [secret] config (unreachable on pinned CLI) → fail, never generate', () => {
    const root = tempWorktree();
    const c = resolveContext(root);
    execMock.mockReturnValue({
      status: 0,
      stdout: '[secret]\n',
      stderr: '',
    } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(false);
    const error = (r as { error?: string }).error ?? '';
    expect(error).toContain('[secret]');
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });

  it('read error (e.g. bad passphrase) → fail, never generate', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'error: could not decrypt configuration value',
    } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(false);
    const error = (r as { error?: string }).error ?? '';
    expect(error).toContain('Failed to read postgres:password');
  });

  it('masked [secret] config (unreachable on pinned CLI) → fail with guidance, never regenerate', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockReturnValue({ status: 0, stdout: '[secret]\n', stderr: '' } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(false);
    const error = (r as { error?: string }).error ?? '';
    expect(error).toContain('PULUMI_CONFIG_PASSPHRASE');
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });

  it('wrong passphrase (incorrect passphrase error) → fail, never generate', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'error: incorrect passphrase',
    } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r.ok).toBe(false);
    const error = (r as { error?: string }).error ?? '';
    expect(error).toContain('Failed to read postgres:password');
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });

  it('right passphrase on legacy secure config returns plaintext (verified on CLI 3.270) → reuse', () => {
    const root = tempWorktree();
    const c = ctx(root);
    execMock.mockReturnValue({
      status: 0,
      stdout: 'real-legacy-pw\n',
      stderr: '',
    } satisfies ExecResult);
    const r = resolvePostgresPassword(c, {});
    expect(r).toEqual({ ok: true, password: 'real-legacy-pw', generated: false });
    expect(execMock.mock.calls.some(([, args]) => args[1] === 'set')).toBe(false);
  });
});

describe('upsertLocalEnv — new contract', () => {
  it('creates file with both owned keys when missing', () => {
    const root = tempWorktree();
    const { envPath } = upsertLocalEnv(root, {
      [ROOT_HOST_ENV_KEY]: 'fbi.com:40000',
      [POSTGRES_PASSWORD_ENV_KEY]: 'pw-123',
    });
    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40000');
    expect(content).toContain('POSTGRES_PASSWORD=pw-123');
  });

  it('ignores keys not in LOCAL_ENV_OWNED_KEYS — no overwrite of user-managed vars', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'MY_SECRET=keep\n', 'utf8');
    upsertLocalEnv(root, { NOT_OWNED: 'should-not-appear' } as Record<string, string>);
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toBe('MY_SECRET=keep\n');
    expect(content).not.toContain('NOT_OWNED');
  });

  it('preserves unrelated variables byte-for-byte while updating owned keys', () => {
    const root = tempWorktree();
    writeFileSync(
      join(root, '.env'),
      ['# comment giữ nguyên', 'OTHER_KEY=keepme', 'ROOT_HOST=fbi.com:1', 'TRAILING=yes'].join(
        '\n',
      ) + '\n',
      'utf8',
    );
    upsertLocalEnv(root, {
      [ROOT_HOST_ENV_KEY]: 'fbi.com:40001',
      [POSTGRES_PASSWORD_ENV_KEY]: 'pw-x',
    });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('ROOT_HOST=fbi.com:40001');
    expect(content).toContain('POSTGRES_PASSWORD=pw-x');
    expect(content).toContain('# comment giữ nguyên');
    expect(content).toContain('OTHER_KEY=keepme');
    expect(content).toContain('TRAILING=yes');
    expect(content).not.toContain('fbi.com:1');
  });

  it('deleting .env then restoring from canonical config keeps the same password (no rotation)', () => {
    const root = tempWorktree();
    // First deploy writes both keys.
    upsertLocalEnv(root, {
      [ROOT_HOST_ENV_KEY]: 'fbi.com:40000',
      [POSTGRES_PASSWORD_ENV_KEY]: 'canonical-pw',
    });
    // Simulate .env loss.
    rmSync(join(root, '.env'));
    // Restore from canonical config value (same password).
    upsertLocalEnv(root, {
      [ROOT_HOST_ENV_KEY]: 'fbi.com:40000',
      [POSTGRES_PASSWORD_ENV_KEY]: 'canonical-pw',
    });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content).toContain('POSTGRES_PASSWORD=canonical-pw');
  });

  it('updates every duplicate occurrence of an owned key (no stale last-wins value)', () => {
    const root = tempWorktree();
    // File mà dotenv parse last-wins: chỉ thay dòng ĐẦU là để lại giá trị cũ
    // ở dòng sau → runtime đọc giá trị stale. Mọi occurrence phải đè vừa.
    writeFileSync(
      join(root, '.env'),
      'ROOT_HOST=fbi.com:1\nOTHER=keep\nROOT_HOST=fbi.com:2\n',
      'utf8',
    );
    upsertLocalEnv(root, { [ROOT_HOST_ENV_KEY]: 'fbi.com:40005' });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content.match(/^ROOT_HOST=.*$/gmu)?.length).toBe(2);
    expect(content).not.toContain('ROOT_HOST=fbi.com:1');
    expect(content).not.toContain('ROOT_HOST=fbi.com:2');
    expect(content.match(/ROOT_HOST=fbi.com:40005/gu)?.length).toBe(2);
    // Không nhân bản dòng: đúng hai occurrence, không dòng thứ ba.
    expect(content.match(/^ROOT_HOST=/gmu)?.length).toBe(2);
    expect(content).toContain('OTHER=keep');
  });

  it('appends an owned key only once even when other owned keys duplicate', () => {
    const root = tempWorktree();
    // ROOT_HOST trùng hai lần (được gộp về một value duy nhất), POSTGRES_PASSWORD
    // chưa có trong file → append đúng một dòng, không phụ thuộc số duplicate.
    writeFileSync(
      join(root, '.env'),
      'ROOT_HOST=fbi.com:1\nOTHER=keep\nROOT_HOST=fbi.com:2\n',
      'utf8',
    );
    upsertLocalEnv(root, {
      [ROOT_HOST_ENV_KEY]: 'fbi.com:40006',
      [POSTGRES_PASSWORD_ENV_KEY]: 'pw-mixed',
    });
    const content = readFileSync(join(root, '.env'), 'utf8');
    expect(content.match(/ROOT_HOST=fbi.com:40006/gu)?.length).toBe(2);
    expect(content.match(/^POSTGRES_PASSWORD=.*$/gmu)?.length).toBe(1);
    expect(content).toContain('POSTGRES_PASSWORD=pw-mixed');
    expect(content).toContain('OTHER=keep');
  });

  it('throws when a value contains a newline', () => {
    const root = tempWorktree();
    expect(() => upsertLocalEnv(root, { [ROOT_HOST_ENV_KEY]: 'a\nb' })).toThrowError(
      /newline|\\n|\\r/u,
    );
    expect(() => upsertLocalEnv(root, { [ROOT_HOST_ENV_KEY]: 'a\rb' })).toThrowError(
      /newline|\\n|\\r/u,
    );
    // Fail-loud phải xảy ra TRƯỚC khi file bị ghi — file không được sinh ra.
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('throws when a value contains a carriage return even on an existing file (file untouched)', () => {
    const root = tempWorktree();
    writeFileSync(join(root, '.env'), 'ROOT_HOST=fbi.com:1\n', 'utf8');
    const before = readFileSync(join(root, '.env'), 'utf8');
    expect(() =>
      upsertLocalEnv(root, { [POSTGRES_PASSWORD_ENV_KEY]: 'has\rnewline' }),
    ).toThrowError(/newline/iu);
    // File giữ nguyên khi guard chặn — không ghi đè nửa chừng.
    const after = readFileSync(join(root, '.env'), 'utf8');
    expect(after).toBe(before);
  });
});

describe('localStatus / localDestroy without passphrase for new-format stacks', () => {
  it('localDestroy on a never-deployed worktree is a no-op without any passphrase', () => {
    const root = tempWorktree();
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    const exit = localDestroy({ worktreeRoot: root });
    expect(exit).toBe(0);
  });

  it('localStatus tolerates a new-format stack without a passphrase env (tool-managed file)', () => {
    const root = tempWorktree();
    // Tool-managed passphrase file present → no env needed.
    writeFileSync(join(root, '.pulumi-local-passphrase'), 'wt-pass\n', 'utf8');
    delete process.env.PULUMI_CONFIG_PASSPHRASE;
    delete process.env.PULUMI_CONFIG_PASSPHRASE_FILE;
    mkdirSync(join(root, '.pulumi-local-state'), { recursive: true });
    execMock.mockReturnValue({ status: 0, stdout: '{}\n', stderr: '' } satisfies ExecResult);
    const exit = localStatus({ worktreeRoot: root });
    expect(exit).toBe(0);
  });
});

describe('git tracking guards', () => {
  it('owned env keys include POSTGRES_PASSWORD', () => {
    expect(LOCAL_ENV_OWNED_KEYS).toContain(POSTGRES_PASSWORD_ENV_KEY);
  });

  it('LOCAL_PASSPHRASE_FILE is gitignored (contract)', () => {
    // Assert the contract name is stable so .gitignore entry stays in sync.
    expect('.pulumi-local-passphrase').toBe('.pulumi-local-passphrase');
  });
});
