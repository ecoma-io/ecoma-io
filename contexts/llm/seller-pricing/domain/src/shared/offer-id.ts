/**
 * Định danh của một seller offer — khoá của pricing schedule, pricing version
 * và pricing snapshot.
 *
 * Brand nominal của `domain-primitives`: ngoài đường đọc đã kiểm qua
 * {@link readOfferId}, không có đường nào dựng một `OfferId` từ chuỗi tuỳ ý.
 * Pricing schedule được key theo **offer** (không phải normalized model) —
 * quyết định granularity offer/model còn mở, library không tự mở rộng.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Định danh offer — key của pricing schedule, version và snapshot. */
export type OfferId = Brand<string, 'OfferId'>;

/**
 * Đọc và brand một offer id từ nguồn ngoài (wire, DB, console input).
 *
 * Chỉ kiểm shape: non-empty sau khi trim — pricing không sở hữu offer, nên
 * không có danh sách offer hợp lệ để kiểm mạnh hơn ở đây.
 */
export function readOfferId(value: unknown): OfferId | null {
  return typeof value === 'string' && value.trim().length > 0 ? (value as OfferId) : null;
}
