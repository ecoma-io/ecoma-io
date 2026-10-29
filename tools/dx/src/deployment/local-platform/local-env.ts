/**
 * Helper dữ liệu dùng chung của lane local — kỹ thuật thuần, KHÔNG orchestration.
 *
 * Entry lifecycle colocated của từng deploy project (`deploys/<p>/local.ts`)
 * import từ đây: các hàm chỉ là MỘT biến đổi dữ liệu có kiểm fail-closed
 * (sinh secret theo hình đúng, đọc lại password canonical từ stack config,
 * upsert `.env` chỉ trên key sở hữu, đọc `ROOT_HOST` từ `.env`). Module này
 * cố ý KHÔNG biết thứ tự giữa các project và KHÔNG gọi lệnh DX nào.
 *
 * Các secret generator giữ nguyên ngữ nghĩa từng hàm (khối comment của mỗi
 * generator giải thích vì sao hình giá trị là CONTRACT của consumer phía app).
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dockerResourceName } from './../../local-runtime/deploy-namespace.js';
import {
  buildRootHost,
  LOCAL_ENV_OWNED_KEYS,
  ROOT_HOST_ENV_KEY,
} from './platform-outputs-contract.js';
import {
  chmodFilePrivate,
  describeSpawnFailure,
  exec,
  fullStackRef,
  pulumiRun,
  type ExecResult,
  type LocalDeployContext,
} from './pulumi-context.js';
import { ROOT_DIR } from '../../utils.js';

/**
 * "Chưa có key" của `pulumi config get` — CHỈ khi CLI báo đúng vậy.
 *
 * Exit != 0 không phân biệt được: sai passphrase (không giải được secret),
 * state lock, backend hỏng... đều exit != 0. Regen secret trên các lỗi đó sẽ
 * ĐÈ mật khẩu đang tồn tại trong state (`config set` chỉ cần salt để mã hoá
 * giá trị mới là thành công trên DIY backend) → container Postgres bị khoá
 * khỏi volume đã init bằng mật khẩu cũ. Export để spec phủ trực tiếp.
 */
export function isConfigKeyMissing(result: ExecResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return /no value for the key|configuration key .* not found/iu.test(output);
}

/** Key trong Pulumi stack config lưu mật khẩu PostgreSQL local. */
export const POSTGRES_PASSWORD_CONFIG_KEY = 'postgres:password';

/**
 * Sinh mật khẩu PostgreSQL cho stack local mới.
 *
 * `randomBytes` của `node:crypto` — nguồn ngẫu nhiên mật mã an toàn. KHÔNG
 * dùng `Math.random`, timestamp, hard-code hay giá trị đoán được: mật khẩu này
 * là superuser credential của database local, và tài liệu yêu cầu sinh ngẫu
 * nhiên bằng API mật mã an toàn.
 *
 * `base64url` → chỉ ký tự `A-Za-z0-9-_`, nên an toàn khi đặt trong file `.env`
 * (không cần quote) và khi truyền làm argument cho `pulumi config set`.
 */
export function generatePostgresPassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Sinh secret HMAC cho envelope internal `ecoma-internal-v1` hai chiều
 * auth <-> account.
 *
 * Một secret ứng dụng dùng {@link generateAppSecret} (32 byte): cùng hình
 * base64url, nhưng đủ entropy chuẩn HMAC-SHA-256 thay vì đoán theo ngưỡng ký
 * tự. Tách tên riêng vì NGHĨA khác với `generatePostgresPassword`: đây là
 * secret HMAC ứng dụng (không phải credential database), và entry up của
 * account là nơi giữ bất biến "auth và account nhận CÙNG giá trị" — sinh hai
 * lần độc lập là mọi envelope internal chết `bad_signature` lúc runtime.
 */
export function generateInternalHmacSecret(): string {
  return generateAppSecret();
}

/**
 * Sinh secret ỨNG DỤNG 32 byte base64url — hình chuẩn cho mọi secret mà
 * contract phía consumer kiểm theo byte (không phải credential database).
 *
 * 32 byte = 256 bit là kích thước chuẩn HMAC-SHA-256: contract của
 * `auth-domain` (`importKey`) bắt ĐÚNG 32 byte từ `AUTH_HANDLE_KEY`,
 * và cookie keyring của oidc-provider cũng là key ký ứng dụng — dùng mật
 * khẩu 24 byte của database cho secret ứng dụng là che giấu hai NGHĨA khác
 * nhau sau một hình dạng giá trị chung (#284). `base64url` giữ tính an toàn
 * khi nhúng: chỉ ký tự `A-Za-z0-9-_`, an toàn trong `.env`, argv của
 * `pulumi config set` và container env không cần quote.
 */
export function generateAppSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Sinh khoá HMAC-SHA-256 32 byte dạng **64 ký tự hex chữ thường** cho lane
 * transactional-mail local (keyring `request_fingerprint`, khoá quarantine).
 *
 * Hình giá trị là CONTRACT của loader: cả `FINGERPRINT_KEY_HEX` (config.ts của
 * control plane) lẫn `HEX_KEY_64` (config.ts của consumer) chỉ chấp nhận
 * `/^[0-9a-f]{64}$/` — chặn cả hex HOA. `hex` encoding đúng 64 ký tự; một
 * hình khác làm hai Worker chết ngay lúc boot với lỗi "phai la 64 hex chu
 * thuong".
 */
export function generateHexKey64(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Sinh root key AES-256 **32 byte dạng base64** cho lane push-notification
 * local (Worker Secret `PUSH_CREDENTIAL_ROOT_KEY_K1` của cặp WIC push).
 *
 * Hình giá trị là CONTRACT của composition root (`main.ts` của app push):
 * giá trị được `atob` giải mã rồi kiểm ĐÚNG 32 byte (AES-256) — hình khác làm
 * cả control plane lẫn consumer chết ngay lúc boot với lỗi độ dài key. Base64
 * chuẩn (có `+/=`) là hình secret production dùng nên giữ nguyên ở local; giá
 * trị xoay mỗi lần `up` là vô hại vì D1 `push` trên volume state là ephemeral
 * theo thiết kế local (không credential nào sống qua hai lần up).
 */
export function generateBase64Key32(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Sinh PEM PKCS#8 cho khoá ký ES256 của auth (Worker Secret `AUTH_SIGNING_KEY`).
 *
 * WebCrypto ở runtime local Node: `crypto.subtle.generateKey({ name:
 * 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])` rồi
 * `exportKey('pkcs8')` — đúng spec PKCS#8 mà `SigningKeyProvider.fromPem`
 * parse (`BEGIN PRIVATE KEY`). Khóa sinh MỖI LẦN GỌI; caller quyết định khi
 * nào gọi (một lần cho mỗi lần up auth trên namespace mới) và stack config
 * là nơi giữ nó ổn định giữa các lần deploy — JWKS đổi giữa chừng là mọi
 * token đã cấp không còn verify được.
 *
 * `forge` không được dùng; `node:crypto` là dependency duy nhất — cùng nguồn
 * với `generatePostgresPassword`.
 */
export async function generateEs256SigningKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const derBase64 = Buffer.from(pkcs8).toString('base64');
  const lines = derBase64.match(/.{1,64}/gu) ?? [];
  // KHÔNG phần tử '' cuối: join('\n') với '' đuôi sinh PEM kết thúc bằng '\n'
  // — `requireSecret` của app từ chối mọi giá trị có whitespace đầu/cuối, WIC
  // local rơi vào /ready 503 config_invalid vĩnh viễn (đo trực tiếp ở #249).
  // PEM RFC 7468 không đòi newline cuối; generator này chỉ phục vụ config set.
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n');
}

/** Kết quả đọc mật khẩu PostgreSQL từ stack config (nguồn sự thật canonical). */
export type PostgresPasswordLookup =
  | { state: 'found'; password: string }
  | { state: 'missing' }
  | { state: 'error'; detail: string };

/**
 * Đọc mật khẩu PostgreSQL từ stack config local.
 *
 * Config lưu **plaintext** (không `secure:`) — nên `pulumi config get` đọc
 * được mà không cần giải mã, và trả về giá trị rõ ràng. Đây là nguồn sự thật
 * canonical: `.env` chỉ là bản sao sinh ra từ đây.
 *
 * Phân biệt ba trạng thái thay vì hai: "chưa có key" (stack mới → được phép
 * sinh mật khẩu) khác "lỗi thật" (sai passphrase, backend hỏng → phải dừng,
 * không được sinh mật khẩu mới). Nhận diện sai ở đây là đúng loại lỗi khiến
 * Postgres bị khoá khỏi volume đã init.
 */
export function lookupPostgresPassword(result: ExecResult): PostgresPasswordLookup {
  if (result.status === 0) {
    const password = result.stdout.trim();
    if (password.length === 0) return { state: 'missing' };
    // Defense-in-depth: CLI `pulumi config get` trên 3.270 với đúng passphrase
    // trả về plaintext (không trả `[secret]`); masking `[secret]` chỉ xuất hiện
    // ở `pulumi config` (list) và ở Automation API (`stack output --json` không
    // `--show-secrets`, xem `@pulumi/pulumi@3.270.0` `automation/localWorkspace.js`).
    // Nhánh này vì vậy không đạt được qua đường gọi này, nhưng giữ lại để fail
    // loud nếu ever xuất hiện (vd. CLI đổi hành vi) thay vì dùng literal
    // `[secret]` làm password. Xem docs migration section để biết trigger thật.
    if (password === '[secret]') {
      return {
        state: 'error',
        detail:
          'Pulumi returned the `[secret]` masking string instead of the real password — the ' +
          'stack config is in a state where the real value cannot be read. Supply the ' +
          'correct passphrase via PULUMI_CONFIG_PASSPHRASE and retry; if it is still ' +
          'masked, see docs/services/local-platform/03-operations.md (section Migration ' +
          'legacy postgres:password).',
      };
    }
    return { state: 'found', password };
  }
  if (isConfigKeyMissing(result)) return { state: 'missing' };
  // KHÔNG nhúng raw stderr/stdout vào detail: stdout của `pulumi config get
  // postgres:password` khi lệnh exit 0 CHÍNH LÀ mật khẩu — nếu CLI đổi hành vi
  // exit-code, nhét raw output vào error string là đường leak thật (detail đi
  // vào console.error). Thay bằng thông điệp cố định + hướng dẫn người dùng tự
  // chạy lệnh để xem stderr gốc.
  return {
    state: 'error',
    detail:
      `pulumi config get failed (exit ${String(result.status)}). Run ` +
      `'pulumi config get ${POSTGRES_PASSWORD_CONFIG_KEY} --stack <stack-ref>' manually in ` +
      'deploys/platform-deploy to see the original stderr — the output of this command is ' +
      'not logged because it may contain the password.',
  };
}

/** Tình trạng volume PostgreSQL của namespace — quyết định được sinh mật khẩu mới không. */
export type PostgresVolumeProbe =
  | { state: 'absent' }
  | { state: 'present' }
  | { state: 'unknown'; detail: string };

/**
 * Kiểm volume PostgreSQL của namespace có tồn tại không.
 *
 * Sự tồn tại của volume là thứ DUY NHẤT biết "database đã được init bằng mật
 * khẩu nào" — stack config có thể mất (ví dụ `pulumi stack rm` xoá cả config
 * trong khi volume `retainOnDelete` còn lại), nhưng volume thì vẫn giữ mật
 * khẩu superuser cũ. Vì vậy khi config mất mà volume còn, KHÔNG được sinh mật
 * khẩu mới: mật khẩu mới không bao giờ khớp volume đó.
 *
 * Phân biệt "không có" với "không xác định được": lỗi Docker (daemon không
 * chạy, socket sai) không phải bằng chứng volume vắng mặt — coi nó là
 * "vắng mặt" sẽ sinh mật khẩu mới rồi khoá người dùng ra khỏi dữ liệu cũ.
 */
export function probePostgresVolume(
  volumeName: string,
  env: NodeJS.ProcessEnv,
): PostgresVolumeProbe {
  const result = exec('docker', ['volume', 'inspect', volumeName], ROOT_DIR, env);
  if (result.status === 0) return { state: 'present' };
  if (result.status === null) {
    return { state: 'unknown', detail: describeSpawnFailure(result) };
  }
  const combined = `${result.stderr}\n${result.stdout}`;
  if (/not found|no such volume/iu.test(combined)) return { state: 'absent' };
  const firstLine = combined
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return { state: 'unknown', detail: firstLine ?? 'unknown Docker error' };
}

/**
 * Chuẩn bị mật khẩu PostgreSQL cho stack local — entry up của platform gọi.
 *
 * Nguồn sự thật CANONICAL là Pulumi stack config (`postgres:password`, lưu
 * plaintext). `.env` là bản sao sinh ra — nguồn của giá trị vẫn là config.
 *
 * Ba nhánh, theo thứ tự:
 *
 * 1. **Đã có trong config** → dùng lại nguyên giá trị. Không bao giờ sinh mới:
 *    sinh mới ở đây là đè mật khẩu đang dùng bởi volume đã init → Postgres
 *    không vào được dữ liệu cũ.
 * 2. **Chưa có trong config** → kiểm volume có tồn tại không:
 *    - Volume **có** → fail với lỗi có hướng dẫn hành động (config mất nhưng
 *      volume `retainOnDelete` còn — sinh mật khẩu mới là mật khẩu KHÔNG BAO
 *      GIỜ khớp volume đó).
 *    - Volume **không** → sinh mật khẩu ngẫu nhiên và ghi vào config.
 * 3. **Lỗi thật khi đọc config** (sai passphrase, backend hỏng) → fail, KHÔNG
 *    sinh mật khẩu mới: lỗi đó không phải bằng chứng "chưa có mật khẩu".
 */
export function resolvePostgresPassword(
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): { ok: true; password: string; generated: boolean } | { ok: false; error: string } {
  const platformDir = join(ROOT_DIR, 'deploys', 'platform-deploy');
  const lookup = lookupPostgresPassword(
    exec(
      'pulumi',
      [
        'config',
        'get',
        POSTGRES_PASSWORD_CONFIG_KEY,
        '--stack',
        fullStackRef('platform-deploy', ctx),
      ],
      platformDir,
      env,
    ),
  );

  if (lookup.state === 'found') {
    return { ok: true, password: lookup.password, generated: false };
  }
  if (lookup.state === 'error') {
    return {
      ok: false,
      error:
        `Failed to read ${POSTGRES_PASSWORD_CONFIG_KEY} from stack config: ${lookup.detail}\n` +
        'Do not generate a new password when the existing one cannot be read — doing so ' +
        'would lock Postgres out of the initialized volume.',
    };
  }

  // Config không có mật khẩu — volume quyết định có được sinh mới không.
  const volumeName = dockerResourceName(ctx.namespace, 'postgres-volume');
  const volume = probePostgresVolume(volumeName, env);
  if (volume.state === 'present') {
    return {
      ok: false,
      error:
        `PostgreSQL volume ${volumeName} already exists but stack config has no ` +
        `${POSTGRES_PASSWORD_CONFIG_KEY}. The volume was initialized with a password that is ` +
        'no longer in config (usually because `pulumi stack rm` removed the config while the ' +
        '`retainOnDelete` volume remained). Generating a new password will NOT match this ' +
        'volume and every connection will get ' +
        '`password authentication failed`.\n' +
        'Remediation: restore the old password into stack config, or delete the volume to ' +
        'start over from empty data:\n' +
        '  nx run platform-deploy:local-down   # DELETES data permanently — think twice\n' +
        '  then run the local-up lane again',
    };
  }
  if (volume.state === 'unknown') {
    return {
      ok: false,
      error:
        `Cannot probe PostgreSQL volume ${volumeName}: ${volume.detail}\n` +
        'Do not generate a new password before confirming whether the volume exists — ' +
        'a generated password may not match the initialized volume.',
    };
  }

  const password = generatePostgresPassword();
  // Giá trị đi qua STDIN, không qua argv: argv của process khác đọc được qua
  // `/proc/<pid>/cmdline` (cùng user) và qua `ps` — mật khẩu local không cần
  // rò ra tới đó. `pulumi config set` đọc giá trị từ stdin khi không có
  // argument value (đo thật trên CLI 3.270), và `--raw` giữ nguyên giá trị
  // (không trim newline).
  //
  // `--plaintext` BẮT BUỘC: CLI 3.270 tự chặn giá trị "trông như secret"
  // (key `postgres:password` + giá trị ngẫu nhiên) với lỗi "looks like a
  // secret; rerun with --secret ... or --plaintext" và exit 1 — đo thật. Không
  // có cờ nào, `config set` fail và mật khẩu KHÔNG được lưu.
  const set = exec(
    'pulumi',
    [
      'config',
      'set',
      POSTGRES_PASSWORD_CONFIG_KEY,
      '--plaintext',
      '--raw',
      '--stack',
      fullStackRef('platform-deploy', ctx),
    ],
    platformDir,
    env,
    { input: password },
  );
  if (set.status !== 0) {
    return {
      ok: false,
      error: `pulumi config set ${POSTGRES_PASSWORD_CONFIG_KEY} failed:\n${set.stderr}`,
    };
  }
  return { ok: true, password, generated: true };
}

/**
 * Ghi các key mà lane platform sở hữu vào `.env` của worktree mà KHÔNG đụng
 * key khác.
 *
 * `.env` là artifact: nếu file không có thì tạo mới với đúng các key được ghi;
 * nếu có rồi thì chỉ thay dòng `KEY=...` của các key thuộc `LOCAL_ENV_OWNED_KEYS`,
 * mọi dòng khác giữ nguyên byte-for-byte.
 *
 * Chỉ key sở hữu được ghi — đây là ranh giới contract, không phải chi tiết
 * cài đặt: `values` do caller dựng và có thể vô tình mang key lạ, mà ghi đè một
 * key người dùng tự quản lý là mất dữ liệu không khôi phục được.
 */
export function upsertLocalEnv(
  worktreeRoot: string,
  values: Readonly<Record<string, string>>,
): { envPath: string } {
  const envPath = join(worktreeRoot, '.env');
  const owned = new Set<string>(LOCAL_ENV_OWNED_KEYS);
  const entries = Object.entries(values).filter(([key]) => owned.has(key));
  // Guard injection: giá trị chứa newline sẽ phá cấu trúc dòng của file khi ghi
  // (một giá trị nhiều dòng sinh ra các dòng env rác). `values` đến từ outputs
  // Pulumi được kiểm soát nên đây là fail-loud với input dị hình, không phải
  // đường xử lý bình thường.
  for (const [, value] of entries) {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(
        'upsertLocalEnv: an owned key value contains a newline character (\\n/\\r) — ' +
          'refusing to write so the .env file structure is not corrupted.',
      );
    }
  }
  if (!existsSync(envPath)) {
    if (entries.length > 0) {
      writeFileSync(envPath, `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } else {
      writeFileSync(envPath, '', { encoding: 'utf8', mode: 0o600 });
    }
    chmodFilePrivate(envPath, 0o600);
    return { envPath };
  }
  const content = readFileSync(envPath, 'utf8');
  // Bỏ phần tử rỗng CUỐI do file kết thúc bằng `\n`: giữ nó thì key được thêm
  // cuối sinh ra một dòng trống misplaced (`OTHER=keep\n\nROOT_HOST=…`) — các
  // phần tử rỗng Ở GIỮA dòng khác vẫn giữ nguyên vị trí như cũ.
  const linesFile = content.split('\n');
  const trailingEmpty = linesFile.length > 1 && linesFile[linesFile.length - 1] === '';
  const lines = trailingEmpty ? linesFile.slice(0, -1) : linesFile;
  // Merge theo vị trí: MỌI dòng `KEY=...` của một key sở hữu đều được cập nhật
  // (không chỉ dòng đầu) — nếu file lỡ có dòng trùng và dotenv parse last-wins
  // thì chỉ thay dòng đầu sẽ để lại giá trị cũ ở dòng sau. Không append thêm
  // dòng mới khi key đã xuất hiện (số lần nào cũng vậy). Dòng không thuộc key
  // sở hữu giữ nguyên byte-for-byte.
  const valueByKey = new Map(entries);
  const seen = new Set<string>();
  const next = lines.map((entry) => {
    const ownedKey = LOCAL_ENV_OWNED_KEYS.find((key) => entry.startsWith(`${key}=`));
    if (ownedKey === undefined) return entry;
    seen.add(ownedKey);
    const value = valueByKey.get(ownedKey);
    return value === undefined ? entry : `${ownedKey}=${value}`;
  });
  // Key sở hữu có trong `values` nhưng chưa xuất hiện trong file → thêm cuối một lần.
  for (const [key, value] of valueByKey) {
    if (!seen.has(key)) {
      next.push(`${key}=${value}`);
    }
  }
  writeFileSync(envPath, `${next.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodFilePrivate(envPath, 0o600);
  return { envPath };
}

/**
 * Đọc `ROOT_HOST` từ `.env` của worktree — artifact mà up của platform ghi sau
 * khi `pulumi up` xanh.
 *
 * `.env` không trở thành nguồn sự thật của resource vì hàm này chỉ đọc: giá trị
 * sai chỉ làm issuer/audience của auth lệch hostname và luồng fail ở smoke.
 */
export function readRootHostFromEnv(worktreeRoot: string): string | undefined {
  const envPath = join(worktreeRoot, '.env');
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${ROOT_HOST_ENV_KEY}=`));
  const value = line?.split('=').slice(1).join('=');
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Đọc outputs của platform stack sau khi `up` — fail-closed khi thiếu key.
 */
export function readPlatformOutputs(
  platformDir: string,
  ctx: LocalDeployContext,
  env: NodeJS.ProcessEnv,
): {
  traefikHostPort: number;
  rootHost: string;
} {
  const stdout = pulumiRun(
    platformDir,
    'platform-deploy',
    ['stack', 'output', '--json'],
    ctx,
    env,
    {
      prepareStack: false,
    },
  );
  // Không truyền `stream` nên trả về chuỗi — chỉ `up`/`preview` mới stream.
  let outputs: Record<string, unknown>;
  try {
    outputs = JSON.parse(stdout ?? '') as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse platform stack outputs as JSON:\n${stdout}`);
  }
  const rawPort = outputs['traefikHostPort'];
  // Port đo được là số nguyên dương — một giá trị `undefined`/`0`/string lọt
  // qua đây sẽ sinh `fbi.com:NaN` ở smoke test, nên chặn tại nguồn.
  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort <= 0) {
    throw new Error(
      `Invalid traefikHostPort output: ${JSON.stringify(rawPort)} — platform not fully up yet?`,
    );
  }
  return { traefikHostPort: rawPort, rootHost: buildRootHost(rawPort) };
}
