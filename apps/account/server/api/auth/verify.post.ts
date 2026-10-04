/**
 * `POST /api/auth/verify` — xác minh OTP và phát hành session.
 *
 * ## Luồng
 *
 * 1. Đọc body (`email`, `code`), hash địa chỉ như challenge đã làm.
 * 2. Tìm challenge active. Không có / hết hạn / hết lượt thử → 400 chung chung.
 * 3. Digest mã và so timing-safe với `code_digest`. Sai → tăng `attempts` (nguyên
 *    tử), 400 chung chung khi còn lượt, khoá challenge khi vượt trần.
 * 4. Đúng → tra cứu địa chỉ **một lần nữa** tại thời điểm verify (không tin thứ
 *    tự事件 giữa challenge và verify): địa chỉ phải vẫn `verified`, account vẫn
 *    `active` — fail-closed với trạng thái account.
 * 5. Consume challenge (single-use, nguyên tử). Thua consume = request trùng đã
 *    thắng, trả 400 — không bao giờ phát hành hai session cho một mã.
 * 6. Tạo session identifier mới (rotate: session anonymous hiện có bị thu hồi
 *    trong cùng transaction), `acr = urn:ecoma:acr:email-otp`, ghi hai cookie
 *    session + CSRF.
 *
 * ## Thông điệp lỗi chung chung
 *
 * Mọi thất bại của luồng verify là `400 { "error": "invalid_code" }` — không phân
 * biệt "chưa từng yêu cầu mã", "mã hết hạn", "mã sai", "hết lượt thử". Phân biệt
 * là oracle cho attacker đang đoán mã: biết "hết hạn" hay "sai" rút ngắn việc
 * vét cạn. `401` dành cho session-based auth; đây là luồng trước-session.
 *
 * ## CSRF
 *
 * Verify là state-changing nhưng xảy ra **trước** khi có session, nên không có
 * CSRF token để kiểm (token phát hành cùng session). Lớp bảo vệ của luồng này là
 * rate-limit cấp mã + trần 5 lần thử per challenge — mô hình giống mọi form
 * pre-auth của OAuth.
 */

import {
  createError,
  defineEventHandler,
  getCookie,
  readValidatedBody,
  setCookie,
  setResponseHeader,
} from 'h3';

import { accountHyperdrive } from '../../utils/bindings';
import { writeLog } from '../../utils/logger';
import { withRequestPool } from '../../utils/db';
import {
  consumeChallenge,
  findActiveChallenge,
  lookupVerifiedAddress,
  MAX_OTP_ATTEMPTS,
  normalizeAndHashEmail,
  OTP_PURPOSE_LOGIN,
  otpDigest,
  recordFailedAttempt,
  resolveOtpTarget,
  timingSafeDigestEqual,
} from '../../lib/otp';
import {
  CSRF_COOKIE_NAME,
  createCsrfToken,
  createSessionIdentifier,
  hashSessionIdentifier,
  insertAuthenticatedSession,
  OTP_ACR,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_SECONDS,
} from '../../lib/session';

interface VerifyBody {
  email: string;
  code: string;
}

/** Body hợp lệ: hình dạng tối thiểu, mã đúng 8 chữ số. */
function isVerifyBody(value: unknown): VerifyBody | false {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const email = (value as { email?: unknown }).email;
  const code = (value as { code?: unknown }).code;
  if (
    typeof email !== 'string' ||
    email.length <= 3 ||
    email.length > 254 ||
    !email.includes('@') ||
    typeof code !== 'string' ||
    !/^\d{8}$/u.test(code)
  ) {
    return false;
  }
  return { email, code };
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');

  const body = await readValidatedBody(event, isVerifyBody).catch(() => null);
  if (body === null) {
    // Body sai hình dạng — khác `invalid_code` ở chỗ người gọi tự sửa được;
    // vẫn chung 400 nhưng mã lỗi nói rõ phần sai của request.
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const config = useRuntimeConfig(event);
  const otpSecret = config.otpHmacSecret;
  const hyperdrive = accountHyperdrive(config);
  if (typeof otpSecret !== 'string' || otpSecret.length === 0 || !hyperdrive) {
    writeLog({ event: 'otp_verify.failed', status: 503, reason: 'config_or_binding_missing' });
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' });
  }

  const { hash } = await normalizeAndHashEmail(body.email);

  try {
    const result = await withRequestPool(hyperdrive, async (pool) => {
      const challenge = await findActiveChallenge(pool, hash, OTP_PURPOSE_LOGIN);
      if (challenge === null || isExpired(challenge.expires_at, Date.now())) {
        writeLog({ event: 'otp_verify.rejected', status: 400, reason: 'no_active_challenge' });
        return false;
      }

      const digest = await otpDigest(otpSecret, OTP_PURPOSE_LOGIN, body.code);
      if (!timingSafeDigestEqual(digest, challenge.code_digest)) {
        const attempts = await recordFailedAttempt(pool, challenge.id);
        writeLog({ event: 'otp_verify.rejected', status: 400, reason: 'code_mismatch' });
        if (attempts !== null && attempts >= MAX_OTP_ATTEMPTS) {
          // Khoá challenge: consume luôn — không còn lượt nào cho mã này.
          await consumeChallenge(pool, challenge.id);
        }
        return false;
      }

      // Đúng mã — xác minh lại trạng thái địa chỉ + account TẠI THỜI ĐIỂM verify.
      // Account suspended giữa lúc cấp mã và verify phải dừng ở đây (FR-012).
      const target = resolveOtpTarget(await lookupVerifiedAddress(pool, hash));
      if (target.kind !== 'verified' || target.userSub === undefined) {
        writeLog({ event: 'otp_verify.rejected', status: 400, reason: 'address_unusable' });
        return false;
      }

      // Consume trước khi phát hành — single-use của mã là thứ giữ hai request
      // mang cùng mã không phát hành hai session.
      const consumed = await consumeChallenge(pool, challenge.id);
      if (!consumed) {
        writeLog({ event: 'otp_verify.rejected', status: 400, reason: 'already_consumed' });
        return false;
      }

      // Rotate (FR-004a): session anonymous của browser (nếu có) bị thu hồi trong
      // cùng transaction với INSERT session mới. Đọc cookie cũ — giá trị, không
      // hash — để biết session_ref cần thu hồi.
      const previousCookie = getCookie(event, '__Host-account-session');
      const previousHash =
        previousCookie === undefined ? null : await hashSessionIdentifier(previousCookie);
      const revokeRef =
        previousHash === null ? undefined : await findSessionRefByHash(pool, previousHash);

      const identifier = createSessionIdentifier();
      const sessionRef = await hashSessionIdentifier(identifier + ':ref:' + target.userSub);
      const now = Date.now();
      await insertAuthenticatedSession(pool, {
        idHash: await hashSessionIdentifier(identifier),
        sessionRef,
        userSub: target.userSub,
        acr: OTP_ACR,
        authnAt: new Date(now),
        expiresAt: new Date(now + SESSION_IDLE_SECONDS * 1000),
        revokeSessionRef: revokeRef,
      });

      const csrfToken = createCsrfToken();
      setResponseHeader(event, 'Cache-Control', 'no-store');
      setCookie(event, SESSION_COOKIE_NAME, identifier, {
        maxAge: SESSION_ABSOLUTE_SECONDS,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      });
      setCookie(event, CSRF_COOKIE_NAME, csrfToken, {
        maxAge: SESSION_ABSOLUTE_SECONDS,
        path: '/',
        secure: true,
        sameSite: 'lax',
      });
      writeLog({ event: 'otp_verify.issued', status: 200, sub: target.userSub });
      return true;
    });

    if (!result) {
      // Cùng một body lỗi cho mọi nhánh từ chối — anti-guessing.
      throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error;
    }
    writeLog({ event: 'otp_verify.failed', status: 503, reason: 'db_unreachable' });
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' });
  }

  return { ok: true };
});

/** Challenge đã quá hạn chưa — thuần. */
function isExpired(expiresAt: Date, nowMs: number): boolean {
  return nowMs >= expiresAt.getTime();
}

/** `session_ref` của session đang sống theo hash identifier — cho rotation. */
async function findSessionRefByHash(
  pool: import('pg').Pool,
  idHash: string,
): Promise<string | undefined> {
  const result = await pool.query<{ session_ref: string }>(
    `SELECT session_ref FROM account.account_sessions
      WHERE id_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [idHash],
  );
  return result.rows[0]?.session_ref;
}

/** HTTPError của h3 (đã có statusCode) — không bọc lại thành 503. */
function isHttpError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  );
}

export type { VerifyBody };
