import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARCH_TAG_DIMENSIONS,
  buildWorkspaceState,
  GraphInconsistencyError,
  KNOWN_SCOPES,
  LEGACY_TAG_VALUES,
  type ArchProjectNode,
  RUNTIME_COMPAT,
  validateArchitecture,
  validateRuntimeCompat,
  validateTagSchema,
} from './arch-tags.js';
import { ROOT_DIR } from './utils.js';

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

  it('rejects layer tags by PREFIX, not by an enumerated value', () => {
    // Dimension `layer` đã bị xoá khỏi taxonomy: giá trị nào mang prefix đó cũng
    // là di tích. `layer:widget` không nằm trong LEGACY_TAG_VALUES — nếu validator
    // chỉ chặn theo danh sách cứng thì nó đi qua guard dimension lặng lẽ.
    const violations = validateTagSchema(
      node('a', ['scope:public', 'type:domain', 'runtime:universal', 'layer:widget']),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'legacy-value', detail: 'layer:widget' });

    // Cùng cơ chế với value khác chưa từng tồn tại trong repo.
    const other = validateTagSchema(
      node('a', ['scope:public', 'type:domain', 'runtime:universal', 'layer:everything']),
    );
    expect(other.map((v) => v.detail)).toContain('layer:everything');
  });

  it('reports layer:widget from validateArchitecture on a full workspace state', () => {
    // Cùng đường vào như arch-check: validateArchitecture trên state đủ project.
    const bad = node('bad', ['scope:public', 'type:domain', 'runtime:universal', 'layer:widget']);
    const good = node('good', ['scope:public', 'type:domain', 'runtime:universal']);
    const violations = validateArchitecture({
      projects: new Map([
        [bad.name, bad],
        [good.name, good],
      ]),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ project: 'bad', kind: 'legacy-value' });
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

/** Graph Nx tối thiểu đủ cho buildWorkspaceState: nodes + dependencies theo source. */
function fakeGraph(nodes: Record<string, { tags?: string[] }>, edges: [string, string][]) {
  const dependencies: Record<string, { target: string }[]> = {};
  for (const [source, target] of edges) {
    (dependencies[source] ??= []).push({ target });
  }
  return {
    nodes: Object.fromEntries(Object.entries(nodes).map(([name, data]) => [name, { name, data }])),
    dependencies,
  };
}

/** Bắt exception để assert trên nó ngoài nhánh catch (no-conditional-expect). */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined; // caller phải assert là GraphInconsistencyError — sẽ fail rõ
}

describe('buildWorkspaceState (graph consistency, fail-closed)', () => {
  it('accepts a consistent workspace/project graph', () => {
    const projects = buildWorkspaceState(
      ['a', 'b'],
      fakeGraph({ a: { tags: ['scope:shared'] }, b: {} }, [['a', 'b']]),
    );
    expect(projects.size).toBe(2);
    expect(projects.get('a')?.tags).toContain('scope:shared');
    expect(projects.get('a')?.dependencies).toEqual(['b']);
  });

  it('fails and names the project missing from the graph', () => {
    // truth = `nx show projects`; graph thiếu 'ghost' → phải fail, không skip.
    const error = capture(() => buildWorkspaceState(['a', 'ghost'], fakeGraph({ a: {} }, [])));
    expect(error).toBeInstanceOf(GraphInconsistencyError);
    const inconsistent = error as GraphInconsistencyError;
    expect(inconsistent.missingProjects).toEqual(['ghost']);
    expect(inconsistent.message).toContain('ghost');
  });

  it('diagnoses every missing project when several are absent', () => {
    const error = capture(() =>
      buildWorkspaceState(['a', 'ghost1', 'ghost2'], fakeGraph({ a: {} }, [])),
    );
    expect(error).toBeInstanceOf(GraphInconsistencyError);
    const inconsistent = error as GraphInconsistencyError;
    expect(new Set(inconsistent.missingProjects)).toEqual(new Set(['ghost1', 'ghost2']));
    expect(inconsistent.message).toContain('ghost1');
    expect(inconsistent.message).toContain('ghost2');
  });

  it('does not treat external/package dependency targets as missing projects', () => {
    // npm package chỉ xuất hiện trong `dependencies`, không trong `nodes` —
    // lọc edges là hành vi đúng, không phải lệch graph (ngược lại với project
    // thật bị thiếu node, test phía trên).
    const projects = buildWorkspaceState(
      ['a', 'b'],
      fakeGraph({ a: {}, b: {} }, [
        ['a', 'npm:lodash'],
        ['a', 'b'],
      ]),
    );
    expect(projects.get('a')?.dependencies).toEqual(['b']);
  });
});

/**
 * Đọc `.oxlintrc.json` là JSONC (oxlint/oxfmt chấp nhận comment) — parse bằng
 * jsonc-parser mà nx đã mang vào tree, truy qua createRequire từ context của
 * nx để không phải thêm dependency mới vào package.json.
 */
function readOxlintConfig(): {
  rules: Record<string, [number, Record<string, unknown>]>;
} {
  const req = createRequire(resolve(ROOT_DIR, 'node_modules/nx/package.json'));
  const jsoncParse: (text: string) => unknown = req('jsonc-parser').parse;
  const raw = readFileSync(resolve(ROOT_DIR, '.oxlintrc.json'), 'utf8');
  return jsoncParse(raw) as { rules: Record<string, [number, Record<string, unknown>]> };
}

/** Mảng depConstraints của @nx/enforce-module-boundaries, đã parse thật. */
function readDepConstraints(): readonly Record<string, unknown>[] {
  const config = readOxlintConfig();
  const rule = config.rules['@nx/enforce-module-boundaries'];
  if (!Array.isArray(rule) || rule.length < 2) {
    throw new Error('@nx/enforce-module-boundaries is not configured in .oxlintrc.json');
  }
  const options = rule[1] as { depConstraints?: Record<string, unknown>[] };
  if (!Array.isArray(options.depConstraints)) {
    throw new Error('depConstraints missing from @nx/enforce-module-boundaries options');
  }
  return options.depConstraints;
}

/** Các constraint match theo `sourceTag` đơn (không phải allSourceTags combo). */
function scopeSourceConstraints(): Map<string, readonly string[]> {
  const bySource = new Map<string, readonly string[]>();
  for (const constraint of readDepConstraints()) {
    if (typeof constraint.sourceTag !== 'string') continue;
    if (!constraint.sourceTag.startsWith('scope:')) continue;
    const targets = constraint.onlyDependOnLibsWithTags;
    if (!Array.isArray(targets)) continue;
    bySource.set(constraint.sourceTag, targets as readonly string[]);
  }
  return bySource;
}

/** Helper của @nx/eslint-plugin (đang cài) để test HÀNH VI constraint thật. */
async function pluginConstraintHelpers(): Promise<{
  findConstraintsFor: (
    constraints: readonly Record<string, unknown>[],
    source: { data: { tags: string[] } },
  ) => readonly Record<string, unknown>[];
  hasNoneOfTheseTags: (proj: { data: { tags: string[] } }, tags: readonly string[]) => boolean;
  findDependenciesWithTags: (
    target: { name: string; data: { tags: string[] } },
    tags: readonly string[],
    graph: unknown,
  ) => unknown[][];
}> {
  const req = createRequire(resolve(ROOT_DIR, 'node_modules/nx/package.json'));
  const pluginPkg = req.resolve('@nx/eslint-plugin/package.json');
  const utilsPath = createRequire(pluginPkg).resolve('./dist/src/utils/runtime-lint-utils.js');
  return (await import(utilsPath)) as never;
}

/** Allowlist scope constraint mà engine thật sẽ áp cho một source tags cụ thể. */
async function scopeAllowlistFor(sourceTags: string[]): Promise<readonly string[]> {
  const { findConstraintsFor } = await pluginConstraintHelpers();
  const matched = findConstraintsFor(readDepConstraints(), { data: { tags: sourceTags } });
  const scope = matched.find(
    (c) => typeof c.sourceTag === 'string' && c.sourceTag.startsWith('scope:'),
  );
  expect(scope, `no scope constraint matches source tags ${sourceTags.join(',')}`).toBeDefined();
  return (scope?.onlyDependOnLibsWithTags ?? []) as readonly string[];
}

/** hasNoneOfTheseTags qua engine thật: false = được phép, true = bị cấm. */
async function edgeAllowed(sourceTags: string[], targetTags: string[]): Promise<boolean> {
  const { hasNoneOfTheseTags } = await pluginConstraintHelpers();
  return !hasNoneOfTheseTags({ data: { tags: targetTags } }, await scopeAllowlistFor(sourceTags));
}

/**
 * Đánh giá cạnh direct A→B qua MỌI constraint khớp source, đúng ngữ nghĩa
 * conjunctive của rule (`findConstraintsFor` trả tất cả constraint khớp; một
 * cái fail là report). `notDependOn*` là transitive nên cần graph thật tối
 * thiểu: findDependenciesWithTags đếm cả self (pathExists(A,A)=true) — target
 * mang tag cấm là đủ báo violation mà không cần node trung gian.
 */
async function directEdgeViolations(sourceTags: string[], targetTags: string[]): Promise<string[]> {
  const { findConstraintsFor, hasNoneOfTheseTags, findDependenciesWithTags } =
    await pluginConstraintHelpers();
  const source = { name: 'a', data: { tags: sourceTags } };
  const target = { name: 'b', data: { tags: targetTags } };
  const graph = {
    nodes: { a: source, b: target },
    dependencies: { a: [{ source: 'a', target: 'b' }] },
  };
  const violations: string[] = [];
  for (const constraint of findConstraintsFor(readDepConstraints(), source)) {
    const only = constraint.onlyDependOnLibsWithTags;
    if (Array.isArray(only) && only.length > 0 && hasNoneOfTheseTags(target, only as string[])) {
      violations.push(`onlyDependOn [${(only as string[]).join(',')}]`);
    }
    const not = constraint.notDependOnLibsWithTags;
    if (Array.isArray(not) && not.length > 0) {
      const paths = findDependenciesWithTags(target, not as string[], graph);
      if (paths.length > 0) {
        violations.push(`notDependOn [${(not as string[]).join(',')}]`);
      }
    }
  }
  return violations;
}

describe('allowlists sync with .oxlintrc.json', () => {
  it('keeps type and runtime allowlists non-empty and disjoint from legacy values', () => {
    for (const dim of ['type', 'runtime'] as const) {
      const allowed = ARCH_TAG_DIMENSIONS[dim] as readonly string[];
      expect(allowed.length).toBeGreaterThan(0);
      for (const value of allowed) {
        expect(LEGACY_TAG_VALUES).not.toContain(`${dim}:${value}`);
      }
    }
  });

  it('gives every KNOWN_SCOPES entry its own source-scope constraint', () => {
    // Hai chiều: scope trong KNOWN_SCOPES mà thiếu constraint là scope không ai
    // kiểm dependency (lỗ hổng `scope:shared` cũ); constraint chứa scope lạ là
    // scope đã xoá mà còn sống trong config.
    const bySource = scopeSourceConstraints();
    for (const scope of KNOWN_SCOPES) {
      const targets = bySource.get(`scope:${scope}`);
      expect(targets, `scope:${scope} must have its own sourceTag constraint`).toBeDefined();
    }
    for (const source of bySource.keys()) {
      const scope = source.slice('scope:'.length);
      expect(
        KNOWN_SCOPES,
        `constraint sourceTag ${source} must be declared in KNOWN_SCOPES`,
      ).toContain(scope);
    }
  });

  /**
   * Policy chéo scope qua HÀNH VI constraint thật (engine @nx/eslint-plugin đang
   * cài, không substring config). Ma trận:
   * - foundation (shared/platform) được phép cho bounded context — vai trò tầng nền;
   * - `type:contracts` chéo scope nghiệp vụ được phép;
   * - implementation scope nghiệp vụ khác bị chặn;
   * - đáy: shared không chạm platform; platform không chạm scope nghiệp vụ.
   */
  const boundedContexts = KNOWN_SCOPES.filter(
    (s) => !['shared', 'platform', 'local', 'public'].includes(s),
  );

  it('allows bounded contexts to depend on shared foundation implementations', async () => {
    for (const scope of boundedContexts) {
      expect(
        await edgeAllowed([`scope:${scope}`], ['scope:shared', 'type:infrastructure']),
        `scope:${scope} -> shared implementation must be allowed`,
      ).toBe(true);
    }
  });

  it('allows bounded contexts to depend on platform foundation implementations', async () => {
    for (const scope of boundedContexts) {
      expect(
        await edgeAllowed([`scope:${scope}`], ['scope:platform', 'type:infrastructure']),
        `scope:${scope} -> platform implementation must be allowed`,
      ).toBe(true);
    }
  });

  it('allows cross-scope dependencies only through type:contracts', async () => {
    for (const source of boundedContexts) {
      for (const target of boundedContexts.filter((t) => t !== source)) {
        expect(
          await edgeAllowed([`scope:${source}`], [`scope:${target}`, 'type:contracts']),
          `${source} -> ${target} contracts must be allowed`,
        ).toBe(true);
        expect(
          await edgeAllowed([`scope:${source}`], [`scope:${target}`, 'type:infrastructure']),
          `${source} -> ${target} implementation must be blocked`,
        ).toBe(false);
        expect(
          await edgeAllowed([`scope:${source}`], [`scope:${target}`, 'type:domain']),
          `${source} -> ${target} domain must be blocked`,
        ).toBe(false);
        expect(
          await edgeAllowed([`scope:${source}`], [`scope:${target}`, 'type:application']),
          `${source} -> ${target} application must be blocked`,
        ).toBe(false);
      }
    }
  });

  it('blocks composition-to-composition edges (app never imports app)', async () => {
    // Ranh giới taxonomy cũ (`type:web`/`type:service` → onlyDependOn ["type:lib"]):
    // app không bao giờ import app khác — một deploy unit không được trờ thành
    // implementation của deploy unit khác. Regression: constraint cũ
    // `type:composition` notDependOn ["type:tooling"] để tuột app→app qua CẢ
    // constraint scope (identity→cache: allowlist có scope:platform) lẫn combo
    // runtime (allowlist có type:composition).
    const source = ['scope:identity', 'type:composition', 'runtime:edge'];
    expect(
      await directEdgeViolations(source, ['scope:platform', 'type:composition', 'runtime:edge']),
      'identity app -> cache app must be blocked',
    ).not.toEqual([]);
    expect(
      await directEdgeViolations(
        ['scope:llm', 'type:composition', 'runtime:edge'],
        ['scope:llm', 'type:composition', 'runtime:edge'],
      ),
      'llm-console -> llm-seller (same scope) must be blocked too',
    ).not.toEqual([]);
    expect(
      await directEdgeViolations(source, ['scope:local', 'type:tooling', 'runtime:native']),
      'app -> tooling must be blocked',
    ).not.toEqual([]);
    // Nghịch đảo: compose lib thật vẫn đi qua — mọi constraint đều chấp thuận.
    expect(
      await directEdgeViolations(source, ['scope:platform', 'type:infrastructure', 'runtime:edge']),
      'app -> platform lib must stay allowed',
    ).toEqual([]);
  });

  it('keeps shared as the bottom of the ownership axis', async () => {
    // Đáy: shared không chạm platform hay scope nghiệp vụ nào — impl lẫn contract.
    // `onlyDependOnLibsWithTags` khớp BẤT KỂ tag nào trong allowlist nên để
    // `type:contracts` vào allowlist shared là mở `shared → contracts của scope
    // bất kỳ` (target chỉ cần một tag khớp), tạo chu trình shared ↔ contracts của
    // scope đó — đảo chiều dependency của tầng đáy. Ngoại lệ contracts là cho
    // CONSUMER, tầng nền không consume scope nghiệp vụ.
    expect(await edgeAllowed(['scope:shared'], ['scope:platform', 'type:infrastructure'])).toBe(
      false,
    );
    expect(await edgeAllowed(['scope:shared'], ['scope:llm', 'type:infrastructure'])).toBe(false);
    expect(await edgeAllowed(['scope:shared'], ['scope:llm', 'type:contracts'])).toBe(false);
    expect(await edgeAllowed(['scope:shared'], ['scope:shared', 'type:domain'])).toBe(true);
  });

  it('keeps platform above shared and independent of business scopes', async () => {
    expect(await edgeAllowed(['scope:platform'], ['scope:shared', 'type:infrastructure'])).toBe(
      true,
    );
    for (const scope of boundedContexts) {
      expect(
        await edgeAllowed(['scope:platform'], [`scope:${scope}`, 'type:infrastructure']),
        `platform -> ${scope} implementation must be blocked`,
      ).toBe(false);
      expect(
        await edgeAllowed(['scope:platform'], [`scope:${scope}`, 'type:contracts']),
        `platform -> ${scope} contracts must be allowed`,
      ).toBe(true);
    }
  });

  it('does not contradict type rules: shared constraint stays scope-only and type-free', () => {
    // Constraint scope:shared onlyDependOn* là lượt direct — allowlist của nó
    // KHÔNG được chứa `type:contracts` (OR-match: target chỉ cần một tag khớp là
    // mở `shared → contracts của scope bất kỳ`, đảo chiều tầng đáy) và cũng không
    // nuốt trục type (`type:domain` v.v.): type direction là việc của constraint
    // `type:*`, để vào đây là mỗi lần taxonomy type đổi lại phải sửa hai chỗ.
    const bySource = scopeSourceConstraints();
    const targets = bySource.get('scope:shared') ?? [];
    expect(targets).toContain('scope:shared'); // test phía trên bắt buộc constraint tồn tại
    const typeEntries = targets.filter((t) => t.startsWith('type:'));
    expect(typeEntries).toEqual([]);
  });

  it('every scope targeted by scope constraints is a known scope', () => {
    // Target scope của constraint scope nào cũng phải thuộc KNOWN_SCOPES —
    // scope target hỏng (typo, scope đã xoá) là constraint cho phép dep vào
    // project không bao giờ được tag như vậy, hoặc tệ hơn: cho phép scope đã
    // bị xoá sống sót qua config. (Thu tập trước, assert sau — tránh
    // expect trong nhánh if, vi phạm no-conditional-expect.)
    const targetedScopes: string[] = [];
    for (const targets of scopeSourceConstraints().values()) {
      for (const target of targets) {
        if (target.startsWith('scope:')) {
          targetedScopes.push(target.slice('scope:'.length));
        }
      }
    }
    expect(targetedScopes.length).toBeGreaterThan(0); // tập target không rỗng
    for (const scope of new Set(targetedScopes)) {
      expect(KNOWN_SCOPES).toContain(scope);
    }
  });

  it('keeps legacy scopes out of the constraint config entirely', () => {
    // Assertion đọc CONFIG ĐÃ PARSE (không substring trên raw text): scope cũ
    // không được là sourceTag lẫn target của bất kỳ constraint nào.
    const constraints = readDepConstraints();
    const legacyScopes = ['console', 'seller', 'docs'];
    const serialized = JSON.stringify(constraints);
    for (const scope of legacyScopes) {
      expect(serialized).not.toContain(`scope:${scope}`);
    }
  });

  it('derives runtime composition constraints from RUNTIME_COMPAT without drift', () => {
    // Lượt runtime của .oxlintrc.json (allSourceTags type:composition + runtime:X,
    // onlyDependOn* runtime) phải là ảnh của RUNTIME_COMPAT: X được phụ thuộc
    // đúng {X, universal}. drift giữa hai nguồn = một bên cấm điều bên kia cho.
    const constraints = readDepConstraints();
    const runtimeConstraints = constraints.filter(
      (c) =>
        Array.isArray(c.allSourceTags) &&
        (c.allSourceTags as string[]).some((t) => t.startsWith('runtime:')),
    );

    const derived: Record<string, Set<string>> = {};
    const runtimeValues = runtimeConstraints.map((c) =>
      (c.allSourceTags as string[]).find((t) => t.startsWith('runtime:')),
    );
    expect(runtimeValues.every((t) => t !== undefined)).toBe(true); // bộ lọc bảo đảm
    for (const constraint of runtimeConstraints) {
      const runtimeTag = (constraint.allSourceTags as string[]).find((t) =>
        t.startsWith('runtime:'),
      ) as string;
      const value = runtimeTag.slice('runtime:'.length);
      expect(RUNTIME_COMPAT, `runtime:${value} must exist in RUNTIME_COMPAT`).toHaveProperty(value);
      const targets = constraint.onlyDependOnLibsWithTags as readonly string[];
      const runtimeTargets = targets
        .filter((t) => t.startsWith('runtime:'))
        .map((t) => t.slice('runtime:'.length));
      derived[value] ??= new Set();
      // Nhiều constraint có thể nhắm cùng runtime (composition vs type khác) —
      // runtime target của chúng phải nhất quán với nhau.
      expect(new Set(runtimeTargets)).toEqual(new Set(RUNTIME_COMPAT[value]));
      for (const t of runtimeTargets) derived[value].add(t);
    }
    // Mọi runtime CỤ THỂ trong RUNTIME_COMPAT phải có ít nhất một constraint
    // direct-edge đại diện trong config. `universal` cố ý không có: phía source
    // universal được chặn TRANSITIVE bởi arch-check trên graph (constraint
    // direct-edge không diễn đạt được "universal chỉ chạm universal qua mọi
    // chuỗi"), thêm constraint direct cho universal chỉ tạo ảo giác hai nguồn.
    const specificRuntimes = Object.keys(RUNTIME_COMPAT).filter((r) => r !== 'universal');
    for (const runtime of specificRuntimes) {
      expect(derived[runtime], `runtime:${runtime} must have a constraint`).toBeDefined();
    }
    expect(derived.universal).toBeUndefined();
  });
});
