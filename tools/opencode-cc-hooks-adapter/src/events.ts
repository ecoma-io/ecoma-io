// Chuyển dữ liệu event của OpenCode thành input theo chuẩn Claude Code hooks.

import type { ClaudeHookEventName, HookInput, HookResult } from './types';

export interface ToolEventData {
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface SessionEventData {
  sessionId: string;
}

export function buildToolHookInput(
  eventName: ClaudeHookEventName,
  event: ToolEventData,
  cwd: string,
): HookInput {
  return {
    session_id: event.sessionId,
    cwd,
    hook_event_name: eventName,
    tool_name: event.tool,
    tool_input: event.args,
  };
}

export function buildSessionHookInput(
  eventName: ClaudeHookEventName,
  event: SessionEventData,
  cwd: string,
): HookInput {
  return {
    session_id: event.sessionId,
    cwd,
    hook_event_name: eventName,
  };
}

// Hook đầu tiên yêu cầu block sẽ quyết định lý do block
export function findBlockResult(results: HookResult[]): HookResult | undefined {
  return results.find((result) => result.action === 'block');
}

// Hook đầu tiên trả về updatedInput sẽ được áp dụng
export function findUpdatedInput(results: HookResult[]): Record<string, unknown> | undefined {
  for (const result of results) {
    if (result.updatedInput) return result.updatedInput;
  }
  return undefined;
}

export function collectAdditionalContext(results: HookResult[]): string[] {
  return results
    .map((result) => result.additionalContext)
    .filter((context): context is string => typeof context === 'string' && context.length > 0);
}

// OpenCode có thể truyền input không phải object (ví dụ freeform tool)
export function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
