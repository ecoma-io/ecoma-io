/**
 * Port thời gian — TTL, mốc created_at/settled_at luôn tính từ đây để unit
 * tests kiểm soát được (theo auth-usercase; domain không đọc đồng hồ).
 */
export interface Clock {
  now(): number;
}
