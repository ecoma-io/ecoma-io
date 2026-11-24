import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Ghim biên phụ thuộc ADR-0018 của `llm-seller-governance-domain`.
 *
 * Lib chỉ được phụ thuộc `@ecoma-io/domain-primitives` và
 * `@ecoma-io/llm-seller-tenant-domain` (một chiều, primitive thôi), ngoài đó là
 * stdlib Node. Mọi import `@ecoma-io/*` khác — đặc biệt chiều ngược sang lib
 * consumer (marketplace, financial, routing...) — là vi phạm biên.
 *
 * Spec đọc trực tiếp source thay vì phân tích graph build: lỗi import vi phạm
 * sẽ bị bắt ngay cả khi tsconfig chưa kịp chặn.
 */

const SRC_ROOT = join(import.meta.dirname, '..');

const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  '@ecoma-io/domain-primitives',
  '@ecoma-io/llm-seller-tenant-domain',
]);

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function workspaceImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from '(@ecoma-io\/[^']*)'/g)].map((match) => match[1]);
}

describe('llm-seller-governance-domain dependency boundary (ADR-0018)', () => {
  it('imports only domain-primitives and llm-seller-tenant-domain from the workspace', () => {
    const violations: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      for (const packageName of workspaceImports(file)) {
        if (!ALLOWED_PACKAGES.has(packageName)) {
          violations.push(`${file}: ${packageName}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('never imports the spec-only verdict consumer beyond the type boundary', () => {
    // `isSellerRestrictionVerdict` của tenant chỉ được dùng trong spec ghim hợp
    // đồng biên (restriction-verdict-boundary.spec.ts), không lọt vào source
    // runtime của governance.
    const runtimeFiles = listTsFiles(SRC_ROOT).filter((file) => !file.endsWith('.spec.ts'));
    const offenders = runtimeFiles.filter((file) =>
      readFileSync(file, 'utf8').includes('isSellerRestrictionVerdict'),
    );
    expect(offenders).toEqual([]);
  });
});
