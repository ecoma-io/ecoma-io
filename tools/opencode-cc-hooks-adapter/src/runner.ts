// Chạy toàn bộ hook khớp với một event.

import { executeHook, type GenerateText } from './executor';
import { matchHook } from './matcher';
import type { HookInput, HookMatcher, HookResult } from './types';

const LOG_PREFIX = '[claude-hooks]';

export async function runHooks(
  eventName: string,
  matchers: HookMatcher[] | undefined,
  toolName: string | undefined,
  input: HookInput,
  generate?: GenerateText,
): Promise<HookResult[]> {
  if (!matchers || matchers.length === 0) return [];

  const promises: Promise<HookResult>[] = [];
  for (const matcher of matchers) {
    if (!matchHook(matcher.matcher, toolName)) continue;
    for (const handler of matcher.hooks) {
      promises.push(
        executeHook(handler, input, generate).catch((error: unknown) => {
          // Một hook lỗi không được làm hỏng các hook còn lại
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`${LOG_PREFIX} Hook error (${eventName}): ${message}`);
          return { action: 'error', reason: message } satisfies HookResult;
        }),
      );
    }
  }

  return Promise.all(promises);
}
