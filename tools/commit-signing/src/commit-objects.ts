/**
 * Đọc và xác thực raw commit object từ git.
 *
 * Gate dựa trên **raw commit object**: `git cat-file commit <sha>` cho ra header
 * của object, và một commit có chữ ký khi và chỉ khi header ấy chứa một dòng bắt
 * đầu bằng `gpgsig `. Cách này offline, deterministic, không phụ thuộc keyring.
 *
 * ## Vì sao header, không phải cả object
 *
 * Commit *message* được phép chứa một dòng bắt đầu bằng `gpgsig ` — git không
 * cấm. Quét cả object sẽ báo động giả cho một commit không hề có chữ ký. Header
 * kết thúc ở dòng trống đầu tiên.
 */

import { execFileSync } from 'node:child_process';

import { ROOT_DIR, gitEnv } from './utils.js';

/**
 * SHA-1 đầy đủ của một commit object.
 *
 * `git cat-file --batch` nhận đúng SHA này; chặn ở đây thay vì để git báo lỗi mơ
 * hồ, và để không nối một chuỗi do output của git cung cấp vào command khác.
 */
export const COMMIT_ID = /^[0-9a-f]{40}$/u;

const NEWLINE = 0x0a;

/**
 * Header của commit object có dòng chữ ký không.
 *
 * Chỉ phần trước dòng trống đầu tiên được xét. `gpgsig-sha256` cũng là một dòng
 * chữ ký (chữ ký bên cạnh của SHA-256), nên nó được tính như `gpgsig`.
 */
export function headerHasSignature(commitObject: string): boolean {
  const header = commitObject.split('\n\n', 1)[0] ?? '';

  return /^gpgsig(-sha256)? /mu.test(header);
}

export type CommitListing = { ok: true; commits: string[] } | { ok: false; reason: string };
export type SignatureCheck = { ok: true; unsigned: string[] } | { ok: false; reason: string };

/**
 * Parse đầu ra raw của `git cat-file --batch` thành danh sách commit chưa ký.
 *
 * Tách khỏi spawn git để test tái tạo được chính các trường hợp lệch format mà
 * parser phải fail closed: output đứt giữa chừng, descriptor lệch id, object
 * thiếu, type không phải `commit`.
 *
 * `--batch` trả về, với mỗi SHA trên stdin: một dòng `<sha> <type> <size>` theo
 * sau bởi đúng `size` byte nội dung object rồi một newline. Dùng `size` để cắt
 * thay vì dò tìm dòng trống: kích thước là thứ git cam kết, còn dòng trống thì
 * message của commit tự do chứa.
 */
export function parseCatFileBatch(commits: string[], output: Buffer): SignatureCheck {
  const unsigned: string[] = [];
  let cursor = 0;

  for (const commit of commits) {
    const newline = output.indexOf(NEWLINE, cursor);
    if (newline === -1) {
      return { ok: false, reason: `git cat-file output ended before describing ${commit}.` };
    }

    const start = newline + 1,
      step = readBatchEntry(commit, output, start);
    if (!step.ok) {
      return step;
    }

    if (!headerHasSignature(output.toString('utf8', start, step.end))) {
      unsigned.push(commit);
    }

    // `end` trỏ vào newline phân cách mà git thêm sau object; dòng descriptor
    // Kế tiếp bắt đầu ngay sau nó. Bỏ qua newline này, nếu không dòng descriptor
    // Kế tiếp sẽ là chuỗi rỗng.
    cursor = step.end + 1;
  }

  return { ok: true, unsigned };
}

/**
 * Đọc một entry của batch: kiểm descriptor rồi trả về vị trí kết thúc object.
 *
 * `git rev-list` chỉ trả SHA của commit, nên type phải là `commit`; nếu không
 * thì output đã lệch với danh sách và không còn tin được.
 */
function readBatchEntry(
  commit: string,
  output: Buffer,
  start: number,
): { ok: true; end: number } | { ok: false; reason: string } {
  const newline = output.indexOf(NEWLINE, start - 1),
    descriptor = output.toString('utf8', start - 1, newline),
    match = /^([0-9a-f]{40}) commit (\d+)$/u.exec(descriptor);
  if (match === null || match[1] !== commit) {
    return {
      ok: false,
      reason: `git cat-file did not return the commit object for ${commit}: "${descriptor}".`,
    };
  }

  const end = start + Number(match[2]);
  if (end > output.length) {
    return { ok: false, reason: `git cat-file truncated the object for ${commit}.` };
  }

  return { end, ok: true };
}

/** Đọc object của các commit bằng `git cat-file --batch`; fail closed khi git lỗi. */
export function readCommitObjectsFromGit(
  commits: string[],
  cwd: string = ROOT_DIR,
): SignatureCheck {
  try {
    const output = execFileSync('git', ['cat-file', '--batch'], {
      cwd,
      // `null` để nhận Buffer: cần cắt theo **byte** để đọc đúng `size` mà git
      // Cam kết, và chuyển sang string sẽ phá vỡ ranh giới đó khi commit message
      // Chứa ký tự nhiều byte.
      encoding: undefined,
      env: gitEnv(),
      input: `${commits.join('\n')}\n`,
      maxBuffer: 64 * 1024 * 1024,
    });

    return parseCatFileBatch(commits, output);
  } catch (error) {
    return {
      ok: false,
      reason: `git could not read the commits to check: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
