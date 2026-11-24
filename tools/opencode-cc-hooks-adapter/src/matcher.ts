/**
 * Kiểm tra một hook có nên chạy hay không dựa trên matcher.
 *
 * @param matcher - Pattern regex lấy từ settings (có thể bỏ trống)
 * @param value - Giá trị để so khớp (thường là tên tool). Nếu undefined thì luôn khớp.
 * @returns true nếu hook nên chạy
 */
export function matchHook(matcher: string | undefined, value: string | undefined): boolean {
  // Event không có khái niệm matcher thì luôn khớp
  if (value === undefined) return true;

  // Chuỗi rỗng, "*" hoặc không khai báo matcher đều khớp tất cả
  if (!matcher || matcher === '*') return true;

  try {
    const regex = new RegExp(matcher, 'i');
    return regex.test(value);
  } catch {
    // Regex không hợp lệ thì coi như không khớp để tránh crash
    return false;
  }
}
