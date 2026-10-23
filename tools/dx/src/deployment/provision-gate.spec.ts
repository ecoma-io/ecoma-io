import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionGate, readPulumiProjectName } from './provision-gate.js';

/**
 * `provisionGate` trả về exit code thay vì tự gọi `process.exit`, nên test được
 * cả hai nhánh mà không cần spawn process — và không cần chạm hạ tầng thật.
 */
function withTempProject(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'provision-gate-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    run(dir);
  } finally {
    // `rmSync` phải chạy hết: thư mục tạm là tài nguyên của runner, rò rỉ 2 test
    // mỗi lần chạy sẽ đầy inode của /tmp.
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readPulumiProjectName', () => {
  it('reads the project name from a manifest', () => {
    withTempProject({ 'Pulumi.yaml': 'name: home-deploy\nruntime: nodejs\n' }, (dir) => {
      expect(readPulumiProjectName(join(dir, 'Pulumi.yaml'))).toEqual({ name: 'home-deploy' });
    });
  });

  it('trims trailing whitespace off the name', () => {
    withTempProject({ 'Pulumi.yaml': 'name:   home-deploy  \n' }, (dir) => {
      expect(readPulumiProjectName(join(dir, 'Pulumi.yaml'))).toEqual({ name: 'home-deploy' });
    });
  });

  it('does not accept an indented name as a declaration', () => {
    // Manifest YAML hợp lệ có thể indent, nhưng khi đó `name` KHÔNG phải khoá
    // cấp gốc của Pulumi. Regex neo `^name:` cố ý từ chối: đọc nhầm một khoá
    // lồng vào làm project name thành giá trị sai, im lặng hơn là báo lỗi.
    withTempProject({ 'Pulumi.yaml': 'config:\n  name: home-deploy\n' }, (dir) => {
      const result = readPulumiProjectName(join(dir, 'Pulumi.yaml'));
      expect('error' in result).toBe(true);
    });
  });

  it('reports a missing manifest rather than throwing', () => {
    withTempProject({}, (dir) => {
      const result = readPulumiProjectName(join(dir, 'Pulumi.yaml'));
      expect('error' in result).toBe(true);
    });
  });

  it('reports a manifest with no name field', () => {
    withTempProject({ 'Pulumi.yaml': 'runtime: nodejs\n' }, (dir) => {
      const result = readPulumiProjectName(join(dir, 'Pulumi.yaml'));
      expect('error' in result).toBe(true);
    });
  });
});

describe('provisionGate', () => {
  it('exits 0 for a valid deployment project', () => {
    withTempProject({ 'Pulumi.yaml': 'name: home-deploy\n' }, (dir) => {
      expect(provisionGate(dir)).toBe(0);
    });
  });

  it('exits 1 when the manifest is absent — fail closed', () => {
    withTempProject({}, (dir) => {
      expect(provisionGate(dir)).toBe(1);
    });
  });

  it('exits 1 when the manifest declares no name', () => {
    withTempProject({ 'Pulumi.yaml': 'runtime: nodejs\n' }, (dir) => {
      expect(provisionGate(dir)).toBe(1);
    });
  });
});
