import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Đường dẫn thư mục `apps/backoffice/db/migrations`.
 *
 * Tính từ vị trí file này chứ không từ `process.cwd()` — cùng lý do với
 * `apps/account/db/migrate.mts`: Nx đặt `cwd: apps/backoffice` cho target của
 * project, còn vitest chạy với root khác.
 */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');

/** Tên database của service này trong provisioning; không hard-code trong SQL. */
export const BACKOFFICE_DATABASE = 'db-backoffice';

/**
 * Khóa advisory chặn hai migration chạy song song.
 *
 * ⚠️ Số được chọn theo chính tên database để hai service (account,
 * backoffice, ...) trên một PostgreSQL instance dùng chung không tranh cùng
 * một khóa (A21, §8: "Shared PostgreSQL ≠ shared write authority" — chung
 * instance ≠ chung khóa migration). Hash theo `hashtext` phía server thay vì
 * hard-code hash trong code: đổi tên database thì khóa đổi theo, và giá trị
 * cụ thể không mang ý nghĩa gì.
 *
 * ⚠️ Runner **không** dùng số này: nó lấy khóa bằng
 * `hashtext(BACKOFFICE_DATABASE)` phía server để khóa đổi theo tên database.
 * Hằng tồn tại cho test assert rằng khóa runner khớp đúng tên mà
 * {@link BACKOFFICE_DATABASE} khai báo — hai thứ phải là một, nếu không thì
 * `MIGRATION_LOCK_KEY` chỉ là một con số chết.
 */
export const MIGRATION_LOCK_KEY = 9_137_204n;

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

/** Thứ tự apply là thứ tự tên file (`0001_`, `0002_`, ...), không phải mtime. */
export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.sql'))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), 'utf8') }));
}

/**
 * File migration là SQL thuần, không có placeholder tên database — `db-backoffice`
 * không cần được inject vì migration không chạm database khác (ranh giới cross-DB
 * là provisioning, xem `03-operations` pattern của `account`). Hàm giữ lại để
 * runner và harness cùng một đường code như `account`, nhưng không thay thế gì.
 */
export function renderMigration(sql: string): string {
  return sql;
}
