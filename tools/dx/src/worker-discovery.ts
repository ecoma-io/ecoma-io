/**
 * Discovery-based worker registry (PR6, issue #68).
 *
 * Nguồn sự thật duy nhất là wrangler.jsonc committed trong từng `apps/` dir
 * (PR3 đã chốt: committed config là source of truth của binding definitions).
 * Thay vì ghim cứng entry list cho từng service (PR4 `MAIL_WORKER_ENTRIES`
 * chỉ là hai entry của mail pair), scan repo → suy topology → boot
 * topological. App mới vào runtime khi tự khai `wrangler.jsonc` + marker
 * `local-worker.jsonc` — không phải sửa `tools/dx` (opt-in tường minh, xem
 * "Opt-in marker" dưới).
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
 * - **Readiness**: KHÔNG suy đoán. Mỗi app khai tường minh trong marker file
 *   `local-worker.jsonc` (xem dưới) — `readiness: 'http-health'` (poll
 *   `GET /health`) hoặc `'log-banner'` (banner `Ready on http` của wrangler
 *   dev). Sai/giá trị lạ → fail-loud với path cụ thể, không boot.
 *
 * ## Opt-in marker `apps/<dir>/local-worker.jsonc`
 *
 * Không phải mọi `wrangler.jsonc` là một Worker local runtime: Nuxt/Nitro app
 * (`account`, `backoffice`, `home`, `pact-broker-app`) cũng khai wrangler config
 * cho deploy production nhưng local của chúng chạy Docker/Traefik, không qua
 * `wrangler dev` — quét mù mọi `wrangler.jsonc` sẽ nhốt các app đó vào một
 * readiness `http-health` không bao giờ đạt (OCR bug-high trên PR #69). Vì vậy
 * việc tham gia local runtime là OPT-IN: app khai marker file mới được scanned.
 * Marker chứa readiness declaration duy nhất (một field, hai giá trị hợp lệ)
 * — KHÔNG suy từ `workers_dev` hay `queues.consumers` nữa: `transactional-mailer
 * -job` KHÔNG khai `workers_dev` trong config committed (undefined, không phải
 * `false`) nên inference cũ làm worker queue-only bị poll `/health` 60s timeout
 * (OCR bug-critical trên PR #69). Opt-out cũng tường minh: xoá marker = rút app
 * khỏi local runtime, thay vì phải sửa `tools/dx`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadCommittedWranglerConfig,
  parseJsonc,
  type CommittedWranglerConfig,
} from './worker-config.js';
import { ROOT_DIR } from './utils.js';

/** Tên marker file opt-in của local worker runtime trong từng `apps/<dir>`. */
export const LOCAL_WORKER_MARKER = 'local-worker.jsonc';

/** Readiness một app khai tường minh trong marker — không suy từ binding nào. */
export type ReadinessDeclaration = 'http-health' | 'log-banner';

/**
 * Đọc marker opt-in `apps/<dir>/local-worker.jsonc` → readiness declaration.
 *
 * Marker phải tồn tại (đã kiểm trước khi gọi) và parse được:
 * `{"readiness": "http-health" | "log-banner"}`. Sai shape hay giá trị lạ →
 * throw với path cụ thể — fail-loud (OCR bug-critical: readiness suy từ
 * `workers_dev`/`queues` khiến app không có `/health` bị poll 60s timeout).
 */
export function loadReadinessDeclaration(markerPath: string): ReadinessDeclaration {
  const marker = parseJsonc(readFileSync(markerPath, 'utf8'));
  if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new Error(
      `local worker marker phải là object: ${markerPath} — "readiness": "http-health" | "log-banner"`,
    );
  }
  // Reject key lạ — marker contract tự khai là "một field, hai giá trị hợp
  // lệ" (readiness declaration duy nhất); chấp nhận ngầm key lạ nuốt intent
  // của tác giả (vd `"path": "/api/health"` tưởng poll path khác) hoặc field
  // copy lẫn từ config wrangler, trái principle no-inference của discovery.
  const unknownKeys = Object.keys(marker as Record<string, unknown>).filter(
    (key) => key !== 'readiness',
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `marker chứa field lạ ở ${markerPath}: ${unknownKeys.join(', ')} — ` +
        'marker chỉ khai "readiness": "http-health" | "log-banner" (no inference)',
    );
  }
  const declared = (marker as Record<string, unknown>).readiness;
  if (declared !== 'http-health' && declared !== 'log-banner') {
    throw new Error(
      `readiness không hợp lệ trong ${markerPath}: '${String(declared)}' — ` +
        'chỉ khai "readiness": "http-health" | "log-banner" (no inference)',
    );
  }
  return declared;
}

/** Entry đã discovered từ một `wrangler.jsonc` + marker opt-in của app đó. */
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
  /** Readiness app KHAI trong marker opt-in — không suy từ config wrangler. */
  readiness: ReadinessDeclaration;
  /** Nhãn ngắn phục vụ report/error. */
  label: string;
}

/**
 * Topological order result: list of entryName in boot order (deps trước) —
 * hoặc lỗi với tập node chưa resolve được (`cyclePath`, xem JSDoc của
 * `kahnTopoSort` về semantics "tập, không phải đường").
 */
export type TopoSortResult = { ok: true; order: string[] } | { ok: false; cyclePath: string[] };

// -------------------------------------------------------------------
// Scanning
// -------------------------------------------------------------------

/**
 * Scan `apps/<dir>` OPT-IN qua marker `local-worker.jsonc` và trả entries theo
 * boot topo-order.
 *
 * Một app THAM GIA local runtime khi và chỉ khi cả hai điều kiện đều đạt:
 *
 * 1. Marker `apps/<dir>/local-worker.jsonc` tồn tại — app khai tường minh nó
 *    muốn chạy qua `wrangler dev` của local runtime. Không marker → app KHÔNG
 *    tham gia (Nuxt app giữ wrangler config cho production deploy nhưng local
 *    của chúng chạy Docker/Traefik — quét mù mọi `wrangler.jsonc` là OCR
 *    bug-high trên PR #69).
 * 2. `wrangler.jsonc` load được (fail-closed validation sẵn của PR3).
 *
 * Config không parse được BỎ QUA (app đó out) chứ không abort toàn bộ — còn
 * dependency lệch sau khi entry được lập thì topo-sort fail-closed ở dưới.
 * Marker sống nhưng config hỏng thì cũng bỏ app đó — nếu đây là lỗi thật thì
 * lỗi hiện rõ khi up (missing service/queue dependency), không phải lúc scan.
 *
 * Thư mục `apps` không tồn tại (đáng ngờ nhưng không phải lỗi chết) — trả về
 * entries rỗng thay vì fail. Lệnh `local-worker-up` cảnh báo trên stderr khi
 * runtime discovered cho ra 0 entry ("no worker apps found" — gần như luôn là
 * misconfig: marker gõ sai tên file, app dir bị rename), và VẪN exit 0: "không
 * có gì sống" là một trạng thái hợp lệ, không phải lỗi process (OCR round-2
 * finding F6).
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
    const appDir = join(appsRoot, dir);
    const markerPath = join(appDir, LOCAL_WORKER_MARKER);
    // (1) Opt-in gate — chỉ app có marker (FILE, không thư mục) được quét
    // tiếp. Lưu ý: topo-sort fail-closed so với TẬP APP ĐÃ OPT-IN, nên
    // producer có trong repo nhưng rút marker (opt-out) sẽ làm consumer fail
    // (orphan queue) — nghĩa này được cố ý: opt-out của một producer là
    // thay đổi topology, cần xoá marker đồng bộ với consumer, không phải
    // rút riêng app một cách im lặng.
    if (!statSync(markerPath, { throwIfNoEntry: false })?.isFile()) continue;
    try {
      // (2) Cấu hình phải load được — hỏng thì app khỏi runtime (fail-closed).
      const committedConfigPath = join(appDir, 'wrangler.jsonc');
      const { config } = loadCommittedWranglerConfig(committedConfigPath);
      // (3) Readiness là DECLARATION trong marker — sai shape/giá trị fail:
      // app này có marker + config load OK nhưng readiness sai vẫn phải ra
      // khỏi danh sách, không fallback ngầm gây readiness timeout
      // (OCR bug-critical).
      const readiness = loadReadinessDeclaration(markerPath);
      entries.push(entryFromCommittedConfig(dir, committedConfigPath, config, readiness));
    } catch (error) {
      // Fail-closed: app out khỏi runtime, không fallback readiness ngầm —
      // nhưng marker tồn tại nghĩa là app chủ động opt-in, nên lý do rơi ra
      // phải quan sát được: stderr warn (path + lý do), không đụng stdout
      // (JSON của `local-worker-status` vẫn parse được).
      console.warn(
        `[local-worker] skip app '${dir}' (${LOCAL_WORKER_MARKER} có nhưng không load được): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
  }
  return topoSortEntries(entries);
}

/**
 * Suy entry từ CommittedWranglerConfig — mọi hình dạng đến đều gọi thẳng
 * `loadCommittedWranglerConfig` (fail-closed sẵn). Readiness truyền vào là
 * declaration đã đọc từ marker (`loadReadinessDeclaration`) — KHÔNG suy từ
 * workers_dev/queues nữa.
 */
function entryFromCommittedConfig(
  appDirName: string,
  committedConfigPath: string,
  config: CommittedWranglerConfig,
  readiness: ReadinessDeclaration,
): DiscoveredWorkerEntry {
  const appDir = join(committedConfigPath, '..');

  // D1 database_name: type khai `string` nhưng `validateCommittedWranglerConfig`
  // không kiểm shape từng entry — thiếu/gõ sai key (vd `databaseName:` camelCase)
  // phải fail-loud ở đây, nếu không sẽ lọt xuống bridge thành `''` rồi app có D1
  // thật bị coi là "không có D1": bước migrations bị nhảy IM LẶNG → app boot
  // trên DB rỗng (`no such table` lúc runtime, khó chẩn đoán) — đúng failure
  // mode mà fail-loud phải chặn (OCR round-2 finding F7).
  const databaseNames = (config.d1_databases ?? []).map((db, index) => {
    // OCR round-4 (F3): phần tử không phải object (null/number/...) phải
    // fail-loud với message rõ — TypeError từ truy cập `.database_name` trên
    // phần tử lạ là dạng lỗi khó chẩn đoán, trái nguyên tắc message tự giải
    // thích của module. Kiểm shape (nếu khai object) rồi mới đọc key.
    if (typeof db !== 'object' || db === null) {
      throw new Error(
        `d1_databases[${index}] của app '${appDirName}' tại ${committedConfigPath} ` +
          `không phải object (nhận ${typeof db}) — topology local không suy ngầm từ shape lạ`,
      );
    }
    if (typeof db.database_name !== 'string' || db.database_name.length === 0) {
      throw new Error(
        `d1_databases[${index}] của app '${appDirName}' thiếu/gõ sai 'database_name' ` +
          `(string không rỗng) tại ${committedConfigPath} — local runtime không suy tên ` +
          'database (no inference)',
      );
    }
    return db.database_name;
  });

  // Queue shape (OCR round-2 finding F9): shape sai của `queues` hiện rơi vào
  // readQueueReferences → trả `[]` NGẦM (fail-OPEN) — deps của consumer rỗng
  // làm orphan-queue guard bị bypass và boot-order thiếu cạnh. Assert tường
  // minh tại đây thay vì nhặt rác: `queues` (nếu khai) phải là object,
  // `producers`/`consumers` (nếu khai) phải là array — message mang path
  // committed config cụ thể.
  if (
    config.queues !== undefined &&
    (config.queues === null || typeof config.queues !== 'object' || Array.isArray(config.queues))
  ) {
    throw new Error(
      `"queues" của app '${appDirName}' tại ${committedConfigPath} phải là object — ` +
        'topology local không suy ngầm từ shape lạ',
    );
  }
  const queues = (config.queues ?? {}) as Record<string, unknown>;
  for (const section of ['producers', 'consumers'] as const) {
    const value = queues[section];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(
        `"queues.${section}" của app '${appDirName}' tại ${committedConfigPath} phải là ` +
          'array — topology local không suy ngầm từ shape lạ',
      );
    }
  }

  // Service deps: `services[].service` đúng như wrangler đọc — tên Worker
  // (từ `name` của config khác, không phải entry name của chúng).
  // OCR round-4 (F4): phần tử null/primitive phải fail-loud (không TypeError
  // opaque, không lọc ngầm phần tử thiếu `service` — deps cụt không báo).
  const services = config.services ?? [];
  const dependsOnServiceNames = services.map((svc, index) => {
    if (typeof svc !== 'object' || svc === null) {
      throw new Error(
        `services[${index}] của app '${appDirName}' tại ${committedConfigPath} không ` +
          `phải object (nhận ${typeof svc}) — topology local không suy ngầm từ shape lạ`,
      );
    }
    const name = (svc as Record<string, unknown>).service;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        `services[${index}] của app '${appDirName}' tại ${committedConfigPath} ` +
          `thiếu/gõ sai 'service' (string không rỗng) — topology local không suy ` +
          'tên peer (no inference)',
      );
    }
    return name;
  });

  // Queue deps: `queues.producers[].queue` — entry này produce,
  // consumers của cùng queue phải boot sau (redelivery qua producer).
  const producesQueues = readQueueReferences(queues.producers, {
    sectionName: 'producers',
    appDirName,
    committedConfigPath,
  });
  const consumesQueues = readQueueReferences(queues.consumers, {
    sectionName: 'consumers',
    appDirName,
    committedConfigPath,
  });

  // Readiness là DECLARATION (truyền từ marker) — comment inference cũ đã
  // sửa: suy từ `workers_dev`/`queues.consumers` làm readiness poll timeout
  // trên config không khai `workers_dev` (OCR bug-critical trên PR #69).
  return {
    entryName: appDirName,
    committedConfigPath,
    appDir,
    workerName: config.name,
    databaseNames,
    dependsOnServiceNames,
    producesQueues,
    consumesQueues,
    readiness,
    label: appDirName,
  };
}

/**
 * Đọc refs của queue producers/consumers — caller đã assert section là array
 * (F9). Chỉ đọc key `queue` chính thức của wrangler config: `exchange` KHÔNG
 * phải key của schema wrangler (là concept AMQP/RabbitMQ) — chấp nhận nó là
 * no-inference violation (OCR round-2 finding F5); config có key sai name thì
 * wrangler dev tự fail validation theo cách rõ, discovery không ăn thay.
 *
 * ⚠️ **OCR round-4 (F2): entry thiếu/sai `queue` phải fail-loud, không lọc ngầm.**
 * Trước đây một entry không phải object, hoặc object thiếu key `queue` (typo
 * `queu`), bị `filter` bỏ qua âm thầm → entry đó không đóng góp queue
 * reference nào → consumer có thể LỌT khỏi orphan-consumer guard và mất cạnh
 * dependency trong topo-sort ⇒ boot sai thứ tự, hoặc consumer boot xong mà
 * không có redelivery. "Không đóng góp" phải là lỗi cấu hình, không phải trạng
 * thái hợp lệ. `sectionName`/`appDirName`/`committedConfigPath` đi vào
 * message để người đọc biết chính xác file và mục sai.
 */
function readQueueReferences(
  section: unknown,
  context: {
    readonly sectionName: string;
    readonly appDirName: string;
    readonly committedConfigPath: string;
  },
): string[] {
  if (!Array.isArray(section)) return [];
  const names = section.map((item: unknown, index: number) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(
        `queues.${context.sectionName}[${index}] của app '${context.appDirName}' tại ` +
          `${context.committedConfigPath} không phải object — topology local không suy ` +
          'ngầm từ shape lạ',
      );
    }
    const name = (item as Record<string, unknown>).queue;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        `queues.${context.sectionName}[${index}] của app '${context.appDirName}' tại ` +
          `${context.committedConfigPath} thiếu/gõ sai 'queue' (string không rỗng) — ` +
          'topology local không suy tên queue (no inference)',
      );
    }
    return name;
  });
  return names;
}

// -------------------------------------------------------------------
// Topological sort
// -------------------------------------------------------------------

/**
 * Topo-sort trên graph: service deps + queue deps (producer trước consumer).
 */
export function topoSortEntries(entries: DiscoveredWorkerEntry[]): DiscoveredWorkerEntry[] {
  // Detections cần entry lập chỉ nhật theo worker name — kiểm TRƯỚC khi map
  // nuốt duplicate (Map set hai key giống nhau là last-wins im lặng, OCR
  // round-2 finding F2): hai app opted-in khai cùng `name` phải fail-loud,
  // tên Worker trùng khiến generated config của hai app ghi đè file generated
  // theo worker name (`sanitizeFileName(workerName).wrangler.jsonc` dùng chung
  // thư mục generated của worktree → process spawn trước bị hot-reload config
  // của app khác) và service binding neo sai peer — cả hai lỗi đều khó chẩn đoán.
  const byWorkerName = new Map<string, DiscoveredWorkerEntry>();
  for (const entry of entries) {
    const existing = byWorkerName.get(entry.workerName);
    if (existing !== undefined) {
      throw new Error(
        `worker name '${entry.workerName}' trùng giữa các app ` +
          `'${existing.entryName}' và '${entry.entryName}' (từ wrangler.jsonc 'name') — ` +
          'generated config sinh theo worker name sẽ ghi đè file của nhau và ' +
          'service binding neo sai peer; mỗi app cần wrangler `name` riêng',
      );
    }
    byWorkerName.set(entry.workerName, entry);
  }
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
        // chiếu một service host không hoạt động ở local runtime (host thật
        // ở production wiring, hoặc peer có trong repo nhưng CHƯA khai marker
        // opt-in). Fail-closed rõ với message nhắc đúng nguyên nhân — người
        // đọc đi tìm marker của peer, không đi tìm wrangler.jsonc tưởng missing.
        throw new Error(
          `app '${entry.entryName}' service binding tới '${serviceName}' — Worker này ` +
            'không trong tập app đã opt-in local runtime; nếu peer có trong repo, ' +
            `peer cần marker ${LOCAL_WORKER_MARKER} trong apps/<dir> để tham gia ` +
            'cùng topology',
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

  // D1 database (OCR round-2 finding F8): `database_name` là định danh của
  // object D1 trong persist dir CHIA SẺ theo worktree — hai app opted-in khai
  // cùng `database_name` là cùng bind MỘT SQLite local (migrations apply đè
  // nhau, hai service đọc/ghi chung data), vi phạm invariant "services own
  // their data" ngay trong local runtime. Fail-closed tương tự orphan queue:
  // copy-paste config phải nổi lên trước boot, không nửa vời.
  const dbOwners = new Map<string, string>();
  for (const entry of entries) {
    for (const databaseName of entry.databaseNames) {
      const owner = dbOwners.get(databaseName);
      if (owner !== undefined && owner !== entry.entryName) {
        throw new Error(
          `d1 database '${databaseName}' được khai bởi nhiều app (${owner}, ${entry.entryName}) — ` +
            'persist dir chia sẻ theo worktree nên hai service sẽ bind chung một DB local ' +
            'và migrations apply chồng nhau; mỗi service cần database_name riêng ' +
            '(services own their data)',
        );
      }
      dbOwners.set(databaseName, entry.entryName);
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
    // `cyclePath` là TẬP node chưa boot được (superset của cycle thật: gồm cả
    // node nằm SAU cycle, in-degree chưa về 0 vì nghe tin từ cycle nhưng
    // không thuộc cycle nào) — message không join ' -> ' mô tả đường tuần tự
    // (OCR round-2 finding F4: người nhận sẽ đi tìm một cycle giữa các node
    // đầu/cuối không tồn tại). Việc derive cycle thật từ sub-graph này là
    // out-of-scope cho round fix này; wording "tập" là trung thực về semantics.
    // Hiển thị theo alphabet từ key của `byEntryName` (đã thứ tự alphabet từ
    // scan) thay vì `.sort()` — rule no-array-sort cấm mutation, message vẫn
    // deterministic.
    const sortedUnresolved = [...byEntryName.keys()].filter((name) =>
      sorted.cyclePath.includes(name),
    );
    throw new Error(
      'dependency cycle giữa các worker apps — các node chưa boot được vì phụ thuộc ' +
        `khép kín (tập, không phải đường cycle): ${sortedUnresolved.join(', ')}`,
    );
  }
  return sorted.order.map((entryName) => byEntryName.get(entryName) as DiscoveredWorkerEntry);
}

/**
 * Kahn's algorithm — trả về order hoặc TẬP node chưa resolve được
 * (`cyclePath`). Tập này là superset của cycle thật: gồm cả node không thuộc
 * cycle nào nhưng vẫn chưa boot được vì in-degree chưa về 0 (đợi một node
 * trong cycle). Không derive cycle thật từ sub-graph còn lại — caller chỉ in
 * tập để người đọc tự tháo phụ thuộc bằng cách config đúng hàng.
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
    // `remaining` là tập node chưa boot được — KHÔNG phải đường cycle tuần tự
    // (gồm cả node đứng sau cycle trong graph). Field giữ tên `cyclePath` cho
    // shape ổn định; caller (và message ở `topoSortEntries`) diễn giải nó là
    // "tập, không phải đường".
    const remaining = nodes.filter((node) => !order.includes(node));
    return { ok: false, cyclePath: remaining };
  }
  return { ok: true, order };
}
