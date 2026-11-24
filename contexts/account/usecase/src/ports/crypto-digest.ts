/**
 * Port crypto thuần — các phép HMAC/digest mà domain yêu cầu caller tính trước
 * (convention §3: domain không tự gọi WebCrypto async).
 * - `hashAddressKey` của domain đã có — port này bọc các phép tương tự cho
 *   OTP digest (HMAC-SHA256 của `purpose:code`) và so sánh timing-safe.
 */
export interface CryptoDigestPort {
  /** HMAC-SHA256 hex 64 ký tự của chuỗi key `purpose:code`. */
  hmacSha256Hex(key: string, value: string): Promise<string>;
  /** So sánh timing-safe hai chuỗi hex cùng độ dài. */
  timingSafeEqualHex(a: string, b: string): boolean;
  /** Sinh mã OTP: chuỗi digits (mặc định 8) bằng rejection sampling — không modulo bias. */
  randomDigits(digits: number): string;
}
