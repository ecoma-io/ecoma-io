import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARCH_TAG_DIMENSIONS,
  collectWorkspaceState,
  KNOWN_SCOPES,
  LEGACY_TAG_VALUES,
  type ArchProjectNode,
  RUNTIME_COMPAT,
  validateArchitecture,
  validateRuntimeCompat,
  validateTagSchema,
} from './arch-tags.js';

/** Dựng node test tối thiểu; tags mặc định đủ schema để test tập trung vào một khía cạnh. */
function node(name: string, tags?: string[], deps: string[] = []): ArchProjectNode {
  return {
    name,
    tags: tags ?? ['scope:public', 'type:domain', 'runtime:universal'],
    dependencies: deps,
  };
}

describe('validateTagSchema', () => {
  it('passes a project carrying exactly one tag per dimension', () => {
    expect(
      validateTagSchema(node('a', ['scope:public', 'type:domain', 'runtime:universal'])),
    ).toEqual([]);
  });

  it('leaves non-architecture tags such as npm:private alone', () => {
    expect(
      validateTagSchema(node('a', ['npm:private', 'scope:public', 'type:domain', 'runtime:edge'])),
    ).toEqual([]);
  });

  it('reports a missing dimension', () => {
    const violations = validateTagSchema(node('a', ['scope:public', 'runtime:edge']));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'missing-dimension', detail: 'type' });
  });

  it('reports a duplicate dimension tag', () => {
    const violations = validateTagSchema(
      node('a', ['scope:public', 'scope:shared', 'type:domain', 'runtime:edge']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'duplicate-dimension' });
  });

  it('rejects a type value outside the allowlist', () => {
    const violations = validateTagSchema(
      node('a', ['scope:public', 'type:widget', 'runtime:edge']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'invalid-value', detail: 'type:widget' });
  });

  it('rejects a runtime value outside the allowlist', () => {
    const violations = validateTagSchema(
      node('a', ['scope:public', 'type:domain', 'runtime:serverless']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'invalid-value', detail: 'runtime:serverless' });
  });

  it('rejects a scope outside KNOWN_SCOPES', () => {
    const violations = validateTagSchema(
      node('a', ['scope:mystery', 'type:domain', 'runtime:edge']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'unknown-scope', detail: 'scope:mystery' });
  });

  it.each(LEGACY_TAG_VALUES)('rejects legacy tag %s', (legacy) => {
    // Legacy tag thay thế đúng tag dimension mà nó lấn sân, để lỗi duy nhất
    // được báo là legacy-value chứ không phải duplicate-dimension.
    const replaces =
      legacy === 'type:infras'
        ? 'type:domain'
        : legacy.startsWith('type:')
          ? 'type:domain'
          : legacy === 'runtime:node'
            ? 'runtime:universal'
            : null; // layer:* lấn sân dimension không tồn tại — chỉ thêm vào
    const tags = replaces
      ? ['scope:public', replaces, 'runtime:universal'].map((t) => (t === replaces ? legacy : t))
      : ['scope:public', 'type:domain', 'runtime:universal', legacy];
    const violations = validateTagSchema(node('a', tags));
    expect(violations.filter((v) => v.kind === 'legacy-value').map((v) => v.detail)).toContain(
      legacy,
    );
  });
});

describe('validateRuntimeCompat', () => {
  it('allows an edge project to depend on edge and universal projects', () => {
    const edge = node('app', ['scope:public', 'type:composition', 'runtime:edge'], ['u', 'e']);
    const projects = new Map(
      [
        edge,
        node('u', ['scope:public', 'type:domain', 'runtime:universal']),
        node('e', ['scope:public', 'type:domain', 'runtime:edge']),
      ].map((n) => [n.name, n]),
    );
    expect(validateRuntimeCompat(edge, projects)).toEqual([]);
  });

  it('blocks an edge project from depending on a native project', () => {
    const edge = node('app', ['scope:public', 'type:composition', 'runtime:edge'], ['cli']);
    const projects = new Map(
      [edge, node('cli', ['scope:local', 'type:tooling', 'runtime:native'])].map((n) => [
        n.name,
        n,
      ]),
    );
    const violations = validateRuntimeCompat(edge, projects);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'runtime-compat' });
    expect(violations[0].detail).toContain('runtime:edge depends on cli (runtime:native)');
  });

  it('blocks a universal project from depending on an edge project', () => {
    // universal là cam kết tương thích hai chiều: dependency edge-only của lib
    // universal sẽ khoá lib vào edge, phá chính cam kết đó.
    const uni = node('lib', ['scope:public', 'type:domain', 'runtime:universal'], ['edgeLib']);
    const projects = new Map(
      [uni, node('edgeLib', ['scope:public', 'type:domain', 'runtime:edge'])].map((n) => [
        n.name,
        n,
      ]),
    );
    const violations = validateRuntimeCompat(uni, projects);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('runtime:universal depends on edgeLib (runtime:edge)');
  });

  it('blocks a universal project from depending on a native project', () => {
    const uni = node('lib', ['scope:public', 'type:domain', 'runtime:universal'], ['cli']);
    const projects = new Map(
      [uni, node('cli', ['scope:local', 'type:tooling', 'runtime:native'])].map((n) => [n.name, n]),
    );
    expect(validateRuntimeCompat(uni, projects)).toHaveLength(1);
  });

  it('blocks a browser project from depending on a native project', () => {
    const browser = node('spa', ['scope:public', 'type:composition', 'runtime:browser'], ['cli']);
    const projects = new Map(
      [browser, node('cli', ['scope:local', 'type:tooling', 'runtime:native'])].map((n) => [
        n.name,
        n,
      ]),
    );
    expect(validateRuntimeCompat(browser, projects)).toHaveLength(1);
  });

  it('does not double-report when the project itself is missing a runtime tag', () => {
    const orphan = node('app', ['scope:public', 'type:composition'], ['u']);
    const projects = new Map(
      [orphan, node('u', ['scope:public', 'type:domain', 'runtime:universal'])].map((n) => [
        n.name,
        n,
      ]),
    );
    expect(validateRuntimeCompat(orphan, projects)).toEqual([]);
  });

  it('matches the documented compatibility matrix shape', () => {
    // Runtime cụ thể phụ thuộc được chính nó + universal; universal chỉ được
    // phụ thuộc universal — đúng nghĩa cam kết tương thích hai chiều.
    // (Sắp trước để assertion không nằm trong nhánh if — no-conditional-expect.)
    const specific = Object.entries(RUNTIME_COMPAT).filter(([source]) => source !== 'universal');
    expect(specific.length).toBe(3);
    for (const [source, targets] of specific) {
      expect(new Set(targets)).toEqual(new Set([source, 'universal']));
    }
    expect(RUNTIME_COMPAT.universal).toEqual(['universal']);
  });
});

describe('validateArchitecture', () => {
  it('aggregates schema and runtime violations across projects', () => {
    const bad = node('bad', ['scope:public', 'type:composition'], ['good']);
    const good = node('good', ['scope:public', 'type:domain', 'runtime:universal']);
    const violations = validateArchitecture({
      projects: new Map([
        [bad.name, bad],
        [good.name, good],
      ]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ project: 'bad', kind: 'missing-dimension' });
  });

  it('returns empty for a consistent workspace', () => {
    const a = node('a', ['scope:llm', 'type:composition', 'runtime:edge'], ['b']);
    const b = node('b', ['scope:llm', 'type:contracts', 'runtime:universal']);
    const violations = validateArchitecture({
      projects: new Map([
        [a.name, a],
        [b.name, b],
      ]),
    });
    expect(violations).toEqual([]);
  });
});

describe('allowlists', () => {
  it('keeps type and runtime allowlists non-empty and disjoint from legacy values', () => {
    for (const dim of ['type', 'runtime'] as const) {
      const allowed = ARCH_TAG_DIMENSIONS[dim] as readonly string[];
      expect(allowed.length).toBeGreaterThan(0);
      for (const value of allowed) {
        expect(LEGACY_TAG_VALUES).not.toContain(`${dim}:${value}`);
      }
    }
  });

  it('contains the scopes referenced by .oxlintrc.json constraints', () => {
    // Scope bị xoá khỏi constraints mà còn trong validator (hoặc ngược lại) là
    // hai nguồn lệch nhau — test này cố tình đọc file thật.
    const config = readFileSync(resolve(import.meta.dirname, '../../../.oxlintrc.json'), 'utf8');
    const legacyScopes = ['console', 'seller', 'docs'];
    for (const scope of legacyScopes) {
      expect(config).not.toContain(`scope:${scope}"`);
    }
    const sharedScopes = ['public', 'shared', 'platform', 'local'];
    for (const scope of KNOWN_SCOPES) {
      if (sharedScopes.includes(scope)) continue; // scope nền có thể không xuất hiện dưới dạng sourceTag riêng
      expect(config).toContain(`scope:${scope}`);
    }
  });
});

describe('collectWorkspaceState', () => {
  it('returns every workspace project with tags and project-to-project deps', () => {
    const { projects } = collectWorkspaceState();
    expect(projects.size).toBeGreaterThanOrEqual(15);
    const home = projects.get('@ecoma-io/home');
    expect(home).toBeDefined();
    expect(home?.tags).toContain('runtime:edge');
    // layout-public → i18n-public là edge project↔project thật của graph.
    const layout = projects.get('layout-public');
    expect(layout?.dependencies).toContain('i18n-public');
    // Node builtin/npm không được lọt vào dependencies project↔project.
    for (const p of projects.values()) {
      for (const dep of p.dependencies) {
        expect(projects.has(dep)).toBe(true);
      }
    }
  });
});
