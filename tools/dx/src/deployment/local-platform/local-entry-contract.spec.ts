import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_DIR } from '../../utils.js';

const LANE_PROJECTS = [
  'platform-deploy',
  'home-deploy',
  'backoffice-deploy',
  'account-deploy',
  'auth-deploy',
  'pact-broker-api-deploy',
  'pact-broker-app-deploy',
  'transactional-mail-deploy',
  'push-notification-deploy',
] as const;

/** Mọi project trong `deploys/` phải thuộc một trong hai loại: lane project (có local lane) hoặc job deploy (chỉ build image). */
const JOB_ONLY_PROJECTS = [
  'transactional-mailer-job-deploy',
  'web-push-notification-job-deploy',
] as const;

function packageJson(project: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT_DIR, 'deploys', project, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function nxTargets(project: string): Record<string, Record<string, unknown>> {
  const pkg = packageJson(project);
  const nx = pkg['nx'] as { tags?: string[]; targets?: Record<string, Record<string, unknown>> };
  expect(nx['tags'], `${project} must be tagged type:deployment`).toContain('type:deployment');
  return nx['targets'] ?? {};
}

function readEntry(project: string): string {
  return readFileSync(join(ROOT_DIR, 'deploys', project, 'local.ts'), 'utf8');
}

describe('local lane colocated entry contract', () => {
  it('every tagged deployment project has a local.ts entry and local-up/local-down targets (fail-closed on new lanes)', () => {
    // Ghim CẤU TRÚC: project `tag:type:deployment` mà thiếu entry/target local là
    // lỗi contract — lane mới phải được thêm đầy đủ, không được nửa vời.
    const deploysDir = join(ROOT_DIR, 'deploys');
    const allProjects = readdirSync(deploysDir).filter((name) =>
      existsSync(join(deploysDir, name, 'package.json')),
    );
    const laneProjects = allProjects.filter(
      (project) => !(JOB_ONLY_PROJECTS as readonly string[]).includes(project),
    );
    expect(new Set(laneProjects)).toEqual(new Set(LANE_PROJECTS));
    for (const project of laneProjects) {
      expect(
        existsSync(join(deploysDir, project, 'local.ts')),
        `${project} must have a colocated local.ts entry`,
      ).toBe(true);
      const targets = nxTargets(project);
      expect(targets['local-up'], `${project} must declare a local-up target`).toBeDefined();
      expect(targets['local-down'], `${project} must declare a local-down target`).toBeDefined();
    }
  });

  it('every local-up runs the colocated entry, not a DX command', () => {
    // Entry colocated là biên duy nhất — `npx tsx local.ts up` từ cwd project.
    // Trỏ về lệnh DX (`pnpm nx affected -t system-test -c local` (which provisions the required `local-up` prerequisites first)...) là hồi quy kiến trúc.
    const commands = LANE_PROJECTS.map((project) => {
      const target = nxTargets(project)['local-up'] as {
        options?: { command?: string; cwd?: string };
        configurations?: Record<string, unknown>;
      };
      return {
        project,
        command: target.options?.command,
        cwd: target.options?.cwd,
        configurations: target.configurations,
      };
    });
    expect(commands).toEqual(
      LANE_PROJECTS.map((project) => ({
        project,
        command: 'npx tsx local.ts up',
        cwd: `deploys/${project}`,
        configurations: expect.objectContaining({ local: {} }),
      })),
    );
  });

  it('every local-down runs the colocated entry (the dependsOn contract itself lives in the teardown-order spec)', () => {
    const downs = LANE_PROJECTS.map((project) => {
      const target = nxTargets(project)['local-down'] as {
        options?: { command?: string; cwd?: string };
        configurations?: Record<string, unknown>;
      };
      return {
        project,
        command: target.options?.command,
        cwd: target.options?.cwd,
        configurations: target.configurations,
      };
    });
    expect(downs).toEqual(
      LANE_PROJECTS.map((project) => ({
        project,
        command: 'npx tsx local.ts down',
        cwd: `deploys/${project}`,
        configurations: expect.objectContaining({ local: {} }),
      })),
    );
  });

  it('entries never call DX commands — grep the colocated local.ts sources', () => {
    // Contract "entry không gọi lệnh DX": kiểm theo nguồn, không phải theo intent.
    // `local-status`/`local-cleanup` là lệnh DX hợp lệ trong *output* (thông báo
    // remediation), không phải lệnh được entry invoke.
    const forbidden = /['"](?:pnpm +dx|tools\/dx)[ '"]/u;
    for (const project of LANE_PROJECTS) {
      const source = readEntry(project);
      expect(forbidden.test(source), `${project} local.ts must not invoke DX commands`).toBe(false);
    }
  });

  it('no orphan lease machinery remains — LANE_LEASE_ENV and assertLaneLease are gone from the codebase', () => {
    // Lease assertion từng là cơ chế fencing của orchestrator đã xoá; sự tồn tại
    // của nó giờ chỉ là dead code gây hiểu nhầm. Fail-closed: tái xuất hiện là đỏ.
    const forbidden = /LANE_LEASE_ENV|assertLaneLease|ECOMA_LANE_LEASE/u;
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!name.endsWith('.ts') || name.endsWith('.spec.ts') || name.endsWith('.d.ts')) continue;
        const source = readFileSync(path, 'utf8');
        if (forbidden.test(source)) offenders.push(path);
      }
    };
    scan(join(ROOT_DIR, 'tools', 'dx', 'src'));
    scan(join(ROOT_DIR, 'deploys'));
    expect(offenders).toEqual([]);
  });
});

describe('shared entry infrastructure', () => {
  it('exposes the lane lock wrapper that prints the holder identity on steal', () => {
    const source = readFileSync(
      join(ROOT_DIR, 'tools/dx/src/deployment/local-platform/local-entry.ts'),
      'utf8',
    );
    expect(source).toContain('acquireLaneLock');
    expect(source).toContain('stealLaneLock');
  });

  it('deletes the platform PostgreSQL volume unconditionally on down (no opt-out flag)', () => {
    // Volume deletion là hành vi MẶC ĐỊNH của down — cờ opt-in cũ
    // `--remove-data` đã bị xoá hoàn toàn và không được thay bằng cờ/config
    // tương đương. Fail-closed theo nguồn: tái xuất hiện chuỗi cờ trong entry
    // (parsing, tham số, tài liệu runtime) là đỏ.
    const source = readEntry('platform-deploy');
    expect(source).not.toContain('--remove-data');
    expect(source).not.toContain('removeData');
  });
});
