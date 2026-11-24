// Plugin tương thích Claude Code hooks cho OpenCode V2.
//
// Đọc hook từ `~/.claude/settings.json`, `.claude/settings.json` và
// `.claude/settings.local.json`, sau đó chạy chúng theo các lifecycle event
// của OpenCode. Định dạng hook giữ nguyên như Claude Code.

import { Plugin } from '@opencode/plugin';
import { loadConfig, warnUnsupportedEvents } from './src/config';
import type { GenerateText } from './src/executor';
import {
  buildSessionHookInput,
  buildToolHookInput,
  collectAdditionalContext,
  findBlockResult,
  findUpdatedInput,
  toRecord,
} from './src/events';
import { runHooks } from './src/runner';
import type { ClaudeHookEventName, HookResult } from './src/types';

const LOG_PREFIX = '[claude-hooks]';

type SessionHookEventName = Extract<ClaudeHookEventName, 'SessionStart' | 'SessionEnd' | 'Stop'>;

function logResults(eventName: string, results: HookResult[]): void {
  const block = findBlockResult(results);
  if (block) {
    console.log(
      `${LOG_PREFIX} [${eventName}] Hook requested block: ${block.reason ?? 'no reason'}`,
    );
  }
  for (const context of collectAdditionalContext(results)) {
    console.log(`${LOG_PREFIX} [${eventName}] additionalContext: ${context}`);
  }
}

// Hook trả về updatedInput sẽ thay thế/thêm vào input của tool.
// Input có thể không phải object (freeform tool) nên xử lý cả hai trường hợp.
function applyUpdatedInput(target: { input: unknown }, updated: Record<string, unknown>): void {
  if (target.input && typeof target.input === 'object' && !Array.isArray(target.input)) {
    Object.assign(target.input as Record<string, unknown>, updated);
    return;
  }
  target.input = updated;
}

export default Plugin.define({
  id: 'claude.hooks',
  async setup(ctx) {
    const directory = ctx.location.directory;
    const { hooks, disableAllHooks } = loadConfig(directory);

    if (disableAllHooks) {
      console.log(`${LOG_PREFIX} All hooks disabled (disableAllHooks=true)`);
      return;
    }

    warnUnsupportedEvents(hooks);

    // Adapter cho handler prompt/agent: dùng model mặc định, không tạo session
    const generate: GenerateText = async (prompt) => {
      const selected = (await ctx.model.default()).data;
      if (!selected) {
        throw new Error('No default model is selected; prompt/agent hooks need one');
      }
      const result = await ctx.experimental.generate.text({
        model: { providerID: selected.providerID, id: selected.id },
        prompt,
      });
      return result.text;
    };

    const runSessionEvent = async (
      eventName: SessionHookEventName,
      sessionID: string,
    ): Promise<void> => {
      const matchers = hooks[eventName];
      if (!matchers || matchers.length === 0) return;

      const input = buildSessionHookInput(eventName, { sessionId: sessionID }, directory);
      const results = await runHooks(eventName, matchers, undefined, input, generate);
      logResults(eventName, results);
    };

    // ---- PreToolUse: có thể chặn tool hoặc sửa input ----
    await ctx.tool.hook('execute.before', async (event) => {
      const matchers = hooks.PreToolUse;
      if (!matchers || matchers.length === 0) return;

      const input = buildToolHookInput(
        'PreToolUse',
        {
          sessionId: String(event.sessionID),
          tool: event.tool,
          args: toRecord(event.input),
        },
        directory,
      );

      const results = await runHooks('PreToolUse', matchers, event.tool, input, generate);

      const block = findBlockResult(results);
      if (block) {
        throw new Error(block.reason ?? 'Blocked by PreToolUse hook');
      }

      const updatedInput = findUpdatedInput(results);
      if (updatedInput) {
        applyUpdatedInput(event, updatedInput);
      }

      logResults('PreToolUse', results);
    });

    // ---- PostToolUse / PostToolUseFailure ----
    await ctx.tool.hook('execute.after', async (event) => {
      const eventName: ClaudeHookEventName =
        event.status === 'error' ? 'PostToolUseFailure' : 'PostToolUse';
      const matchers = hooks[eventName];
      if (!matchers || matchers.length === 0) return;

      const input = buildToolHookInput(
        eventName,
        {
          sessionId: String(event.sessionID),
          tool: event.tool,
          args: toRecord(event.input),
        },
        directory,
      );

      const results = await runHooks(eventName, matchers, event.tool, input, generate);
      logResults(eventName, results);
    });

    // ---- Slash command thay cho các event không có hook point ----
    // V2 không có event `command.executed`, nên các event này chạy qua command.
    await ctx.command.transform((editor) => {
      editor.add({
        name: 'hook-prompt',
        description:
          'Run Claude UserPromptSubmit hooks, then resubmit the prompt with their context',
        execute: async ({ sessionID, prompt, delivery }) => {
          const matchers = hooks.UserPromptSubmit;
          const input = buildSessionHookInput(
            'UserPromptSubmit',
            { sessionId: String(sessionID) },
            directory,
          );
          const results = await runHooks('UserPromptSubmit', matchers, undefined, input, generate);
          logResults('UserPromptSubmit', results);

          const context = collectAdditionalContext(results).join('\n\n');
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: context ? `${prompt.text}\n\n${context}` : prompt.text,
            delivery,
          });
        },
      });

      editor.add({
        name: 'hook-notify',
        description: 'Run Claude Notification hooks',
        execute: async ({ sessionID }) => {
          const matchers = hooks.Notification;
          const input = buildSessionHookInput(
            'Notification',
            { sessionId: String(sessionID) },
            directory,
          );
          const results = await runHooks('Notification', matchers, undefined, input, generate);
          logResults('Notification', results);
        },
      });

      editor.add({
        name: 'hook-precompact',
        description: 'Run Claude PreCompact hooks',
        execute: async ({ sessionID }) => {
          const matchers = hooks.PreCompact;
          const input = buildSessionHookInput(
            'PreCompact',
            { sessionId: String(sessionID) },
            directory,
          );
          const results = await runHooks('PreCompact', matchers, undefined, input, generate);
          logResults('PreCompact', results);
        },
      });
    });

    // ---- SessionStart / SessionEnd / Stop ----
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ['session.created', 'session.deleted', 'session.idle'],
          signal: controller.signal,
        })) {
          switch (event.type) {
            case 'session.created':
              await runSessionEvent('SessionStart', String(event.data.sessionID));
              break;
            case 'session.deleted':
              await runSessionEvent('SessionEnd', String(event.data.sessionID));
              break;
            case 'session.idle':
              await runSessionEvent('Stop', String(event.data.sessionID));
              break;
          }
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${LOG_PREFIX} Event subscription error: ${message}`);
      }
    })();

    return () => controller.abort();
  },
});
