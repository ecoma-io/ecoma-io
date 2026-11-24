/** Đọc payload JSON của hook từ stdin; JSON hỏng hoặc rỗng coi như không có gì để làm. */

import { readFileSync } from 'node:fs';

import type { HookPayload } from './payload';

export async function readHookPayload(): Promise<HookPayload> {
  let text: string;
  try {
    text = readFileSync(0, 'utf8');
  } catch {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as HookPayload;
    }
    return {};
  } catch {
    // Input không phải JSON hợp lệ: không có gì để xử lý
    return {};
  }
}
