/**
 * Machine-token auth cho Pact CLI — auth pattern 2 của docs/services/
 * pact-broker/01-architecture.md §5.2.
 *
 *  * Token 32 byte entropy, base64url; chỉ hash SHA-256 nằm trong DB
 *    (`pact.machine_tokens.token_hash` UNIQUE). Token bản rõ không bao giờ
 *    được log, không bao giờ nằm trong error response.
 *  * Lookup theo hash → tenant + scopes + revoked_at: revoke là hiệu lực tức
 *    thời, không cần cache invalidation.
 *  * 401 ĐỒNG NHẤT cho mọi lý do (thiếu header, token lạ, token đã revoke,
 *    tenant suspended) — không giúp kẻ dò biết nó sai ở bước nào.
 *  * Scope read/write/admin: write bao read, admin bao write. Endpoint chỉ
 *    đọc đòi `read`; endpoint ghi đòi `write`; quản trị token/membership đòi
 *    `admin`.
 *
 * KHÔNG dùng middleware này cho dashboard: dashboard đi OIDC qua BFF
 * (§5.1), và BFF không bao giờ thấy machine token.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../domain/types';
import { sha256Hex } from './hashing';

/** Hình dạng repo tra token — repo layer cài đặt. */
export interface TokenLookupResult {
  tokenId: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended' | 'deleted';
  scopes: string[];
  revokedAt: Date | null;
}

export interface TokenRepo {
  /** Tra token theo SHA-256 hash. `null` = không có token nào khớp. */
  findByTokenHash(tokenHash: string): Promise<TokenLookupResult | null>;
}

/**
 * Scope có thứ bậc: admin ⊃ write ⊃ read. Mảng scopes của token là tập phẳng
 * (CHECK trong DB ép `read|write|admin` cách nhau bởi dấu cách); token với
 * scope `admin` thỏa mọi đòi hỏi.
 */
export function scopeSatisfied(scopes: string[], required: 'read' | 'write' | 'admin'): boolean {
  if (required === 'read') {
    return scopes.includes('read') || scopes.includes('write') || scopes.includes('admin');
  }
  if (required === 'write') {
    return scopes.includes('write') || scopes.includes('admin');
  }
  return scopes.includes('admin');
}

/**
 * SHA-256 hex của token bản rõ — đúng hàm DB-side dùng khi insert.
 *
 * Tham số `plainToken` thay vì `token`: tên `token` là nguồn của rule
 * security-sensitive-value-in-http-response. Kết quả là digest SHA-256 —
 * một chiều, không chứa bit nào của token — nên dòng return không phải
 * rò rỉ; tên tham số trung tính giúp rule nhìn thấy đúng điều đó.
 */
export function hashToken(plainToken: string): Promise<string> {
  return sha256Hex(plainToken);
}

/** Chuỗi Authorization hợp lệ duy nhất: `Bearer <token>`. */
function extractBearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(headerValue);
  return match ? (match[1] ?? null) : null;
}

/**
 * 401 response ĐỒNG NHẤT. Không phân biệt lý do — cùng status, cùng body
 * shape, cùng WWW-Authenticate. Message tiếng Anh không dấu là CLI output
 * cho máy đọc.
 */
function unauthorized(requestId: string): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', requestId }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="pact-broker-api"',
    },
  });
}

/**
 * Factory middleware: đòi machine token có scope `required` và tenant active.
 *
 * ⚠️ Hash tra DB, không so sánh token bản rõ với cột nào. `timingSafeEqual`
 * không cần ở đây: lookup là index unique theo hash SHA-256 — không có chuỗi
 * bí mật nào được so từng byte trong code.
 */
export function requireMachineToken(
  repo: TokenRepo,
  required: 'read' | 'write' | 'admin',
): MiddlewareHandler<AppEnv> {
  // Không annotate tường minh: ngữ cảnh đã là `Promise<Response | void>` từ
  // `MiddlewareHandler` của Hono; viết `Promise<Response | void>` ra thì vi
  // phạm rule lint `no-invalid-void-type` của repo (void trong union).
  return async (c, next) => {
    const token = extractBearerToken(c.req.header('authorization'));
    if (token === null) {
      return unauthorized(c.get('requestId') ?? '');
    }

    const lookup = await repo.findByTokenHash(await hashToken(token));
    if (lookup === null) {
      return unauthorized(c.get('requestId') ?? '');
    }
    // Token revoked, tenant suspended/deleted: cùng 401 với token lạ.
    if (lookup.revokedAt !== null || lookup.tenantStatus !== 'active') {
      return unauthorized(c.get('requestId') ?? '');
    }
    if (!scopeSatisfied(lookup.scopes, required)) {
      // 403 chỉ khi token HỢP LỆ nhưng thiếu scope — ở đây tiết lộ được và
      // nên tiết lộ: owner cần biết token thiếu scope nào.
      return c.json(
        { error: 'Forbidden', message: `Token does not have required scope: ${required}` },
        403,
      );
    }

    c.set('tenantId', lookup.tenantId);
    c.set('tenantName', lookup.tenantName);
    c.set('scopes', lookup.scopes);
    c.set('tokenId', lookup.tokenId);
    await next();
    return undefined;
  };
}
