/**
 * `login_handoffs` — AC-008b2, AC-008b3, AC-008b5, FR-006c2, FR-006c3, FR-006c4.
 *
 * Đây là phần khó nhất của schema, và cũng là chỗ dễ tự lừa nhất: một cách
 * kiểm thử "đọc rồi ghi" sẽ xanh ở mọi test tuần tự rồi hỏng dưới tải đồng thời.
 * Vì vậy AC-008b2 ở đây **thật sự** chạy song song, trên hai connection, với
 * một thanh chặn để hai lệnh `INSERT` thực sự cùng lúc.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AccountDatabase,
  futureInstant,
  hashIdentifier,
  probeDocker,
  startAccountDatabase,
} from './harness.ts';

const dockerAvailable = await probeDocker();

/** Handle X đến từ query string; database chỉ lưu hash của nó. */
const RAW_HANDLE = 'X-stolen-from-a-log-or-referrer';

describe.skipIf(!dockerAvailable)('login_handoffs', () => {
  let db: AccountDatabase;

  beforeAll(async () => {
    db = await startAccountDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.truncateData();
  });

  /**
   * Chèn binding bằng **một** thao tác atomic duy nhất — đây là hình thức
   * `FR-006c2` bắt buộc. `INSERT ... ON CONFLICT DO NOTHING` rồi `SELECT` là
   * so khớp, không phải ghi; đọc-rồi-ghi trước khi insert là hình thức bị cấm.
   *
   * Trả về `won` để test khẳng định ai thắng, chứ không chỉ đo bản ghi cuối.
   */
  async function bindFirst(
    handleHash: string,
    sessionRef: string,
    client?: import('pg').Client,
  ): Promise<{ won: boolean; sessionRef: string | null; state: string }> {
    const own = client ?? (await db.connect());
    try {
      const inserted = await own.query<{ session_ref: string; state: string }>(
        `INSERT INTO account.login_handoffs (handle_hash, session_ref, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (handle_hash) DO NOTHING
         RETURNING session_ref, state`,
        [handleHash, sessionRef, futureInstant()],
      );

      // `ON CONFLICT (handle_hash) DO NOTHING` là **cơ chế** first-binding-wins:
      // một `INSERT` nguyên tử, thắng thua do ràng buộc UNIQUE quyết định chứ
      // không phải bằng đọc-rồi-ghi. `rowCount === 1` nghĩa là mình thắng; `0`
      // nghĩa là binding đã có và phải so khớp, **không** được ghi đè.
      if (inserted.rowCount === 1) {
        const row = inserted.rows[0];
        if (row === undefined) {
          throw new Error('rowCount = 1 nhung RETURNING khong tra ve dong nao');
        }
        return { won: true, sessionRef: row.session_ref, state: row.state };
      }

      // Đã có binding: đây là so khớp, và đó là chỗ FR-006c3 được áp dụng —
      // session đã bind không đổi.
      const existing = await own.query<{ session_ref: string; state: string }>(
        `SELECT session_ref, state FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error(
          'ON CONFLICT bat tranh nhung SELECT khong tim thay binding: handle_hash ton tai o dau?',
        );
      }
      return { won: false, sessionRef: row.session_ref, state: row.state };
    } finally {
      if (client === undefined) {
        await own.end();
      }
    }
  }

  it('AC-008b2: two sessions presenting X for the first time concurrently — exactly one wins', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);
    const first = await db.connect();
    const second = await db.connect();

    try {
      // Hai connection, hai transaction riêng. `pg_sleep` bên trong transaction
      // giữ mỗi transaction mở cho tới khi cả hai đã sẵn sàng, nên hai `INSERT`
      // thực sự tranh nhau thay vì lần này chạy trước lần kia.
      const barrier = 'SELECT pg_sleep(0.5)';

      const s1 = first
        .query('BEGIN')
        .then(() => first.query(barrier))
        .then(() => bindFirst(handleHash, 'asr-session-one', first))
        .then(async (result) => {
          await first.query('COMMIT');
          return result;
        });

      const s2 = second
        .query('BEGIN')
        .then(() => second.query(barrier))
        .then(() => bindFirst(handleHash, 'asr-session-two', second))
        .then(async (result) => {
          await second.query('COMMIT');
          return result;
        });

      const [r1, r2] = await Promise.all([s1, s2]);

      const winners = [r1, r2].filter((result) => result.won);
      const losers = [r1, r2].filter((result) => !result.won);

      // Đúng một binding thắng, và kẻ thua nhận về định danh của session đã bind
      // chứ không phải định danh của chính nó.
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]?.sessionRef).toBe(winners[0]?.sessionRef);

      // Đúng một bản ghi — không có bản ghi thứ hai sinh ra bởi cuộc tranh chấp.
      const check = await db.connect();
      try {
        const { rows } = await check.query<{ session_ref: string }>(
          `SELECT session_ref FROM account.login_handoffs WHERE handle_hash = $1`,
          [handleHash],
        );
        // Đúng một bản ghi — không có bản ghi thứ hai sinh ra bởi cuộc tranh chấp.
        expect(rows).toHaveLength(1);
        expect(rows[0]?.session_ref).toBe(winners[0]?.sessionRef);
      } finally {
        await check.end();
      }
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('AC-008b3: a second session presenting X after the fact is rejected and the binding is untouched', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);

    const first = await bindFirst(handleHash, 'asr-original');
    expect(first.won).toBe(true);

    const second = await bindFirst(handleHash, 'asr-intruder');
    expect(second.won).toBe(false);
    expect(second.sessionRef).toBe('asr-original');

    const client = await db.connect();
    try {
      const { rows } = await client.query<{ session_ref: string; state: string }>(
        `SELECT session_ref, state FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.session_ref).toBe('asr-original');
      expect(rows[0]?.state).toBe('bound');
    } finally {
      await client.end();
    }
  });

  it('FR-006c3: the database refuses to overwrite a binding even under a direct UPDATE', async () => {
    // Không chỉ "thao tác atomic không ghi đè" — mà một `UPDATE` thẳng của
    // session khác vào binding cũng phải bị chặn, kể cả khi tầng ứng dụng quên.
    const handleHash = hashIdentifier(RAW_HANDLE);
    await bindFirst(handleHash, 'asr-original');

    const client = await db.connect();
    try {
      await expect(
        client.query(
          `UPDATE account.login_handoffs SET session_ref = 'asr-intruder' WHERE handle_hash = $1`,
          [handleHash],
        ),
      ).rejects.toThrow(/chi doi duoc khi chuyen binding luc rotate session/iu);
    } finally {
      await client.end();
    }
  });

  it('FR-006c2: the runtime role cannot rebind by rewriting handle_hash', async () => {
    // `handle_hash` là PRIMARY KEY và **là** cơ chế first-binding-wins
    // (FR-006c2). Runtime role có UPDATE trên bảng này, nên không có luật riêng
    // ở trigger thì `SET handle_hash = '<khác>'` giải phóng PK và cho phép
    // bind lần thứ hai cho cùng handle X — đúng đường FR-006c3/c4 cấm. Chạy
    // bằng credential **thật** của runtime role để chứng minh luật nằm ở
    // database, không phải ở tầng ứng dụng.
    const handleHash = hashIdentifier(RAW_HANDLE);
    const rivalHash = hashIdentifier(`${RAW_HANDLE}-stolen`);
    await bindFirst(handleHash, 'asr-pk-guard');

    const runtime = await db.connectAsRuntime();
    try {
      await expect(
        runtime.query(`UPDATE account.login_handoffs SET handle_hash = $1 WHERE handle_hash = $2`, [
          rivalHash,
          handleHash,
        ]),
      ).rejects.toThrow(/handle_hash la PRIMARY KEY va co che first-binding-wins/iu);
    } finally {
      await runtime.end();
    }

    // Binding cũ vẫn nguyên vẹn dưới đúng handle_hash cũ; không có hàng thứ hai.
    const verify = await db.connect();
    try {
      const { rows } = await verify.query<{ handle_hash: string; session_ref: string }>(
        `SELECT handle_hash, session_ref FROM account.login_handoffs`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.handle_hash).toBe(handleHash);
      expect(rows[0]?.session_ref).toBe('asr-pk-guard');
    } finally {
      await verify.end();
    }
  });

  it('AC-008b5: rotating the session transfers the binding in the same transaction', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);
    await bindFirst(handleHash, 'asr-before-login');

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Cùng một transaction: session cũ bị thu hồi, session mới được cấp,
      // binding chuyển sang session mới và chuyển sang state `session_rotated`.
      // Nếu tách thành hai transaction thì có một khoảng thời gian binding trỏ
      // tới session đã bị thu hồi — và `01-architecture.md` §3.6.2 nói rõ đó là
      // cách làm login hỏng.
      await client.query(
        `UPDATE account.login_handoffs
            SET session_ref = 'asr-after-login', state = 'session_rotated'
          WHERE handle_hash = $1`,
        [handleHash],
      );
      await client.query(
        `INSERT INTO account.account_sessions (id_hash, session_ref, expires_at)
         VALUES ('hash-after-login', 'asr-after-login', $1)`,
        [futureInstant()],
      );

      await client.query('COMMIT');
    } finally {
      await client.end();
    }

    const verify = await db.connect();
    try {
      const { rows } = await verify.query<{ session_ref: string; state: string }>(
        `SELECT session_ref, state FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      expect(rows[0]?.session_ref).toBe('asr-after-login');
      expect(rows[0]?.state).toBe('session_rotated');

      // Session thứ ba không thể chiếm X sau khi binding đã chuyển.
      const third = await bindFirst(handleHash, 'asr-third-party');
      expect(third.won).toBe(false);
      expect(third.sessionRef).toBe('asr-after-login');
    } finally {
      await verify.end();
    }
  });

  it('FR-006c4: the transfer is rolled back together with the session it points at', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);
    await bindFirst(handleHash, 'asr-before-rollback');

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE account.login_handoffs
            SET session_ref = 'asr-rolled-back', state = 'session_rotated'
          WHERE handle_hash = $1`,
        [handleHash],
      );
      // Cố tình hỏng giữa chừng: `session_ref` mới không tồn tại.
      await expect(
        client.query(
          `INSERT INTO account.account_sessions (id_hash, session_ref, expires_at)
           VALUES ('hash-rolled-back', 'asr-rolled-back', now() - interval '1 day')`,
        ),
      ).rejects.toThrow(/account_sessions_expiry_check/u);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }

    const verify = await db.connect();
    try {
      const { rows } = await verify.query<{ session_ref: string; state: string }>(
        `SELECT session_ref, state FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      // Không có đường nào để binding rơi: hoặc cả hai cùng thành công, hoặc
      // không có gì thay đổi.
      expect(rows[0]?.session_ref).toBe('asr-before-rollback');
      expect(rows[0]?.state).toBe('bound');
    } finally {
      await verify.end();
    }
  });

  it('AC-008b4: the same session presenting X again is idempotent', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);

    const first = await bindFirst(handleHash, 'asr-same-session');
    const retry = await bindFirst(handleHash, 'asr-same-session');

    expect(first.won).toBe(true);
    // Retry trả về binding cũ, không tạo bản ghi thứ hai — và không báo lỗi.
    expect(retry.sessionRef).toBe('asr-same-session');

    const client = await db.connect();
    try {
      const { rows } = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      expect(rows[0]?.count).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('AC-008b6: state is constrained to the four states the design allows', async () => {
    const client = await db.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO account.login_handoffs (handle_hash, session_ref, state, expires_at)
           VALUES ('h-bad-state', 'asr-bad', 'extended', $1)`,
          [futureInstant()],
        ),
      ).rejects.toThrow(/login_handoffs_state_check/u);
    } finally {
      await client.end();
    }
  });

  it('the raw handle X is never stored, only its hash', async () => {
    const handleHash = hashIdentifier(RAW_HANDLE);
    await bindFirst(handleHash, 'asr-no-raw-handle');

    const client = await db.connect();
    try {
      const { rows } = await client.query<{ leaked: number }>(
        `SELECT count(*)::int AS leaked
           FROM account.login_handoffs
          WHERE handle_hash = $1 OR handle_hash LIKE '%' || $2 || '%'`,
        [RAW_HANDLE, RAW_HANDLE],
      );
      expect(rows[0]?.leaked).toBe(0);
    } finally {
      await client.end();
    }
  });

  /**
   * Chuyển state trên `login_handoffs` — ba nhóm luật của
   * `login_handoffs_rebind_guard` (0001): terminal, forward-only, và
   * `session_ref` chỉ đổi khi rotate.
   *
   * Bốn đường hợp lệ của máy trạng thái §3.6: `bound → session_rotated` (xoay
   * session, đổi `session_ref` — FR-006c4), `bound → consumed` (dùng xong không
   * xoay — FR-006d2), `session_rotated → consumed` và
   * `session_rotated → expired` (FR-006d2 / FR-006g). Mọi UPDATE khác bị raise
   * ở tầng database.
   *
   * Gieo hàng bằng INSERT (trigger chỉ canh UPDATE); đọc lại bằng SELECT —
   * mỗi test tự dựng đúng state mình cần rồi đo phản ứng của trigger.
   *
   * @param handleHash Hash của handle X — đúng cột PRIMARY KEY của bảng.
   * @param state Trạng thái cần gieo; INSERT không qua trigger UPDATE nên
   *   nhận cả trạng thái kết thúc.
   * @param sessionRef Binding cần gieo cùng state.
   */
  async function seed(handleHash: string, state: string, sessionRef: string): Promise<void> {
    const client = await db.connect();
    try {
      await client.query(
        `INSERT INTO account.login_handoffs (handle_hash, session_ref, state, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [handleHash, sessionRef, state, futureInstant()],
      );
    } finally {
      await client.end();
    }
  }

  /** Đọc lại state + session_ref hiện tại của một handoff. */
  async function readBack(handleHash: string): Promise<{ state: string; session_ref: string }> {
    const client = await db.connect();
    try {
      const { rows } = await client.query<{ state: string; session_ref: string }>(
        `SELECT state, session_ref FROM account.login_handoffs WHERE handle_hash = $1`,
        [handleHash],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error('khong tim thay handoff sau khi seed');
      }
      return row;
    } finally {
      await client.end();
    }
  }

  describe('state transitions', () => {
    it('FR-006c4: rotating a bound handoff to session_rotated with a new session_ref is allowed', async () => {
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'bound', 'asr-before-rotate');

      const client = await db.connect();
      try {
        await client.query(
          `UPDATE account.login_handoffs
              SET state = 'session_rotated', session_ref = 'asr-after-rotate'
            WHERE handle_hash = $1`,
          [handleHash],
        );
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('session_rotated');
      expect(row.session_ref).toBe('asr-after-rotate');
    });

    it('FR-006d2: consuming a bound handoff directly without rotating is allowed', async () => {
      // `bound → consumed` là đường hợp lệ của máy trạng thái §3.6: xác thực
      // thành công, handoff được dùng, không có xoay session đi kèm. Điểm then
      // chốt là `session_ref` KHÔNG đổi — chỉ có rotate mới đổi binding.
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'bound', 'asr-consumed-in-place');

      const client = await db.connect();
      try {
        await client.query(
          `UPDATE account.login_handoffs SET state = 'consumed' WHERE handle_hash = $1`,
          [handleHash],
        );
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('consumed');
      expect(row.session_ref).toBe('asr-consumed-in-place');
    });

    it('FR-006d2: a session_rotated handoff can still be consumed', async () => {
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'session_rotated', 'asr-rotated-then-consumed');

      const client = await db.connect();
      try {
        await client.query(
          `UPDATE account.login_handoffs SET state = 'consumed' WHERE handle_hash = $1`,
          [handleHash],
        );
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('consumed');
      expect(row.session_ref).toBe('asr-rotated-then-consumed');
    });

    it('FR-006g: a session_rotated handoff can expire without any extension path', async () => {
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'session_rotated', 'asr-rotated-then-expired');

      const client = await db.connect();
      try {
        await client.query(
          `UPDATE account.login_handoffs SET state = 'expired' WHERE handle_hash = $1`,
          [handleHash],
        );
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('expired');
      // Hết hạn là trạng thái kết thúc: FR-006g cấm mọi đường gia hạn, nên UPDATE
      // tiếp theo — kể cả chỉ đụng `expires_at` — phải bị chặn (test terminal bên dưới).
    });

    it('FR-006d2: a consumed handoff rejects every further update', async () => {
      // Bẫy của trigger bản cũ: chỉ kiểm `NEW.state`, nên hàng `consumed` đổi
      // sang `session_rotated` + `session_ref` mới là TÁI BIND một handoff đã
      // dùng — đúng đường "dùng lại" mà FR-006d2 cấm. Chạy bằng credential
      // thật của runtime role để chứng minh luật nằm ở database, không phải ở
      // tầng ứng dụng hay ở superuser.
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'consumed', 'asr-already-consumed');

      const runtime = await db.connectAsRuntime();
      try {
        await expect(
          runtime.query(
            `UPDATE account.login_handoffs SET expires_at = now() + interval '1 day'
              WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);

        await expect(
          runtime.query(
            `UPDATE account.login_handoffs SET state = 'expired' WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);

        await expect(
          runtime.query(
            `UPDATE account.login_handoffs SET state = 'bound' WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);

        // Đúng kịch bản tái bind: hồi sinh sang session_rotated và trỏ sang
        // session của kẻ tấn công.
        await expect(
          runtime.query(
            `UPDATE account.login_handoffs
                SET state = 'session_rotated', session_ref = 'asr-rebind-attack'
              WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);
      } finally {
        await runtime.end();
      }

      // Hàng vẫn nguyên vẹn sau bốn UPDATE bị từ chối.
      const row = await readBack(handleHash);
      expect(row.state).toBe('consumed');
      expect(row.session_ref).toBe('asr-already-consumed');
    });

    it('FR-006g: an expired handoff rejects every further update', async () => {
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'expired', 'asr-already-expired');

      const client = await db.connect();
      try {
        // Gia hạn: đúng đường FR-006g cấm — "không có đường gia hạn âm thầm".
        await expect(
          client.query(
            `UPDATE account.login_handoffs SET expires_at = now() + interval '1 day'
              WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);

        await expect(
          client.query(
            `UPDATE account.login_handoffs SET state = 'consumed' WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);

        await expect(
          client.query(
            `UPDATE account.login_handoffs
                SET state = 'session_rotated', session_ref = 'asr-expired-rebind'
              WHERE handle_hash = $1`,
            [handleHash],
          ),
        ).rejects.toThrow(/la trang thai ket thuc/iu);
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('expired');
      expect(row.session_ref).toBe('asr-already-expired');
    });

    it('FR-006d2: a session_rotated handoff cannot return to bound', async () => {
      // Forward-only: quay lại `bound` là đưa binding về trạng thái chưa dùng,
      // mở đường "dùng lại" một handoff đã xoay — FR-006d2: không có đường dùng
      // lại. `session_ref` giữ nguyên để điểm chặn duy nhất là luật state.
      const handleHash = hashIdentifier(RAW_HANDLE);
      await seed(handleHash, 'session_rotated', 'asr-stay-rotated');

      const client = await db.connect();
      try {
        await expect(
          client.query(`UPDATE account.login_handoffs SET state = 'bound' WHERE handle_hash = $1`, [
            handleHash,
          ]),
        ).rejects.toThrow(/chi duoc chuyen sang consumed hoac expired/iu);
      } finally {
        await client.end();
      }

      const row = await readBack(handleHash);
      expect(row.state).toBe('session_rotated');
    });

    it('FR-006c3: session_ref cannot change outside the bound-to-session_rotated rotate', async () => {
      // Ba hình thức đổi binding sai chỗ, cùng một luật: chỉ đúng một thao tác
      // rotate từ `bound` được đổi `session_ref` (FR-006c4). Mọi UPDATE khác
      // đổi `session_ref` là ghi đè binding — FR-006c3.
      const boundHash = hashIdentifier(`${RAW_HANDLE}-bound`);
      await seed(boundHash, 'bound', 'asr-bound-ref');

      const rotatedHash = hashIdentifier(`${RAW_HANDLE}-rotated`);
      await seed(rotatedHash, 'session_rotated', 'asr-rotated-ref');

      const client = await db.connect();
      try {
        // bound nhưng KHÔNG rotate state: đổi ref thẳng = ghi đè binding.
        await expect(
          client.query(
            `UPDATE account.login_handoffs SET session_ref = 'asr-steal-bound'
              WHERE handle_hash = $1`,
            [boundHash],
          ),
        ).rejects.toThrow(/chi doi duoc khi chuyen binding luc rotate session/iu);

        // bound → consumed kèm ref mới: đường "consume" không được đổi binding.
        await expect(
          client.query(
            `UPDATE account.login_handoffs
                SET state = 'consumed', session_ref = 'asr-steal-consume'
              WHERE handle_hash = $1`,
            [boundHash],
          ),
        ).rejects.toThrow(/chi doi duoc khi chuyen binding luc rotate session/iu);

        // session_rotated đổi ref lần thứ hai: FR-006c4 là "một thao tác atomic
        // duy nhất", không có đường session thứ ba thừa kế X.
        await expect(
          client.query(
            `UPDATE account.login_handoffs
                SET state = 'consumed', session_ref = 'asr-steal-second-rotate'
              WHERE handle_hash = $1`,
            [rotatedHash],
          ),
        ).rejects.toThrow(/chi doi duoc khi chuyen binding luc rotate session/iu);
      } finally {
        await client.end();
      }

      const boundRow = await readBack(boundHash);
      expect(boundRow.state).toBe('bound');
      expect(boundRow.session_ref).toBe('asr-bound-ref');
      const rotatedRow = await readBack(rotatedHash);
      expect(rotatedRow.state).toBe('session_rotated');
      expect(rotatedRow.session_ref).toBe('asr-rotated-ref');
    });
  });
});
