import type { GrantId, Kid } from './types.js';

/**
 * Port signing/issuance — Use Case KHÔNG import `jose` hay bất kỳ crypto implementation.
 * Implementation (ES256, non-extractable key, JWKS allow-list) thuộc Infrastructure.
 */

export interface AccessTokenIssued {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly kid: Kid;
}

/** Lưu ý: chỉ trả token AT; refresh token opaque do RefreshTokenIssuer riêng. */
export interface AccessTokenIssuer {
  /** Phát AT JWT (typ: at+jwt, ES256). TTL và signing policy do Infrastructure cấu hình. */
  issueAccessToken(input: {
    subject: string;
    clientId: string;
    grantId: GrantId;
    scope: readonly string[];
    /** TTL seconds yêu cầu; Infrastructure clamp về MAX (900s từ legacy). */
    ttlSeconds: number;
  }): Promise<AccessTokenIssued>;
}

export interface RefreshTokenIssued {
  /** Opaque refresh token (32 random bytes base64url) — chỉ xuất hiện 1 lần cho client. */
  readonly refreshToken: string;
  /** Family id phục vụ rotation + reuse detection. */
  readonly familyId: string;
  readonly expiresIn: number;
}

export interface RefreshTokenIssuer {
  /**
   * Tạo refresh token mới (mở family mới) hoặc rotate trong family hiện có.
   * Rotation semantics: token cũ bị vô hiệu, family id giữ nguyên.
   */
  issueOrRotate(input: {
    subject: string;
    clientId: string;
    grantId: GrantId;
    scope: readonly string[];
    familyId?: string | undefined;
  }): Promise<RefreshTokenIssued>;
}

/** Id token/userinfo không thuộc scope lib này — chỉ AT/RT theo task. */
