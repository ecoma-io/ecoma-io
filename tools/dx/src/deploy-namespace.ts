/**
 * Namespace cô lập deployment giữa các Git worktree.
 *
 * Nhiều worktree của cùng repository chạy local deployment đồng thời trên một
 * host: mỗi worktree cần Docker network, container Traefik, container
 * PostgreSQL, volume và Pulumi stack RIÊNG. Timestamp/random suffix là base
 * trượt — resource bị mồ côi sau mỗi lần chạy lại và hai lệnh chạy cạnh nhau
 * không nhận ra nhau; namespace ở đây vì thế phải ỔN ĐỊNH qua các lần chạy lại,
 * và ổn định đó đến từ việc hash chính đường dẫn worktree root.
 *
 * Nguồn dữ liệu duy nhất là absolute worktree root đã normalize:
 *
 * 1. `realpathSync.native` — resolve symlink (`.claude/worktrees/<name>` là
 *    symlink trên một số hệ, hai đường dẫn khác nhau trỏ cùng một thư mục thật
 *    phải ra MỘT namespace, không phải hai) và đọc canonical case của macOS.
 * 2. `path.normalize` + bỏ trailing separator — bỏ khác biệt trình bày
 *    (`/a/b/` vs `/a/b`) giữa các caller.
 *
 * Thuật toán hash là xxHash64 (`@node-rs/xxhash`, binding native prebuilt cho
 * linux/darwin/win) — prompt kiến trúc chốt xxHash; chọn 64-bit thay vì 32-bit
 * để xác suất hai worktree đụng namespace dưới mức mỗi host có hàng chục
 * worktree (birthday bound ~2^32 lần thử).
 *
 * `NAMESPACE_LENGTH = 12` hex (48 bit) là đủ phân biệt trong thực tế và giữ tên
 * resource gọn; phần đầu được prefix chữ để tránh tên Docker bắt đầu bằng số
 * và để nhận ra bằng mắt đây là namespace của ecoma.
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';

import { xxh64 } from '@node-rs/xxhash';

/** Độ dài phần hex của namespace giữ lại trong tên resource. */
export const NAMESPACE_LENGTH = 12;

/** Prefix nhận diện resource local của repo này trong danh sách Docker. */
export const RESOURCE_PREFIX = 'ecoma';

/**
 * Normalize worktree root thành dạng canonical dùng làm input hash.
 *
 * Không absolute ⇒ resolve theo cwd của caller; đường dẫn không tồn tại ném
 * lỗi từ `realpathSync` — fail-closed đúng ý: một namespace sinh ra từ đường
 * dẫn ảo là namespace của một worktree không có thật.
 */
export function normalizeWorktreeRoot(root: string): string {
  const absolute = isAbsolute(root) ? root : resolve(root);
  const real = realpathSync.native(absolute);
  const normalized = normalize(real);
  // `path.normalize('/a/b/')` giữ trailing sep; bỏ để `/a/b/` và `/a/b` cùng
  // một input hash. Giữ root `/` nguyên — hash của `/` phải là hash của `/`,
  // không phải hash của chuỗi rỗng.
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/u, '') : normalized;
}

/**
 * Namespace ổn định của một worktree: `w` + xxHash64 hex đầu 12 ký tự.
 *
 * Prefix `w` đảm bảo ký tự đầu là chữ cái — một số công cụ Docker/naming hạn
 * chế tên bắt đầu bằng số, và hash hex có thể xuất 0-9 ở vị trí đầu.
 */
export function worktreeNamespace(root: string): string {
  const digest = xxh64(Buffer.from(normalizeWorktreeRoot(root), 'utf8'));
  return `w${digest.toString(16).padStart(16, '0').slice(0, NAMESPACE_LENGTH)}`;
}

/** Loại resource local được đặt tên theo namespace. */
export type DeployResourceKind =
  | 'network'
  | 'traefik'
  | 'postgres'
  | 'postgres-volume'
  | 'home'
  | 'home-image';

/**
 * Tên Docker resource hợp lệ và nhất quán cho một namespace.
 *
 * Hình dạng `ecoma-<namespace>-<kind>`: prefix nhận diện để `docker ps`
 * lọc được bằng mắt, namespace ở giữa để hai worktree không bao giờ trùng
 * tên, kind ở cuối để người đọc biết resource này là gì.
 */
export function dockerResourceName(namespace: string, kind: DeployResourceKind): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(namespace)) {
    throw new Error(`namespace không hợp lệ cho Docker name: ${namespace}`);
  }
  return `${RESOURCE_PREFIX}-${namespace}-${kind}`;
}

/**
 * Tên Pulumi stack local của một worktree: `local-<namespace>`.
 *
 * Stack name phải đi kèm namespace vì Pulumi state là nguồn sự thật của
 * resource: hai worktree dùng chung một stack local là hai lần chạy sửa cùng
 * một state — race, mất output, xoá nhầm resource của nhau. Backend là
 * `file://` cục bộ theo contract delivery (`02-delivery.md` §7.4.1: `local`
 * chỉ đi với `file://`).
 */
export function pulumiStackName(namespace: string): string {
  return `local-${namespace}`;
}
