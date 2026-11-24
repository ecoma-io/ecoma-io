import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, warnUnsupportedEvents, UNSUPPORTED_EVENTS } from './config';

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-hooks-home-'));
  project = mkdtempSync(join(tmpdir(), 'cc-hooks-project-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

function writeSettings(dir: string, name: string, content: unknown): void {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', name), JSON.stringify(content));
}

describe('loadConfig', () => {
  it('returns empty hooks when no settings file exists', () => {
    const config = loadConfig(project, { homeDir: home });

    expect(config).toEqual({ hooks: {}, disableAllHooks: false });
  });

  it('merges hooks from global, project, and local files in order', () => {
    writeSettings(home, 'settings.json', {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'global' }] }] },
    });
    writeSettings(project, 'settings.json', {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'project' }] }],
        PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'ptu' }] }],
      },
    });
    writeSettings(project, 'settings.local.json', {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'local' }] }] },
    });

    const { hooks } = loadConfig(project, { homeDir: home });

    expect(hooks.SessionStart).toHaveLength(2);
    expect(hooks.SessionStart?.map((entry) => entry.hooks[0])).toEqual([
      { type: 'command', command: 'global' },
      { type: 'command', command: 'project' },
    ]);
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.Stop).toHaveLength(1);
  });

  it('skips files with invalid JSON', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), 'not json');

    const config = loadConfig(project, { homeDir: home });

    expect(config.hooks).toEqual({});
  });

  it('resolves disableAllHooks with local > project > global precedence', () => {
    writeSettings(home, 'settings.json', { disableAllHooks: true });
    expect(loadConfig(project, { homeDir: home }).disableAllHooks).toBe(true);

    writeSettings(project, 'settings.json', { disableAllHooks: false });
    expect(loadConfig(project, { homeDir: home }).disableAllHooks).toBe(false);

    writeSettings(project, 'settings.local.json', { disableAllHooks: true });
    expect(loadConfig(project, { homeDir: home }).disableAllHooks).toBe(true);
  });

  it('reads the real home settings when no override is passed', () => {
    // Chỉ chạy để chắc chắn signature mặc định dùng homedir() không crash
    expect(() => loadConfig(mkdtempSync(join(tmpdir(), 'cc-hooks-cwd-')))).not.toThrow();
    expect(homedir()).toBeTruthy();
  });
});

describe('warnUnsupportedEvents', () => {
  it('warns for each configured unsupported event', () => {
    const warn = vi.fn<(message: string) => void>();
    const hooks = {
      PermissionRequest: [{ hooks: [] }],
      SubagentStop: [{ hooks: [] }],
    };

    warnUnsupportedEvents(hooks, warn);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PermissionRequest'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SubagentStop'));
  });

  it('does not warn for supported events or empty config', () => {
    const warn = vi.fn<(message: string) => void>();

    warnUnsupportedEvents({ PostToolUse: [{ hooks: [] }] }, warn);
    warnUnsupportedEvents({}, warn);

    expect(warn).not.toHaveBeenCalled();
  });

  it('lists every unsupported event type', () => {
    expect(UNSUPPORTED_EVENTS).toContain('PermissionRequest');
    expect(UNSUPPORTED_EVENTS).toContain('InstructionsLoaded');
  });
});
