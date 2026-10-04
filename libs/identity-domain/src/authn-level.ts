/**
 * Thang bằng chứng xác thực (`authn_level`) — thang **có thứ tự**.
 *
 * Session lưu `authn_level` + `authn_at` (FR-004b). Hành động nhạy cảm đòi bằng
 * chứng **đủ mới**, không suy ra từ tuổi session. Thứ tự trong module này là thứ
 * tự mạnh dần: `anonymous` yếu nhất, `passkey` mạnh nhất.
 *
 * ⚠️ Việc bật passkey trước TOTP hay sau vẫn chưa chốt (`01-architecture.md` §10).
 * Thang này định nghĩa **thứ tự tương đối** của các mức đã có, không quyết định
 * cái nào được bật trước.
 */

/** Các mức bằng chứng, từ yếu đến mạnh. Thứ tự khai báo CHÍNH LÀ thứ tự leo. */
export const AUTHN_LEVEL = {
  Anonymous: 'anonymous',
  Password: 'password',
  Totp: 'totp',
  Passkey: 'passkey',
} as const;

/** Union của các mức bằng chứng. */
export type AuthnLevel = (typeof AUTHN_LEVEL)[keyof typeof AUTHN_LEVEL];

/**
 * Thang leo, yếu → mạnh. Vị trí trong mảng là "bậc" của mức đó.
 *
 * Thứ tự phải giữ nguyên khi thêm mức mới; thêm sai vị trí làm sai thứ tự so sánh.
 */
export const AUTHN_LEVELS = [
  AUTHN_LEVEL.Anonymous,
  AUTHN_LEVEL.Password,
  AUTHN_LEVEL.Totp,
  AUTHN_LEVEL.Passkey,
] as const;

/** Type guard cho `AuthnLevel`. */
export function isAuthnLevel(value: unknown): value is AuthnLevel {
  return typeof value === 'string' && (AUTHN_LEVELS as readonly string[]).includes(value);
}

/** Bậc của một mức bằng chứng; `anonymous` là 0. */
export function authnLevelRank(level: AuthnLevel): number {
  return AUTHN_LEVELS.indexOf(level);
}

/**
 * So sánh hai mức bằng chứng.
 *
 * @returns Âm nếu `a` yếu hơn `b`, 0 nếu bằng, dương nếu `a` mạnh hơn.
 */
export function compareAuthnLevels(a: AuthnLevel, b: AuthnLevel): number {
  return authnLevelRank(a) - authnLevelRank(b);
}

/** `true` khi `a` mạnh hơn hoặc bằng `b`. */
export function authnLevelSatisfies(actual: AuthnLevel, required: AuthnLevel): boolean {
  return compareAuthnLevels(actual, required) >= 0;
}

/** `true` khi `level` đủ mạnh cho hành động nhạy cảm yêu cầu `required`. */
export function meetsAuthnLevel(level: AuthnLevel, required: AuthnLevel): boolean {
  return authnLevelSatisfies(level, required);
}
