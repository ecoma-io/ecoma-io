/**
 * Port thời gian — TTL và expiry luôn tính từ đây để unit tests kiểm soát được.
 */
export interface Clock {
  now(): Date;
}
