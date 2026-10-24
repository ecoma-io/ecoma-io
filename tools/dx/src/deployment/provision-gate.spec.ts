import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionGate, readDeploymentStatus, readPulumiProjectName } from './provision-gate.js';

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

describe('readDeploymentStatus', () => {
  it('reads the marker from a deploy project package.json', () => {
    withTempProject({ 'package.json': '{"ecoma":{"deployment":{"status":"scaffold"}}}' }, (dir) => {
      expect(readDeploymentStatus(join(dir, 'package.json'))).toBe('scaffold');
    });
  });

  it('returns undefined when the marker is absent', () => {
    withTempProject({ 'package.json': '{"name":"x-deploy"}' }, (dir) => {
      expect(readDeploymentStatus(join(dir, 'package.json'))).toBeUndefined();
    });
  });

  it('returns undefined for a status value outside the contract', () => {
    // Marker chỉ có hai giá trị hợp lệ; giá trị lạ (typo, status map bị bỏ
    // vào marker) không được lọt qua làm cảnh báo giả.
    withTempProject({ 'package.json': '{"ecoma":{"deployment":{"status":"absorbed"}}}' }, (dir) => {
      expect(readDeploymentStatus(join(dir, 'package.json'))).toBeUndefined();
    });
  });

  it('returns undefined instead of throwing on an unparseable file', () => {
    withTempProject({ 'package.json': 'not json' }, (dir) => {
      expect(readDeploymentStatus(join(dir, 'package.json'))).toBeUndefined();
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

  it('announces a scaffold project and still exits 0', () => {
    // Scaffold chạy provision KHÔNG được giả vờ provision thành công — dòng
    // scaffold phải nổi bật trước dòng dry-run; đồng thời KHÔNG được fail:
    // scaffold là placeholder tường minh, không phải lỗi hợp đồng thứ tự.
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      lines.push(String(message));
    };
    try {
      withTempProject(
        {
          'Pulumi.yaml': 'name: push-notification-deploy\n',
          'package.json': '{"ecoma":{"deployment":{"status":"scaffold"}}}',
        },
        (dir) => {
          expect(provisionGate(dir)).toBe(0);
        },
      );
    } finally {
      console.log = originalLog;
    }
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      '[provision] push-notification-deploy is a scaffold — no managed resources; nothing to provision.',
    );
    expect(lines[1]).toContain('[provision] push-notification-deploy');
    expect(lines[1]).not.toContain('scaffold');
  });

  it('prints no scaffold line for an implemented project', () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      lines.push(String(message));
    };
    try {
      withTempProject(
        {
          'Pulumi.yaml': 'name: home-deploy\n',
          'package.json': '{"ecoma":{"deployment":{"status":"implemented"}}}',
        },
        (dir) => {
          expect(provisionGate(dir)).toBe(0);
        },
      );
    } finally {
      console.log = originalLog;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('scaffold');
  });

  it('treats a missing marker as implemented and stays silent about scaffolds', () => {
    // Thiếu marker không được biến cổng dry-run thành fail — arch-check là
    // nơi đảm bảo marker tồn tại; provision-gate chỉ đọc để in cảnh báo.
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      lines.push(String(message));
    };
    try {
      withTempProject({ 'Pulumi.yaml': 'name: home-deploy\n' }, (dir) => {
        expect(provisionGate(dir)).toBe(0);
      });
    } finally {
      console.log = originalLog;
    }
    expect(lines).toHaveLength(1);
  });
});
