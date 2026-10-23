import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildRootHost,
  extractTraefikHostPort,
  LOCAL_ROOT_HOSTNAME,
  TRAEFIK_INTERNAL_PORT,
} from './platform-outputs-contract.js';

describe('buildRootHost', () => {
  it('ghép hostname với port thực tế — `fbi.com:<port>`', () => {
    expect(buildRootHost(32768)).toBe('fbi.com:32768');
    expect(buildRootHost(44301)).toBe('fbi.com:44301');
  });

  it('hostname là hằng số local đã chốt', () => {
    expect(LOCAL_ROOT_HOSTNAME).toBe('fbi.com');
  });
});

describe('traefik-dynamic.yml consistency', () => {
  it('cert filename trong dynamic config khớp LOCAL_ROOT_HOSTNAME — hai nguồn sự thật bị khóa lại', () => {
    // `deploys/platform-deploy/index.ts` suy tên cert từ `LOCAL_ROOT_HOSTNAME`,
    // còn `traefik-dynamic.yml` hardcode — lệch một chữ là MỌI worktree sập
    // (Traefik không có certificate trong store). Test đọc chính file YAML và
    // khóa hai bên với nhau thay vì dựa kỷ luật "sửa cùng lúc".
    //
    // Anchor từ vị trí file này (`import.meta.dirname` — ESM, thay cho
    // `__dirname` CJS): spec nằm ở tools/dx/src/deployment/local-platform nên
    // cần năm mức `../` về repo root. Sai một mức là ENOENT ngay khi chạy.
    const dynamic = readFileSync(
      join(import.meta.dirname, '../../../../../deploys/platform-deploy/traefik-dynamic.yml'),
      'utf8',
    );
    expect(dynamic).toContain(`certFile: /certs/${LOCAL_ROOT_HOSTNAME}.crt`);
    expect(dynamic).toContain(`keyFile: /certs/${LOCAL_ROOT_HOSTNAME}.key`);
    // Mọi dòng `certFile:`/`keyFile:` phải trỏ đúng hostname hằng số — thu về
    // một mảng trước, assert không điều kiện (vitest cấm `expect` trong if).
    const mounted = dynamic
      .split('\n')
      .map((line) => line.match(/(certFile|keyFile): \/certs\/(\S+)/u))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ kind: m[1], file: m[2] }));
    expect(mounted.length).toBeGreaterThanOrEqual(2);
    expect(mounted).toEqual([
      { kind: 'certFile', file: `${LOCAL_ROOT_HOSTNAME}.crt` },
      { kind: 'keyFile', file: `${LOCAL_ROOT_HOSTNAME}.key` },
    ]);
  });
});

describe('extractTraefikHostPort', () => {
  it('đọc external của đúng port HTTPS nội bộ', () => {
    expect(
      extractTraefikHostPort([
        { internal: 8080, external: 39000 },
        { internal: TRAEFIK_INTERNAL_PORT, external: 39001 },
      ]),
    ).toBe(39001);
  });

  it('fail-closed khi ports undefined', () => {
    expect(() => extractTraefikHostPort(undefined)).toThrow(/chưa sẵn sàng/u);
  });

  it('fail-closed khi port HTTPS không có external (Docker chưa cấp)', () => {
    expect(() => extractTraefikHostPort([{ internal: TRAEFIK_INTERNAL_PORT }])).toThrow(
      /chưa sẵn sàng/u,
    );
    expect(() =>
      extractTraefikHostPort([{ internal: TRAEFIK_INTERNAL_PORT, external: 0 }]),
    ).toThrow(/chưa sẵn sàng/u);
  });

  it('fail-closed với NaN — so sánh <= với NaN luôn false, phải chặn bằng Number.isInteger', () => {
    expect(() =>
      extractTraefikHostPort([{ internal: TRAEFIK_INTERNAL_PORT, external: Number.NaN }]),
    ).toThrow(/chưa sẵn sàng/u);
  });

  it('fail-closed khi không có port nào khớp HTTPS nội bộ', () => {
    expect(() => extractTraefikHostPort([{ internal: 80, external: 39002 }])).toThrow(
      /chưa sẵn sàng/u,
    );
  });
});
