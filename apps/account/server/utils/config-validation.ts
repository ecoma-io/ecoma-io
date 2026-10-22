/**
 * Validate cấu hình runtime của app `account` — **fail closed**.
 *
 * ## Vì sao validate request đầu chứ không phải ở từng call site, cũng không ở init
 *
 * `03-operations.md` §8 nói rõ failure mode của identity: khi `db-account` không
 * trả lời được thì **không phát hành**, không có degraded path. Cùng nguyên tắc đó
 * áp cho config: một Worker nhận traffic với config thiếu secret thì mọi request
 * `/internal/**` đã đi vào một đường **không xác thực được** mà không ai biết —
 * nên phải ném, không có degraded path.
 *
 * Nhưng **không** validate ở module-init: trên Workers preset, Nitro build ra
 * module với `createNitroApp()` chạy top-level trong `index.mjs`, trong khi secret
 * của Worker chỉ được nối vào runtime config ở request. Validate ở init đọc một
 * config chưa có secret và `throw` ⇒ module không load được ⇒ kể cả deployment
 * **đúng** cũng chết. {@link lazyConfigValidator} giữ fail-closed ở request đầu.
 *
 * ⚠️ **Không có fallback giá trị rỗng.** Thiếu biến ⇒ `throw`. Một internal HMAC
 * secret rỗng thì `verifyRequest` chạy trơn và **chấp nhận mọi chữ ký** — đúng cái
 * kiểu hỏng mà SR-010 cấm. Vì vậy "cho chạy được với secret rỗng" không phải là
 * degrade an toàn, nó là tắt xác thực.
 *
 * ## Vì sao file này tách khỏi `server/plugins/config.ts`
 *
 * Plugin Nitro gọi `defineNitroPlugin` ở **module scope**, nên bất kỳ ai import
 * plugin đó đều chạy lệnh đó — và `defineNitroPlugin` là auto-import của Nitro,
 * không tồn tại ngoài runtime Nitro. Đặt hàm validate vào đó nghĩa là không có cách
 * nào test nó mà không dựng cả runtime. Tách ra đây giữ validate thuần (test được
 * trực tiếp, không cần stub) và giữ plugin làm lớp glue.
 */

import { assertKid, MAX_SKEW_SECONDS, MIN_SKEW_SECONDS } from '@ecoma-io/identity-contracts';

import { MIN_OTP_HMAC_SECRET_LENGTH } from '../lib/otp';

/** Độ dài tối thiểu của internal HMAC secret, tính bằng ký tự. */
const MIN_INTERNAL_HMAC_SECRET_LENGTH = 32;

/** Phần `runtimeConfig` mà app đọc (không kể `public`). */
export interface AccountRuntimeConfig {
  internalHmacSecret?: unknown;
  internalHmacKid?: unknown;
  internalHmacPreviousSecret?: unknown;
  internalHmacPreviousKid?: unknown;
  internalAuthSkewSeconds?: unknown;
  /** Secret HMAC của OTP — digest mã 8 chữ số trước khi ghi DB. */
  otpHmacSecret?: unknown;
  /** Origin của transactional-mail (không có path cuối) — rỗng ⇒ mail fail-closed. */
  mailServiceUrl?: unknown;
}

/**
 * Validate config của app `account`.
 *
 * Ném {@link Error} khi thiếu hoặc sai; trả `undefined` khi hợp lệ. Hàm thuần,
 * không đọc `process.env` — nhận object làm tham số để test được trực tiếp, và để
 * `runtimeConfig` của Nuxt là nguồn duy nhất cho config (không có chỗ nào trong code
 * tự đọc `process.env` và đi vòng qua đường đó).
 */
export function validateAccountConfig(config: AccountRuntimeConfig): void {
  const secret = config.internalHmacSecret;

  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(
      'Thiếu NUXT_INTERNAL_HMAC_SECRET. Worker internal contract không chạy được ' +
        'không có secret: envelope HMAC phải fail closed, không có fallback rỗng.',
    );
  }

  if (secret.length < MIN_INTERNAL_HMAC_SECRET_LENGTH) {
    // Chỉ nêu **ngưỡng**, không nêu độ dài thật của secret: message này đọc được
    // trong log của platform, và độ dài secret là thông tin hữu ích cho attacker.
    throw new Error(
      `NUXT_INTERNAL_HMAC_SECRET phải dài ít nhất ${MIN_INTERNAL_HMAC_SECRET_LENGTH} ký tự.`,
    );
  }

  const skew = config.internalAuthSkewSeconds;
  if (skew !== undefined && skew !== null) {
    // Rỗng (`''` từ `runtimeConfig`) là "chưa đặt" và được bỏ qua để mặc định của
    // `identity-contracts` là nguồn duy nhất — tránh hai nguồn sự thật cho một luật.
    if (
      skew !== '' &&
      (typeof skew !== 'number' || !Number.isInteger(skew) || skew < MIN_SKEW_SECONDS)
    ) {
      throw new Error(`NUXT_INTERNAL_AUTH_SKEW_SECONDS phải là số nguyên >= ${MIN_SKEW_SECONDS}.`);
    }
    // Trần là **hằng giao thức** của lib (`MAX_SKEW_SECONDS`), không phải ngưỡng cục bộ:
    // nếu `account` nhận một skew mà `auth` từ chối, hai service chạy hai cửa sổ khác nhau
    // và bên rộng hơn quyết định thời gian sống thật của cửa sổ replay. Kiểm ở đây để lỗi
    // hiện ra lúc validate chứ không âm thầm nới cửa sổ.
    if (typeof skew === 'number' && Number.isInteger(skew) && skew > MAX_SKEW_SECONDS) {
      throw new Error(`NUXT_INTERNAL_AUTH_SKEW_SECONDS vượt trần ${MAX_SKEW_SECONDS} giây.`);
    }
  }

  // OTP HMAC secret — cùng luật fail-closed với internal HMAC. Một secret rỗng
  // hay ngắn khiến digest của mã OTP trở nên đoán được (HMAC với key yếu không
  // còn là keyed digest), tức bảng `otp_challenges` lưu thứ có thể khôi phục mã
  // từ digest bằng vét cạn 10^8 giá trị trong thời gian ngắn.
  const otpSecret = config.otpHmacSecret;
  if (typeof otpSecret !== 'string' || otpSecret.length === 0) {
    throw new Error(
      'Thiếu NUXT_OTP_HMAC_SECRET. Luồng đăng nhập email-OTP không chạy được không có secret: ' +
        'digest mã OTP phải fail closed, không có fallback rỗng.',
    );
  }
  if (otpSecret.length < MIN_OTP_HMAC_SECRET_LENGTH) {
    // Chỉ nêu **ngưỡng**, không nêu độ dài thật — message đọc được trong log platform.
    throw new Error(`NUXT_OTP_HMAC_SECRET phải dài ít nhất ${MIN_OTP_HMAC_SECRET_LENGTH} ký tự.`);
  }

  // `kid` của internal HMAC — bộ luật hình dạng **cùng hằng** của lib (`assertKid`):
  // 8–16 hex chữ thường. Rỗng ⇒ transition (kid chưa bật), hợp lệ. Sai hình dạng khi
  // được đặt là cấu hình sai rõ ràng, fail closed ở request đầu.
  validateOptionalKid(config.internalHmacKid, 'NUXT_INTERNAL_HMAC_KID');
  validateOptionalKid(config.internalHmacPreviousKid, 'NUXT_INTERNAL_HMAC_PREVIOUS_KID');

  // Cặp previous: cả hai cùng được đặt hoặc cùng vắng mặt — một mình một cái là cấu hình
  // sai rõ ràng (envelope có `kid` previous không tra được, hoặc `kid` cũ không có khoá
  // theo sau). Trùng `kid` hai dòng là mơ hồ theo đúng nghĩa, chặn luôn; trùng **giá trị
  // secret** cho hai `kid` khác nhau cũng chặn — hai `kid` chia một secret làm selector
  // 'kid nào cũng đúng'.
  const prevSecret = config.internalHmacPreviousSecret;
  const prevKid = config.internalHmacPreviousKid;
  validateSecretValue(prevSecret, 'NUXT_INTERNAL_HMAC_PREVIOUS_SECRET');
  const hasPrevSecret = typeof prevSecret === 'string' && prevSecret.length > 0;
  const hasPrevKid = typeof prevKid === 'string' && prevKid.length > 0;
  if (hasPrevSecret !== hasPrevKid) {
    throw new Error(
      hasPrevSecret
        ? 'NUXT_INTERNAL_HMAC_PREVIOUS_SECRET được đặt nhưng thiếu NUXT_INTERNAL_HMAC_PREVIOUS_KID.'
        : 'NUXT_INTERNAL_HMAC_PREVIOUS_KID được đặt nhưng thiếu NUXT_INTERNAL_HMAC_PREVIOUS_SECRET.',
    );
  }
  if (
    hasPrevKid &&
    typeof config.internalHmacKid === 'string' &&
    config.internalHmacKid.length > 0
  ) {
    if (config.internalHmacKid === prevKid) {
      throw new Error(
        'NUXT_INTERNAL_HMAC_KID trùng NUXT_INTERNAL_HMAC_PREVIOUS_KID — hai khoá không thể chia một `kid`.',
      );
    }
  }
  if (hasPrevSecret && typeof secret === 'string' && secret === prevSecret) {
    throw new Error(
      'NUXT_INTERNAL_HMAC_SECRET trùng NUXT_INTERNAL_HMAC_PREVIOUS_SECRET — hai `kid` không thể chia một secret.',
    );
  }

  // Mail service URL — để trống là "chưa cấu hình", và luồng OTP cần gửi mail nên
  // phải fail closed ở request chứ không gửi được với URL rỗng. Chỉ kiểm hình dạng
  // http(s):// origin: URL sai host là lỗi cấu hình lộ ở lần gửi thật, còn một
  // kiểm host cứng ở đây sẽ thành allowlist phải cập nhật mỗi lần đổi môi trường.
  const mailUrl = config.mailServiceUrl;
  if (mailUrl !== undefined && mailUrl !== '') {
    if (typeof mailUrl !== 'string' || !/^https?:\/\//u.test(mailUrl)) {
      throw new Error('NUXT_MAIL_SERVICE_URL phải là origin http(s) của transactional-mail.');
    }
  }
}

/**
 * Validate một `kid` tuỳ chọn — rỗng/`undefined` ⇒ hợp lệ (transition, `kid` chưa bật).
 *
 * Hình dạng lấy từ **chính lib** (`assertKid`) chứ không chép lại regex ở đây: một
 * hằng giao thức có hai nơi định nghĩa là chỗ hai bên lệch nhau trong im lặng.
 */
function validateOptionalKid(value: unknown, name: string): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} phải là chuỗi.`);
  }
  try {
    assertKid(value);
  } catch {
    // ⚠️ Không nêu giá trị — `kid` sai có thể là nhầm dán secret, và message này đọc
    // được trong log của platform.
    throw new Error(`${name} phải là 8-16 ký tự hex chữ thường.`);
  }
}

/**
 * Validate một secret tuỳ chọn — rỗng/`undefined` ⇒ vắng mặt (hợp lệ); có thì phải là
 * chuỗi **không** rỗng và **không** có khoảng trắng đầu/cuối.
 *
 * Cùng luật với `internalHmacSecret`: trim âm thầm đổi giá trị bí mật, và hai bên
 * dùng hai giá trị khác nhau là hỏng đóng — nên từ chối thay vì sửa.
 */
function validateSecretValue(value: unknown, name: string): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} phải là chuỗi.`);
  }
  if (value !== value.trim()) {
    throw new Error(`${name} không được có khoảng trắng đầu hoặc cuối.`);
  }
}

/**
 * Validator **trì hoãn** tới lần request đầu tiên — vẫn fail closed, nhưng không
 * nữa ở mức module-init.
 *
 * ## Vì sao không validate lúc plugin Nitro khởi tạo
 *
 * Trên Workers preset, Nitro build ra module với `createNitroApp()` chạy ở
 * **top-level** của `index.mjs` — tức Worker module load là chạy plugin. Nhưng
 * secret của Worker (`wrangler secret`) được Nitro nối vào runtime config ở
 * **request** (env của Workers không tồn tại ở module scope của module Worker
 * theo cùng cách). Validate ở init vì thế đọc một runtime config **chưa có
 * secret** và `throw` ⇒ module không load được ⇒ Worker chết ngay cả khi
 * deployment cấu hình **đúng** — fail-closed sai chỗ, biến một cấu hình đúng
 * thành một Worker không bao giờ phục vụ.
 *
 * Trì hoãn sang request đầu giữ nguyên bản chất fail-closed: request đầu tiên
 * chạm vào config thiếu **vẫn** ném (500 từ hook request, và riêng contract
 * internal vẫn 401 `no_secret` ở middleware — hai lớp độc lập). Flag được set
 * **chỉ sau khi** validate đi qua: ném ở giữa thì cờ chưa set, request sau thử
 * lại và vẫn fail — không có đường "thử một lần rồi cho qua".
 *
 * @param readConfig Đọc runtime config theo event của request hiện tại (Nitro
 *   auto-import `useRuntimeConfig` cần event trên Workers).
 * @returns Hàm ensure gọi trên mỗi request; đắt nhất một boolean check khi đã
 *   hợp lệ.
 */
export function lazyConfigValidator(
  readConfig: (event: unknown) => AccountRuntimeConfig,
): (event: unknown) => void {
  let validated = false;
  return (event: unknown): void => {
    if (validated) {
      return;
    }
    validateAccountConfig(readConfig(event));
    validated = true;
  };
}
