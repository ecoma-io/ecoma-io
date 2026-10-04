import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_DIR } from './utils.js';

/**
 * Rule của OpenCodeReview là *policy* của repository, không phải config của một
 * app: nó quyết định file nào được đưa vào AI Review. Spec này ghim phần policy
 * đó để một thay đổi vô tình không âm thầm bật/tắt phạm vi review.
 *
 * Điều spec này KHÔNG chứng minh: CLI có thật sự chọn `.md` hay không. Bằng
 * chứng cho hành vi đó là `ocr review --preview --from <base> --to <head>` chạy
 * trên artifact thật (xem PR của issue #239), vì chỉ CLI mới có quyền quyết
 * định — spec này không mô phỏng lại doublestar của CLI.
 */
const RULE_PATH = join(ROOT_DIR, '.opencodereview', 'rule.json');

/**
 * Tập pattern `exclude` được phép dùng: đúng các pattern của
 * `internal/config/allowlist/default_exclude_patterns.json` (ref action đang
 * ghim) mà một file Markdown có thể khớp, cộng bốn pattern mở rộng cho tên khóa
 * riêng tư có hậu tố (upstream chỉ khớp tên khóa chính xác, ví dụ `id_rsa`, nên
 * không phủ `id_rsa.md`). Thêm pattern ngoài tập này là đổi policy review — phải
 * sửa spec này một cách có chủ ý, cùng lúc với rule.
 */
const ALLOWED_EXCLUDES = new Set([
  '**/*.generated.*',
  '**/testdata/**',
  '**/fixtures/**',
  '**/__tests__/**',
  '**/__snapshots__/**',
  '**/dist/**',
  '**/.nuxt/**',
  '**/{id_rsa,id_dsa,id_ecdsa,id_ed25519}*',
]);

const MARKDOWN_GLOBS = ['**/*.md', '**/*.markdown', '**/*.mdx'];

type RuleFile = { include?: unknown; exclude?: unknown };

function readRule(): RuleFile {
  return JSON.parse(readFileSync(RULE_PATH, 'utf8')) as RuleFile;
}

describe('OpenCodeReview project rule', () => {
  it('includes every markdown extension the CLI does not support by default', () => {
    const rule = readRule();
    expect(Array.isArray(rule.include)).toBe(true);
    expect(rule.include).toStrictEqual(MARKDOWN_GLOBS);
  });

  it('keeps a non-empty exclude list', () => {
    const rule = readRule();
    expect(Array.isArray(rule.exclude)).toBe(true);
    expect(rule.exclude).not.toHaveLength(0);
  });

  it('does not exclude any file the rule set was widened to review', () => {
    const rule = readRule();
    // Một pattern phủ toàn bộ Markdown (`**/*.md`) sẽ vô hiệu hóa chính tính
    // năng này mà mọi check khác vẫn xanh.
    const catchAll = ['**/*.md', '**/*.markdown', '**/*.mdx', '**'];
    for (const pattern of rule.exclude as unknown[]) {
      expect(catchAll).not.toContain(pattern);
    }
  });

  it('only uses documented exclude patterns', () => {
    const rule = readRule();
    const unexpected = (rule.exclude as unknown[]).filter(
      (pattern) => typeof pattern !== 'string' || !ALLOWED_EXCLUDES.has(pattern),
    );
    expect(unexpected).toStrictEqual([]);
  });
});
