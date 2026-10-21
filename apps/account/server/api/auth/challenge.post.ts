/**
 * `POST /api/auth/challenge` — cấp OTP đăng nhập cho một địa chỉ email.
 *
 * ## Anti-enumeration là bất biến số một của route này
 *
 * Mọi request với `email` hợp lệ về hình dạng nhận **cùng một response** —
 * `204`, không body — dù địa chỉ:
 *
 * - tồn tại và đã `verified` (mail thật được gửi),
 * - tồn tại nhưng `pending`/`revoked`,
 * - không tồn tại,
 * - thuộc account `suspended`/`deleted`,
 * - hay vừa bị rate-limit.
 *
 * Lý do: một response phân biệt được là một oracle đo sự tồn tại của account
 * (FR-011b áp cùng nguyên tắc cho contract status). Kẻ dò địa chỉ chỉ cần một
 * byte khác nhau để map toàn bộ cơ sở người dùng. Vì vậy ngay cả rate-limit
 * response cũng phải giống response thành công — kẻ dò không học được gì, còn
 * user thật sẽ không nhận mail và tự hiểu (mail không tới).
 *
 * ## Vẫn ghi challenge cho địa chỉ lạ
 *
 * Với địa chỉ không thuộc account nào, route **vẫn** ghi một hàng `otp_challenges`
 * ("challenge ma") với digest của một mã sẽ không bao giờ được gửi. Hai lý do:
 * (1) rate-limit đếm từ bảng này nên địa chỉ lạ phải chịu cùng giới hạn — nếu
 * không, dò địa chỉ là thao tác miễn phí trong khi user thật bị limit; (2) thời
 * gian xử lý hai nhánh là như nhau (một lần tra cứu + một lần ghi), không rò qua
 * timing. Mã của challenge ma cũng được sinh thật rồi digest — không có nhánh
 * "bỏ qua crypto" để không tạo lệch thời gian.
 *
 * ## Cooldown resend và rate limit trả cùng 204
 *
 * Cả hai là điều kiện bị chặn của cùng một luồng, và cả hai cùng không được phân
 * biệt với thành công. Challenge active còn cooldown: consume và cấp mã mới
 * **không** diễn ra — người dùng nhấn resend liên tục không được mail mới trước
 * 60 giây, nhưng không được biết là bị chặn.
 */

import { createError, defineEventHandler, readValidatedBody, setResponseHeader } from 'h3';

import { accountHyperdrive } from '../../utils/bindings';
import { writeLog } from '../../utils/logger';
import { withRequestPool } from '../../utils/db';
import { sendMail, buildOtpMailRequest } from '../../lib/mail';
import {
  countChallengesSince,
  createOtpChallenge,
  findActiveChallenge,
  insertChallenge,
  isRateLimited,
  isResendBlocked,
  isUniqueViolation,
  lookupVerifiedAddress,
  normalizeAndHashEmail,
  OTP_PURPOSE_LOGIN,
  OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS,
  OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  resolveOtpTarget,
} from '../../lib/otp';

/** Body hợp lệ: `email` là chuỗi có hình dạng địa chỉ, giới hạn độ dài để chống abuse. */
function isChallengeBody(value: unknown): { email: string } | false {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const email = (value as { email?: unknown }).email;
  // Hình dạng tối thiểu — không phải RFC 5321 đầy đủ. Chuỗi rỗng, quá dài
  // (> 254 theo RFC 5321 giới hạn path) hay thiếu `@` bị 400; mọi địa chỉ khác
  // đi qua luồng anti-enumeration bình thường.
  if (
    typeof email !== 'string' ||
    email.length <= 3 ||
    email.length > 254 ||
    !email.includes('@')
  ) {
    return false;
  }
  return { email };
}

export default defineEventHandler(async (event) => {
  // FR-011e là cho contract status; route public này tương tự không được cache —
  // mỗi request là một lần cấp mã.
  setResponseHeader(event, 'Cache-Control', 'no-store');

  const body = await readValidatedBody(event, isChallengeBody).catch(() => null);
  if (body === null) {
    // 400 chỉ cho body sai **hình dạng** — điều người gọi có thể tự sửa, không
    // lộ gì về tồn tại của account.
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  // `useRuntimeConfig(event)` — truyền event như mọi route khác: binding của
  // request đến từ env của Worker trên preset Cloudflare.
  const config = useRuntimeConfig(event);
  const otpSecret = config.otpHmacSecret;
  const hyperdrive = accountHyperdrive(config);
  if (typeof otpSecret !== 'string' || otpSecret.length === 0 || !hyperdrive) {
    // Fail closed: không có secret hay DB thì không cấp mã. Trả 503 chung —
    // không phân biệt thiếu config với DB chết qua response.
    writeLog({ event: 'otp_challenge.failed', status: 503, reason: 'config_or_binding_missing' });
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' });
  }

  const { hash } = await normalizeAndHashEmail(body.email);

  let outcome: 'sent' | 'silently_rejected';
  try {
    outcome = await withRequestPool(hyperdrive, async (pool) => {
      // Rate limit TRƯỚC mọi thứ: hai cửa sổ trượt, chặn là im lặng.
      const [shortCount, hourCount] = await Promise.all([
        countChallengesSince(pool, hash, OTP_RATE_LIMIT_SHORT_WINDOW_SECONDS),
        countChallengesSince(pool, hash, OTP_RATE_LIMIT_HOUR_WINDOW_SECONDS),
      ]);
      if (isRateLimited(shortCount, hourCount)) {
        return 'silently_rejected' as const;
      }

      // Cooldown resend: challenge active mới tạo dưới 60s thì không cấp lại.
      const active = await findActiveChallenge(pool, hash, OTP_PURPOSE_LOGIN);
      if (active !== null && isResendBlocked(active.created_at, Date.now())) {
        return 'silently_rejected' as const;
      }

      // Sinh mã + digest — cho **mọi** địa chỉ, kể cả lạ (challenge ma).
      const material = await createOtpChallenge(otpSecret, OTP_PURPOSE_LOGIN);
      const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

      // Tra cứu địa chỉ — quyết định gửi mail hay không, KHÔNG quyết định response.
      const target = resolveOtpTarget(await lookupVerifiedAddress(pool, hash));

      try {
        const inserted = await insertChallenge(pool, {
          addressHash: hash,
          digest: material.digest,
          purpose: OTP_PURPOSE_LOGIN,
          expiresAt,
          resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        });
        if (inserted === null) {
          // Thua cooldown **trong** transaction: request song song vừa commit một
          // challenge còn trong 60s. Đây cùng họ với pre-check cooldown ở trên —
          // branch bị chặn bình thường, về `silently_rejected` (204).
          return 'silently_rejected' as const;
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Thua race: request song song vừa consume/insert trước. Đây là nhánh
          // bị chặn bình thường — cùng họ với cooldown — nên về `silently_rejected`
          // (204). Ném tiếp sẽ thành 503, một response phân biệt được và là
          // oracle cho kẻ dò ("địa chỉ này đang có người cấp mã thật").
          return 'silently_rejected' as const;
        }
        throw error;
      }

      if (target.kind !== 'verified') {
        // Challenge ma: digest được ghi (rate-limit địa chỉ lạ như địa chỉ thật),
        // mail KHÔNG đi ra. Log mã ổn định — không log địa chỉ (đó là dữ liệu
        // định danh, SR-001; address_hash đủ để điều tra mà không lộ).
        return 'silently_rejected' as const;
      }

      const correlationId = material.digest.slice(0, 16);
      const mailResult = await sendConfigured(config, {
        recipient: body.email,
        code: material.code,
        correlationId,
      });

      // Mail lỗi không đổi response (anti-enumeration) — chỉ log mã lý do.
      //
      // ⚠️ Nuốt lỗi ở đây KHÔNG đồng nghĩa với ngụy trang: `sendMail` không bao giờ
      // ném cho lỗi đã phân loại (`rejected`/`invalid_payload`/`unreachable` đều là
      // `{ ok: false, reason }` — lib/mail.ts), và response luôn 204 giữ nguyên.
      // Bằng chứng phía service duy nhất của nhánh failed là log `mail_failed`
      // dưới: đây là contract observability của route (SR-010 — quan sát, không
      // điều kiện cấp), và không đường nào biến một gửi-thất-bại thành `ok` hay
      // response "đã gửi" cho client.
      if (!mailResult.ok) {
        writeLog({
          event: 'otp_challenge.mail_failed',
          status: 204,
          reason: mailResult.reason,
          error_code: mailResult.detail ?? 'none',
        });
      } else {
        writeLog({ event: 'otp_challenge.created', status: 204 });
      }
      return 'sent' as const;
    });
  } catch {
    writeLog({ event: 'otp_challenge.failed', status: 503, reason: 'db_unreachable' });
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' });
  }

  // Nhánh nào cũng 204 — bất biến anti-enumeration của route.
  setResponseHeader(event, 'Cache-Control', 'no-store');
  if (outcome === 'silently_rejected') {
    writeLog({ event: 'otp_challenge.suppressed', status: 204 });
  }
  event.node.res.statusCode = 204;
  return null;
});

/**
 * Gửi mail với URL từ config — tách hàm để route ngắn và để test mock được
 * `sendMail` qua module mock mà không dựng runtime config.
 *
 * ⚠️ Contract receiver bắt buộc `Idempotency-Key` per-attempt: `sendMail` tự đặt
 * header từ `correlationId` ({@link otpMailIdempotencyKey} trong lib/mail.ts), với
 * correlationId = 16 hex đầu của digest HMAC của attempt tại route này — per-challenge
 * unique (mỗi attempt sinh digest riêng), deterministic cho retry cùng attempt.
 */
function sendConfigured(
  config: { mailServiceUrl?: unknown },
  params: { recipient: string; code: string; correlationId: string },
): ReturnType<typeof sendMail> {
  const url = typeof config.mailServiceUrl === 'string' ? config.mailServiceUrl : undefined;
  const request = buildOtpMailRequest({
    recipient: params.recipient,
    code: params.code,
    correlationId: params.correlationId,
  });
  return sendMail(url, request);
}
