/**
 * Unit test cho lớp đọc binding Hyperdrive của `apps/backoffice` — hình dạng
 * binding, fail-closed khi env vắng, và cấu hình pool theo giới hạn
 * Hyperdrive (HD9/HD10).
 *
 * ⚠️ Test này **không** dựng DB: phần đúng của DB đã được
 * `tests/integration/read-routes.spec.ts` kiểm chứng trên PostgreSQL thật với
 * credential runtime role thật. Ở đây chỉ ghim hình dạng đầu vào và các con
 * số cấu hình — hai thứ mà test integration không bắt được (vì nó dùng
 * connection string thật).
 */

import { describe, expect, it } from 'vitest';

import { DB_BACKOFFICE_BINDING, backofficeHyperdrive, buildPoolOptions } from './db';

describe('backofficeHyperdrive', () => {
  it('returns the binding when the env carries a connection string', () => {
    const binding = { connectionString: 'postgres://runtime@origin:5432/db-backoffice' };
    expect(backofficeHyperdrive({ [DB_BACKOFFICE_BINDING]: binding })).toBe(binding);
  });

  it('returns null when the env is missing or has no binding', () => {
    expect(backofficeHyperdrive(undefined)).toBeNull();
    expect(backofficeHyperdrive(null)).toBeNull();
    expect(backofficeHyperdrive('not-an-env')).toBeNull();
    expect(backofficeHyperdrive({})).toBeNull();
    expect(backofficeHyperdrive({ SOME_OTHER_BINDING: {} })).toBeNull();
  });

  it('returns null when the binding has no usable connection string', () => {
    expect(backofficeHyperdrive({ [DB_BACKOFFICE_BINDING]: null })).toBeNull();
    expect(backofficeHyperdrive({ [DB_BACKOFFICE_BINDING]: 'string-binding' })).toBeNull();
    expect(backofficeHyperdrive({ [DB_BACKOFFICE_BINDING]: {} })).toBeNull();
    expect(backofficeHyperdrive({ [DB_BACKOFFICE_BINDING]: { connectionString: '' } })).toBeNull();
  });
});

describe('buildPoolOptions', () => {
  it('keeps the pool inside the Hyperdrive connection budget (HD9/HD10)', () => {
    expect(buildPoolOptions({ connectionString: 'postgres://runtime@origin/db' })).toEqual({
      connectionString: 'postgres://runtime@origin/db',
      // HD9: ~20 origin connection mỗi config là soft limit ⇒ pool nhỏ.
      max: 4,
      // HD10: Hyperdrive đóng idle connection sau 10 phút.
      idleTimeoutMillis: 600_000,
      // HD10: initial connect timeout 15s.
      connectionTimeoutMillis: 15_000,
    });
  });

  it('does not set ssl because Hyperdrive manages the origin TLS itself (HD2)', () => {
    expect(
      buildPoolOptions({ connectionString: 'postgres://runtime@origin/db' }),
    ).not.toHaveProperty('ssl');
  });
});
