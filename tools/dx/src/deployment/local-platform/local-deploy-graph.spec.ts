import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  classifyLocalUpDependsOnEntry,
  localDeployTaskSequence,
  localDestroyStackOrder,
  localLaneConfigurationNames,
  localUpProjectSequence,
  LocalLaneGraphError,
  LOCAL_LANE_PROJECTS,
  LOCAL_UP_PREREQUISITE_TARGET,
  readProjectLaneTargets,
  type JsonTargetSpec,
} from './local-deploy-graph.js';
import { ROOT_DIR } from '../../utils.js';

/**
 * Spec cấu trúc Task Graph của lane local — kiểm trên CHÍNH KHAI BÁO Nx
 * (package.json của từng deploy project + nx.json) chứ không snapshot mảng: mảng trả về
 * bởi module là dữ liệu dẫn xuất, khai báo mới là nguồn. Một thay đổi
 * `dependsOn` phá bất biến sẽ đỏ tại đây TRƯỚC khi orchestration chạy.
 */

/** Chuẩn hoá entry dependsOn Nx thành chuỗi "project:target" — dùng ở nhiều test. */
function dependsOnNames(deps: NonNullable<JsonTargetSpec['dependsOn']>): string[] {
  return deps.map((d) =>
    typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
  );
}

/** Hàng đợi topo của chính spec — KHÔNG dùng code production để tự kiểm. */
function specTopoSequence(
  deps: Readonly<Record<string, readonly string[]>>,
  nodes: readonly string[],
): string[] {
  const inDegree = new Map<string, number>(nodes.map((n) => [n, (deps[n] ?? []).length]));
  const dependents = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [node, ds] of Object.entries(deps)) {
    for (const d of ds) dependents.get(d)?.push(node);
  }
  const queue = nodes.filter((n) => (inDegree.get(n) ?? 0) === 0);
  const out: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    out.push(node);
    for (const dependent of dependents.get(node) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  return out;
}

describe('local lane Nx declarations (source of truth)', () => {
  it('every lane project declares a local-up target with a total dependsOn chain', () => {
    // Không conditional expect: chia hai assert phẳng — unit nào thiếu dependsOn
    // tường minh sẽ làm tập này lệch, message là danh sách project vi phạm.
    const withoutExplicitDependsOn = LOCAL_LANE_PROJECTS.filter((project) => {
      if (project === 'platform-deploy') return false; // chain head — được phép không khai
      const deps = readProjectLaneTargets(project)['local-up'].dependsOn;
      return !Array.isArray(deps);
    });
    expect(withoutExplicitDependsOn).toEqual([]);
    for (const project of LOCAL_LANE_PROJECTS) {
      expect(readProjectLaneTargets(project)['local-up'].executor).toBe('nx:run-commands');
    }
    // Chain head: platform-deploy KHÔNG phụ thuộc unit nào.
    expect(readProjectLaneTargets('platform-deploy')['local-up'].dependsOn).toBeUndefined();
  });

  it('home depends on platform local-up only (the .env it needs is written inside that task)', () => {
    const deps = readProjectLaneTargets('home-deploy')['local-up'].dependsOn ?? [];
    const normalized = deps.map((d) =>
      typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
    );
    expect(normalized).toContain('platform-deploy:local-up');
    // Graph KHÔNG còn carve-out: không dependsOn nào được phép trỏ target
    // local-env — target đó đã bị gỡ khỏi toàn bộ lane.
    expect(normalized).not.toContain('platform-deploy:local-env');
  });

  it('account depends on backoffice; auth depends on account (bounded-context invariant)', () => {
    const accountDeps = readProjectLaneTargets('account-deploy')['local-up'].dependsOn ?? [];
    const authDeps = readProjectLaneTargets('auth-deploy')['local-up'].dependsOn ?? [];
    expect(dependsOnNames(accountDeps)).toContain('backoffice-deploy:local-up');
    expect(dependsOnNames(authDeps)).toContain('account-deploy:local-up');
  });

  it('wave-2 spine edges: pact-app→pact-api, pact-api→platform, mail→account, push→platform', () => {
    // Bốn unit wave-2 diễn đạt thứ tự chạy NGAY TẠI ĐÂY (không phải ở
    // orchestration): app đọc machineToken từ stack api qua cross-stack read
    // (api phải up trước); api cần network + StackReference platform; mail đọc
    // mailInternalAuthSecret từ stack account; push cần network platform.
    const pactApiDeps =
      readProjectLaneTargets('pact-broker-api-deploy')['local-up'].dependsOn ?? [];
    const pactAppDeps =
      readProjectLaneTargets('pact-broker-app-deploy')['local-up'].dependsOn ?? [];
    const mailDeps =
      readProjectLaneTargets('transactional-mail-deploy')['local-up'].dependsOn ?? [];
    const pushDeps = readProjectLaneTargets('push-notification-deploy')['local-up'].dependsOn ?? [];
    expect(dependsOnNames(pactApiDeps)).toContain('platform-deploy:local-up');
    expect(dependsOnNames(pactAppDeps)).toContain('pact-broker-api-deploy:local-up');
    expect(dependsOnNames(mailDeps)).toContain('account-deploy:local-up');
    expect(dependsOnNames(pushDeps)).toContain('platform-deploy:local-up');
  });

  it('wave-2 WIC units declare build prerequisites on their app bundles', () => {
    // WIC chạy `wrangler dev` từ bundle `dist/` mount lúc container start —
    // cùng lập luận auth (#247): thiếu edge build là restart loop ngay lúc up.
    // pact-broker-app build BÊN TRONG Docker (image Nitro) nên KHÔNG có edge
    // build — edge build chỉ trên ba unit WIC.
    const pactApiDeps =
      readProjectLaneTargets('pact-broker-api-deploy')['local-up'].dependsOn ?? [];
    const mailDeps =
      readProjectLaneTargets('transactional-mail-deploy')['local-up'].dependsOn ?? [];
    const pushDeps = readProjectLaneTargets('push-notification-deploy')['local-up'].dependsOn ?? [];
    const pactAppDeps =
      readProjectLaneTargets('pact-broker-app-deploy')['local-up'].dependsOn ?? [];
    expect(dependsOnNames(pactApiDeps)).toContain('@ecoma-io/pact-broker-api:build');
    expect(dependsOnNames(mailDeps)).toContain('@ecoma-io/transactional-mail:build');
    expect(dependsOnNames(mailDeps)).toContain('@ecoma-io/transactional-mailer-job:build');
    expect(dependsOnNames(pushDeps)).toContain('@ecoma-io/push-notification:build');
    expect(dependsOnNames(pushDeps)).toContain('@ecoma-io/web-push-notification-job:build');
    expect(dependsOnNames(pactAppDeps).some((n) => n.endsWith(':build'))).toBe(false);
  });

  it('platform local-smoke depends on the chain tail AND every wave-2 leaf (smoke runs after the whole chain)', () => {
    const deps = readProjectLaneTargets('platform-deploy')['local-smoke'].dependsOn ?? [];
    const names = deps.map((d) =>
      typeof d === 'string' ? d : `${(d.projects ?? []).join('|')}:${d.target ?? ''}`,
    );
    expect(names).toContain('auth-deploy:local-up');
    // Lá của các nhánh wave-2: smoke là node CUỐI của orchestration — thiếu
    // edge tới một lá là smoke có thể chạy trước unit đó kết thúc.
    expect(names).toContain('pact-broker-app-deploy:local-up');
    expect(names).toContain('transactional-mail-deploy:local-up');
    expect(names).toContain('push-notification-deploy:local-up');
  });

  it('no lane target or dependsOn entry references local-env anywhere (no carve-out)', () => {
    // Target `local-env` đã bị gỡ khỏi lane — ghi `.env` sống bên TRONG task
    // platform `local-up`. Test đọc khai báo THÔ của MỌI project lane (không
    // qua module derive) nên một dependsOn còn trỏ local-env, hay một target
    // local-env còn được khai, đều đỏ tại đây.
    for (const project of LOCAL_LANE_PROJECTS) {
      for (const [target, spec] of Object.entries(readProjectLaneTargets(project))) {
        expect(target, `${project} must not declare target local-env`).not.toBe('local-env');
        for (const d of spec.dependsOn ?? []) {
          const normalized = typeof d === 'string' ? d : (d.target ?? '');
          expect(normalized, `${project}:${target} must not depend on local-env`).not.toBe(
            'local-env',
          );
        }
      }
    }
  });

  it('auth local-up declares build prerequisites on BOTH app projects (WIC bundles exist before up)', () => {
    // #247: WIC container chạy `wrangler dev` từ bundle `dist/` mount lúc
    // container start — không edge build là wrangler fail entry-point ngay
    // lúc container đầu tiên lên. Test đọc khai báo THÔ: xoá edge "cho gọn"
    // sẽ đỏ tại đây. Hai project là ĐỦ (auth + bridge) — thiếu một là worker
    // còn lại restart loop.
    const deps = readProjectLaneTargets('auth-deploy')['local-up'].dependsOn ?? [];
    const names = dependsOnNames(deps);
    expect(names).toContain('auth:build');
    expect(names).toContain('account-bridge:build');
  });
});

describe('build-prerequisite edges (target "build" outside the lane)', () => {
  it('classifies a build edge to an out-of-lane project as a prerequisite, not spine', () => {
    // Edge build trỏ ra ngoài lane là HỢP LỆ — chính khai báo thật của
    // auth-deploy dùng nó (#247). Nó không tham gia spine: kết quả không mang
    // dependency nào.
    const entry = { projects: ['auth'], target: LOCAL_UP_PREREQUISITE_TARGET };
    expect(classifyLocalUpDependsOnEntry('auth-deploy', entry)).toEqual({
      kind: 'prerequisite',
    });
  });

  it('out-of-lane local-up stays REJECTED with the exact legacy message', () => {
    // Hai chiều của contract: mở `build` KHÔNG mở cửa cho edge up ngoài lane.
    // Thông điệp ghim nguyên văn — caller (orchestration fail-closed) in ra
    // cho developer, đổi chữ là đổi contract lỗi.
    const entry = { projects: ['auth'], target: 'local-up' };
    expect(() => classifyLocalUpDependsOnEntry('auth-deploy', entry)).toThrowError(
      new LocalLaneGraphError(
        'auth-deploy:local-up depends on auth which is outside the local lane',
      ),
    );
  });

  it('an unknown target on an in-lane project is still rejected ("unexpected target")', () => {
    const entry = { projects: ['platform-deploy'], target: 'deploy' };
    expect(() => classifyLocalUpDependsOnEntry('auth-deploy', entry)).toThrowError(
      /depends on unexpected target "deploy"/u,
    );
  });

  it('a build edge does NOT enter the spine topo (sequence and destroy order unchanged)', () => {
    // Bất biến cấu trúc: build prerequisite KHÔNG tham gia topo — chuỗi dưới
    // là suy thuần từ spine edge (Kahn FIFO ổn định theo thứ tự khai báo):
    // các unit wave-2 chỉ phụ thuộc platform/account nên Kahn cho vào sớm ngay
    // khi dependency của chính nó xong (không đợi cả chuỗi cũ) — hợp lệ topo,
    // deterministic, và destroy là đảo chính xác.
    expect(localUpProjectSequence()).toEqual([
      'platform-deploy',
      'home-deploy',
      'pact-broker-api-deploy',
      'push-notification-deploy',
      'staff-access-deploy',
      'backoffice-deploy',
      'pact-broker-app-deploy',
      'account-deploy',
      'auth-deploy',
      'transactional-mail-deploy',
    ]);
    expect(localDestroyStackOrder()).toEqual([
      'transactional-mail-deploy',
      'auth-deploy',
      'account-deploy',
      'pact-broker-app-deploy',
      'backoffice-deploy',
      'staff-access-deploy',
      'push-notification-deploy',
      'pact-broker-api-deploy',
      'home-deploy',
      'platform-deploy',
    ]);
  });
});

describe('localUpProjectSequence — structural invariants', () => {
  it('platform comes before EVERY unit (single topological sequence)', () => {
    const sequence = localUpProjectSequence();
    expect(sequence[0]).toBe('platform-deploy');
    const platformIndex = sequence.indexOf('platform-deploy');
    const units = [
      'home-deploy',
      'backoffice-deploy',
      'account-deploy',
      'auth-deploy',
      'pact-broker-api-deploy',
      'pact-broker-app-deploy',
      'transactional-mail-deploy',
      'push-notification-deploy',
    ] as const;
    for (const unit of units) {
      expect(sequence.indexOf(unit)).toBeGreaterThan(platformIndex);
    }
  });

  it('account before auth (bounded-context invariant: owner password role + WIC upstream)', () => {
    const sequence = localUpProjectSequence();
    expect(sequence.indexOf('account-deploy')).toBeLessThan(sequence.indexOf('auth-deploy'));
  });

  it('wave-2 wiring invariants (pact chain, mail after account, push after platform)', () => {
    const sequence = localUpProjectSequence();
    // pact-app đọc machineToken từ stack pact-api (cross-stack read) — up sau
    // pact-api. pact-api cần network/postgres platform — up sau platform.
    expect(sequence.indexOf('pact-broker-api-deploy')).toBeLessThan(
      sequence.indexOf('pact-broker-app-deploy'),
    );
    // mail đọc mailInternalAuthSecret từ stack account — up sau account.
    expect(sequence.indexOf('account-deploy')).toBeLessThan(
      sequence.indexOf('transactional-mail-deploy'),
    );
  });

  it('sequence agrees with an INDEPENDENT topological sort of the declared dependsOn graph', () => {
    // Spec tự dựng đồ thị từ khai báo thô (đọc file trực tiếp), rồi so với
    // kết quả của module — hai phép tính độc lập cùng kết luận là bằng chứng
    // cấu trúc, không phải snapshot mảng.
    const declared: Record<string, string[]> = {};
    for (const project of LOCAL_LANE_PROJECTS) {
      const deps = readProjectLaneTargets(project)['local-up'].dependsOn ?? [];
      declared[project] = deps
        .map((d) => (typeof d === 'string' ? d : ((d.projects ?? [])[0] ?? '')))
        // Build prerequisite là entry target "build" (project app ngoài lane)
        // — KHÔNG phải spine edge, không được lọt vào đồ thị tham chiếu này.
        .filter((name, index) => {
          const raw = deps[index];
          return !(typeof raw !== 'string' && raw.target === 'build');
        });
    }
    const expected = specTopoSequence(declared, [...LOCAL_LANE_PROJECTS]);
    expect(localUpProjectSequence()).toEqual(expected);
    expect(expected).toHaveLength(10);
  });

  it('covers exactly the ten local stacks — destroy must not inherit a silently smaller set', () => {
    expect([...LOCAL_LANE_PROJECTS]).toEqual([
      'platform-deploy',
      'home-deploy',
      'backoffice-deploy',
      'account-deploy',
      'auth-deploy',
      'pact-broker-api-deploy',
      'pact-broker-app-deploy',
      'transactional-mail-deploy',
      'push-notification-deploy',
      'staff-access-deploy',
    ]);
  });
});

describe('localDeployTaskSequence — legacy parity and wave-2 extension', () => {
  it('task sequence maps the legacy 8-step mirror onto a pure local-up/local-smoke spine', async () => {
    // Import muộn để song song hoá rõ hai nguồn: DEPLOY_STEPS (bản hard-coded)
    // và task sequence (dẫn xuất từ khai báo Nx). Hai step read-outputs +
    // update-env gộp vào task platform local-up (step up tự ghi .env) — chuỗi
    // task chỉ còn local-up của 9 stack + local-smoke cuối.
    const { DEPLOY_STEPS, STEP_TO_TASK } = await import('./local-deploy.js');
    const tasks = localDeployTaskSequence().map((t) => `${t.project}:${t.target}`);

    const mapped = DEPLOY_STEPS.map((step) => STEP_TO_TASK[step]);
    expect(mapped).toHaveLength(8);
    expect(tasks).toHaveLength(11); // 10 local-up + 1 local-smoke
    expect(tasks[0]).toBe(mapped[0]); // platform-up
    // Không task trung gian nào giữa platform-up và các unit — mọi task là
    // local-up, trừ smoke CUỐI.
    for (const task of tasks.slice(0, -1)) {
      expect(task.endsWith(':local-up')).toBe(true);
    }
    // Chuỗi cũ giữ nguyên thứ tự tương đối trong chuỗi mới (subsequence).
    const legacyUnits = [mapped[3], mapped[4], mapped[5], mapped[6]]; // home → backoffice → account → auth
    let cursor = 1;
    for (const legacyTask of legacyUnits) {
      const found = tasks.indexOf(legacyTask, cursor);
      expect(found).toBeGreaterThan(cursor - 1);
      cursor = found + 1;
    }
    // Bốn unit wave-2 đủ mặt trong chuỗi.
    for (const wave2 of [
      'pact-broker-api-deploy:local-up',
      'pact-broker-app-deploy:local-up',
      'transactional-mail-deploy:local-up',
      'push-notification-deploy:local-up',
    ]) {
      expect(tasks).toContain(wave2);
    }
    expect(tasks[tasks.length - 1]).toBe('platform-deploy:local-smoke'); // smoke vẫn CUỐI
    // Bất biến chính vẫn được chứng minh trên chuỗi mới: account trước auth.
    expect(tasks.indexOf('account-deploy:local-up')).toBeLessThan(
      tasks.indexOf('auth-deploy:local-up'),
    );
  });

  it('platform local-up is first, no local-env task exists, local-smoke is last', () => {
    const tasks = localDeployTaskSequence();
    expect(tasks[0]).toEqual({ project: 'platform-deploy', target: 'local-up' });
    expect(tasks.some((t) => t.target === ('local-env' as never))).toBe(false);
    expect(tasks[tasks.length - 1]).toEqual({ project: 'platform-deploy', target: 'local-smoke' });
  });

  it('skipSmoke variant drops the smoke task only', async () => {
    const { buildNxOrchestrationPlan } = await import('./local-deploy.js');
    const withSmoke = buildNxOrchestrationPlan();
    const withoutSmoke = buildNxOrchestrationPlan({ skipSmoke: true });
    expect(withSmoke.taskSequence.at(-1)).toBe('platform-deploy:local-smoke');
    expect(withoutSmoke.taskSequence).not.toContain('platform-deploy:local-smoke');
    expect(withoutSmoke.taskSequence).toHaveLength(withSmoke.taskSequence.length - 1);
    // Lệnh run-many vẫn khoá đúng tập project/target sau khi lọc smoke.
    expect(withoutSmoke.args).toContain('-c');
    expect(withoutSmoke.args[withoutSmoke.args.indexOf('-c') + 1]).toBe('local');
  });
});

describe('localDestroyStackOrder — reverse dependency order', () => {
  it('destroys dependents first and platform LAST (wave-2 units → staff-access → auth → account → backoffice → home → platform)', () => {
    expect(localDestroyStackOrder()).toEqual([
      'transactional-mail-deploy',
      'auth-deploy',
      'account-deploy',
      'pact-broker-app-deploy',
      'backoffice-deploy',
      'staff-access-deploy',
      'push-notification-deploy',
      'pact-broker-api-deploy',
      'home-deploy',
      'platform-deploy',
    ]);
  });

  it('is exactly the reverse of the up sequence — one source of order, two directions', () => {
    const up = localUpProjectSequence();
    const down = localDestroyStackOrder();
    // target es2022 không có toReversed: copy rồi đảo tại chỗ.
    const upReversed = up.slice();
    upReversed.reverse();
    expect(down).toEqual(upReversed);
  });
});

describe('local lane safety — single configuration, never cacheable', () => {
  it('every lane target exposes ONLY the "local" configuration (no staging/production lane)', () => {
    for (const project of LOCAL_LANE_PROJECTS) {
      expect(localLaneConfigurationNames(project)).toEqual(['local']);
    }
  });

  it('nx.json targetDefaults keep every local-* target out of the cache', () => {
    const nxJson = JSON.parse(readFileSync(join(ROOT_DIR, 'nx.json'), 'utf8')) as {
      targetDefaults: Record<string, Array<{ cache?: boolean }>>;
    };
    for (const target of ['local-up', 'local-smoke']) {
      const defaults = nxJson.targetDefaults[target];
      expect(Array.isArray(defaults), `${target} must have targetDefaults`).toBe(true);
      for (const entry of defaults ?? []) {
        expect(entry.cache, `${target} must never be cacheable (side-effecting)`).toBe(false);
      }
    }
    // Target `local-env` không còn tồn tại — targetDefaults cũng phải không giữ
    // entry chết cho nó.
    expect(nxJson.targetDefaults['local-env']).toBeUndefined();
  });

  it('nx.json does NOT attach dependsOn to local-up (order lives in project declarations)', () => {
    const nxJson = JSON.parse(readFileSync(join(ROOT_DIR, 'nx.json'), 'utf8')) as {
      targetDefaults: Record<string, Array<{ dependsOn?: unknown }>>;
    };
    for (const entry of nxJson.targetDefaults['local-up'] ?? []) {
      expect(entry.dependsOn).toBeUndefined();
    }
  });
});

describe('readProjectLaneTargets — fail-closed on broken declarations', () => {
  it('throws LocalLaneGraphError when a lane target is missing', () => {
    // Project ngoài danh sách lane không có target local → module phải ném lỗi
    // tường minh (không trả về spec rỗng cho caller "đoán" tiếp). Fixture phải
    // là project KHÔNG khai `local-up`: wave 2 (#264) đã đưa
    // `push-notification-deploy` vào lane (có `local-up`), nên fixture chuyển
    // sang `transactional-mailer-job-deploy` — deploy project ngoài lane không
    // có target `local-up` (runtime của nó là worker thứ hai trong WIC của
    // transactional-mail-deploy).
    expect(() => readProjectLaneTargets('transactional-mailer-job-deploy')).toThrowError(
      new LocalLaneGraphError(
        'transactional-mailer-job-deploy is missing target local-up — the Nx declaration is the source of truth for local lane order',
      ),
    );
  });
});
