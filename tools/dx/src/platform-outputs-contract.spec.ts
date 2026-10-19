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
