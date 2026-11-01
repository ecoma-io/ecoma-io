import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRealBackofficeAdapter } from './real-adapter';

/**
 * Unit test cho adapter thật — fetch không gọi mạng thật: `globalThis.fetch`
 * được stub để trả về payload có kiểm soát, và test assert payload đúng shape
 * mà adapter ánh xạ sang kiểu UI.
 *
 * Chạy tách biệt DB thật: route `/api/*` không bao giờ được gọi trong test này,
 * chỉ `fetch` stub được gọi. Điều này tuân thủ 06-testing.md §4: `test` =
 * colocated unit, dependency ngoài (mạng/DB) thay bằng giả lập.
 */

/** Gán `globalThis.fetch` thành hàm stub trả về `payload` đã kiểm soát. */
function respondWith(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

describe('createRealBackofficeAdapter', () => {
  const STAFF_RESPONSE = {
    staff: [
      { sub: 'acct_1', status: 'active', displayName: 'Nguyễn Văn A' },
      { sub: 'acct_2', status: 'suspended', displayName: null },
    ],
  };

  const ROLES_RESPONSE = {
    roles: [
      { id: 'operator', isSystem: true },
      { id: 'support', isSystem: false },
    ],
  };

  const PERMISSIONS_RESPONSE = {
    permissions: [
      { id: 'staff.read', domain: 'staff', action: 'read', status: 'active' },
      { id: 'role.read', domain: 'role', action: 'read', status: 'active' },
      { id: 'permission.read', domain: 'permission', action: 'read', status: 'active' },
    ],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isPreview = false (adapter thật không phải prototype)', () => {
    respondWith(STAFF_RESPONSE);
    expect(createRealBackofficeAdapter().isPreview).toBe(false);
  });

  it('listStaff ánh xạ wire shape sang StaffMember UI', async () => {
    respondWith(STAFF_RESPONSE);
    const adapter = createRealBackofficeAdapter();

    const staff = await adapter.listStaff();

    expect(staff).toEqual([
      { accountId: 'acct_1', displayName: 'Nguyễn Văn A', status: 'active', roleIds: [] },
      { accountId: 'acct_2', displayName: '', status: 'suspended', roleIds: [] },
    ]);
  });

  it('listRoles ánh xạ wire shape sang SystemRole UI', async () => {
    respondWith(ROLES_RESPONSE);
    const adapter = createRealBackofficeAdapter();

    const roles = await adapter.listRoles();

    expect(roles).toEqual([
      { id: 'operator', permissionIds: [] },
      { id: 'support', permissionIds: [] },
    ]);
  });

  it('listPermissions ánh xạ wire shape sang Permission UI', async () => {
    respondWith(PERMISSIONS_RESPONSE);
    const adapter = createRealBackofficeAdapter();

    const permissions = await adapter.listPermissions();

    expect(permissions).toEqual([
      { id: 'staff.read', domain: 'staff', action: 'read' },
      { id: 'role.read', domain: 'role', action: 'read' },
      { id: 'permission.read', domain: 'permission', action: 'read' },
    ]);
  });

  it('gọi fetch cùng-origin cho mỗi route', async () => {
    const responses: Record<string, unknown> = {
      '/api/staff': STAFF_RESPONSE,
      '/api/roles': ROLES_RESPONSE,
      '/api/permissions': PERMISSIONS_RESPONSE,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown): Promise<Response> => {
        // `fetch` có thể nhận string, URL hoặc Request tùy runtime — chuẩn hóa về string.
        const path =
          typeof input === 'string'
            ? input
            : typeof input === 'object' && input !== null && 'url' in input
              ? (input as { url: string }).url
              : String(input);
        calls.push(path);
        return new Response(JSON.stringify(responses[path]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const adapter = createRealBackofficeAdapter();
    await adapter.listStaff();
    await adapter.listRoles();
    await adapter.listPermissions();

    expect(calls).toEqual(['/api/staff', '/api/roles', '/api/permissions']);

    vi.unstubAllGlobals();
  });

  it('phi 2xx làm reject promise (fail-closed, không trả dữ liệu giả)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (): Promise<Response> =>
          new Response(JSON.stringify({ error: 'db unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const adapter = createRealBackofficeAdapter();

    await expect(adapter.listStaff()).rejects.toThrow(/503/u);
    await expect(adapter.listRoles()).rejects.toThrow(/503/u);
    await expect(adapter.listPermissions()).rejects.toThrow(/503/u);

    vi.unstubAllGlobals();
  });

  it('lỗi mạng làm reject promise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (): Promise<Response> => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const adapter = createRealBackofficeAdapter();

    await expect(adapter.listStaff()).rejects.toThrow('Failed to fetch');

    vi.unstubAllGlobals();
  });

  /**
   * displayName null từ route được ánh xạ thành chuỗi rỗng — `StaffMember`
   * không có trường nullable, và `null` có nghĩa là "chưa đặt tên" ở contract
   * wire, không phải dữ liệu bị lỗi. UI sẽ hiển thị nhãn riêng cho tên trống
   * (xem `staff.vue`).
   */
  it('displayName null → chuỗi rỗng trong StaffMember', async () => {
    respondWith({
      staff: [{ sub: 'acct_1', status: 'active', displayName: null }],
    });
    const adapter = createRealBackofficeAdapter();

    const staff = await adapter.listStaff();

    expect(staff[0]?.displayName).toBe('');
  });

  /**
   * Mỗi phương thức đọc gọi `fetch` một lần riêng lẻ — không chia sẻ cache,
   * không gọi lại route cho nhiều method.
   */
  it('mỗi method gọi đúng một route tương ứng', async () => {
    const responses: Record<string, unknown> = {
      '/api/staff': STAFF_RESPONSE,
      '/api/roles': ROLES_RESPONSE,
      '/api/permissions': PERMISSIONS_RESPONSE,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown): Promise<Response> => {
        // `fetch` có thể nhận string, URL hoặc Request tùy runtime — chuẩn hóa về string.
        let path: string;
        if (typeof input === 'string') {
          path = input;
        } else if (typeof input === 'object' && input !== null && 'url' in input) {
          path = (input as { url: string }).url;
        } else {
          path = String(input);
        }
        // Chuỗi có thể là URL đầy đủ (http://host/api/staff) — chỉ lấy phần pathname.
        try {
          const url = new URL(path);
          path = url.pathname;
        } catch {
          // Không phải URL hoàn chỉnh: giữ nguyên chuỗi.
        }
        calls.push(path);
        const payload = responses[path] ?? {};
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const adapter = createRealBackofficeAdapter();
    await adapter.listStaff();
    await adapter.listRoles();
    await adapter.listPermissions();

    expect(calls).toEqual(['/api/staff', '/api/roles', '/api/permissions']);

    vi.unstubAllGlobals();
  });
});
