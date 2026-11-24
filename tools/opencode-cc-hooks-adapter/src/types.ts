// Kiểu dữ liệu dùng chung cho lớp tương thích Claude Code hooks.
// Giữ nguyên định dạng hook của Claude Code để có thể dùng lại `.claude/settings.json`.

// Loại handler mà Claude Code hỗ trợ
export type HookHandlerType = 'command' | 'http' | 'prompt' | 'agent';

export interface CommandHandler {
  type: 'command';
  command: string;
  // Mặc định 600 giây, giống Claude Code
  timeout?: number;
}

export interface HttpHandler {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface PromptHandler {
  type: 'prompt';
  prompt: string;
  timeout?: number;
}

export interface AgentHandler {
  type: 'agent';
  prompt: string;
  timeout?: number;
}

export type HookHandler = CommandHandler | HttpHandler | PromptHandler | AgentHandler;

// Tên event theo Claude Code
export type ClaudeHookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'UserPromptSubmit'
  | 'Notification'
  | 'PreCompact'
  // Các event bên dưới không có điểm bắt tương ứng trong OpenCode
  | 'PermissionRequest'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded';

// Một entry trong mảng hooks, gồm matcher và danh sách handler
export interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

// Cấu trúc `hooks` trong settings của Claude Code
export type HooksConfig = Partial<Record<ClaudeHookEventName, HookMatcher[]>>;

// Cấu trúc file settings
export interface ClaudeSettings {
  hooks?: HooksConfig;
  disableAllHooks?: boolean;
}

// JSON gửi vào stdin của command handler (hoặc body của HTTP handler)
export interface HookInput {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

// Output có cấu trúc do handler trả về
export interface HookSpecificOutput {
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}

// Output tổng quát của handler
export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  decision?: 'block';
  reason?: string;
  hookSpecificOutput?: HookSpecificOutput;
  ok?: boolean;
}

export type HookResultAction = 'allow' | 'block' | 'error' | 'skip';

// Kết quả sau khi chuẩn hoá output của handler
export interface HookResult {
  action: HookResultAction;
  reason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}
