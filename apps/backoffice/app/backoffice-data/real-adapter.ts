/**
 * Adapter thật — đọc dữ liệu từ backend qua internal fetch cùng-origin.
 *
 * Ba phương thức đọc gọi `GET /api/staff`, `GET /api/roles`,
 * `GET /api/permissions` bên trong Worker (hoặc từ trình duyệt, cùng origin),
 * rồi ánh xạ hình dạng hợp đồng wire sang kiểu UI. Mọi lỗi (mạng, phi 2xx,
 * DB không khả dụng, enforcement từ chối) đều bị ném ra để `useAsyncState`
 * hiển thị trạng thái error — fail-closed, không bao giờ trả dữ liệu giả.
 *
 * `isPreview = false`: UI không hiển thị banner "dữ liệu mẫu".
 *
 * ⚠️ Không truy cập DB trực tiếp: mọi đường đi dữ liệu đi qua 3 read route
 * (`server/api/{staff,roles,permissions}.get.ts`), mỗi route đã có enforcement
 * riêng. Adapter này chỉ là consommateur của hợp đồng API nội bộ.
 */
import type { BackofficeDataAdapter, Permission, StaffMember, SystemRole } from './types';

/** Hình dạng route trả về cho `GET /api/staff`. */
type WireStaff = {
  readonly sub: string;
  readonly status: string;
  readonly displayName: string | null;
};

/** Hình dạng route trả về cho `GET /api/roles`. */
type WireRole = {
  readonly id: string;
  readonly isSystem: boolean;
};

/** Hình dạng route trả về cho `GET /api/permissions`. */
type WirePermission = {
  readonly id: string;
  readonly domain: string;
  readonly action: string;
  readonly status: string;
};

type WireStaffResponse = { readonly staff: readonly WireStaff[] };
type WireRolesResponse = { readonly roles: readonly WireRole[] };
type WirePermissionsResponse = { readonly permissions: readonly WirePermission[] };

/** Gọi một route đọc nội bộ, fail-closed: phi 2xx hoặc lỗi mạng đều ném. */
async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Backoffice route ${path} trả về ${response.status}`);
  }

  return (await response.json()) as T;
}

function mapStaff(row: WireStaff): StaffMember {
  return {
    accountId: row.sub,
    displayName: row.displayName ?? '',
    status: row.status as StaffMember['status'],
    roleIds: [],
  };
}

function mapRole(row: WireRole): SystemRole {
  return {
    id: row.id,
    permissionIds: [],
  };
}

function mapPermission(row: WirePermission): Permission {
  return {
    id: row.id,
    domain: row.domain,
    action: row.action,
  };
}

export function createRealBackofficeAdapter(): BackofficeDataAdapter {
  return {
    isPreview: false,

    async listStaff(): Promise<readonly StaffMember[]> {
      const response = await fetchJson<WireStaffResponse>('/api/staff');
      return response.staff.map(mapStaff);
    },

    async listRoles(): Promise<readonly SystemRole[]> {
      const response = await fetchJson<WireRolesResponse>('/api/roles');
      return response.roles.map(mapRole);
    },

    async listPermissions(): Promise<readonly Permission[]> {
      const response = await fetchJson<WirePermissionsResponse>('/api/permissions');
      return response.permissions.map(mapPermission);
    },
  };
}
