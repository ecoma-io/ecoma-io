// Đọc và merge các file settings của Claude Code.
// Thứ tự ưu tiên: global -> project -> local (entry của file sau được nối tiếp).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeHookEventName, ClaudeSettings, HooksConfig } from './types';

// Các event không có điểm bắt tương ứng trong OpenCode
export const UNSUPPORTED_EVENTS: ClaudeHookEventName[] = [
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCompleted',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
];

export const SUPPORTED_EVENTS: ClaudeHookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'UserPromptSubmit',
  'Notification',
  'PreCompact',
];

function readSettingsFile(filePath: string): ClaudeSettings | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    // File không tồn tại hoặc JSON hỏng: bỏ qua, giống hành vi của plugin gốc
    return null;
  }
}

function mergeHooksConfig(base: HooksConfig, override: HooksConfig): HooksConfig {
  const result: HooksConfig = { ...base };
  for (const [event, matchers] of Object.entries(override)) {
    const key = event as ClaudeHookEventName;
    const existing = result[key] ?? [];
    result[key] = [...existing, ...(matchers ?? [])];
  }
  return result;
}

export interface LoadedConfig {
  hooks: HooksConfig;
  disableAllHooks: boolean;
}

export interface LoadConfigOptions {
  // Cho phép ghi đè thư mục home khi test
  homeDir?: string;
}

export function loadConfig(
  cwd: string = process.cwd(),
  { homeDir = homedir() }: LoadConfigOptions = {},
): LoadedConfig {
  const globalPath = join(homeDir, '.claude', 'settings.json');
  const projectPath = join(cwd, '.claude', 'settings.json');
  const localPath = join(cwd, '.claude', 'settings.local.json');

  const globalSettings = readSettingsFile(globalPath);
  const projectSettings = readSettingsFile(projectPath);
  const localSettings = readSettingsFile(localPath);

  let merged: HooksConfig = {};
  if (globalSettings?.hooks) merged = mergeHooksConfig(merged, globalSettings.hooks);
  if (projectSettings?.hooks) merged = mergeHooksConfig(merged, projectSettings.hooks);
  if (localSettings?.hooks) merged = mergeHooksConfig(merged, localSettings.hooks);

  // disableAllHooks: local > project > global
  const disableAllHooks =
    localSettings?.disableAllHooks ??
    projectSettings?.disableAllHooks ??
    globalSettings?.disableAllHooks ??
    false;

  return { hooks: merged, disableAllHooks };
}

export function warnUnsupportedEvents(
  hooks: HooksConfig,
  warn: (message: string) => void = console.warn,
): void {
  for (const event of UNSUPPORTED_EVENTS) {
    if (hooks[event] && hooks[event]!.length > 0) {
      warn(
        `[claude-hooks] Unsupported event "${event}" is configured but will not fire: OpenCode has no matching lifecycle point.`,
      );
    }
  }
}
