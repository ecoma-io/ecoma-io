/**
 * Discovery-based worker registry (PR6, issue #68).
 *
 * Nguồn sự thật duy nhất là wrangler.jsonc committed trong từng `apps/` dir
 * (PR3 đã chốt: committed config là source of truth của binding definitions).
 * Thay vì ghim cứng entry list cho từng service (PR4 `MAIL_WORKER_ENTRIES`
 * chỉ là hai entry của mail pair), scan repo → suy topology → boot
 * topological. Thêm app mới vào repo = tự động vào local runtime mà không
 * phải sửa `tools/dx`.
 *
 * ## Suy quyết từ committed config
 *
 * - **Entry name**: file metadata dùng tên package short (`apps/<dir>`), KHÔNG
 *   tên Worker `wrangler name` (`ecoma-transactional-mail`) — entry name là
 *   tên file trong stateDir, không dùng tên resource.
 * - **D1 migrations**: `d1_databases[]` — mỗi database một lần
 *   `wrangler d1 migrations apply` trên persist dir chung (database_name là
 *   identifier từ config; `validateDatabaseIdentifier` đã chặn ký tự nguy).
 * - **Dependency graph**: service binding (`services[].service` cần Worker
 *   tên đó SỐNG trước khi bind) và Queue (consumer cần producer cùng queue
 *   để redelivery hoạt động — trên wrangler dev, producer của queue phải có
 *   config rõ ràng; spike §2 evidence). Topo-sort trên graph đó; cycle →
 *   fail với đường cycle rõ ràng, KHÔNG boot nửa vời.
 * - **Readiness**: app có `workers_dev: false` + consumers (queue-only
 *   worker, không fetch handler serving) → banner; còn lại HTTP `/health`.
 *   Trong wrangler dev, mọi Worker đều mở HTTP dev port kể cả queue-only —
 *   banner vẫn hoạt động (stream từ stdout/stderr của process).
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadCommittedWranglerConfig, type CommittedWranglerConfig } from './worker-config.js';
import { ROOT_DIR } from './utils.js';

/** Entry đã discovered từ một `wrangler.jsonc`. */
export interface DiscoveredWorkerEntry {
  /** Entry metadata name (file `<name>.json` trong stateDir). */
  entryName: string;
  /** Đường committed wrangler config tuyệt đối. */
  committedConfigPath: string;
  /** Thư mục app — `cwd` của `wrangler dev` process. */
  appDir: string;
  /** Tên Worker thật từ `name` — phục vụ đoán file generated (status). */
  workerName: string;
  /** D1 `database_name` — migrations apply trên từng database này. */
  databaseNames: string[];
  /**
   * Worker URLs (description: `service` đúng như wrangler `services[].service`)
   * mà entry này binding tới — sẵn sàng để topo-sort.
   */
  dependsOnServiceNames: string[];
  /** Các queue mà entry này PRODUCE — downstream consumer phụ thuộc (boot sau). */
  producesQueues: string[];
  /** Các queue mà entry này CONSUME — producer phải boot trước để redelivery. */
  consumesQueues: string[];
  /** Readiness đã suy: `http-health` cho worker có serving port, banner ngược lại. */
  readiness: 'http-health' | 'log-banner';
  /** Nhãn ngắn phục vụ report/error. */
  label: string;
}

/**
 * Topological order result: list of entryName in boot order (deps trước) —
 * hoặc lỗi cycle với đường cycle cụ thể.
 */
export type TopoSortResult = { ok: true; order: string[] } | { ok: false; cyclePath: string[] };

// -------------------------------------------------------------------
// Scanning
// -------------------------------------------------------------------

/**
 * Scan mọi `apps/<dir>/wrangler.jsonc` và trả entries theo boot topo-order.
 * Config không parse được bị BỎ QUA (app đó không tham gia local runtime)
 * chứ không abort toàn bộ — còn dependency lệch sau khi entry được lập thì
 * topo-sort fail-closed ở dưới.
 *
 * Thư mục `apps` không tồn tại (đáng ngờ nhưng không phải lỗi chết) — trả về
 * entries rỗng thay vì fail, để up command báo "no worker apps found" một
 * cách bình tĩnh thay vì truyền stack trace.
 */
export function discoverWorkerEntries(rootDir?: string): DiscoveredWorkerEntry[] {
  const appsRoot = join(rootDir ?? ROOT_DIR, 'apps');
  let appDirs: string[];
  try {
    appDirs = readdirSync(appsRoot, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const entries: DiscoveredWorkerEntry[] = [];
  // `appDirs` là array mình sở hữu (readdirSync trả mảng mới) nên sort tại
  // chỗ không mutation nào ngoài mong muốn — target es2022 không có toSorted.
  appDirs.sort();
  for (const dir of appDirs) {
    const committedConfigPath = join(appsRoot, dir, 'wrangler.jsonc');
    try {
      const { config } = loadCommittedWranglerConfig(committedConfigPath);
      entries.push(entryFromCommittedConfig(dir, committedConfigPath, config));
    } catch {
      // Config rác (ví dụ wrapper tool app, future scaffolding) — bỏ qua
      // để không chặn boot của các app thật. Chỉ `wrangler.jsonc` tồn
      // tại + parse được mới có nghĩa là app này muốn chạy qua local worker.
      continue;
    }
  }
  return topoSortEntries(entries);
}

/**
 * Suy entry từ CommittedWranglerConfig — mọi hình dạng đến đều gọi thẳng
 * `loadCommittedWranglerConfig` (fail-closed sẵn).
 */
function entryFromCommittedConfig(
  appDirName: string,
  committedConfigPath: string,
  config: CommittedWranglerConfig,
): DiscoveredWorkerEntry {
  const appDir = join(committedConfigPath, '..');
  const d1s = config.d1_databases ?? [];

  // Service deps: `services[].service` đúng như wrangler đọc — tên Worker
  // (từ `name` của config khác, không phải entry name của chúng).
  const services = config.services ?? [];
  const dependsOnServiceNames = services
    .map((svc) => (svc as Record<string, unknown>).service)
    .filter((name): name is string => typeof name === 'string');

  // Queue deps: `queues.producers[].queue` — entry này produce,
  // consumers của cùng queue phải boot sau (redelivery qua producer).
  const queues = config.queues ?? {};
  const producesQueues = readQueueReferences(queues.producers);
  const consumesQueues = readQueueReferences(queues.consumers);

  // Readiness inference:
  // - queue-only worker (consumer bits, workers_dev=false, KHÔNG serving
  //   route cho runtime query) → banner `Ready on http` (case-sensitive);
  // - còn lại → HTTP `/health` poll.
  const hasQueueConsumer = consumesQueues.length > 0;
  const readiness: DiscoveredWorkerEntry['readiness'] =
    hasQueueConsumer && config.workers_dev === false ? 'log-banner' : 'http-health';

  return {
    entryName: appDirName,
    committedConfigPath,
    appDir,
    workerName: config.name,
    databaseNames: d1s.map((db) => db.database_name),
    dependsOnServiceNames,
    producesQueues,
    consumesQueues,
    readiness,
    label: appDirName,
  };
}

/** Đọc refs của queue producers/consumers — `queues` là `Record<string, unknown>`. */
function readQueueReferences(section: unknown): string[] {
  if (!Array.isArray(section)) return [];
  // `exchange` là alias của `queue` trong wrangler config (đều dùng được).
  const names = section.map((item: unknown) =>
    typeof item === 'object' && item !== null
      ? ((item as Record<string, unknown>).queue ?? (item as Record<string, unknown>).exchange)
      : undefined,
  );
  return names.filter((name): name is string => typeof name === 'string');
}

// -------------------------------------------------------------------
// Topological sort
// -------------------------------------------------------------------

/** Topo-sort trên graph: service deps + queue deps (consumer trước producer). */
export function topoSortEntries(entries: DiscoveredWorkerEntry[]): DiscoveredWorkerEntry[] {
  const byWorkerName = new Map(entries.map((entry) => [entry.workerName, entry]));
  const byEntryName = new Map(entries.map((entry) => [entry.entryName, entry]));

  // Edge A: service binding — entry X có dependsOnServiceNames [Y-name] →
  // entry của Y phải boot TRƯỚC. Worker name của entry là `ecoma-<dir>`
  // nên khi match, đối chiếu tên Worker (`ecoma-*`), không phải entry name.
  const deps = new Map<string, Set<string>>();
  const init = (key: string): void => {
    if (!deps.has(key)) deps.set(key, new Set<string>());
  };
  for (const entry of entries) init(entry.entryName);

  for (const entry of entries) {
    for (const serviceName of entry.dependsOnServiceNames) {
      const peer = byWorkerName.get(serviceName);
      if (peer === undefined) {
        // Service binding chỉ vào WORKER CÙNG topology local — app tham
        // chiếu một service host không có trong repo (vd future service)
        // KHÔNG được âm thầm boot trước — fail-closed rõ.
        throw new Error(
          `app '${entry.entryName}' service binding tới '${serviceName}' — Worker này ` +
            'không nằm trong repo scan (apps/<dir>/wrangler.jsonc); local runtime cần Worker đó ' +
            'cùng tồn tại để boot tuần tự',
        );
      }
      init(peer.entryName);
      deps.get(entry.entryName)?.add(peer.entryName);
    }
    // Edge B: queue deps — entry này consume queue Q mà peer P produce:
    // P phải boot trước. Đa consumer cùng queue cũng cùng thế.
    for (const queueName of entry.consumesQueues) {
      for (const peer of entries) {
        if (peer.producesQueues.includes(queueName) && peer.entryName !== entry.entryName) {
          deps.get(entry.entryName)?.add(peer.entryName);
        }
      }
      // Consume queue không được produce bởi bất kỳ app nào trong repo →
      // fail-closed: wrangler dev vẫn chấp nhận config và consumer sẽ boot,
      // nhưng redelivery KHÔNG hoạt động (spike §3 — queue không có producer
      // là boot được nhưng consumer luôn idle). Fail sớm rõ ràng hơn.
    }
  }

  const consumedQueues = new Set(entries.flatMap((e) => e.consumesQueues));
  const producedQueues = new Set(entries.flatMap((e) => e.producesQueues));
  const orphanConsumes = [...consumedQueues].filter((queue) => !producedQueues.has(queue));
  if (orphanConsumes.length > 0) {
    throw new Error(
      'queue consumer không có producer trong repo: ' +
        orphanConsumes
          .map((queue) => {
            const consumers = entries
              .filter((e) => e.consumesQueues.includes(queue))
              .map((e) => e.entryName)
              .join(', ');
            return `${queue} (consumed by ${consumers})`;
          })
          .join('; '),
    );
  }

  const sorted = kahnTopoSort([...byEntryName.keys()], deps);
  if (!sorted.ok) {
    throw new Error(`dependency cycle giữa các worker apps: ${sorted.cyclePath.join(' -> ')}`);
  }
  return sorted.order.map((entryName) => byEntryName.get(entryName) as DiscoveredWorkerEntry);
}

/**
 * Kahn's algorithm — trả về order hoặc cycle path cụ thể để caller in cho
 * người dùng tự tháo khỏi loop bằng cách config đúng hàng.
 */
function kahnTopoSort(nodes: string[], deps: Map<string, Set<string>>): TopoSortResult {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const node of nodes) {
    inDegree.set(node, deps.get(node)?.size ?? 0);
    for (const dep of deps.get(node) ?? new Set<string>()) {
      if (!dependents.has(dep)) dependents.set(dep, new Set<string>());
      dependents.get(dep)?.add(node);
    }
  }

  // next ĐÃ theo thứ tự nodes (alphabet từ scan) — cả hai node đều in-degree 0
  // thì node đứng trước alphabet được boot trước, ra kết quả ổn định: cùng
  // repo, cùng lần chạy, cùng order (yêu cầu determinism của orchestration).
  const next = nodes.filter((node) => (inDegree.get(node) ?? 0) === 0);
  const order: string[] = [];
  // FIFO — shift() node đầu: alphabet-deterministic, an toàn vì nodes không
  // mutated (deps mutation chỉ trên set nội bộ). shift() là O(n) mỗi vòng
  // nhưng số app local là chục — chi phí bỏ qua được.
  while (next.length > 0) {
    const node = next.shift() as string;
    order.push(node);
    for (const dependent of dependents.get(node) ?? new Set<string>()) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) next.push(dependent);
    }
  }

  if (order.length !== nodes.length) {
    const remaining = nodes.filter((node) => !order.includes(node));
    return { ok: false, cyclePath: remaining };
  }
  return { ok: true, order };
}
