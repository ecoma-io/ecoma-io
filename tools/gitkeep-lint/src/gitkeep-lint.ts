/**
 * Một file `.gitkeep` chỉ hợp lệ khi thư mục chứa nó không có entry nào khác.
 *
 * Ranh giới: thư mục được xét trên **working tree** — cùng trạng thái mà gate
 * pre-commit (truyền `{staged_files}`) và CI (checkout sạch) nhìn thấy, không
 * xét index hay history.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

/**
 * Thư mục gốc repository, suy ra từ vị trí file này (`src/` sâu hơn root ba cấp).
 * Violation in path so với đây thay vì cwd, để output nhất quán dù CLI được gọi
 * từ thư mục nào.
 */
export const ROOT_DIR = resolve(import.meta.dirname, '../../..');

/**
 * Thu thập mọi file `.gitkeep` dưới `target` (đường dẫn tuyệt đối tới một file
 * hoặc thư mục, duyệt đệ quy).
 *
 * Lỗi target là lỗi sử dụng CLI và được ném ra với message ngắn gọn. Riêng một
 * `.gitkeep` không còn trên disk được bỏ qua im lặng: pre-commit truyền
 * `{staged_files}` nên một file staged-xoá vẫn xuất hiện trong danh sách dù
 * việc xoá nó chính là cách sửa hợp lệ.
 */
export function collectGitkeepFiles(target: string): string[] {
  let stats: Stats;
  try {
    stats = statSync(target);
  } catch {
    if (basename(target) === '.gitkeep') return [];
    throw new Error('path does not exist');
  }
  if (stats.isFile()) {
    if (basename(target) === '.gitkeep') return [target];
    throw new Error('not a .gitkeep file');
  }
  if (!stats.isDirectory()) throw new Error('not a regular file or directory');

  const collected: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    // Dirent không đi qua symlink nên một symlink tròn (loop) không gây đệ quy vô hạn.
    if (entry.isDirectory()) collected.push(...collectGitkeepFiles(join(target, entry.name)));
    else if (entry.isFile() && entry.name === '.gitkeep') collected.push(join(target, entry.name));
  }
  return collected;
}

/**
 * Mọi `.gitkeep` trong working tree: file git đang track cộng file mới chưa
 * track, trừ file bị ignore. Đi qua git thay vì tự duyệt fs để tôn trọng
 * `.gitignore` và không chạm vào `node_modules`.
 *
 * `-z` để path chứa khoảng trắng không bị quote theo cách git in ra người xem.
 */
export function findRepositoryGitkeepFiles(repo: string = ROOT_DIR): string[] {
  const stdout = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z', '--', '*.gitkeep'],
    { cwd: repo, encoding: 'utf8' },
  );
  return stdout
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => resolve(repo, path));
}

/**
 * Kiểm từng `.gitkeep` theo quy tắc trong JSDoc module, trả danh sách violation
 * (path relative với root + lý do), đã sort.
 *
 * Tính cả entry là thư mục rỗng chứ không chỉ file: thư mục rỗng chưa track chỉ
 * tồn tại trên máy dev, nếu bỏ qua thì local sạch mà CI vẫn đỏ.
 */
export function checkGitkeepFiles(keepFiles: string[]): string[] {
  const violations: string[] = [];
  for (const keep of keepFiles) {
    const siblings = readdirSync(dirname(keep))
      .filter((name) => name !== '.gitkeep')
      .toSorted();
    if (siblings.length > 0) {
      violations.push(
        `${relative(ROOT_DIR, keep)}: directory is not empty (${siblings.join(', ')})`,
      );
    }
  }
  return violations.toSorted();
}
