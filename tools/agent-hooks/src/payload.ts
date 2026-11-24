/**
 * Parse payload JSON của hook PostToolUse và trích danh sách file bị đụng tới.
 *
 * Payload chuẩn Claude Code/OpenCode: `{ tool_name, tool_input, cwd }` với
 * `tool_input` mang path ở field khác nhau tuỳ tool (`file_path` cho
 * Edit/Write, `path` cho một số tool V2, `files[]`/`edits[]` cho tool dạng
 * danh sách). Chỉ giữ file tồn tại, là file thường và nằm trong project root —
 * file ngoài root không thuộc quyền của hook này.
 */

import { isAbsolute, resolve, sep } from 'node:path';
import { statSync } from 'node:fs';

/** Payload hook chuẩn hoá tối thiểu — chỉ những field tool này cần. */
export interface HookPayload {
  tool_input?: Record<string, unknown> | null;
}

/**
 * Trích các giá trị path thô từ `tool_input`, bất kể field nào tool dùng.
 *
 * Trả về chuỗi thô (có thể relative), chưa resolve — việc resolve thuộc
 * {@link extractHookFiles} để dễ test logic root-boundary riêng.
 */
export function rawPathsFromToolInput(
  toolInput: Record<string, unknown> | null | undefined,
): string[] {
  const raw: string[] = [];

  const single = [toolInput?.path, toolInput?.filePath, toolInput?.file_path];
  for (const value of single) {
    if (typeof value === 'string') raw.push(value);
  }

  const lists = [toolInput?.files, toolInput?.edits];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') {
        raw.push(entry);
      } else if (entry !== null && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        for (const value of [record.path, record.filePath, record.file_path]) {
          if (typeof value === 'string') raw.push(value);
        }
      }
    }
  }

  return raw;
}

/**
 * Resolve các path thô thành đường dẫn tuyệt đối, lọc theo root.
 *
 * - Path relative được resolve theo `root`; path absolute giữ nguyên.
 * - Bỏ path nằm ngoài `root` (kể cả `/foo/../bar` thoát root qua `..`).
 * - Bỏ path không tồn tại hoặc không phải file thường.
 * - Khử trùng lặp, giữ thứ tự lần đầu xuất hiện.
 */
export function extractHookFiles(payload: HookPayload, root: string): string[] {
  const normalizedRoot = isAbsolute(root) ? root : resolve(root);

  const seen = new Set<string>();
  const files: string[] = [];

  for (const value of rawPathsFromToolInput(payload.tool_input)) {
    const absolute = resolve(normalizedRoot, value);

    // Bỏ file nằm ngoài project root (resolve đã gộp `..` nên so sánh prefix an toàn)
    if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) continue;

    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    if (!seen.has(absolute)) {
      seen.add(absolute);
      files.push(absolute);
    }
  }

  return files;
}
