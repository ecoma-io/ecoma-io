import { describe, expect, it } from 'vitest';

/**
 * Suite này kiểm hợp đồng đầu vào của smoke script bằng cách chạy chính tiến
 * trình script với argument sai — exit code và stderr là contract công khai
 * của nó (local-deploy gọi script qua `node` và đọc exit code). Không request
 * mạng nào ở đây: kịch bản HTTPS thật thuộc integration test có Docker.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { ROOT_DIR } from './utils.js';

const script = join(ROOT_DIR, 'tools/dx/src/local-smoke.mjs');

function run(args: string[]): { status: number; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 30000,
    });
    return { status: 0, stderr: stdout };
  } catch (error) {
    const err = error as { status?: number; stderr?: string; stdout?: string };
    return { status: err.status ?? -1, stderr: (err.stderr ?? err.stdout ?? '').trim() };
  }
}

describe('local-smoke.mjs input contract', () => {
  it('không có argument → usage, exit 2', () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage');
  });

  it('rootHost thiếu port → exit 2 với báo lỗi định dạng', () => {
    const result = run(['fbi.com']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('<hostname>:<port>');
  });

  it('port không phải số → exit 2', () => {
    const result = run(['fbi.com:notaport']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('port không hợp lệ');
  });

  it('port ngoài range → exit 2', () => {
    const result = run(['fbi.com:99999']);
    expect(result.status).toBe(2);
  });

  it('hostname/port không truy cập được → exit 1 (fail-closed, không nuốt lỗi)', () => {
    // Port 1 trên loopback: không server nào nghe — TLS handshake fail hoặc
    // connection refused; CẢ HAI đều phải exit khác 0. Đây là bằng chứng script
    // KHÔNG fake pass khi server không có.
    const result = run(['fbi.com:1']);
    expect(result.status).not.toBe(0);
  });
});
