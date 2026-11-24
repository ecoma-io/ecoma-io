/**
 * Khai báo global tối thiểu cho các Web API mà `@ecoma-io/auth-domain` thực dùng:
 * WebCrypto (`crypto.subtle` HMAC + digest), `TextEncoder` và `btoa`/`atob`
 * (base64url codec).
 *
 * ⚠️ **Vì sao không thêm `"dom"` vào `lib` hay dùng `@cloudflare/workers-types`:** lib
 * mang tag `runtime:universal` — cam kết chạy được trên cả Cloudflare Workers lẫn Node
 * (vitest chạy trên Node). Cùng lý do với `universal-web-api.d.ts` của
 * `account-domain`. Mọi API khai dưới đây thuộc phần giao thực có trên cả Workers lẫn
 * Node ≥ 19; thêm API Workers-only hay browser-only vào lib này sẽ FAIL typecheck ngay.
 */

interface UniversalSubtleCrypto {
  importKey(
    format: string,
    keyData: Uint8Array,
    algorithm: string | { readonly name: string; readonly hash: string },
    extractable: boolean,
    usages: readonly string[],
  ): Promise<object>;
  sign(
    algorithm: string | { readonly name: string },
    key: object,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

declare const crypto: {
  readonly subtle: UniversalSubtleCrypto;
};

declare class TextEncoder {
  public encode(input?: string): Uint8Array;
}

/** Base64 codec — có trên cả Workers lẫn Node ≥ 16. */
declare function btoa(data: string): string;
declare function atob(data: string): string;
