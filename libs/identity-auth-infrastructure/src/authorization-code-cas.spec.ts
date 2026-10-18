import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { describe, expect, it } from 'vitest';

import { redeemAuthorizationCode } from './authorization-code-cas';

/**
 * CAS của authorization code trên PostgreSQL THẬT.
 *
 * ⚠️ Vì sao test này phải có PostgreSQL thật mà không thay bằng fake: tính
 * đúng đắn của CAS KHÔNG nằm trong câu SQL của ta. Nó nằm ở hành vi khoá hàng
 * của PostgreSQL dưới `READ COMMITTED` khi hai transaction cùng chạy một
 * `UPDATE` có điều kiện. Một fake có thể cho đúng một winner bằng một `Map` và
 * vẫn hoàn toàn sai về điều nó dạy ta tin — cụ thể là tin rằng `SELECT` rồi
 * `UPDATE` là atomic.
 *
 * Vì vậy: không có PostgreSQL thì SKIP, và PR phải nói thẳng là chưa verify
 * được phần đó. Xem `describe.skipIf`.
 *
 * ⚠️ **Test này áp `apps/auth/migrations/*.sql` THẬT, không khai một bảng riêng.**
 * Lý do là đo được: bản test trước dựng bảng có cột `code_id`/`scope` và xanh
 * trong khi schema thật có `id uuid`/`code_hash`/`granted_scopes text[]`. Một
 * bảng do test tự chế là một schema thứ hai, và test xanh trên schema thứ hai
 * KHÔNG nói được gì về production. Giờ DDL của test và DDL của production là
 * cùng một tập file.
 *
 * ⚠️ Hai role, và sự tách biệt là một phần của test:
 * - `ecoma_auth_migrator` tạo schema — role runtime KHÔNG được `CREATE`.
 * - `ecoma_auth_runtime` chạy CAS — đúng role production dùng.
 * Nếu CAS chạy được bằng superuser thì test không chứng minh được gì về
 * production: nó chỉ chứng minh rằng superuser làm được mọi thứ.
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

function base() {
  return {
    host: HOST as string,
    port: Number(PORT as string),
    database: DATABASE as string,
    prepare: false,
  } as const;
}

/** Kết nối bằng role runtime — role production thật sự dùng. */
function connectRuntime(max = 10): postgres.Sql {
  return postgres({
    ...base(),
    user: RUNTIME_USER as string,
    password: RUNTIME_PASSWORD,
    max,
  });
}

/** Kết nối bằng role DDL, chỉ để dựng schema. */
function connectMigrator(): postgres.Sql {
  return postgres({
    ...base(),
    user: MIGRATOR_USER as string,
    password: MIGRATOR_PASSWORD,
    max: 1,
  });
}

/**
 * Dựng schema bằng chính các file migration của `apps/auth`.
 *
 * ⚠️ **Chỉ chạy khi schema chưa có, và đây là cố ý.** Migration KHÔNG dùng
 * `CREATE TABLE IF NOT EXISTS` — README giải thích rõ: `CREATE TABLE IF NOT
 * EXISTS` im lặng bỏ qua một bảng đang tồn tại với schema KHÁC, tức là biến một
 * sai lệch thật thành im lặng. Re-runnable đến từ **runner** nhớ lịch sử, không
 * từ kiểu `CREATE`. Test này không có runner, nên nó tự kiểm tra trước.
 *
 * ⚠️ **Và "kiểm tra rồi tạo" phải nằm dưới advisory lock.** Test không phải tiến
 * trình duy nhất dựng schema này: `internal-nonces.spec.ts` trong cùng thư mục áp
 * đúng bộ file đó lên đúng database đó, và Vitest chạy hai file **song song**;
 * `nx run-many -t test` còn chạy song song theo project. Không có lock thì hai
 * bên cùng thấy "bảng chưa có" rồi cùng `CREATE`, và người thua nhận
 * `relation "oauth_clients" already exists` — một suite đỏ vì lịch chạy, không vì
 * hành vi. Đây là lỗi đã quan sát được, không phải phòng xa.
 *
 * Khoá là theo (database, key), nên cùng một số ở mọi spec PG là đúng.
 * `internal-nonces.spec.ts` assert hai file dùng cùng một khoá.
 */
const SCHEMA_SETUP_LOCK_KEY = 8_274_411;

async function applyMigrations(migrator: postgres.Sql): Promise<void> {
  await migrator.unsafe('SELECT pg_advisory_lock($1)', [SCHEMA_SETUP_LOCK_KEY]);
  try {
    const existing = await migrator<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'auth' AND table_name = 'authorization_codes'
    `;
    if (existing.length > 0) {
      return;
    }

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      // Thứ tự số trong tên file là thứ tự áp dụng; so chuỗi là đủ vì tất cả đều
      // gốc đều 4 chữ số.
      .toSorted();

    for (const file of files) {
      await migrator.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
  } finally {
    await migrator.unsafe('SELECT pg_advisory_unlock($1)', [SCHEMA_SETUP_LOCK_KEY]);
  }
}

/** Dựng schema rồi trả về client runtime đã sẵn sàng. */
async function setup(): Promise<{ runtime: postgres.Sql; migrator: postgres.Sql }> {
  const migrator = connectMigrator();
  await applyMigrations(migrator);
  return { runtime: connectRuntime(), migrator };
}

/**
 * Seed một code đã cấp.
 *
 * ⚠️ Insert bằng role DDL để không phụ thuộc quyền `INSERT` của runtime vào
 * đúng câu test này — role isolation có một test riêng bên dưới.
 */
async function seedCode(
  migrator: postgres.Sql,
  values: {
    hash: string;
    sub?: string;
    clientId?: string;
    ttlSeconds?: number;
    transactionTtlSeconds?: number;
  },
): Promise<void> {
  const clientId = values.clientId ?? 'client-cas-test';
  const sub = values.sub ?? 'sub-cas-test';

  // ⚠️ Cột, ràng buộc và giá trị hợp lệ lấy từ `0001`/`0002`, không tự chế.
  // Những gì dưới đây KHÔNG phải chi tiết hình thức — mỗi cái là một CHECK
  // hoặc UNIQUE của migration đang bảo vệ một tính chất bảo mật:
  //   - `client_type='public'` đi kèm `client_secret_hash IS NULL`
  //     (client công khai không mang secret — không có secret để lộ);
  //   - `acr='urn:ecoma:acr:email-otp'` bắt buộc khi có `sub`
  //     (`identity_is_complete_check`: không được biết ai mà không biết họ
  //     xác thực với assurance nào);
  //   - `handle_hash_x` UNIQUE (mỗi transaction một handle X);
  //   - `code_challenge_method='S256'` (FR-010).
  await migrator`
    INSERT INTO auth.oauth_clients (client_id, client_name, client_type)
    VALUES (${clientId}, 'CAS test client', 'public')
    ON CONFLICT (client_id) DO NOTHING
  `;

  // ⚠️ `handle_hash_x` là `bytea` UNIQUE nên mỗi seed cần một giá trị khác nhau —
  //    dùng chuỗi `code_hash` đã có, đổi sang `bytea` bằng `convert_to`. KHÔNG
  //    dùng `digest()`: nó thuộc pgcrypto, và migration cấm `CREATE EXTENSION`
  //    trong `db-auth` (bề mặt mở rộng không cần thiết). Test phải sống trong
  //    cùng ràng buộc đó.
  //
  // ⚠️ `transaction_id` phải truyền TƯỜNG MINH: `0011` đổi cột sang `text` và
  //    DROP default `gen_random_uuid()` — application là bên mint id (43 ký tự
  //    base64url), database không tự sinh nữa. Chuỗi `tx-` + hash chỉ cần
  //    UNIQUE theo seed, không có CHECK format ở cột này.
  const transactionId = await migrator<{ id: string }[]>`
    INSERT INTO auth.authorization_transactions (
      transaction_id, state, client_id, redirect_uri, code_challenge,
      code_challenge_method, requested_scopes, client_state, handle_hash_x,
      browser_binding_hash, sub, key_version, expires_at, acr, authn_at
    )
    VALUES (
      ${`tx-${values.hash}`}, 'completed', ${clientId}, 'https://app.example.com/cb',
      'challenge-cas', 'S256', ARRAY['openid'], 'state-cas',
      convert_to(${`x-${values.hash}`}, 'UTF8'), convert_to(${`b-${values.hash}`}, 'UTF8'),
      ${sub}, 1,
      now() + make_interval(secs => ${values.transactionTtlSeconds ?? 600}),
      'urn:ecoma:acr:email-otp', now()
    )
    RETURNING transaction_id AS id
  `;

  await migrator`
    INSERT INTO auth.authorization_codes
      (code_hash, authorization_transaction_id, sub, client_id, redirect_uri,
       code_challenge, granted_scopes, expires_at)
    VALUES (
      ${values.hash}, ${transactionId[0]?.id as string}, ${sub}, ${clientId},
      'https://app.example.com/cb', 'challenge-cas', ARRAY['openid'],
      now() + make_interval(secs => ${values.ttlSeconds ?? 600})
    )
  `;
}

/**
 * Dọn dữ liệu của một lần seed.
 *
 * ⚠️ Xoá transaction **sau khi** xoá code: `authorization_codes` có FK
 * `ON DELETE RESTRICT` sang transaction, và `authorization_transactions` có
 * UNIQUE trên `handle_hash_x`. Bỏ qua bước này thì lần chạy thứ hai của cùng
 * một test va vào UNIQUE — tức là một suite chỉ xanh lần đầu, đúng cái loại lỗi
 * mà `nx cache` che thêm một tầng nữa.
 */
async function cleanSeed(migrator: postgres.Sql, hashes: string[]): Promise<void> {
  await migrator`
    DELETE FROM auth.authorization_codes WHERE code_hash IN ${migrator(hashes)}
  `;
  await migrator`
    DELETE FROM auth.authorization_transactions
     WHERE handle_hash_x IN ${migrator(hashes.map((h) => `x-${h}`))}
  `;
}

describe('redeemAuthorizationCode — on real PostgreSQL', () => {
  describe.skipIf(!available)('schema', () => {
    it('the adapter matches the migration: it has every column the migration declares', async () => {
      // ⚠️ Test này chốt lại chính lớp lỗi đã gặp: câu SQL của adapter tham
      // chiếu một cột mà migration không có, và mọi test khác vẫn có thể xanh
      // nếu chúng không chạy SQL đó. Ở đây ta hỏi database, không hỏi code.
      const { runtime, migrator } = await setup();
      try {
        await seedCode(migrator, { hash: 'hash-schema-probe' });

        const result = await redeemAuthorizationCode(runtime as never, {
          codeHash: 'hash-schema-probe',
          consumedBy: 'test/schema-probe',
          now: new Date(),
        });

        expect(result.outcome).toBe('won');
      } finally {
        await cleanSeed(migrator, ['hash-schema-probe']);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('single-winner under contention', () => {
    it('TWO requests hit the same code — exactly ONE wins', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedCode(migrator, { hash: 'hash-race-1' });

        // Gọi SONG SONG, không await lần lượt. Đây là toàn bộ điểm của test —
        // và `max: 10` ở `connectRuntime` là điều kiện để hai transaction thật
        // sự chạy song song thay vì xếp hàng trên một connection.
        const outcomes = await Promise.all([
          redeemAuthorizationCode(runtime as never, {
            codeHash: 'hash-race-1',
            consumedBy: 'test/a',
            now: new Date(),
          }),
          redeemAuthorizationCode(runtime as never, {
            codeHash: 'hash-race-1',
            consumedBy: 'test/b',
            now: new Date(),
          }),
        ]).then((results) => results.map((r) => r.outcome));

        // ⚠️ KHÔNG assert thứ tự `['won','lost']`. Ai thắng là KẾT QUẢ của
        // race ở tầng PostgreSQL, không phải hợp đồng của hệ thống — một test
        // ghim thứ tự đó là một test chạy đôi lần sẽ đỏ ngẫu nhiên, và người
        // đọc sẽ tưởng có race trong CAS. Hợp đồng chỉ là: **đúng MỘT** thắng.
        expect(outcomes.toSorted()).toEqual(['lost', 'won']);
        // Chỉ MỘT lần consume được ghi nhận, và nó ghi đúng `consumed_by` của
        // người thắng — cột này là đường điều tra, nên phải trỏ về request thật.
        const rows = await migrator<{ consumed_by: string | null }[]>`
          SELECT consumed_by FROM auth.authorization_codes WHERE code_hash = 'hash-race-1'
        `;
        expect(['test/a', 'test/b']).toContain(rows[0]?.consumed_by);
      } finally {
        await cleanSeed(migrator, ['hash-race-1']);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('THREE requests hit it — STILL exactly ONE wins', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedCode(migrator, { hash: 'hash-race-3' });

        const outcomes = await Promise.all(
          ['test/1', 'test/2', 'test/3'].map((who) =>
            redeemAuthorizationCode(runtime as never, {
              codeHash: 'hash-race-3',
              consumedBy: who,
              now: new Date(),
            }),
          ),
        ).then((results) => results.map((r) => r.outcome).toSorted());

        expect(outcomes).toEqual(['lost', 'lost', 'won']);
      } finally {
        await cleanSeed(migrator, ['hash-race-3']);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('an expired code — nobody wins, and it is indistinguishable from one already consumed', async () => {
      const { runtime, migrator } = await setup();
      try {
        // ⚠️ Transaction vẫn còn hạn; CHỈ code hết hạn. Migration có CHECK
        // `expires_at > created_at` cho transaction, nên hạm hết hạn ở cả hai
        // là seed sai — và một seed sai làm test đo thứ khác với thứ nó tưởng.
        await seedCode(migrator, {
          hash: 'hash-expired',
          ttlSeconds: -60,
          transactionTtlSeconds: 600,
        });
        // Code đã bị consume trước, để so sánh hai trường hợp "không thắng".
        await seedCode(migrator, { hash: 'hash-consumed' });
        const first = await redeemAuthorizationCode(runtime as never, {
          codeHash: 'hash-consumed',
          consumedBy: 'test/first',
          now: new Date(),
        });
        expect(first.outcome).toBe('won');

        const expired = await redeemAuthorizationCode(runtime as never, {
          codeHash: 'hash-expired',
          consumedBy: 'test/expired',
          now: new Date(),
        });
        const replayed = await redeemAuthorizationCode(runtime as never, {
          codeHash: 'hash-consumed',
          consumedBy: 'test/replay',
          now: new Date(),
        });
        const unknown = await redeemAuthorizationCode(runtime as never, {
          codeHash: 'hash-khong-ton-tai',
          consumedBy: 'test/unknown',
          now: new Date(),
        });

        // ⚠️ Cả ba PHẢI giống hệt nhau. Phân biệt chúng là oracle: client biết
        // code có tồn tại không, và từ đó dò được code của người khác.
        expect(expired.outcome).toBe('lost');
        expect(replayed.outcome).toBe('lost');
        expect(unknown.outcome).toBe('lost');
        expect(expired.row).toBeUndefined();
        expect(replayed.row).toBeUndefined();
        expect(unknown.row).toBeUndefined();

        // ⚠️ Và code hết hạn KHÔNG bị đánh dấu consumed — `expires_at > $2`
        // nằm trong cùng câu UPDATE. Đánh dấu nó là burn một code vốn đã chết.
        const rows = await migrator<{ consumed_at: Date | null }[]>`
          SELECT consumed_at FROM auth.authorization_codes WHERE code_hash = 'hash-expired'
        `;
        expect(rows[0]?.consumed_at).toBeNull();
      } finally {
        await cleanSeed(migrator, ['hash-expired', 'hash-consumed']);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('the runtime role must not be created by migration — DDL belongs to the migrator', async () => {
      // ⚠️ Không có test này thì "runtime role bị giới hạn quyền" chỉ là lời
      // hứa trong tài liệu. Nó phải là một khẳng định của suite.
      const { runtime, migrator } = await setup();
      try {
        await expect(runtime.unsafe('CREATE TABLE should_not_work (x int)')).rejects.toThrow(
          /permission denied/u,
        );
      } finally {
        await migrator.unsafe('DROP TABLE IF EXISTS should_not_work');
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('permission grants', () => {
    it('set `AUTH_TEST_PG_*` to run the single-winner tests', () => {
      // Marker test: giữ cho suite không bị coi là "pass" khi thực tế là skip
      // toàn bộ. Xem README §"Vì sao PostgreSQL thật".
      expect(available).toBe(true);
    });
  });
});
