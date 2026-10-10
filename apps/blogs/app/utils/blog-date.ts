/**
 * Formatting ngày hiển thị của blog — tách khỏi component để test được và để
 * một quy tắc format duy nhất dùng chung mọi view (`BlogLandingView`,
 * `BlogArticleCard`, `BlogArticleView`).
 *
 * `timeZone: 'UTC'` là bắt buộc: `date` là ISO date `YYYY-MM-DD` không mang
 * giờ, parse kèm `T00:00:00Z` neo thời điểm; không neo timezone thì SSR
 * (timezone server) và hydration (timezone máy người đọc) có thể in hai ngày
 * khác nhau cho cùng một article.
 */

/** Option chung cho mọi format ngày article — năm/tháng/ngày đầy đủ, UTC. */
const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
} as const;

/**
 * Format ngày xuất bản theo locale hiển thị.
 *
 * Ngày không parse được (frontmatter lệch schema, `date: ''` từ route fallback)
 * trả **chuỗi rỗng** thay vì in `Invalid Date` ra UI — component quyết định có
 * render `<time>` hay không, chuỗi rỗng là tín hiệu "ẩn đi".
 */
export function formatArticleDate(date: string, localeCode: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(localeCode, DATE_FORMAT_OPTIONS);
}

/**
 * Đúng khi ngày hợp lệ hiển thị được — điều kiện render `<time>` của view:
 * ngày rỗng hoặc không parse được thì meta dòng ngày biến mất, phần còn lại
 * của card vẫn render.
 *
 * Round-trip qua UTC components thay vì chỉ check `NaN`: JS Date **roll over**
 * ngày ngoài lịch (`2026-02-31` → 3/3) thay vì trả Invalid Date, nên kiểm tra
 * `NaN` một mình lọt qua ngày không tồn tại mà schema regex vẫn cho qua
 * (`^\d{4}-\d{2}-\d{2}$` chỉ khớp hình dạng).
 */
export function isValidArticleDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return (
    year !== undefined &&
    month !== undefined &&
    day !== undefined &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
