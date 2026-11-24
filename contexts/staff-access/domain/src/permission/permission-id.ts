/**
 * Định danh permission `domain.action` (ADR-0010): nửa domain là resource
 * noun, nửa action là verb — `staff.read`, `role.assign`, `invitation.create`.
 *
 * Permission **không phải scope**: OAuth scope do `auth` cấp không map thẳng
 * thành application-level permission. Không permission bao trùm, không
 * `admin.*`, không wildcard (SR-016).
 *
 * Catalog là nguồn sự thật duy nhất của permission (sealed, seed migration +
 * ADR); lib này chỉ định nghĩa **hình dạng** của định danh, không phát minh
 * permission cụ thể nào.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Opaque value object cho permission literal `domain.action`. */
export type PermissionId = Brand<string, 'PermissionId'>;

/**
 * Hình `domain.action`: domain là resource noun, action là verb; cả hai chỉ
 * chữ thường + số, phân tách bằng MỘT dấu chấm. Cấm wildcard/bao trùm —
 * không `*`, không `admin.*`, không dấu chấm thứ hai.
 */
const PERMISSION_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)?\.[a-z0-9]+(?:_[a-z0-9]+)?$/u;

/**
 * Kiểm tra một chuỗi bất kỳ có phải permission literal hợp lệ không.
 *
 * Hình thức không xác định ngữ nghĩa: permission có thuộc catalog hay không
 * là việc của catalog sống ở persistence (sealed, ADR-0010) — lib thuần này
 * không có catalog để validate nội dung.
 */
export function isPermissionId(value: unknown): value is PermissionId {
  return typeof value === 'string' && PERMISSION_PATTERN.test(value);
}

/**
 * Đóng gói một permission literal thành `PermissionId`.
 *
 * @throws TypeError nếu literal không đúng hình `domain.action`.
 */
export function permissionIdFrom(value: string): PermissionId {
  if (!isPermissionId(value)) {
    throw new TypeError('PermissionId phải đúng hình domain.action.');
  }
  return value;
}
