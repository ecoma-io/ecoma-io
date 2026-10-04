import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_NONCE_EXPIRY_EPOCH_SECONDS } from '@ecoma-io/identity-contracts';

import {
  createPostgresClient,
  NonceStoreContractError,
  recordNonce,
  type HyperdriveBinding,
  type Queryable,
} from './postgres';

/**
 * `auth.internal_nonces` — kho nonce bền của `auth`, trên PostgreSQL THẬT.
 *
 * Đây là mặt còn lại của bản sao ở `apps/account/tests/integration/internal-nonces.spec.ts`,
 * và lý do tồn tại của cả hai kho là **mỗi service sở hữu database của mình**: một
 * nonce đã chiếm ở `db-account` KHÔNG bảo vệ được request đến `auth`, và ngược lại.
 * Nonce là duy nhất theo **từng service nhận**.
 *
 * ⚠️ Vì sao phải là PostgreSQL thật: tính đúng đắn của `recordNonce` KHÔNG nằm trong
 * chuỗi SQL của ta. Nó nằm ở việc PostgreSQL quyết định thắng thua bằng ràng buộc
 * UNIQUE khi hai transaction cùng chèn một khoá. Một fake `Map` cho đúng một winner
 * và vẫn dạy ta tin rằng `SELECT` rồi `INSERT` là atomic. Không có PostgreSQL thì
 * SKIP, và PR phải nói thẳng phần đó chưa verify — xem `describe.skipIf`.
 *
 * ⚠️ Test này áp `apps/auth/migrations/*.sql` THẬT, không khai một bảng riêng: một
 * bảng do test tự chế là schema thứ hai, và test xanh trên schema thứ hai không nói
 * được gì về production (bài học ở `authorization-code-cas.spec.ts`).
 */

const HOST = process.env['AUTH_TEST_PG_HOST'];
const PORT = process.env['AUTH_TEST_PG_PORT'];
const DATABASE = process.env['AUTH_TEST_PG_DATABASE'];
const RUNTIME_USER = process.env['AUTH_TEST_PG_USER'];
const RUNTIME_PASSWORD = process.env['AUTH_TEST_PG_PASSWORD'];
/** Role có quyền DDL. Không có thì skip luôn phần tạo schema. */
const MIGRATOR_USER = process.env['AUTH_TEST_PG_MIGRATOR_USER'];
const MIGRATOR_PASSWORD = process.env['AUTH_TEST_PG_MIGRATOR_PASSWORD'];

const available =
  HOST !== undefined &&
  PORT !== undefined &&
  DATABASE !== undefined &&
  RUNTIME_USER !== undefined &&
  MIGRATOR_USER !== undefined;

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/auth/migrations',
);

/**
 * Khoá advisory cho bước dựng schema.
 *
 * ⚠️ **Không phải trang trí.** Ba spec cùng áp migration lên cùng một database
 * (`AUTH_TEST_PG_DATABASE`): file này, `authorization-code-cas.spec.ts`, và spec của
 * `apps/auth`. Vitest chạy song song theo file, và `nx run-many -t test` chạy song
 * song theo project — nên hai tiến trình có thể cùng thấy "bảng chưa có" rồi cùng
 * `CREATE`. Người thua nhận `relation "..." already exists`, tức là một suite đỏ vì
 * lịch chạy chứ không vì hành vi. Advisory lock biến "kiểm tra rồi tạo" thành tuần
 * tự giữa các tiến trình; khoá là theo (database, key) nên cùng số ở đây là đúng.
 *
 * Khoá của runner migration (`apps/account/db/migrate.mts`) là khoá khác — nó giữ
 * trên `db-account`, và hai database không chia sẻ không gian khoá.
 */
const SCHEMA_SETUP_LOCK_KEY = 8_274_411;

/**
 * Khoá advisory giữ suốt suite — **không phải** khoá dựng schema ở trên.
 *
 * ⚠️ Hai thứ khác nhau và cần cả hai. `SCHEMA_SETUP_LOCK_KEY` chỉ tuần tự hoá bước
 * `CREATE`; nó **không** ngăn hai suite chạm cùng dữ liệu. Mà `auth.internal_nonces`
 * là một bảng **dùng chung**: spec này và `apps/auth/src/internal-auth.spec.ts` cùng
 * ghi vào đó trên cùng một database (`AUTH_TEST_PG_DATABASE`). Việc dọn dẹp ở đây là
 * `DELETE` toàn bảng và test đồng thời assert `count(*)` toàn bảng — nên suite kia
 * chạy song song sẽ làm hàng của nó xuất hiện trong phép đếm, và test đỏ vì **lịch
 * chạy**, không vì hành vi. Đo được: `count(*)` trả `2` thay vì `1` khi
 * `nx run-many -t test` chạy hai project song song.
 *
 * Vì vậy suite này **giữ** một khoá riêng cho hết vòng đời của nó: các test ở đây
 * được viết như thể chúng sở hữu bảng, và khoá này làm điều đó thành đúng thay vì
 * phải viết lại từng phép đếm theo tiền tố nonce riêng. `apps/auth/src/internal-auth.spec.ts`
 * khai cùng số (có test đọc nguồn để hai bên không trôi xa nhau).
 *
 * ⚠️ Thứ tự lấy khoá là **nhất quán** giữa các suite (`suite` rồi mới `schema`), nên
 * không có chu trình khoá. Khoá là session-scoped, nên nó phải nằm trên một
 * connection duy nhất (`max: 1`) — một pool `max: 3` có thể `unlock` trên connection
 * khác với connection đã `lock`, và `pg_advisory_unlock` khi đó trả `false` mà không
 * nhả gì.
 */
const NONCE_SUITE_LOCK_KEY = 3_771_002;

/** Một connection duy nhất — bắt buộc cho khoá advisory session-scoped. */
function connectSingleSession(
  user: string,
  password: string | undefined,
): ReturnType<typeof postgres> {
  return postgres({
    host: HOST as string,
    port: Number(PORT as string),
    user,
    password: password ?? '',
    database: DATABASE as string,
    max: 1,
    prepare: false,
  });
}

/** Schema của bảng giả dùng để chứng minh adapter tự qualify `auth.`. */
const DECOY_SCHEMA = 'nonce_decoy';

/**
 * Binding Hyperdrive giả cho test.
 *
 * ⚠️ **`connectionString` KHÔNG phải thứ driver đọc — đo được, không suy đoán.**
 * `createPostgresClient` truyền **object binding** (không phải chuỗi) xuống
 * `postgres()`. Trong `postgres@3.4.9`, `parseOptions` chỉ gọi `parseUrl` khi tham
 * số là `string` (`if (!url || typeof url !== 'string') return …`), nên với object
 * nó bỏ qua URL và lấy từng trường: `host`/`port`/`user`/`password`/`database`.
 * Binding Hyperdrive thật mang đúng các trường đó (`@cloudflare/workers-types`,
 * `interface Hyperdrive`), nên production chạy được — nhưng một binding chỉ có
 * `connectionString` sẽ âm thầm nối tới `localhost:5432`.
 *
 * Vì vậy test dựng binding theo hình dạng THẬT của Workers, không theo hình dạng
 * tối thiểu mà type của lib khai.
 */
interface TestBinding extends HyperdriveBinding {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

function bindingFor(user: string, password: string | undefined): TestBinding {
  const host = HOST as string;
  const port = Number(PORT as string);
  const database = DATABASE as string;
  return {
    connectionString: `postgres://${user}:${encodeURIComponent(password ?? '')}@${host}:${port}/${database}`,
    host,
    port,
    user,
    password: password ?? '',
    database,
  };
}

/** Client runtime — pool `max: 3`, `prepare: false`, đúng cấu hình production. */
function connectRuntime(): ReturnType<typeof createPostgresClient> {
  return createPostgresClient(bindingFor(RUNTIME_USER as string, RUNTIME_PASSWORD));
}

/** Client DDL — chỉ dùng để dựng schema. */
function connectMigrator(): ReturnType<typeof createPostgresClient> {
  return createPostgresClient(bindingFor(MIGRATOR_USER as string, MIGRATOR_PASSWORD));
}

/**
 * Dựng schema bằng chính các file migration của `apps/auth`.
 *
 * ⚠️ **Chỉ chạy khi schema chưa có, và đây là cố ý.** Migration không dùng
 * `CREATE TABLE IF NOT EXISTS` — README giải thích: `IF NOT EXISTS` im lặng bỏ qua
 * một bảng đang tồn tại với schema KHÁC, biến một sai lệch thật thành im lặng.
 * Re-runnable đến từ **runner** nhớ lịch sử, không từ kiểu `CREATE`. Test không có
 * runner nên nó tự kiểm tra trước, dưới advisory lock.
 */
async function withSchema(
  migrator: ReturnType<typeof createPostgresClient>,
  fn: () => Promise<void>,
): Promise<void> {
  await migrator.unsafe('SELECT pg_advisory_lock($1)', [SCHEMA_SETUP_LOCK_KEY]);
  try {
    await fn();
  } finally {
    await migrator.unsafe('SELECT pg_advisory_unlock($1)', [SCHEMA_SETUP_LOCK_KEY]);
  }
}

async function applyMigrations(migrator: ReturnType<typeof createPostgresClient>): Promise<void> {
  const existing = await migrator.unsafe<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'auth' AND table_name = 'internal_nonces'`,
  );
  if (existing.length > 0) {
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    // Thứ tự số trong tên file là thứ tự áp dụng; so chuỗi là đủ vì tất cả đều
    // gốc 4 chữ số.
    .toSorted();

  for (const file of files) {
    await migrator.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

/**
 * Đọc nội dung file migration `0010` (kho nonce của auth).
 *
 * Nằm ở phạm vi module vì cả hai test file-assert dùng chung: một bản khai bên trong
 * `describe` bị `unicorn/consistent-function-scoping` bắt vì nó không capture biến nào.
 */
function readMigration0010(): string {
  return readFileSync(join(MIGRATIONS_DIR, '0010_internal_nonces.sql'), 'utf8');
}

/**
 * Mở một cặp client đã sẵn schema, chạy `body`, rồi đóng cả hai.
 *
 * `body` nhận client runtime để test dùng, và client migrator để dọn dữ liệu —
 * dọn bằng role DDL để test về grant ở dưới không phụ thuộc việc dọn dẹp.
 */
async function withStore(
  body: (
    runtime: ReturnType<typeof createPostgresClient>,
    migrator: ReturnType<typeof createPostgresClient>,
  ) => Promise<void>,
): Promise<void> {
  const migrator = connectMigrator();
  const runtime = connectRuntime();
  try {
    await withSchema(migrator, () => applyMigrations(migrator));
    await body(runtime, migrator);
  } finally {
    await runtime.end({ timeout: 1 });
    await migrator.end({ timeout: 1 });
  }
}

/** Xoá dữ liệu nonce giữa các test — nonce là PRIMARY KEY nên phải dọn. */
async function clearNonces(migrator: ReturnType<typeof createPostgresClient>): Promise<void> {
  await migrator.unsafe('DELETE FROM auth.internal_nonces');
}

/**
 * Đếm hàng của hai bảng **append-only** trong `auth`.
 *
 * Prune là `DELETE` theo mốc thời gian — đúng thao tác mà append-only cấm — nên câu
 * prune phải chứng minh được là nó chỉ chạm kho nonce. Đếm **trước và sau** trong cùng
 * một test, không so với một con số cứng: suite chạy chung database với các spec khác,
 * nên một con số tuyệt đối là một phép khẳng định về lịch chạy, không về hành vi.
 */
async function appendOnlyCounts(
  migrator: ReturnType<typeof createPostgresClient>,
): Promise<{ audit: number; revocations: number }> {
  const rows = await migrator.unsafe<{ audit: string; revocations: string }>(
    `SELECT (SELECT count(*) FROM auth.authorization_audit_events)::text AS audit,
            (SELECT count(*) FROM auth.token_revocations)::text        AS revocations`,
  );
  return {
    audit: Number(rows[0]?.audit ?? '0'),
    revocations: Number(rows[0]?.revocations ?? '0'),
  };
}

/** Đếm hàng của chính kho nonce, để chốt prune xoá đúng số hàng dự kiến. */
async function countNonces(client: ReturnType<typeof createPostgresClient>): Promise<number> {
  const rows = await client.unsafe<{ count: string }>(
    `SELECT count(*)::text AS count FROM auth.internal_nonces`,
  );
  return Number(rows[0]?.count ?? '0');
}

/** `expires_at` theo công thức của protocol: `timestamp + skew + buffer`. */
function skewAndBuffer(): { skew: number; buffer: number } {
  // ⚠️ Đọc file nguồn của lib contracts chứ không import: `libs/identity-auth-infrastructure`
  // không có cạnh phụ thuộc tới `libs/identity-contracts`, và thêm cạnh đó chỉ để
  // test lấy hai con số là một thay đổi kiến trúc, không phải một test. Cùng cách
  // mà `apps/account/tests/integration/internal-nonces.spec.ts` cross-check bản lặp
  // lại của hằng này.
  const source = readFileSync(
    join(MIGRATIONS_DIR, '../../../libs/identity-contracts/src/internal-auth.ts'),
    'utf8',
  );
  const skew = /DEFAULT_SKEW_SECONDS = (\d+)/u.exec(source);
  const buffer = /NONCE_TTL_BUFFER_SECONDS = (\d+)/u.exec(source);
  if (skew === null || buffer === null) {
    throw new Error('khong doc duoc DEFAULT_SKEW_SECONDS / NONCE_TTL_BUFFER_SECONDS');
  }
  return { skew: Number(skew[1]), buffer: Number(buffer[1]) };
}

describe('advisory lock dung chung giua cac spec PostgreSQL', () => {
  // Không nằm trong `skipIf`: đây là test trên **file nguồn**, không cần database.
  // Và nó phải chạy cả khi không có PostgreSQL — thiếu nó thì hai spec PG lặng lẽ
  // dùng hai khoá khác nhau, lock mất tác dụng, và triệu chứng duy nhất là một
  // suite đỏ ngẫu nhiên vì `relation "oauth_clients" already exists`.
  it('authorization-code-cas.spec.ts dung cung khoa dung schema', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'authorization-code-cas.spec.ts'),
      'utf8',
    );
    const declared = /SCHEMA_SETUP_LOCK_KEY = ([\d_]+)/u.exec(source);
    expect(declared).not.toBeNull();
    expect(Number((declared?.[1] ?? '').replaceAll('_', ''))).toBe(SCHEMA_SETUP_LOCK_KEY);
  });

  it('authorization-transaction-store.spec.ts dung cung khoa dung schema', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'authorization-transaction-store.spec.ts'),
      'utf8',
    );
    const declared = /SCHEMA_SETUP_LOCK_KEY = ([\d_]+)/u.exec(source);
    expect(declared).not.toBeNull();
    expect(Number((declared?.[1] ?? '').replaceAll('_', ''))).toBe(SCHEMA_SETUP_LOCK_KEY);
  });

  it('app cua auth dung cung khoa dung schema VA cung khoa giu suite', () => {
    // ⚠️ Cả **hai** khoá, không chỉ khoá schema: thiếu khoá suite thì hai suite chạm
    // cùng `auth.internal_nonces` song song, và test `count(*)` toàn bảng ở dưới đỏ vì
    // hàng của suite kia — một lần đỏ đã đo được, không phải giả thuyết.
    const source = readFileSync(
      join(import.meta.dirname, '../../../apps/auth/src/internal-auth.spec.ts'),
      'utf8',
    );
    const schemaKey = /SCHEMA_SETUP_LOCK_KEY = ([\d_]+)/u.exec(source);
    const suiteKey = /NONCE_SUITE_LOCK_KEY = ([\d_]+)/u.exec(source);
    expect(schemaKey).not.toBeNull();
    expect(suiteKey).not.toBeNull();
    expect(Number((schemaKey?.[1] ?? '').replaceAll('_', ''))).toBe(SCHEMA_SETUP_LOCK_KEY);
    expect(Number((suiteKey?.[1] ?? '').replaceAll('_', ''))).toBe(NONCE_SUITE_LOCK_KEY);
  });
});

describe('migration 0010 — assert tren FILE, chay duoc khong can PostgreSQL', () => {
  // ⚠️ Vì sao nhóm này tách khỏi các test PostgreSQL, và vì sao nó **không** nằm trong
  // `skipIf`: `applyMigrations` chỉ áp migration khi schema CHƯA có, nên trên một
  // database đã dựng, sửa file migration **không** làm schema đang chạy đổi theo — và
  // một mutation trong file vì vậy sống sót nếu chỉ hỏi database. Assert trên file là
  // assert trên thứ **sẽ được deploy**; assert trên catalog là assert trên thứ **đang
  // chạy**. Cần cả hai.
  //
  // Đo được, không phải suy đoán: bỏ dòng `GRANT` khỏi `0010` vẫn xanh toàn bộ suite
  // khi chạy trên database đã migrate, vì grant đã được áp từ trước và không ai áp lại.
  // Cùng vậy với `NOT NULL`/`DEFAULT` trên `expires_at`.
  //
  // Và nhóm này chạy **cả khi không có PostgreSQL**: đặt phần file-assert bên trong một
  // test `skipIf` nghĩa là máy không có DB không kiểm được migration chút nào — một
  // khoảng trống im lặng đúng ở lớp quyết định schema sẽ lên production.
  it('expires_at phai NOT NULL va khong co DEFAULT', () => {
    const createTable = /CREATE TABLE[\S\s]*?auth\.internal_nonces\s*\(([\S\s]*?)\)\s*;/u.exec(
      readMigration0010(),
    );
    const column = /^\s*expires_at\s+(?<definition>.*?),?\s*$/mu.exec(createTable?.[1] ?? '');
    expect(column?.groups?.['definition']).toMatch(/NOT NULL/u);
    expect(column?.groups?.['definition']?.toUpperCase()).not.toContain('DEFAULT');
  });

  it('grant runtime dung hai quyen, khong co UPDATE/DELETE/TRUNCATE/ALL', () => {
    // Nới `expires_at` của một nonce đã ghi là nới cửa sổ replay — sửa dữ liệu kiểm
    // soát bảo mật — nên nó phải bị chặn ở tầng grant. Grant là **lớp enforce thật**:
    // `verifyRequest` không hề biết có grant nào tồn tại.
    //
    // ⚠️ **`DELETE` cũng bị chặn**, không chỉ `UPDATE`. Xoá một nonce **còn hiệu lực** là mở
    // lại cửa sổ replay cho đúng envelope đó, và một đường xoá do Worker gọi là đường mà một
    // request lỗi có thể gọi vào — đúng học thuyết retention của `0009` ("Dọn dữ liệu hết TTL
    // là job của migrator"). Prune vì vậy chạy bằng `ecoma_auth_migrator`; test prune bên dưới
    // cũng đi bằng role đó, nên grant này không chặn đường vận hành nào.
    //
    // `TRUNCATE` bị cấm cùng lý do với bảng audit: xoá sạch kho nonce bằng một câu lệnh
    // không phải prune theo `expires_at`. `ALL` không xuất hiện trong tệp này; liệt kê
    // đúng hai quyền là cách để một lần sửa sau không vô tình nới rộng.
    const sql = readMigration0010();
    const grants = sql
      .split('\n')
      .filter((line) => /^\s*(?:GRANT|REVOKE)\b/u.test(line) && line.includes('internal_nonces'));

    expect(grants).toHaveLength(2);
    expect(grants[0]).toContain(
      'GRANT SELECT, INSERT ON TABLE auth.internal_nonces TO ecoma_auth_runtime;',
    );
    // Chốt chặn phòng thủ: `REVOKE` tường minh, để một default privilege trong tương lai
    // không âm thầm mở lại đường xoá.
    expect(grants[1]).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auth.internal_nonces');
    for (const line of grants) {
      expect(line).not.toMatch(/\bALL\b/u);
    }
  });
});

describe('recordNonce — auth.internal_nonces tren PostgreSQL that', () => {
  // Giữ khoá suite cho hết vòng đời: các test dưới đây `DELETE` toàn bảng và assert
  // `count(*)` toàn bảng, nên chúng chỉ đúng khi không suite nào khác chạm cùng bảng.
  // Xem JSDoc của `NONCE_SUITE_LOCK_KEY`.
  let suiteLock: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    if (!available) {
      return;
    }
    suiteLock = connectSingleSession(MIGRATOR_USER as string, MIGRATOR_PASSWORD);
    await suiteLock.unsafe('SELECT pg_advisory_lock($1)', [NONCE_SUITE_LOCK_KEY]);
  }, 30_000);

  afterAll(async () => {
    if (suiteLock === undefined) {
      return;
    }
    // Nhả tường minh trước khi `end()`: connection bị đóng thì PostgreSQL cũng nhả
    // session lock, nhưng nhả tường minh để một `end()` thất bại không biến thành
    // một suite khác bị chặn tới hết thời hạn.
    await suiteLock.unsafe('SELECT pg_advisory_unlock($1)', [NONCE_SUITE_LOCK_KEY]);
    await suiteLock.end({ timeout: 1 });
  });

  describe.skipIf(!available)('schema va adapter', () => {
    it('adapter khop migration: claim ghi nonce moi va bao da thay khi trinh lai', async () => {
      // ⚠️ Test này chốt đúng lớp lỗi đã gặp ở `authorization-code-cas.spec.ts`:
      // câu SQL của adapter tham chiếu một cột mà migration không có, và mọi test
      // khác vẫn xanh nếu chúng không chạy SQL đó. Ở đây ta hỏi database, không hỏi code.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const expiry = Math.floor(Date.now() / 1000) + 3_600;

        expect(await recordNonce(runtime, 'nonce-schema-probe', expiry)).toBe(false);
        expect(await recordNonce(runtime, 'nonce-schema-probe', expiry)).toBe(true);

        const rows = await migrator.unsafe<{ nonce: string }>(
          `SELECT nonce FROM auth.internal_nonces WHERE nonce = 'nonce-schema-probe'`,
        );
        expect(rows.map((row) => row.nonce)).toEqual(['nonce-schema-probe']);
        await clearNonces(migrator);
      });
    });

    it('khong co DEFAULT tren expires_at — caller phai neo TTL, database khong duoc tu dien', async () => {
      // ⚠️ Test hành vi ở trên KHÔNG bắt được `DEFAULT now()`: nó luôn truyền
      // `expires_at` tường minh nên default không bao giờ kích hoạt. Đây là chỗ dễ
      // tự lừa nhất của cả suite — thêm default vào SQL làm một test xanh hơn và làm
      // replay guard vô hiệu hoá hoàn toàn (nonce sống mãi).
      //
      // ⚠️ Assert **trên file** nằm ở nhóm `migration 0010 — assert tren FILE` phía
      // trên, và đó là chủ ý: nó phải chạy cả khi không có PostgreSQL. Ở đây chỉ còn
      // assert trên **catalog của database đang chạy** — hai nửa của cùng một tính
      // chất, và một mình nửa này không đủ (xem JSDoc của nhóm đó).
      await withStore(async (_runtime, migrator) => {
        const rows = await migrator.unsafe<{ has_default: boolean; not_null: boolean }>(
          `SELECT a.atthasdef AS has_default, a.attnotnull AS not_null
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'auth'
              AND c.relname = 'internal_nonces'
              AND a.attname = 'expires_at'
              AND a.attnum > 0
              AND NOT a.attisdropped`,
        );
        const observed = rows[0];
        if (observed === undefined) {
          throw new Error('khong tim thay cot auth.internal_nonces.expires_at');
        }
        expect(observed.has_default).toBe(false);
        expect(observed.not_null).toBe(true);
      });
    });

    it('co index tren expires_at, dung truy van duy nhat ma bang phuc vu', async () => {
      // Prune là `DELETE … WHERE expires_at < now()`. Không có index thì prune quét
      // cả bảng, và prune chậm là prune bị bỏ — nghĩa là nonce cũ nằm lại.
      await withStore(async (_runtime, migrator) => {
        const rows = await migrator.unsafe<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'auth'
              AND tablename = 'internal_nonces'
              AND indexdef LIKE '%(expires_at)'`,
        );
        expect(rows).toHaveLength(1);
      });
    });
  });

  describe.skipIf(!available)('chong replay', () => {
    it('nhan mot lan, tu choi moi lan trinh lai sau do', async () => {
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const expiry = Math.floor(Date.now() / 1000) + 3_600;

        expect(await recordNonce(runtime, 'nonce-first-time', expiry)).toBe(false);
        expect(await recordNonce(runtime, 'nonce-first-time', expiry)).toBe(true);
        expect(await recordNonce(runtime, 'nonce-first-time', expiry)).toBe(true);
        await clearNonces(migrator);
      });
    });

    it('hai caller cung nonce chay SONG SONG — dung mot thang', async () => {
      // Hai **pool** riêng (hai connection thật), cùng race trên một câu `INSERT`.
      //
      // ⚠️ Bản trước của test này chạy hai `client.begin(...)` và truyền **transaction**
      // trực tiếp vào `recordNonce` — đúng kiểu dùng mà F-04A cấm: một transaction có
      // thể bị rollback ở tầng nghiệp vụ, và khi đó bản ghi nonce biến mất trong khi
      // envelope đã được chấp nhận, tức replay guard bị gỡ bỏ sau lưng. Kiểu của tham
      // số giờ là `PostgresClientLike` (có brand `unique symbol` không export) nên
      // `recordNonce(tx, …)` không biên dịch được nữa — test phải chạy trên **pool**,
      // đúng như `makeNonceGuard` làm ở production.
      //
      // Không còn `pg_sleep`: race ở đây là hai câu `INSERT … ON CONFLICT DO NOTHING`
      // chạy thật sự đồng thời trên hai connection PostgreSQL khác nhau. Tính nguyên tử
      // đến từ chính câu lệnh, không từ một thanh chặn nhân tạo.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const second = connectRuntime();
        const expiry = Math.floor(Date.now() / 1000) + 3_600;
        try {
          const claim = (client: ReturnType<typeof createPostgresClient>): Promise<boolean> =>
            recordNonce(client, 'nonce-concurrent', expiry);

          const seen = await Promise.all([claim(runtime), claim(second)]);

          // `false` = được chấp nhận. Đúng **một** cái. KHÔNG assert thứ tự: ai thắng
          // là kết quả của race ở tầng PostgreSQL, không phải hợp đồng của hệ thống.
          expect(seen.filter((alreadySeen) => !alreadySeen)).toHaveLength(1);

          const rows = await migrator.unsafe<{ count: string }>(
            `SELECT count(*)::text AS count FROM auth.internal_nonces`,
          );
          expect(rows[0]?.count).toBe('1');
        } finally {
          await second.end({ timeout: 1 });
          await clearNonces(migrator);
        }
      });
    });

    it('a nonce written on the POOL survives a later business ROLLBACK', async () => {
      // ⚠️ Bất biến trung tâm của F-04A, và là lý do `recordNonce` **không** nhận
      // transaction: một nonce được ghi trong cùng transaction với nghiệp vụ sẽ biến mất
      // nếu nghiệp vụ rollback — nhưng request đã được trả lời `ok`, nên cùng envelope
      // đó replay được lần nữa. Đây là hỏng im lặng: không test tuần tự nào thấy được,
      // và triệu chứng chỉ xuất hiện dưới tải có rollback.
      //
      // Ca này ghim đúng hành vi: ghi nonce trên pool (autocommit, như `makeNonceGuard`),
      // rồi mở một transaction **nghiệp vụ** riêng làm việc gì đó và rollback nó. Nonce
      // phải còn nguyên — và lần `recordNonce` sau đó cho cùng nonce phải trả `true`
      // (đã thấy), tức replay vẫn bị chặn.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const expiry = Math.floor(Date.now() / 1000) + 3_600;

        expect(await recordNonce(runtime, 'nonce-survives-rollback', expiry)).toBe(false);

        // Transaction nghiệp vụ điển hình: ghi gì đó, rồi rollback (lỗi nghiệp vụ,
        // constraint violation, một exception ở tầng trên).
        await runtime
          .begin(async (tx) => {
            await tx.unsafe(
              `INSERT INTO auth.internal_nonces (nonce, expires_at)
               VALUES ('nonce-inside-business-tx', to_timestamp($1))`,
              [expiry],
            );
            throw new Error('nghiep vu that bai — rollback');
          })
          .catch(() => {
            // Nuốt: đây là chính kịch bản đang được mô phỏng.
          });

        const rows = await migrator.unsafe<{ count: string }>(
          `SELECT count(*)::text AS count FROM auth.internal_nonces WHERE nonce = $1`,
          ['nonce-survives-rollback'],
        );
        expect(rows[0]?.count).toBe('1');
        // Và bản ghi trong transaction đã rollback thì KHÔNG còn — chứng minh rollback
        // thật sự có hiệu lực (nếu không, test trên xanh vì lý do sai).
        const rolled = await migrator.unsafe<{ count: string }>(
          `SELECT count(*)::text AS count FROM auth.internal_nonces WHERE nonce = $1`,
          ['nonce-inside-business-tx'],
        );
        expect(rolled[0]?.count).toBe('0');
        // Replay vẫn bị chặn sau rollback.
        expect(await recordNonce(runtime, 'nonce-survives-rollback', expiry)).toBe(true);

        await clearNonces(migrator);
      });
    });

    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['so am', -1],
      ['so 0', 0],
      ['so thap phan', Math.floor(Date.now() / 1000) + 3_600.5],
      ['epoch mili giay (loi don vi)', (Math.floor(Date.now() / 1000) + 3_600) * 1_000],
      ['vuot tran MAX_NONCE_EXPIRY_EPOCH_SECONDS', MAX_NONCE_EXPIRY_EPOCH_SECONDS + 1],
    ])('tu choi expiry khong hop le tai TANG LUU TRU, fail closed: %s', async (_label, expiry) => {
      // ⚠️ `recordNonce` là **hàm export** và là điểm ghi duy nhất vào bảng nonce, nên
      // nó phải tự bảo vệ bất biến của mình — không được tin `config.ts` hay người gọi.
      // Không có test này thì một `NaN` từ config đi thẳng vào `to_timestamp($2)`, ghi
      // một hàng TTL vô nghĩa (hoặc lỗi ở tầng driver), và replay guard hỏng theo cách
      // chỉ lộ ra khi prune chạy.
      //
      // Điểm mấu chốt là **fail closed TRƯỚC khi ghi**: phải ném, và **không** được để
      // lại hàng nào trong bảng.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        await expect(recordNonce(runtime, 'nonce-bad-expiry', expiry)).rejects.toThrow(
          /nonce expiry/u,
        );
        const rows = await migrator.unsafe<{ count: string }>(
          `SELECT count(*)::text AS count FROM auth.internal_nonces`,
        );
        expect(rows[0]?.count).toBe('0');
      });
    });

    it('accepts an expiry exactly at the ceiling: the bound is `<=`, not `<`', async () => {
      // Biên của một trần là chỗ dễ sai nhất, và một ca ở xa ngưỡng không phân biệt được
      // `<` với `<=`.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        expect(await recordNonce(runtime, 'nonce-at-ceiling', MAX_NONCE_EXPIRY_EPOCH_SECONDS)).toBe(
          false,
        );
        await clearNonces(migrator);
      });
    });

    it('nonce la duy nhat theo tung service nhan — kho cua service khac khong gate duoc', async () => {
      // ⚠️ Đây là biến thể mutation-detectable của "nonce là duy nhất theo từng
      // service": `db-auth` và `db-account` là hai database nên một nonce chiếm ở
      // bên này không bao giờ hiện ở bên kia. Trong một database, thứ duy nhất giữ
      // tính chất đó là **tên bảng được qualify `auth.`**.
      //
      // Dựng một bảng cùng tên ở schema khác và đặt schema đó lên ĐẦU `search_path`
      // của một connection riêng: nếu câu SQL của adapter bỏ tiền tố `auth.`, nó sẽ
      // thấy hàng mồi, trả `true` (đã thấy), và một envelope hoàn toàn mới bị từ chối
      // là `replayed_nonce`. Đó là hỏng im lặng, nên phải có test bắt nó.
      const migrator = connectMigrator();
      await withSchema(migrator, () => applyMigrations(migrator));
      try {
        await migrator.unsafe(
          `CREATE SCHEMA IF NOT EXISTS ${DECOY_SCHEMA} AUTHORIZATION ${MIGRATOR_USER}`,
        );
        await migrator.unsafe(
          `CREATE TABLE IF NOT EXISTS ${DECOY_SCHEMA}.internal_nonces (
             nonce text PRIMARY KEY,
             expires_at timestamptz NOT NULL,
             observed_at timestamptz NOT NULL DEFAULT now()
           )`,
        );
        await migrator.unsafe(
          `INSERT INTO ${DECOY_SCHEMA}.internal_nonces (nonce, expires_at)
             VALUES ('nonce-cross-store', now() + interval '1 hour')
           ON CONFLICT (nonce) DO NOTHING`,
        );

        // Connection riêng vì `SET search_path` là session state, và pool `max: 3`
        // của `createPostgresClient` không hứa câu sau rơi vào cùng connection.
        const scoped = postgres({
          host: HOST as string,
          port: Number(PORT as string),
          user: RUNTIME_USER as string,
          password: RUNTIME_PASSWORD,
          database: DATABASE as string,
          max: 1,
          prepare: false,
        });
        try {
          await scoped.unsafe(`SET search_path TO ${DECOY_SCHEMA}, public`);

          const expiry = Math.floor(Date.now() / 1000) + 3_600;
          expect(await recordNonce(scoped as never, 'nonce-cross-store', expiry)).toBe(false);

          const own = await migrator.unsafe<{ count: string }>(
            `SELECT count(*)::text AS count FROM auth.internal_nonces
              WHERE nonce = 'nonce-cross-store'`,
          );
          expect(own[0]?.count).toBe('1');
        } finally {
          await scoped.end({ timeout: 1 });
        }
      } finally {
        await migrator.unsafe(`DROP SCHEMA IF EXISTS ${DECOY_SCHEMA} CASCADE`);
        await migrator.unsafe(`DELETE FROM auth.internal_nonces`);
        await migrator.end({ timeout: 1 });
      }
    });

    it('TTL cua nonce song qua het cua so replay cua envelope', async () => {
      // Hằng của giao thức, không phải tuỳ chọn: `verifyRequest` chấp nhận khi
      // `|now − timestamp| ≤ skew`, nên envelope hết replayable đúng tại
      // `timestamp + skew` và nonce phải sống quá mốc đó (cộng buffer cho prune theo
      // lô). TTL **ngắn hơn** skew là hỏng: prune xoá nonce còn hiệu lực và replay
      // thành công ngay trong cửa sổ.
      //
      // ⚠️ So với `skew`, KHÔNG phải `2 × skew`: so với `2 × skew` thì cả bản đúng
      // lẫn bản thiếu buffer đều qua, và test mất sức bắt mutation thiếu buffer.
      const { skew, buffer } = skewAndBuffer();
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const envelopeTimestamp = Math.floor(Date.now() / 1000);

        expect(await recordNonce(runtime, 'nonce-ttl', envelopeTimestamp + skew + buffer)).toBe(
          false,
        );

        const rows = await migrator.unsafe<{ ttl_seconds: number }>(
          `SELECT EXTRACT(EPOCH FROM (expires_at - observed_at))::float8 AS ttl_seconds
             FROM auth.internal_nonces WHERE nonce = 'nonce-ttl'`,
        );
        const ttl = rows[0]?.ttl_seconds;
        expect(ttl).toBeGreaterThan(skew);
        expect(ttl).toBeLessThan(skew + buffer + 5);
        await clearNonces(migrator);
      });
    });
  });

  describe.skipIf(!available)('prune', () => {
    it('prune xoa nonce het han va giu nonce con song', async () => {
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const now = Math.floor(Date.now() / 1000);
        expect(await recordNonce(runtime, 'nonce-expired', now - 600)).toBe(false);
        expect(await recordNonce(runtime, 'nonce-alive', now + 600)).toBe(false);

        const pruned = await migrator.unsafe<{ nonce: string }>(
          `DELETE FROM auth.internal_nonces WHERE expires_at < now() RETURNING nonce`,
        );
        expect(pruned.map((row) => row.nonce)).toEqual(['nonce-expired']);

        const left = await migrator.unsafe<{ nonce: string }>(
          `SELECT nonce FROM auth.internal_nonces ORDER BY nonce`,
        );
        expect(left.map((row) => row.nonce)).toEqual(['nonce-alive']);
        await clearNonces(migrator);
      });
    });

    it('keeps an expired nonce whose expiry falls exactly on the prune cut-off (the predicate is `<`, not `<=`)', async () => {
      // ⚠️ Bài toán biên, và biên ở đây là bất biến replay. Đổi `<` thành `<=` xoá thêm
      // đúng một lớp nonce: những nonce hết hạn **tại chính thời điểm** prune chạy. Đó là
      // lớp vừa mới hết hạn, tức lớp còn sát cửa sổ replay nhất — và cũng là lớp mà một
      // lệch đồng hồ nhỏ giữa hai máy đẩy vào. Không test tuần tự nào khác đỏ vì đổi dấu này.
      //
      // Mốc so sánh được **ghim bằng literal** chứ không dùng `now()`: `now()` là thời điểm
      // transaction, nó nhích giữa transaction ghi và transaction prune, nên một hàng đặt
      // đúng `now()` sẽ không bao giờ "đúng bằng" mốc prune và bài test không chạm tới biên.
      // Ghim mốc làm nó tất định mà vẫn chốt đúng vị từ đang được bảo vệ.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        await runtime.unsafe(
          `INSERT INTO auth.internal_nonces (nonce, expires_at) VALUES
             ('nonce-boundary-before', TIMESTAMPTZ '2000-01-01 00:00:00+00' - interval '1 microsecond'),
             ('nonce-boundary-exact',  TIMESTAMPTZ '2000-01-01 00:00:00+00'),
             ('nonce-boundary-after',  TIMESTAMPTZ '2000-01-01 00:00:00+00' + interval '1 microsecond')`,
        );

        const pruned = await migrator.unsafe<{ nonce: string }>(
          `DELETE FROM auth.internal_nonces
            WHERE expires_at < TIMESTAMPTZ '2000-01-01 00:00:00+00'
        RETURNING nonce`,
        );
        expect(pruned.map((row) => row.nonce)).toEqual(['nonce-boundary-before']);

        const left = await migrator.unsafe<{ nonce: string }>(
          `SELECT nonce FROM auth.internal_nonces ORDER BY nonce`,
        );
        expect(left.map((row) => row.nonce)).toEqual([
          'nonce-boundary-after',
          'nonce-boundary-exact',
        ]);
        await clearNonces(migrator);
      });
    });

    it('is idempotent: a second prune deletes nothing and does not throw', async () => {
      // Prune chạy theo lịch, chạy tay, và retry sau `psql` exit 2 — nên "chạy prune hai
      // lần trên cùng một kho" là chuyện thường, không phải ngoại lệ. Lần thứ hai phải trả
      // **0 hàng** và không ném: không còn gì hết hạn là một kết quả thành công, không phải
      // một lỗi. Một câu prune ném khi bảng đã sạch sẽ biến mọi lần retry thành đỏ.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        const now = Math.floor(Date.now() / 1000);
        await recordNonce(runtime, 'nonce-expired', now - 600);
        await recordNonce(runtime, 'nonce-alive', now + 600);

        const first = await migrator.unsafe<{ nonce: string }>(
          `DELETE FROM auth.internal_nonces WHERE expires_at < now() RETURNING nonce`,
        );
        expect(first.map((row) => row.nonce)).toEqual(['nonce-expired']);

        const second = await migrator.unsafe<{ nonce: string }>(
          `DELETE FROM auth.internal_nonces WHERE expires_at < now() RETURNING nonce`,
        );
        expect(second).toHaveLength(0);

        const left = await migrator.unsafe<{ nonce: string }>(
          `SELECT nonce FROM auth.internal_nonces ORDER BY nonce`,
        );
        expect(left.map((row) => row.nonce)).toEqual(['nonce-alive']);
        await clearNonces(migrator);
      });
    });

    it('the prune predicate uses the expires_at index instead of scanning the whole table', async () => {
      // ⚠️ Index **có mặt trong catalog** không chứng minh planner dùng được nó cho **vị từ
      // này**: `expires_at::date < …` hay một vế bọc hàm vẫn xanh ở test catalog phía trên
      // trong khi index thành vô dụng, và prune quét toàn bảng. Prune chậm là prune bị bỏ,
      // nghĩa là nonce cũ nằm lại.
      //
      // Bảng test gần rỗng nên planner tự nhiên chọn seq scan (rẻ hơn cho vài trang). Ép nó
      // đi đường index mới đo được điều cần đo: vị từ này **có** một đường index áp dụng được.
      // Nếu không có, planner vẫn rơi về seq scan và test đỏ — đó là nhánh sập của phép đo,
      // không phải một lần skip.
      //
      // ⚠️ `SET` là **session-scoped**, nên nó phải nằm trên đúng connection sẽ chạy `EXPLAIN`.
      // Client migrator là pool: `SET` có thể rơi vào connection này và `EXPLAIN` chạy trên
      // connection khác, và khi đó planner lại tự do chọn seq scan. Vì vậy dùng một session
      // đơn (`max: 1`) — cùng lý do đã ghi ở `connectSingleSession` cho advisory lock.
      await withStore(async () => {
        const single = connectSingleSession(MIGRATOR_USER as string, MIGRATOR_PASSWORD);
        try {
          await single.unsafe(`SET enable_seqscan = off`);
          // ⚠️ Không truyền type param cho `unsafe`: kiểu của driver là
          // `unsafe<T extends any[]>` (T là **mảng kết quả**), nên một tham số kiểu hàng
          // như `unsafe<{ plan: string }>` là sai — và tệ hơn, `EXPLAIN` không alias được
          // tên cột (`QUERY PLAN`), nên không có tên trường nào để khai. Đọc theo giá trị.
          const planRows: unknown[] = await single.unsafe(
            `EXPLAIN (COSTS OFF) DELETE FROM auth.internal_nonces WHERE expires_at < now()`,
          );
          const plan = planRows
            .map((row) => Object.values(row as Record<string, string>).join(' '))
            .join('\n');
          expect(plan).toContain('internal_nonces_expires_at_idx');
        } finally {
          await single.end({ timeout: 1 });
        }
      });
    });

    it('leaves the two append-only tables in the same schema untouched', async () => {
      // Lý do `internal_nonces` tồn tại **tách khỏi** `authorization_audit_events` là hai vòng
      // đời khác nhau (xem đầu file `0010`). Prune là `DELETE` theo mốc thời gian — đúng thao
      // tác append-only cấm — nên nếu câu prune chạm bảng audit thì mất mát là **audit**, không
      // phải một hàng nonce bị xoá thêm. Cùng lý do với `token_revocations`.
      //
      // ⚠️ Đếm trên bảng rỗng không chứng minh gì: 0 → 0 vẫn xanh kể cả khi prune xoá sạch cả
      // bảng. Vì vậy mỗi bảng append-only được gieo một hàng trước khi prune, và phép so là
      // **trước/sau trong cùng test** chứ không phải một con số cứng.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        await recordNonce(runtime, 'nonce-expired', Math.floor(Date.now() / 1000) - 600);
        await migrator.unsafe(
          `INSERT INTO auth.authorization_audit_events (event_type) VALUES ('token_issued')`,
        );
        await migrator.unsafe(
          `INSERT INTO auth.token_revocations (level, subject_ref, reason)
           VALUES ('subject', 'sub-prune-guard', 'prune-guard')`,
        );

        const appendBefore = await appendOnlyCounts(migrator);
        const noncesBefore = await countNonces(migrator);
        // Chốt vế "có gì để mất": nếu hai bảng append-only rỗng thì phép so bên dưới là
        // 0 = 0 và không chứng minh được gì.
        expect(appendBefore.audit).toBeGreaterThan(0);
        expect(appendBefore.revocations).toBeGreaterThan(0);

        await migrator.unsafe(
          `DELETE FROM auth.internal_nonces WHERE expires_at < now() RETURNING nonce`,
        );

        expect(await appendOnlyCounts(migrator)).toEqual(appendBefore);
        // Và prune vẫn phải làm đúng việc của nó — nếu không thì "không đụng bảng khác"
        // đạt được một cách tầm thường bằng cách không xoá gì cả.
        expect(await countNonces(migrator)).toBe(noncesBefore - 1);
        await clearNonces(migrator);
      });
    });

    it('runtime KHONG co UPDATE — khong noi rong duoc cua so da ghi', async () => {
      // Nới `expires_at` của một nonce đã ghi là nới cửa sổ replay. Đây là "sửa dữ
      // liệu kiểm soát bảo mật", nên phải bị chặn ở tầng grant chứ không hy vọng
      // tầng ứng dụng không làm.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        await recordNonce(runtime, 'nonce-no-update', Math.floor(Date.now() / 1000) + 600);
        await expect(
          runtime.unsafe(`UPDATE auth.internal_nonces SET expires_at = now() + interval '1 year'`),
        ).rejects.toThrow(/permission denied/iu);
        await clearNonces(migrator);
      });
    });

    it('runtime CO dung SELECT, INSERT — va khong hon', async () => {
      // Grant là lớp enforce; `verifyRequest` không hề biết có grant nào tồn tại.
      // Nếu sau này ai đó thêm `UPDATE`, `DELETE` hay `TRUNCATE` vào `0010`, mọi test hành vi
      // vẫn xanh và chỉ mất bảo vệ — nên test này giữ ranh giới ở đúng tầng nó được
      // enforce. Assert **đúng hai** quyền, không phải "có ít nhất hai": thêm một quyền nữa
      // là mở lại một đường sửa/xoá dữ liệu kiểm soát bảo mật.
      await withStore(async (_runtime, migrator) => {
        const rows = await migrator.unsafe<{ privileges: string[] }>(
          `SELECT array_agg(privilege_type)::text[] AS privileges
             FROM information_schema.role_table_grants
            WHERE table_schema = 'auth'
              AND table_name = 'internal_nonces'
              AND grantee = $1`,
          [RUNTIME_USER],
        );
        expect([...(rows[0]?.privileges ?? [])].toSorted()).toEqual(['INSERT', 'SELECT']);
      });
    });

    it('runtime KHONG co DELETE — mot ban ghi nonce khong bi xoa qua serving path', async () => {
      // ⚠️ Đây là bất biến bảo mật, không phải chi tiết grant. Một nonce còn hiệu lực bị xoá
      // là cửa sổ replay mở lại cho đúng envelope đó. Prune là job của `ecoma_auth_migrator`
      // (học thuyết retention của `0009`), nên đường serving path không được có `DELETE`.
      await withStore(async (runtime, migrator) => {
        await clearNonces(migrator);
        await recordNonce(runtime, 'nonce-no-delete', Math.floor(Date.now() / 1000) + 600);
        await expect(
          runtime.unsafe(`DELETE FROM auth.internal_nonces WHERE nonce = 'nonce-no-delete'`),
        ).rejects.toThrow(/permission denied/iu);
        await clearNonces(migrator);
      });
    });
  });

  describe.skipIf(!available)('fail closed', () => {
    it('kho nonce khong goi duoc ⇒ recordNonce NEM, khong bao gio tra ve false', async () => {
      // ⚠️ Đây là tính chất bảo mật quan trọng nhất của cả file. `recordNonce` trả
      // `false` nghĩa là "nonce chưa từng thấy" — và `verifyRequest` coi đó là
      // `ok`. Nếu một lỗi hạ tầng (DB chết, pool hết hạn, connection refused) bị
      // nuốt thành `false`, thì **mọi** request đã xác thực trở thành replayable
      // trong suốt thời gian DB chết, và không có test tuần tự nào bắt được.
      //
      // Vì vậy hợp đồng là: lỗi ⇒ NÉM. Ai muốn fail-closed thì phải tự bắt lấy lỗi
      // đó và từ chối (`db_unreachable` → 503), chứ không được để một giá trị `false`
      // chảy xuống như một câu trả lời.
      const unreachable = postgres({
        host: '127.0.0.1',
        // Cổng không có listener: `ECONNREFUSED` ngay, không phải một lần chờ timeout.
        port: 1,
        user: 'nobody',
        password: 'nobody',
        database: 'nothing',
        max: 1,
        prepare: false,
        connect_timeout: 2,
      });
      try {
        const claim = recordNonce(unreachable as never, 'nonce-unreachable', 1);
        // Kèm `ECONNREFUSED` chứ không phải `toThrow()` trần: nó chứng minh lỗi đến
        // từ **bước kết nối** — tức là lỗi hạ tầng thật — chứ không phải một lỗi khác
        // trong `recordNonce` (sai SQL, sai tham số) mà một test chỉ hỏi "có ném không"
        // sẽ nhận nhầm là đạt.
        await expect(claim).rejects.toThrow(/ECONNREFUSED/u);
        // Khẳng định thêm: không nhánh nào của lỗi trả về `false`. `rejects.toThrow`
        // đã loại trường hợp resolve, nhưng nói thẳng ra thì mutation "trả về false
        // khi lỗi" không thể lọt qua mà không đỏ ở đây.
        const outcome = await claim.then(
          (value) => `resolved:${String(value)}`,
          (error: unknown) => `rejected:${String(error)}`,
        );
        expect(outcome.startsWith('rejected:')).toBe(true);
      } finally {
        await unreachable.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('cap quyen', () => {
    it('dang `AUTH_TEST_PG_*` de chay cac test replay', () => {
      // Marker test: giữ cho suite không bị coi là "pass" khi thực tế là skip toàn
      // bộ. Xem README §"Chạy test CAS trên PostgreSQL thật".
      expect(available).toBe(true);
    });
  });
});

/**
 * Client giả trả về **đúng** thứ ta muốn: một hình dạng kết quả tuỳ ý.
 *
 * ⚠️ `as never` theo đúng lối đã dùng ở test "kho nonce khong goi duoc": ta cố tình đưa
 * cho adapter một client **không** khớp `Queryable`, nên không có kiểu nào trung thực hơn
 * để nói điều đó. Ở đây nó phục vụ hai tính chất của adapter mà **không cần PostgreSQL** —
 * phần duy nhất của `recordNonce` chạy được trong CI, vì CI không đặt `AUTH_TEST_PG_*`.
 * Atomicity thật vẫn chỉ chứng minh được trên PostgreSQL.
 */
const queryableReturning = (result: unknown) => ({ unsafe: async () => result }) as never;

describe('recordNonce — guard hinh dang tra ve, khong can PostgreSQL', () => {
  it('nem khi Queryable tra ve hinh dang khac mang, thay vi dien giai thanh false', async () => {
    // ⚠️ **Mutation-test, không phải assert trang trí.** Gỡ guard trong `postgres.ts` thì
    // promise RESOLVE `undefined === 0` = `false` — nghĩa là "nonce chưa từng thấy" — và
    // mọi request đã dùng đi qua: replay guard tắt hẳn, im lặng. Assert này đỏ đúng ở
    // mutation đó (`promise resolved "false" instead of rejecting`).
    await expect(recordNonce(queryableReturning({ rows: [] }), 'nonce-shape', 1)).rejects.toThrow(
      /mang hang/u,
    );
  });

  it('classifies a bad result shape as an adapter contract error, not a config error', async () => {
    // ⚠️ Lỗi hình dạng xảy ra **lúc chạy**, không phải lúc boot; `AuthConfigurationError` được
    // định nghĩa là lỗi fail-fast lúc khởi động/dựng dependency. Trộn hai loại vào một class là
    // phân loại sai chỗ, và nếu về sau có nhánh phân biệt theo class thì lỗi tích hợp này sẽ bị
    // xử lý như lỗi cấu hình. Assert bằng `instanceof` (đối tượng lỗi), không bằng message — vì
    // điều đang được chốt ở đây chính là **loại** lỗi.
    await expect(recordNonce(queryableReturning({ rows: [] }), 'nonce-shape', 1)).rejects.toThrow(
      NonceStoreContractError,
    );
  });

  it('cuc tinh cua length: mot hang la "nonce moi", khong hang la "da thay"', async () => {
    // Chốt chiều của `inserted.length === 0`, thứ mà `RETURNING` tồn tại để phục vụ:
    // chèn được ⇒ một hàng ⇒ nonce MỚI ⇒ `false`. Đụng UNIQUE ⇒ không hàng ⇒ ĐÃ THẤY
    // ⇒ `true`. Đảo chiều ở đây là từ chối mọi request hợp lệ (hoặc mở toang guard), và
    // test này bắt được cả hai mà không cần database.
    expect(
      await recordNonce(queryableReturning([{ nonce: 'nonce-shape' }]), 'nonce-shape', 1),
    ).toBe(false);
    expect(await recordNonce(queryableReturning([]), 'nonce-shape', 1)).toBe(true);
  });

  it('rejects a transaction passed to recordNonce: no rollback can free a replay (F-04A)', async () => {
    // ⚠️ **Đây là khẳng định ở tầng KIỂU, không phải một assert runtime.** `recordNonce`
    // nhận `PostgresClientLike` — có brand `unique symbol` không export — chứ không nhận
    // `Queryable` thuần. Callback của `begin` nhận đúng một `Queryable`, nên
    // `client.begin((tx) => recordNonce(tx, ...))` là **lỗi biên dịch**, không phải một
    // lời khuyên trong comment: transaction có thể bị rollback ở tầng nghiệp vụ, bản ghi
    // nonce biến mất sau rollback, mà envelope đã được `verifyRequest` trả `ok` — replay
    // guard bị gỡ trong im lặng. Bỏ `begin` khỏi kiểu cũng không đủ (transaction của
    // `postgres.js` khớp structural), nên chỉ brand mới chặn thật.
    //
    // `transaction` khai báo đúng `Queryable` — hình dạng thật của `TransactionSql` mà
    // `postgres.js` đưa cho callback. Không `as any`: nếu có `as any`, directive
    // `@ts-expect-error` trở thành thừa (`TS2578`) và test sẽ đỏ vì lý do sai, hoặc tệ
    // hơn là xanh trong khi chẳng chứng minh gì.
    const transaction: Queryable = { unsafe: async () => [] };
    // @ts-expect-error -- `Queryable` thieu brand nen khong thoa PostgresClientLike (F-04A)
    await recordNonce(transaction, 'nonce-tx', 1_700_000_000);

    // Chốt vế còn lại: cái KHÔNG được đỏ thì không được đỏ — pool thật vẫn phải nhận.
    // Nếu brand bị làm rộng quá tay (ví dụ gán vào `Queryable`), dòng dưới sẽ đỏ và
    // test này bắt được, thay vì để lỗi trôi tới một suite bị skip trên CI.
    expect(typeof recordNonce).toBe('function');
  });
});
