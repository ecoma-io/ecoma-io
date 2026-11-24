/**
 * Format + lint các file agent vừa sửa, giữ kết quả khớp bước pre-commit của
 * lefthook: `oxfmt --write` cho nhóm glob format, `oxlint --fix` cho nhóm
 * JS/TS/Vue, cùng exclusion `.agents/skills/security-audit/**`; với markdown
 * thì chạy `markdownlint-cli2 --no-globs` và loại cả `.agents/skills/**`
 * (khớp block `markdownlint` của lefthook).
 *
 * Nguyên tắc xử lý lỗi, giống bản bash cũ:
 * - Lỗi công cụ (không tìm thấy binary, oxfmt crash...) **không chặn** agent:
 *   log stderr và trả exit 0.
 * - oxlint/markdownlint còn lỗi không tự sửa được thì trả exit 2 để agent
 *   thấy và sửa.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, sep, resolve } from 'node:path';

import { extractHookFiles, type HookPayload } from './payload';

/** Glob format của lefthook (`lefthook.yml` pre-commit `format`). */
const FORMAT_EXTENSIONS = 'js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|json|jsonc|css|scss|html|md|yml|yaml';
/** Glob lint của lefthook (`lefthook.yml` pre-commit `lint`). */
const LINT_EXTENSIONS = 'js|jsx|mjs|cjs|ts|tsx|mts|cts|vue';
/** Glob markdownlint của lefthook (`lefthook.yml` pre-commit `markdownlint`). */
const MARKDOWN_EXTENSIONS = 'md|markdown';
/** Exclusion chung của cả hai command trong lefthook. */
const EXCLUDED_PREFIX = '.agents/skills/security-audit/';
/** Exclusion của block markdownlint trong lefthook: toàn bộ skills. */
const MARKDOWN_EXCLUDED_PREFIX = '.agents/skills/';

export interface FormatLintResult {
  /** Exit code cho hook: 0 = không chặn, 2 = còn lỗi lint cho agent sửa. */
  exitCode: 0 | 2;
}

/** Kết quả chạy một tool con (oxfmt/oxlint) trên một nhóm file. */
interface ToolRun {
  status: number;
  output: string;
}

export interface RunFormatLintOptions {
  /** Thư mục gốc project; paths ngoài thư mục này bị bỏ qua. */
  root: string;
  /** Env truyền cho tool con; mặc định `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Inject runner cho test; mặc định `spawnSync` của node. */
  runToolFn?: (
    argv: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => { status: number | null; output: string };
  /** Thư mục chứa binary local; mặc định `<root>/node_modules/.bin`. */
  binDir?: string;
}

function matchesExtension(absoluteFile: string, extensions: string): boolean {
  return new RegExp(`\\.(?:${extensions})$`, 'u').test(absoluteFile.toLowerCase());
}

/** Chia file đã lọc theo root + exclusion thành nhóm format, lint và markdown. */
export function partitionFiles(
  files: string[],
  root: string,
): { format: string[]; lint: string[]; markdown: string[] } {
  const format: string[] = [];
  const lint: string[] = [];
  const markdown: string[] = [];

  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join('/');
    if (relativePath.startsWith(EXCLUDED_PREFIX)) continue;

    if (matchesExtension(file, FORMAT_EXTENSIONS)) {
      format.push(file);
      if (matchesExtension(file, LINT_EXTENSIONS)) {
        lint.push(file);
      } else if (
        matchesExtension(file, MARKDOWN_EXTENSIONS) &&
        !relativePath.startsWith(MARKDOWN_EXCLUDED_PREFIX)
      ) {
        markdown.push(file);
      }
    }
  }

  return { format, lint, markdown };
}

/**
 * Chạy tool với danh sách file, ưu tiên binary local để tránh độ trễ của npx;
 * thiếu binary local thì fallback `npx --no-install` (giống bản bash cũ).
 *
 * Trả status process; stdout+stderr gộp một buffer để in ra khi lỗi.
 */
function runTool(
  name: string,
  args: string[],
  options: {
    root: string;
    binDir: string;
    env: NodeJS.ProcessEnv;
    runToolFn: NonNullable<RunFormatLintOptions['runToolFn']>;
  },
): ToolRun {
  // Ưu tiên binary local để tránh độ trễ của npx
  const localBin = resolve(options.binDir, name);
  const hasLocal = existsSync(localBin);
  const argv = hasLocal ? [localBin, ...args] : ['npx', '--no-install', name, ...args];

  const result = options.runToolFn(argv, { cwd: options.root, env: options.env });

  return { status: result.status ?? -1, output: result.output };
}

/** Kết quả đầy đủ của một tiến trình con, dùng cho default runner. */
interface SyncSpawnResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
}

/**
 * Chạy `oxfmt --write`, `oxlint --fix` và `markdownlint-cli2 --no-globs`
 * trên các file payload chỉ ra.
 *
 * Lỗi tool log qua callback `report` và **không** dừng workflow (exit 0);
 * oxlint/markdownlint còn lỗi thì exit 2.
 */
export function runFormatLint(
  payload: HookPayload,
  options: RunFormatLintOptions & { report?: (message: string) => void },
): FormatLintResult {
  const root = resolve(options.root);
  const env = options.env ?? process.env;
  const binDir = options.binDir ?? resolve(root, 'node_modules/.bin');
  const report = options.report ?? ((message: string) => process.stderr.write(`${message}\n`));
  const runToolFn =
    options.runToolFn ??
    ((argv: string[], spawnOptions: { cwd: string; env: NodeJS.ProcessEnv }) => {
      const result: SyncSpawnResult = spawnSync(argv[0]!, argv.slice(1), {
        ...spawnOptions,
        encoding: 'utf-8',
      });
      const output = [result.stdout ?? '', result.stderr ?? ''].join('');
      return { status: result.status, output };
    });

  const files = extractHookFiles(payload, root);
  const { format, lint, markdown } = partitionFiles(files, root);
  if (format.length === 0) return { exitCode: 0 };

  const runOptions = { root, binDir, env, runToolFn };

  const formatRun = runTool(
    'oxfmt',
    ['--write', '--no-error-on-unmatched-pattern', ...format],
    runOptions,
  );
  if (formatRun.status !== 0) {
    // Lỗi công cụ không nên chặn workflow
    report(`[agent-hooks] oxfmt failed:\n${formatRun.output}`);
    return { exitCode: 0 };
  }

  if (lint.length > 0) {
    const lintRun = runTool(
      'oxlint',
      ['--fix', '--no-error-on-unmatched-pattern', ...lint],
      runOptions,
    );
    if (lintRun.status !== 0) {
      // Exit code 2: báo lỗi lint còn lại cho agent
      report(`[agent-hooks] oxlint found issues:\n${lintRun.output}`);
      return { exitCode: 2 };
    }
  }

  if (markdown.length > 0) {
    const markdownRun = runTool('markdownlint-cli2', ['--no-globs', ...markdown], runOptions);
    if (markdownRun.status !== 0) {
      // Exit code 2: báo lỗi markdown còn lại cho agent
      report(`[agent-hooks] markdownlint found issues:\n${markdownRun.output}`);
      return { exitCode: 2 };
    }
  }

  return { exitCode: 0 };
}
