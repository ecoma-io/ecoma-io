/**
 * Port thời gian — TTL và expiry tính từ đây để unit tests kiểm soát được.
 * Trả epoch milliseconds (khớp convention domain dùng `now: number`).
 */
export interface Clock {
  now(): number;
}
