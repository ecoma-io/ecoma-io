/**
 * Sinh cấu hình Wrangler runtime theo worktree và cô lập binding state local.
 *
 * PR3: committed `wrangler.jsonc` là NGUỒN SỰ THẬT của binding definitions.
 * Module này đọc config committed, kiểm fail-closed (không remote, không touch
 * tài nguyên remote), rồi sinh ra một config runtime disposable trong
 * `<worktreeRoot>/.worker-local-state/generated/` với:
 *
 * - `migrations_dir` tuyệt đối (để `wrangler d1 migrations apply --local` chạy
 *   đúng dù cwd khác nơi chứa config committed).
 * - persist dir theo worktree (`workerProcessStateDir` / `WORKER_STATE_DIR_NAME`)
 *   để hai worktree không dùng chung D1/Queue state.
 * - port dev xác định theo (namespace, worker name) để tránh đụng port giữa
 *   các worktree.
 *
 * Config sinh ra là disposable: xoá được an toàn, sinh lại là idempotent. Không
 * bao giờ truyền `--remote` và không bao giờ resolve binding tới tài nguyên
 * remote — mọi `remote: true` trong config committed đều bị từ chối.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { normalizeWorktreeRoot, worktreeNamespace } from './deploy-namespace.js';
import { workerProcessStateDir } from './worker-process.js';
import { ROOT_DIR } from './utils.js';

/** Thư mục con chứa config runtime sinh ra, nằm trong state dir của worktree. */
export const GENERATED_CONFIG_DIR_NAME = 'generated';

/** Đường dẫn thư mục chứa config runtime sinh ra của một worktree. */
export function generatedConfigDir(worktreeRoot: string): string {
  return join(workerProcessStateDir(worktreeRoot), GENERATED_CONFIG_DIR_NAME);
}

/** Persist dir theo worktree — dùng chung cho mọi process Worker của worktree đó. */
export function persistToDir(worktreeRoot: string): string {
  return workerProcessStateDir(worktreeRoot);
}

/** D1 database entry trong committed wrangler config (subset dùng cho local). */
export interface WranglerD1Database {
  binding: string;
  database_name: string;
  database_id?: string;
  preview_database_id?: string;
  migrations_table?: string;
  migrations_dir?: string;
  migrations_pattern?: string;
  database_internal_env?: string;
  remote?: boolean;
  [key: string]: unknown;
}

/** Shape tối thiểu của committed wrangler config mà PR3 quan tâm. */
export interface CommittedWranglerConfig {
  $schema?: string;
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  account_id?: string;
  workers_dev?: boolean;
  observability?: Record<string, unknown>;
  d1_databases?: WranglerD1Database[];
  queues?: Record<string, unknown>;
  services?: Array<Record<string, unknown>>;
  vars?: Record<string, unknown>;
  triggers?: Record<string, unknown>;
  dev?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LoadedCommittedConfig {
  config: CommittedWranglerConfig;
  configPath: string;
  configDir: string;
}

export interface GenerateWorkerConfigOptions {
  /** Worktree root (tuyệt đối hoặc tương đối) — sẽ được normalize. */
  worktreeRoot: string;
  /** Đường dẫn tới committed wrangler.jsonc (nguồn sự thật). */
  committedConfigPath: string;
  /** Tên Worker dùng cho tên file sinh ra và port. Mặc định lấy từ config.name. */
  workerName?: string;
  /** Port dev tường minh. Nếu không truyền, tự phân bổ theo namespace. */
  port?: number;
  /**
   * Remote mode — PHẢI là false/undefined. Truyền true để báo lỗi rõ ràng
   * (fail-closed): PR3 không bao giờ chạy remote.
   */
  remote?: boolean;
}

export interface GeneratedWorkerConfigResult {
  worktreeRoot: string;
  namespace: string;
  persistTo: string;
  configPath: string;
  config: CommittedWranglerConfig;
}

export interface ApplyLocalSeedsOptions {
  /** Đường dẫn committed/generated config dùng làm --config. */
  configPath: string;
  /** Tên D1 database (database_name) cần execute. */
  databaseName: string;
  /** Persist dir theo worktree. */
  persistTo: string;
  /** Danh sách file seed (.sql) áp dụng theo thứ tự. */
  seedFiles: string[];
  /** Remote mode — PHẢI là false/undefined, truyền true để báo lỗi. */
  remote?: boolean;
  /** Đường dẫn wrangler CLI (mặc định node_modules/wrangler/bin/wrangler.js). */
  wranglerBin?: string;
  /** cwd cho subprocess wrangler. */
  cwd?: string;
}

export interface ApplyLocalMigrationsOptions {
  configPath: string;
  databaseName: string;
  persistTo: string;
  remote?: boolean;
  wranglerBin?: string;
  cwd?: string;
}

// ---------- JSONC parser (không phụ thuộc dependency mới) ----------

/**
 * Bỏ comment (`//`, `/* *\/`) và dấu phẩy thừa trước `}`/`]` trong JSONC,
 * tôn trọng chuỗi. Trả về chuỗi JSON hợp lệ.
 */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  let state: 'normal' | 'string' | 'lineComment' | 'blockComment' = 'normal';
  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';
    if (state === 'normal') {
      if (ch === '"') {
        out += ch;
        state = 'string';
        i += 1;
        continue;
      }
      if (ch === '/' && next === '/') {
        state = 'lineComment';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'blockComment';
        i += 2;
        continue;
      }
      if (ch === ',') {
        // trailing comma: bỏ qua nếu ký tự không-space tiếp theo là } hoặc ]
        let j = i + 1;
        while (
          j < n &&
          (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')
        )
          j += 1;
        if (j < n && (text[j] === '}' || text[j] === ']')) {
          i += 1;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'string') {
      out += ch;
      if (ch === '\\') {
        // escape: copy ký tự tiếp theo nguyên vẹn
        if (i + 1 < n) {
          out += text[i + 1];
          i += 2;
          continue;
        }
      }
      if (ch === '"') {
        state = 'normal';
      }
      i += 1;
      continue;
    }
    if (state === 'lineComment') {
      if (ch === '\n') {
        out += '\n';
        state = 'normal';
      }
      i += 1;
      continue;
    }
    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        i += 2;
        continue;
      }
      if (ch === '\n') out += '\n';
      i += 1;
      continue;
    }
  }
  return out;
}

/** Parse JSONC (có comment + trailing comma) thành giá trị JS. Fail-closed khi parse lỗi. */
export function parseJsonc(text: string): unknown {
  const cleaned = stripJsonc(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`không parse được JSONC: ${(error as Error).message}`, { cause: error });
  }
}

// ---------- Validation fail-closed ----------

function assertNoRemoteTrue(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRemoteTrue(item, `${path}[${index}]`));
    return;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'remote' && val === true) {
      throw new Error(
        `wrangler config chứa 'remote: true' tại ${childPath} — PR3 không cho phép remote mode`,
      );
    }
    assertNoRemoteTrue(val, childPath);
  }
}

export function validateCommittedWranglerConfig(config: unknown): CommittedWranglerConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('wrangler config phải là một object');
  }
  const c = config as Record<string, unknown>;
  if (typeof c.name !== 'string' || c.name.trim().length === 0) {
    throw new Error("wrangler config thiếu 'name' (string không rỗng)");
  }
  if (typeof c.main !== 'string' || c.main.trim().length === 0) {
    throw new Error("wrangler config thiếu 'main' (string không rỗng)");
  }
  if (typeof c.compatibility_date !== 'string' || c.compatibility_date.trim().length === 0) {
    throw new Error("wrangler config thiếu 'compatibility_date' (string không rỗng)");
  }
  assertNoRemoteTrue(config, '');
  // account_id không được dùng trong local runtime — tránh resolve tới account thật.
  if (typeof c.account_id === 'string' && c.account_id.trim().length > 0) {
    throw new Error(
      "wrangler config khai 'account_id' — local runtime không được resolve tới account thật",
    );
  }
  return c as CommittedWranglerConfig;
}

export function loadCommittedWranglerConfig(configPath: string): LoadedCommittedConfig {
  const absolute = resolve(configPath);
  if (!existsSync(absolute)) {
    throw new Error(`committed wrangler config không tồn tại: ${absolute}`);
  }
  let raw: string;
  try {
    raw = readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`không đọc được committed wrangler config: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const parsed = parseJsonc(raw);
  const config = validateCommittedWranglerConfig(parsed);
  return { config, configPath: absolute, configDir: dirname(absolute) };
}

// ---------- Port phân bổ ----------

/** Port dev xác định theo (namespace, worker name) — tránh đụng giữa worktree. */
export function allocateWorkerPort(namespace: string, workerName: string): number {
  const input = `${namespace}\u0000${workerName}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  // range 10000..59999, tránh port privileged và hay dùng.
  return 10000 + (hash % 50000);
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return cleaned.length > 0 ? cleaned : 'worker';
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

// ---------- Sinh config runtime ----------

export function generateWorkerConfig(
  options: GenerateWorkerConfigOptions,
): GeneratedWorkerConfigResult {
  if (options.remote === true) {
    throw new Error('generateWorkerConfig: remote mode không được phép (PR3 fail-closed)');
  }
  const normalizedRoot = normalizeWorktreeRoot(options.worktreeRoot);
  const namespace = worktreeNamespace(normalizedRoot);
  const loaded = loadCommittedWranglerConfig(options.committedConfigPath);
  const { config: committed, configDir } = loaded;

  const generated = deepClone(committed);

  // Wrangler resolve mọi path tương đối theo THƯ MỤC CHỨA config file, không
  // phải cwd — generated config nằm ở `<root>/.worker-local-state/generated/`,
  // khác configDir của committed config, nên mọi path trỏ về repo (hiện tại
  // là `main`) phải tuyệt đối hoá bằng configDir, cùng cơ chế với
  // migrations_dir bên dưới. OCR high finding (cả hai run chốt cùng lý do).
  if (
    typeof generated.main === 'string' &&
    generated.main.trim().length > 0 &&
    !isAbsolute(generated.main)
  ) {
    generated.main = resolve(configDir, generated.main);
  }

  // migrations_dir tuyệt đối cho mọi D1 binding.
  if (Array.isArray(generated.d1_databases)) {
    for (const entry of generated.d1_databases) {
      if (entry && typeof entry === 'object') {
        const db = entry as WranglerD1Database;
        const source =
          typeof db.migrations_dir === 'string' && db.migrations_dir.trim().length > 0
            ? db.migrations_dir
            : 'migrations';
        db.migrations_dir = resolve(configDir, source);
      }
    }
  }

  // Port dev theo worktree để tránh đụng port giữa các worktree.
  const workerName = options.workerName ?? generated.name;
  const port = options.port ?? allocateWorkerPort(namespace, workerName);
  const existingDev =
    generated.dev && typeof generated.dev === 'object' && !Array.isArray(generated.dev)
      ? (generated.dev as Record<string, unknown>)
      : {};
  generated.dev = { ...existingDev, port };

  // Fail-closed: không còn remote:true nào lọt qua.
  assertNoRemoteTrue(generated, '');

  const persistTo = persistToDir(normalizedRoot);
  const outDir = generatedConfigDir(normalizedRoot);
  mkdirSync(outDir, { recursive: true });

  const baseName = `${sanitizeFileName(workerName)}.wrangler.jsonc`;
  const configPath = join(outDir, baseName);

  const content = `${JSON.stringify(generated, null, 2)}\n`;
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, configPath);
  } catch (error) {
    try {
      // best-effort dọn temp file nếu rename fail.
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw new Error(`không ghi được generated config: ${(error as Error).message}`, {
      cause: error,
    });
  }

  return {
    worktreeRoot: normalizedRoot,
    namespace,
    persistTo,
    configPath,
    config: generated,
  };
}

// ---------- Áp dụng seeds/migrations local ----------

const DEFAULT_WRANGLER_BIN = join(ROOT_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function resolveWranglerInvocation(wranglerBin?: string): { command: string; prefix: string[] } {
  const bin = wranglerBin ?? DEFAULT_WRANGLER_BIN;
  if (bin.endsWith('.js') || bin.endsWith('.mjs') || bin.endsWith('.cjs')) {
    return { command: process.execPath, prefix: [bin] };
  }
  return { command: bin, prefix: [] };
}

// Env tối thiểu cho wrangler subprocess — không leak Cloudflare token/account
// env từ parent, defense-in-depth dù generateWorkerConfig đã fail-closed remote.
function sanitizedWranglerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function runWrangler(args: string[], options: { wranglerBin?: string; cwd?: string }): void {
  const { command, prefix } = resolveWranglerInvocation(options.wranglerBin);
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000, // không chờ wrangler treo vô hạn
    env: sanitizedWranglerEnv(),
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      throw new Error(`wrangler ${args.join(' ')} vượt quá timeout 5 phút — abort`);
    }
    throw new Error(`wrangler không chạy được: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim() || (result.stdout ?? '').trim() || 'lý do không rõ';
    throw new Error(`wrangler ${args.join(' ')} thất bại:\n${detail}`);
  }
}

export function applyLocalD1Seeds(options: ApplyLocalSeedsOptions): void {
  if (options.remote === true) {
    throw new Error('applyLocalD1Seeds: remote mode không được phép (PR3 fail-closed)');
  }
  const configPath = resolve(options.configPath);
  if (!existsSync(configPath)) {
    throw new Error(`config không tồn tại: ${configPath}`);
  }
  if (!existsSync(options.persistTo)) {
    mkdirSync(options.persistTo, { recursive: true });
  }
  for (const seedFile of options.seedFiles) {
    const absoluteSeed = resolve(seedFile);
    if (!existsSync(absoluteSeed)) {
      throw new Error(`seed file không tồn tại: ${absoluteSeed}`);
    }
    runWrangler(
      [
        'd1',
        'execute',
        options.databaseName,
        '--config',
        configPath,
        '--local',
        '--persist-to',
        options.persistTo,
        '--file',
        absoluteSeed,
      ],
      { wranglerBin: options.wranglerBin, cwd: options.cwd },
    );
  }
}

export function applyLocalD1Migrations(options: ApplyLocalMigrationsOptions): void {
  if (options.remote === true) {
    throw new Error('applyLocalD1Migrations: remote mode không được phép (PR3 fail-closed)');
  }
  const configPath = resolve(options.configPath);
  if (!existsSync(configPath)) {
    throw new Error(`config không tồn tại: ${configPath}`);
  }
  if (!existsSync(options.persistTo)) {
    mkdirSync(options.persistTo, { recursive: true });
  }
  runWrangler(
    [
      'd1',
      'migrations',
      'apply',
      options.databaseName,
      '--config',
      configPath,
      '--local',
      '--persist-to',
      options.persistTo,
    ],
    { wranglerBin: options.wranglerBin, cwd: options.cwd },
  );
}
