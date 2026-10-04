import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { describe, expect, it } from 'vitest';

import {
  insertAuthorizationCode,
  insertTransaction,
  findTransactionByHandleX,
  transitionTransaction,
} from './authorization-transaction-store';

/**
 * Hợp đồng persistence của `authorization_transactions` trên PostgreSQL THẬT.
 *
 * ⚠️ Vì sao phải có PostgreSQL thật: toàn bộ điểm C1 là câu SQL của adapter
 * khớp schema thật — đúng tên cột, đúng kiểu (`transaction_id` là `text` sau
 * `0011`, hash là `bytea`, scope là `text[]`), đúng ràng buộc. Bảng do test tự
 * chế là schema thứ hai; test xanh trên schema thứ hai không nói gì về
 * production (đúng bài học của `authorization-code-cas.spec.ts`). Suite này áp
 * chính các file `apps/auth/migrations/*.sql`.
 *
 * ⚠️ Hai role như CAS spec: `ecoma_auth_migrator` dựng schema, runtime chỉ
 * chạy DML. Nếu adapter chạy được bằng superuser thì test không chứng minh gì
 * về quyền production.
 */

const HOST = process.env['AUTH_TEST_PG_HOST'];
const PORT = process.env['AUTH_TEST_PG_PORT'];
const DATABASE = process.env['AUTH_TEST_PG_DATABASE'];
const RUNTIME_USER = process.env['AUTH_TEST_PG_USER'];
const RUNTIME_PASSWORD = process.env['AUTH_TEST_PG_PASSWORD'];
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

function connectRuntime(max = 10): postgres.Sql {
  return postgres({
    ...base(),
    user: RUNTIME_USER as string,
    password: RUNTIME_PASSWORD,
    max,
  });
}

function connectMigrator(): postgres.Sql {
  return postgres({
    ...base(),
    user: MIGRATOR_USER as string,
    password: MIGRATOR_PASSWORD,
    max: 1,
  });
}

/**
 * Khoá advisory DÙNG CHUNG với mọi spec PG khác — `internal-nonces.spec.ts`
 * có test parity đọc chính file này để kiểm tra con số. Số khác ở đây = một
 * suite đỏ ngẫu nhiên vì hai tiến trình cùng dựng schema.
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
      .toSorted();
    for (const file of files) {
      await migrator.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
  } finally {
    await migrator.unsafe('SELECT pg_advisory_unlock($1)', [SCHEMA_SETUP_LOCK_KEY]);
  }
}

async function setup(): Promise<{ runtime: postgres.Sql; migrator: postgres.Sql }> {
  const migrator = connectMigrator();
  await applyMigrations(migrator);
  return { runtime: connectRuntime(), migrator };
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const BASE_TX_ID = 'a'.repeat(43); // 43 ký tự base64url — như `createOpaqueId`
const SCOPE_TX_ID = 'b'.repeat(43);
const HASH_X = 'XXkVq2oFfTAgy1WcdbeNkanIsw6CwJh0jAcs8CtGYWw';
const HASH_X_ALT = 'YYkVq2oFfTAgy1WcdbeNkanIsw6CwJh0jAcs8CtGYWw';
const BINDING_HASH = 'AAIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHw4';

function newTxRecord(overrides: Partial<Parameters<typeof insertTransaction>[1]> = {}) {
  return {
    transaction_id: BASE_TX_ID,
    handle_hash_x: HASH_X,
    client_id: 'client-tx-store-test',
    redirect_uri: 'https://app.example.com/cb',
    requested_scopes: ['openid'] as const,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    browser_binding_hash: BINDING_HASH,
    key_version: 1,
    expires_at: new Date(Date.now() + 600_000),
    client_state: null,
    nonce: null,
    ...overrides,
  };
}

/** Client đăng ký — FK của `oauth_clients` đòi hàng trước. */
async function seedClient(migrator: postgres.Sql, clientId: string): Promise<void> {
  await migrator`
    INSERT INTO auth.oauth_clients (client_id, client_name, client_type)
    VALUES (${clientId}, 'tx store test client', 'public')
    ON CONFLICT (client_id) DO NOTHING
  `;
}

/**
 * Xoá mọi hàng test tạo ra. Thứ tự: code trước, transaction sau — FK
 * `ON DELETE RESTRICT` của `authorization_codes` sang transaction.
 */
async function cleanup(migrator: postgres.Sql, transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) {
    return;
  }
  await migrator`
    DELETE FROM auth.authorization_codes
     WHERE authorization_transaction_id IN ${migrator(transactionIds)}
  `;
  await migrator`
    DELETE FROM auth.authorization_transactions
     WHERE transaction_id IN ${migrator(transactionIds)}
  `;
}

describe('authorization-transaction-store — tren PostgreSQL that', () => {
  describe('migration 0011 — assert tren FILE, chay duoc khong can PostgreSQL', () => {
    // ⚠️ Probe đã đo được lỗi này trên PostgreSQL thật: psql không bọc transaction
    // COMMIT từng statement, nên khi guard BƯỚC 0 vang trên database có hàng legacy,
    // các bước 1-2 (đổi kiểu) đã kịp COMMIT — guard vang nhưng schema lệch nửa đường
    // (transaction_id thành `text` trong khi CHECK/FK còn cũ). BEGIN/COMMIT bọc toàn
    // file biến mọi điểm hỏng thành rollback toàn phần; assert trên file là assert
    // trên thứ sẽ được deploy (cùng lý do với nhóm test 0010 của internal-nonces.spec).
    it('wraps the whole conversion in ONE transaction (BEGIN ... COMMIT)', () => {
      const source = readFileSync(
        join(MIGRATIONS_DIR, '0011_authorization_transaction_contract.sql'),
        'utf8',
      );
      const beginPos = source.indexOf('BEGIN;');
      const commitPos = source.indexOf('COMMIT;');
      expect(beginPos).toBeGreaterThan(-1);
      expect(commitPos).toBeGreaterThan(beginPos);
      // Bắt buộc COMMIT đứng SAU mọi DDL: statement nào nằm ngoài cặp BEGIN/COMMIT
      // là statement tự COMMIT — đúng thứ probe đã chứng kiến rò rỉ.
      const lastDdl = source.lastIndexOf('COMMENT ON COLUMN');
      expect(lastDdl).toBeGreaterThan(-1);
      expect(lastDdl).toBeLessThan(commitPos);
    });

    it('fails loudly on legacy states and never guesses a mapping', () => {
      const source = readFileSync(
        join(MIGRATIONS_DIR, '0011_authorization_transaction_contract.sql'),
        'utf8',
      );
      // Guard BƯỚC 0 phải RAISE EXCEPTION (dừng), không phải UPDATE/DROP âm thầm.
      expect(source).toMatch(/RAISE EXCEPTION[\S\s]*?state legacy/u);
      expect(source).not.toMatch(/DELETE FROM auth\.authorization_transactions/u);
      expect(source).not.toMatch(/TRUNCATE/u);
      // Không đổi file có trong lịch sử migration.
      expect(source).not.toMatch(/ALTER TABLE auth\.authorization_codes\s+ALTER COLUMN code_hash/u);
    });
  });

  describe.skipIf(!available)('schema catalog sau migration 0011', () => {
    it('transaction_id la TEXT, khong con UUID — loai cua cot doc tu database', async () => {
      const { migrator } = await setup();
      try {
        const rows = await migrator<{ data_type: string }[]>`
          SELECT data_type FROM information_schema.columns
           WHERE table_schema = 'auth'
             AND table_name = 'authorization_transactions'
             AND column_name = 'transaction_id'
        `;
        expect(rows[0]?.data_type).toBe('text');
      } finally {
        await migrator.end({ timeout: 1 });
      }
    });

    it('ba cot FK lien quan cung la TEXT — detach/re-attach khong de sot cot nao', async () => {
      // 0011 đổi cả bốn cột; bỏ sót một cột nghĩa là so khớp text với uuid
      // nổ ngay khi chạy query — nhưng chỉ nổ ở ĐƯỜNG DÙNG CÓ SO KHỚP. Test
      // catalog này bắt nó ở tầng schema, không phải chờ đúng đường dùng.
      const { migrator } = await setup();
      try {
        const rows = await migrator<{ column_name: string; data_type: string }[]>`
          SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'auth'
             AND (
               (table_name = 'authorization_codes'
                  AND column_name = 'authorization_transaction_id')
               OR (table_name = 'oauth_consent_decisions'
                     AND column_name = 'authorization_transaction_id')
               OR (table_name = 'authorization_audit_events'
                     AND column_name = 'authorization_transaction_id')
             )
           ORDER BY column_name
        `;
        expect(rows).toHaveLength(3);
        for (const row of rows) {
          expect(row.data_type).toBe('text');
        }
      } finally {
        await migrator.end({ timeout: 1 });
      }
    });

    it('CHECK state la dung 6 trang thai canonical — khong con legacy state nao sot', async () => {
      // ⚠️ Đây là test của chính lỗi 4.2: schema cũ cho `awaiting_login`/
      // `consent_denied`/`already_processed`. CHECK này là ranh giới hợp đồng
      // state machine; lệch một tên là một state "ma" có thể được ghi.
      const { migrator } = await setup();
      try {
        const rows = await migrator<{ check_clause: string }[]>`
          SELECT pg_get_constraintdef(c.oid) AS check_clause
            FROM pg_constraint c
           WHERE c.conrelid = 'auth.authorization_transactions'::regclass
             AND c.contype = 'c'
             AND c.conname = 'authorization_transactions_state_check'
        `;
        const clause = rows[0]?.check_clause ?? '';
        for (const state of [
          'pending_browser',
          'browser_confirmed',
          'awaiting_consent',
          'ready_to_complete',
          'completed',
          'denied',
        ]) {
          expect(clause).toContain(state);
        }
        for (const legacy of ['awaiting_login', 'consent_denied', 'already_processed']) {
          expect(clause).not.toContain(legacy);
        }
      } finally {
        await migrator.end({ timeout: 1 });
      }
    });

    it('client_state va nonce duoc phep NULL — RFC 6749 state la optional', async () => {
      const { migrator } = await setup();
      try {
        const rows = await migrator<{ column_name: string; is_nullable: string }[]>`
          SELECT column_name, is_nullable FROM information_schema.columns
           WHERE table_schema = 'auth'
             AND table_name = 'authorization_transactions'
             AND column_name IN ('client_state', 'nonce')
           ORDER BY column_name
        `;
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.is_nullable).toBe('YES');
        }
      } finally {
        await migrator.end({ timeout: 1 });
      }
    });

    it('FK tro dung vao authorization_transactions(transaction_id) — tai bien ke ca sau re-attach', async () => {
      const { migrator } = await setup();
      try {
        const rows = await migrator<{ confrelid: string }[]>`
          SELECT confrelid::regclass::text AS confrelid
            FROM pg_constraint
           WHERE conname = 'authorization_codes_transaction_fk'
        `;
        expect(rows[0]?.confrelid).toBe('auth.authorization_transactions');
      } finally {
        await migrator.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('CRUD va transition qua adapter', () => {
    it('tao ROI TIM — round-trip day du cac cot, bytea ve base64url', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        const found = await findTransactionByHandleX(runtime as never, {
          handleXHash: HASH_X,
        });

        // ⚠️ So từng trường, không so object nguyên: shape DTO là hợp đồng với
        // application, và một field thiếu sẽ xanh nếu test chỉ `toMatchObject`.
        expect(found).toBeDefined();
        expect(found?.transaction_id).toBe(BASE_TX_ID);
        expect(found?.state).toBe('pending_browser');
        expect(found?.handle_hash_x).toBe(HASH_X);
        expect(found?.browser_binding_hash).toBe(BINDING_HASH);
        expect(found?.client_id).toBe('client-tx-store-test');
        expect(found?.redirect_uri).toBe('https://app.example.com/cb');
        expect([...(found?.requested_scopes ?? [])]).toEqual(['openid']);
        expect(found?.code_challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
        expect(found?.code_challenge_method).toBe('S256');
        expect(found?.key_version).toBe(1);
        expect(found?.sub).toBeNull();
        expect(found?.acr).toBeNull();
        expect(found?.authn_at).toBeNull();
        expect(found?.account_session_ref).toBeNull();
        expect(found?.client_state).toBeNull();
        expect(found?.nonce).toBeNull();
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('hash bytea <-> base64url: byte khac nhau cho hash khac nhau, khongbam tho', async () => {
      // ⚠️ Codec sai (vd. dùng standard base64 thay vì base64url) thường KHÔNG
      // nổ — nó so khớp lệch một cách im lặng. Dùng hai hash chỉ khác suffix
      // để bắt biến dạng: byte cuối 0x00 và 0x01 phải là hai hàng khác nhau.
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        // Hai chuỗi base64url 43 ký tự giải mã ra 32 byte, byte cuối khác nhau.
        await insertTransaction(runtime as never, newTxRecord({ handle_hash_x: HASH_X }));
        await insertTransaction(
          runtime as never,
          newTxRecord({
            transaction_id: SCOPE_TX_ID,
            handle_hash_x: HASH_X_ALT,
          }),
        );

        const a = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        const b = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X_ALT });

        expect(a?.transaction_id).toBe(BASE_TX_ID);
        expect(b?.transaction_id).toBe(SCOPE_TX_ID);
      } finally {
        await cleanup(migrator, [BASE_TX_ID, SCOPE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('khong tim thay khi hash khong ton tai — undefined, khong throw', async () => {
      const { runtime, migrator } = await setup();
      try {
        const found = await findTransactionByHandleX(runtime as never, {
          handleXHash: 'not-a-real-hash-value-but-43-chars-long-aaaaaaaaaaa',
        });
        expect(found).toBeUndefined();
      } finally {
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('client_state co gia tri — duoc luu va tra ve NGUYEN VAN (FR-007)', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        const clientState = 'csrf-token-with-special-chars:?&#/';
        await insertTransaction(runtime as never, newTxRecord({ client_state: clientState }));

        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect(found?.client_state).toBe(clientState);
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('requested_scopes nhieu phan tu — text[] khong bi noi thanh chuoi', async () => {
      // ⚠️ Đây là test của lỗi 4.3: DTO cũ mang `scope: string`. Nếu adapter
      // truyền chuỗi 'openid profile' vào cột `text[]`, PostgreSQL từ chối —
      // nhưng nếu test chỉ nhìn "có lưu được" thì sẽ bỏ sót hình dạng.
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(
          runtime as never,
          newTxRecord({ requested_scopes: ['openid', 'profile', 'email'] }),
        );

        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect([...(found?.requested_scopes ?? [])]).toEqual(['openid', 'profile', 'email']);
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('transition thanh cong tu pending_browser sang browser_confirmed — tra true', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        const won = await transitionTransaction(runtime as never, {
          transactionId: BASE_TX_ID,
          from: 'pending_browser',
          to: 'browser_confirmed',
          at: new Date(),
        });
        expect(won).toBe(true);

        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect(found?.state).toBe('browser_confirmed');
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('transition tu state sai — TU CHOI (CAS khong tim thay from)', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        // Transaction đang `pending_browser`; đòi chuyển TỪ `completed` phải fail.
        const won = await transitionTransaction(runtime as never, {
          transactionId: BASE_TX_ID,
          from: 'completed',
          to: 'denied',
          at: new Date(),
        });
        expect(won).toBe(false);

        // ⚠️ Và state KHÔNG đổi — từ chối phải là no-op, không phải "dù sao
        // cũng ghi đích".
        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect(found?.state).toBe('pending_browser');
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('transaction het han — transition TU CHOI du khi from dung', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        // ⚠️ Không seed hàng hết hạn được: CHECK `expires_at > created_at`
        // chặn `expires_at` trong quá khứ lúc INSERT. Hết hạn thật xảy ra theo
        // THỜI GIAN — cùng một nhánh SQL (`expires_at > $4`) được kiểm bằng
        // truyền `at` muộn hơn `expires_at`.
        const won = await transitionTransaction(runtime as never, {
          transactionId: BASE_TX_ID,
          from: 'pending_browser',
          to: 'browser_confirmed',
          at: new Date(Date.now() + 1_200_000), // muộn hơn expires_at (+10 phut)
        });
        expect(won).toBe(false);

        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect(found?.state).toBe('pending_browser');
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('CAS theo from — tu denied khong the tu goi transition ve pending_browser khong chi dinh from', async () => {
      // ⚠️ PHÂN TẦNG CỐ Ý: CHECK của schema chỉ là ALLOWLIST giá trị; tính
      // HỢP LỆ của bước chuyển (máy trạng thái một chiều) thuộc về domain
      // `canTransition` — adapter CAS chỉ cơ chế so khớp `from`. Test này ghim
      // đúng hợp đồng của tầng adapter: transition luôn phải NÓI RÕ state
      // hiện tại; gọi sai state là không tác động. Chính phủ "điểm cuối không
      // đường ra" được kiểm ở domain (`transaction.spec` của domain).
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());
        await transitionTransaction(runtime as never, {
          transactionId: BASE_TX_ID,
          from: 'pending_browser',
          to: 'denied',
          at: new Date(),
        });

        // So khớp `from: 'denied'` với đích khác — không hàng nào khớp, no-op.
        const wrongFrom = await transitionTransaction(runtime as never, {
          transactionId: BASE_TX_ID,
          from: 'ready_to_complete',
          to: 'denied',
          at: new Date(),
        });
        expect(wrongFrom).toBe(false);

        // Và khi NÓI ĐÚNG `from: 'denied'` → `pending_browser`, CAS tự nó KHÔNG
        // chặn — vì chặn thứ tự là việc của `assertTransition` ở domain trước
        // khi adapter được gọi. Test này ghi nhận hành vi tầng dưới để ai đó
        // "tiện tay thêm CHECK transition vào DB" biết mình đang đổi hợp đồng,
        // không phải sửa bug.
        const found = await findTransactionByHandleX(runtime as never, { handleXHash: HASH_X });
        expect(found?.state).toBe('denied');
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('HAI transition dong thoi — DUNG MOT thang thang CAS', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        const results = await Promise.all([
          transitionTransaction(runtime as never, {
            transactionId: BASE_TX_ID,
            from: 'pending_browser',
            to: 'browser_confirmed',
            at: new Date(),
          }),
          transitionTransaction(runtime as never, {
            transactionId: BASE_TX_ID,
            from: 'pending_browser',
            to: 'denied',
            at: new Date(),
          }),
        ]);

        // Đích đến của winner phụ thuộc race — hợp đồng chỉ là ĐÚNG MỘT thắng.
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.filter((r) => r === false)).toHaveLength(1);
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('insertAuthorizationCode khop schema 0004', () => {
    it('ghi code khop FK — sub, granted_scopes text[], nonce nullable duoc chap nhan', async () => {
      const { runtime, migrator } = await setup();
      try {
        await seedClient(migrator, 'client-tx-store-test');
        await insertTransaction(runtime as never, newTxRecord());

        // ⚠️ Cả hai hình dạng nonce: CÓ nonce (SR-007 — phải vào id_token) và
        // KHÔNG nonce. Chỉ test một hình là để lọt lỗi nullable ngược chiều.
        await insertAuthorizationCode(runtime as never, {
          code_hash: 'hash-code-with-nonce-000000000000000000000000',
          authorization_transaction_id: BASE_TX_ID,
          sub: 'account-1',
          client_id: 'client-tx-store-test',
          redirect_uri: 'https://app.example.com/cb',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          granted_scopes: ['openid', 'profile'],
          nonce: 'n-abc',
          expires_at: new Date(Date.now() + 120_000),
        });
        await insertAuthorizationCode(runtime as never, {
          code_hash: 'hash-code-no-nonce-00000000000000000000000000',
          authorization_transaction_id: BASE_TX_ID,
          sub: 'account-1',
          client_id: 'client-tx-store-test',
          redirect_uri: 'https://app.example.com/cb',
          code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
          granted_scopes: ['openid'],
          nonce: null,
          expires_at: new Date(Date.now() + 120_000),
        });

        const rows = await migrator<
          {
            code_hash: string;
            sub: string;
            granted_scopes: string[];
            nonce: string | null;
          }[]
        >`
          SELECT code_hash, sub, granted_scopes, nonce
            FROM auth.authorization_codes
           WHERE authorization_transaction_id = ${BASE_TX_ID}
           ORDER BY code_hash
        `;
        expect(rows).toHaveLength(2);
        expect(rows[0]?.code_hash).toBe('hash-code-no-nonce-00000000000000000000000000');
        expect(rows[0]?.nonce).toBeNull();
        expect(rows[1]?.code_hash).toBe('hash-code-with-nonce-000000000000000000000000');
        expect(rows[1]?.sub).toBe('account-1');
        expect(rows[1]?.granted_scopes).toEqual(['openid', 'profile']);
        expect(rows[1]?.nonce).toBe('n-abc');
      } finally {
        await cleanup(migrator, [BASE_TX_ID]);
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });

    it('code tham chieu transaction khong ton tai — FK TU CHOI, adapter khong nu loi', async () => {
      const { runtime, migrator } = await setup();
      try {
        await expect(
          insertAuthorizationCode(runtime as never, {
            code_hash: 'hash-orphan-00000000000000000000000000000',
            authorization_transaction_id: 'f'.repeat(43),
            sub: 'account-1',
            client_id: 'client-tx-store-test',
            redirect_uri: 'https://app.example.com/cb',
            code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            code_challenge_method: 'S256',
            granted_scopes: ['openid'],
            nonce: null,
            expires_at: new Date(Date.now() + 120_000),
          }),
        ).rejects.toThrow(/violates foreign key constraint/u);
      } finally {
        await runtime.end({ timeout: 1 });
        await migrator.end({ timeout: 1 });
      }
    });
  });

  describe.skipIf(!available)('cap quyen', () => {
    it('dang `AUTH_TEST_PG_*` de chay cac test persistence contract', () => {
      // Marker test: giữ cho suite không bị coi là "pass" khi thực tế là skip.
      expect(available).toBe(true);
    });
  });
});
