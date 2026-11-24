// Thực thi từng loại handler của Claude Code hooks: command, http, prompt, agent.

import { spawn } from 'node:child_process';
import type {
  AgentHandler,
  CommandHandler,
  HookHandler,
  HookInput,
  HttpHandler,
  HookOutput,
  HookResult,
  PromptHandler,
} from './types';

// Hàm sinh văn bản do plugin truyền vào, dùng cho handler prompt/agent
export type GenerateText = (prompt: string) => Promise<string>;

function parseHookOutput(text: string): HookOutput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as HookOutput;
  } catch {
    return null;
  }
}

function outputToResult(output: HookOutput | null): HookResult {
  if (!output) return { action: 'allow' };

  // Các trường hợp bị block: decision="block", continue=false hoặc ok=false
  if (output.decision === 'block' || output.continue === false || output.ok === false) {
    return {
      action: 'block',
      reason: output.stopReason ?? output.reason ?? 'Blocked by hook',
      updatedInput: output.hookSpecificOutput?.updatedInput,
      additionalContext: output.hookSpecificOutput?.additionalContext,
    };
  }

  return {
    action: 'allow',
    updatedInput: output.hookSpecificOutput?.updatedInput,
    additionalContext: output.hookSpecificOutput?.additionalContext,
  };
}

function interpolateEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => process.env[name] ?? '');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Handler command: ghi input JSON vào stdin và đọc kết quả từ exit code/stdout
async function runCommand(handler: CommandHandler, input: HookInput): Promise<HookResult> {
  const timeoutMs = (handler.timeout ?? 600) * 1000;
  const inputJson = JSON.stringify(input);

  return new Promise<HookResult>((resolve) => {
    let settled = false;

    const proc = spawn('bash', ['-c', handler.command], {
      env: {
        ...process.env,
        OPENCODE_PROJECT_DIR: input.cwd,
        OPENCODE_SESSION_ID: input.session_id,
        OPENCODE_HOOK_EVENT: input.hook_event_name,
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({ action: 'error', reason: `Command timed out after ${handler.timeout ?? 600}s` });
      }
    }, timeoutMs);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code === 0) {
        const output = parseHookOutput(stdout);
        resolve(outputToResult(output));
      } else if (code === 2) {
        resolve({ action: 'block', reason: stderr || 'Blocked by hook' });
      } else {
        // Exit code khác 0 và 2: lỗi không chặn, chỉ ghi log
        const reason = stderr || `Command exited with code ${code}`;
        console.error(`[claude-hooks] Command hook error (exit ${code}): ${reason}`);
        resolve({ action: 'error', reason });
      }
    });

    proc.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error(`[claude-hooks] Failed to spawn command: ${error.message}`);
      resolve({ action: 'error', reason: error.message });
    });

    // Process có thể thoát trước khi ghi xong stdin (EPIPE): bỏ qua lỗi write
    proc.stdin.on('error', () => {});
    proc.stdin.write(inputJson, () => {
      proc.stdin.end();
    });
  });
}

// Handler http: POST input JSON tới URL cấu hình
async function runHttp(handler: HttpHandler, input: HookInput): Promise<HookResult> {
  const timeoutMs = (handler.timeout ?? 600) * 1000;
  const body = JSON.stringify(input);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (handler.headers) {
    for (const [key, value] of Object.entries(handler.headers)) {
      headers[key] = interpolateEnvVars(value);
    }
  }

  try {
    const response = await fetch(handler.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const reason = `HTTP ${response.status} ${response.statusText}`;
      console.error(`[claude-hooks] HTTP hook error: ${reason}`);
      return { action: 'error', reason };
    }

    const text = await response.text();
    const output = parseHookOutput(text);
    return outputToResult(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[claude-hooks] HTTP hook fetch error: ${message}`);
    return { action: 'error', reason: message };
  }
}

// Handler prompt/agent: dùng model mặc định để sinh kết quả, không tạo session
async function runPrompt(
  handler: PromptHandler | AgentHandler,
  input: HookInput,
  generate: GenerateText | undefined,
): Promise<HookResult> {
  if (!generate) {
    return { action: 'error', reason: 'No model generation available for prompt/agent hook' };
  }

  const timeoutMs = (handler.timeout ?? (handler.type === 'agent' ? 60 : 30)) * 1000;
  const promptText = handler.prompt.replace(/\$ARGUMENTS/g, JSON.stringify(input));

  try {
    const text = await withTimeout(
      generate(promptText),
      timeoutMs,
      `Prompt/agent hook timed out after ${timeoutMs / 1000}s`,
    );
    const output = parseHookOutput(text);
    return outputToResult(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[claude-hooks] Prompt/agent hook error: ${message}`);
    return { action: 'error', reason: message };
  }
}

export async function executeHook(
  handler: HookHandler,
  input: HookInput,
  generate?: GenerateText,
): Promise<HookResult> {
  switch (handler.type) {
    case 'command':
      return runCommand(handler, input);
    case 'http':
      return runHttp(handler, input);
    case 'prompt':
    case 'agent':
      return runPrompt(handler, input, generate);
    default: {
      const exhaustive: never = handler;
      void exhaustive;
      return { action: 'skip', reason: 'Unknown handler type' };
    }
  }
}

export { parseHookOutput, outputToResult, interpolateEnvVars };
