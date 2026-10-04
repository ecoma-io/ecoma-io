/**
 * `auth` là API-only Worker của bounded context `identity`.
 *
 * Kiến trúc route (xem `oidc/runtime.ts` về việc chia hai lanes):
 *   - **Hono** giữ `/health`, `/.well-known/*`, `/authorize`, `/authorize/confirm`,
 *     `/internal/*` — những route KHÔNG cần pipeline Koa của provider.
 *   - **Provider (qua bridge Node)** giữ `/auth`, `/auth/:uid` (resume), `/token`,
 *     `/jwks.json`, `/revocation`, `/session/end` — `PROVIDER_ROUTES` là bảng
 *     chuyển tiếp duy nhất.
 *
 * ⚠️ Endpoint nào chưa được implement thì **KHÔNG trả 200 với body rỗng hay
 * "sẽ có sau"**. Thiếu route thì Hono trả 404, và 404 là sự thật.
 */

import { Hono } from 'hono';

import {
  INTERNAL_BODY_LIMIT_BYTES,
  type VerifyFailureReason,
} from '@ecoma-io/identity-auth-contracts';
import { createAuthorizationStore } from './authorization-store';
import { AccountClient, isAuthenticatedInternalRequest } from './account-client';
import { type AuthConfig, type AuthEnv, loadAuthConfig } from './config';
import { PROVIDER_ROUTES } from './oidc/provider';
import { dispatchToNode, getRuntime } from './oidc/runtime';
import { handleAuthorize, handleAuthorizeConfirm } from './browser-handlers';
import { runSessionVerified } from './session-verified-handler';
import { runConsentContext, runConsentDecide } from './consent-handler';

const app = new Hono();

/**
 * `Retry-After` cho nhánh `503` khi kho nonce/DB không gọi được — đơn vị **giây**.
 *
 * `docs/overview/03-operations.md` §3.2 chốt "DB không lấy được connection ⇒ 503 +
 * `Retry-After`", nên header này là phần của hợp đồng trạng thái, không phải tuỳ chọn
 * hiển thị.
 */
const INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS = '5';

/**
 * Cấu hình đã nạp, cache theo isolate.
 *
 * ⚠️ Không cache thì mỗi request sẽ import lại PKCS#8 và tạo handle khoá mới —
 * thao tác đắt trên đường phục vụ. ⚠️ Cache theo PROMISE và KHÔNG cache lỗi —
 * một `loadAuthConfig` thất bại phải thử lại ở request sau.
 */
let cachedConfigPromise: Promise<AuthConfig> | undefined;

async function getConfig(env: AuthEnv): Promise<AuthConfig> {
  cachedConfigPromise ??= loadAuthConfig(env).catch((error: unknown) => {
    cachedConfigPromise = undefined;
    throw error;
  });
  return await cachedConfigPromise;
}

/**
 * Phân loại lỗi hạ tầng cho back-channel: lỗi đến từ pool/Postgres hoặc từ
 * `AccountClient` (service binding) là "dependency unavailable" ⇒ 503; còn lại
 * là bug nội bộ ⇒ 500. KHÔNG bao giờ đổi một lỗi hạ tầng thành một kết quả
 * nghiệp vụ (fail-closed).
 */
function isInfrastructureError(error: unknown): boolean {
  if (error instanceof Error) {
    // postgres.js ném `PostgresError`; AccountClient ném Error thường kèm
    // message tiếng Việt. Kiểm theo nguồn gốc: tên class của driver là tín
    // hiệu duy nhất đáng tin, còn message là dữ liệu biến đổi — không so message.
    if (error.name === 'PostgresError') {
      return true;
    }
  }
  return false;
}

app.get('/health', (c) =>
  c.json({
    service: 'auth',
    status: 'ok',
    time: new Date().toISOString(),
  }),
);

/**
 * Discovery — SHADOW cả hai well-known của OIDC Core §4 và OAuth 2.0 AF §5.
 *
 * ⚠️ Dựng từ `PROVIDER_ROUTES` + `config.issuer`, KHÔNG hardcode path: provider
 * là nguồn sự thật của chính routes nó mount, và ghi lại chúng hai nơi là hai
 * chỗ để lệch. Cùng lý do, `jwks_uri` trỏ `/jwks.json` của provider — bản
 * hand-rolled JWKS đã bỏ, một JWKS duy nhất từ chính bộ máy cấp token.
 *
 * ⚠️ "Trung thực" nghĩa là: chỉ quảng bá endpoint provider thực sự mount.
 * `revocation_endpoint` được mount (RFC 7009 bật) ⇒ được khai; `introspection`
 * và `userinfo` tắt ⇒ không xuất hiện trong document này. Client đọc sai một
 * endpoint không có là đi vào 404.
 *
 * ⚠️ Chính provider cũng serve một discovery riêng ở cùng đường (initialize
 * mounts `/.well-known/*` vô điều kiện) — nhưng nó KHÔNG qua adapter TÙY CHỈNH
 * đúng nghĩa khi clients của nó nạp động, và mọi giá trị (scopes_supported,
 * claims_supported) phải khớp cấu hình ECOMA. Shadow của Hono trả TRƯỚC bridge
 * (route Hono khớp trước khi rơi xuống provider), và trả cùng hình dạng —
 * nhưng có kiểm.
 */
function discoveryDocument(config: AuthConfig): Record<string, unknown> {
  const issuer = config.issuer;
  return {
    issuer,
    authorization_endpoint: `${issuer}${PROVIDER_ROUTES.authorization}`,
    token_endpoint: `${issuer}${PROVIDER_ROUTES.token}`,
    revocation_endpoint: `${issuer}${PROVIDER_ROUTES.revocation}`,
    jwks_uri: `${issuer}${PROVIDER_ROUTES.jwks}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: ['openid', 'offline_access', 'profile'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'aud', 'iss', 'exp', 'iat', 'nbf', 'client_id', 'scope'],
  };
}

app.get('/.well-known/openid-configuration', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  return c.json(discoveryDocument(config));
});

// RFC 8414 metadata — cùng một document, provider mount cả hai well-known
// (initialize_app.js), nên shadow phải shadow cả hai.
app.get('/.well-known/oauth-authorization-server', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  return c.json(discoveryDocument(config));
});

/**
 * `GET /authorize` — bước 1 của §5.1.2: mint transaction + cookie browser +
 * 302 vào route authorization của provider (`/auth`).
 *
 * Lỗi nghiệp vụ đã được `handleAuthorize` dịch xong thành JSON/redirect;
 * lỗi hạ tầng (DB chết) VẪN NÉM ra ngoài — Worker runtime trả 500, cùng cách
 * mọi dependency chết được xử lý, và log của platform giữ stack.
 */
app.get('/authorize', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  const runtime = await getRuntime(c.env as AuthEnv);
  return await handleAuthorize({
    config,
    store: createAuthorizationStore({ client: runtime.postgresClient }),
    query: c.req.query(),
    cookieHeader: c.req.header('cookie'),
    now: new Date(),
  });
});

/**
 * `GET /authorize/confirm?handle=X` — bước 2 của §5.1.2: đối chiếu cookie
 * browser binding rồi CAS `pending_browser → browser_confirmed`, rồi 302 về
 * login-continue của `account`.
 */
app.get('/authorize/confirm', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  const runtime = await getRuntime(c.env as AuthEnv);
  return await handleAuthorizeConfirm({
    store: createAuthorizationStore({ client: runtime.postgresClient }),
    query: c.req.query(),
    cookieHeader: c.req.header('cookie'),
    accountBaseUrl: config.accountBaseUrl,
    now: new Date(),
  });
});

/**
 * Đọc body theo stream với hạn mức tích lũy — KHÔNG dùng `arrayBuffer()`.
 *
 * `arrayBuffer()` nạp hết payload vào heap rồi mới so `byteLength`, nên request
 * chunked (không khai `Content-Length`) vẫn chiếm toàn bộ bộ nhớ trước khi bị
 * từ chối. Heap isolate của Workers ~128 MB, vài request song song là đủ OOM
 * isolate và làm chết mọi endpoint (kể cả `/health`). Đọc từng chunk rồi dừng
 * giữa chừng khi vượt hạn mức là chốt chặn thật cho cả hai dạng framing.
 */
async function readBodyLimited(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        // Từ chối NGAY, không đọc nốt: mỗi byte đã đọc là bộ nhớ đã cấp phát.
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Route nội bộ — dùng cho cả đăng ký route lẫn dòng log từ chối. */
const INTERNAL_VERIFIED_ROUTE = '/internal/session/verified';
const INTERNAL_CONSENT_CONTEXT_ROUTE = '/internal/consent/context';
const INTERNAL_CONSENT_DECIDE_ROUTE = '/internal/consent/decide';

/**
 * Ghi MỘT dòng log cho một lần từ chối internal.
 *
 * Hợp đồng log: chỉ `reason` cùng `event`, `route`, `method`, `status` —
 * **không** giá trị header, **không** message của driver, **không** byte nào
 * từ request. Logger này là chỗ duy nhất thực hiện hợp đồng đó.
 *
 * ⚠️ `no-console` của `.oxlintrc.json` bị tắt ở đúng một dòng dưới đây: Workers
 * không có sink nào khác, log chỉ đi qua `console.*`.
 *
 * ⚠️ **Nuốt mọi lỗi** (NFR-004): observability không được nằm trên serving path,
 * nên một lần ghi log thất bại không được làm request đổi trạng thái.
 */
function logInternalRejection(
  route: string,
  reason: VerifyFailureReason | 'db_unreachable',
  status: 401 | 503,
): void {
  try {
    // oxlint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: 'internal_auth.rejected',
        route,
        method: 'POST',
        status,
        reason,
      }),
    );
  } catch {
    // Cố tình im lặng — xem JSDoc ở trên.
  }
}

/**
 * Middleware chung cho cả ba route nội bộ: 413 → streaming read → envelope
 * HMAC verify trên RAW bytes → 503/401 phân loại.
 *
 * Trả `{ ok: true, raw, config }` khi envelope hợp lệ — handler nghiệp vụ tiếp
 * tục với body ĐÃ xác thực; trả `Response` khi từ chối.
 *
 * ⚠️ **`raw` đi thẳng vào verify — KHÔNG decode** (chi tiết đầy đủ ở lịch sử
 * file): decode non-fatal biến hai payload byte khác nhau thành cùng chuỗi ⇒
 * cùng bodyHash ⇒ chữ ký nói "tôi đã thấy chuỗi này" trong khi thứ được xác
 * thực là một ảnh chiếu mất thông tin. Không decode, không parse: một body JSON
 * dị dạng bị từ chối vì **chữ ký không khớp**, không vì parse lỗi.
 */
async function verifyInternalEnvelope(
  c: {
    readonly env: unknown;
    readonly req: {
      readonly raw: Request;
      readonly header: (name: string) => string | undefined;
    };
    json: (body: unknown, status: number, headers?: Record<string, string>) => Response;
  },
  route: string,
): Promise<
  | { readonly ok: true; readonly raw: Uint8Array; readonly config: AuthConfig }
  | { readonly ok: false; readonly response: Response }
> {
  const config = await getConfig(c.env as AuthEnv);

  // Từ chối NGAY khi `Content-Length` đã nói quá lớn — không cần đọc một byte
  // nào. Bước kiểm kích thước thật bên dưới vẫn là chốt chặn (chunked).
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > INTERNAL_BODY_LIMIT_BYTES) {
    return { ok: false, response: c.json({ error: 'payload_too_large' }, 413) };
  }

  const raw =
    c.req.raw.body === null
      ? new Uint8Array()
      : await readBodyLimited(c.req.raw.body, INTERNAL_BODY_LIMIT_BYTES);
  if (raw === null) {
    return { ok: false, response: c.json({ error: 'payload_too_large' }, 413) };
  }

  const auth = await isAuthenticatedInternalRequest({
    secret: config.internalSecret,
    request: c.req.raw,
    body: raw,
    nowMs: Date.now(),
    hyperdrive: config.hyperdrive,
    skewSeconds: config.internalAuthSkewSeconds,
  });

  if (!auth.ok) {
    // ⚠️ 401 + `WWW-Authenticate`, không nêu lý do cụ thể: nêu "signature_mismatch"
    // là biến response thành oracle dò chữ ký.
    //
    // ⚠️ `db_unreachable` là 503, không phải 401: khi DB chết ta KHÔNG THỂ khẳng
    // định nonce chưa từng thấy — fail-closed.
    if (auth.reason === 'db_unreachable') {
      logInternalRejection(route, auth.reason, 503);
      return {
        ok: false,
        response: c.json({ error: 'service_unavailable' }, 503, {
          'Retry-After': INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS,
        }),
      };
    }
    logInternalRejection(route, auth.reason, 401);
    return {
      ok: false,
      response: c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'HMAC realm="ecoma-internal"',
      }),
    };
  }

  return { ok: true, raw, config };
}

/**
 * `POST /internal/session/verified` — `account` báo identity đã xác minh.
 *
 * Sau envelope: `runSessionVerified` chạy toàn bộ bước 10-11 của §5.1.2 (CAS
 * consume X + bind → fail-closed account status → consent/grant branch →
 * continue_url). Lỗi hạ tầng NÉM qua handler và được phân loại dưới đây.
 */
app.post(INTERNAL_VERIFIED_ROUTE, async (c) => {
  const verified = await verifyInternalEnvelope(c, INTERNAL_VERIFIED_ROUTE);
  if (!verified.ok) {
    return verified.response;
  }
  const { raw, config } = verified;

  try {
    const runtime = await getRuntime(c.env as AuthEnv);
    const account = new AccountClient({
      binding: (c.env as AuthEnv).ACCOUNT_SERVICE as {
        fetch: (request: Request) => Promise<Response>;
      },
      secret: config.internalSecret,
    });
    const result = await runSessionVerified({
      provider: runtime.provider,
      postgresClient: runtime.postgresClient,
      store: createAuthorizationStore({ client: runtime.postgresClient }),
      handleKey: config.handleKey,
      accountBaseUrl: config.accountBaseUrl,
      now: new Date(),
      checkStatus: (accountId) => account.checkStatus({ accountId, nowMs: Date.now() }),
      rawBody: raw,
    });
    return c.json(result.body, result.status);
  } catch (error) {
    if (isInfrastructureError(error)) {
      return c.json({ error: 'service_unavailable' }, 503, {
        'Retry-After': INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    }
    throw error;
  }
});

/**
 * `POST /internal/consent/context` — đọc-only context cho consent UI của
 * account (hàng 6 của §5.1.2).
 */
app.post(INTERNAL_CONSENT_CONTEXT_ROUTE, async (c) => {
  const verified = await verifyInternalEnvelope(c, INTERNAL_CONSENT_CONTEXT_ROUTE);
  if (!verified.ok) {
    return verified.response;
  }

  try {
    const runtime = await getRuntime(c.env as AuthEnv);
    // Body ĐÃ verify chữ ký — parse ở đây, một lần.
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(verified.raw)) as unknown;
    } catch {
      return c.json({ error: 'invalid_payload' }, 400);
    }
    const result = await runConsentContext({
      postgresClient: runtime.postgresClient,
      payload,
      now: new Date(),
    });
    return c.json(result.body, result.status);
  } catch (error) {
    if (isInfrastructureError(error)) {
      return c.json({ error: 'service_unavailable' }, 503, {
        'Retry-After': INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    }
    throw error;
  }
});

/**
 * `POST /internal/consent/decide` — quyết định consent (hàng 7/8 của §5.1.2):
 * advance + consume Y + decision trong MỘT transaction db-auth, rồi result
 * gắn vào Interaction của provider.
 */
app.post(INTERNAL_CONSENT_DECIDE_ROUTE, async (c) => {
  const verified = await verifyInternalEnvelope(c, INTERNAL_CONSENT_DECIDE_ROUTE);
  if (!verified.ok) {
    return verified.response;
  }

  try {
    const runtime = await getRuntime(c.env as AuthEnv);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(verified.raw)) as unknown;
    } catch {
      return c.json({ error: 'invalid_payload' }, 400);
    }
    const result = await runConsentDecide({
      provider: runtime.provider,
      postgresClient: runtime.postgresClient,
      payload,
      handleKey: verified.config.handleKey,
      now: new Date(),
    });
    return c.json(result.body, result.status);
  } catch (error) {
    if (isInfrastructureError(error)) {
      return c.json({ error: 'service_unavailable' }, 503, {
        'Retry-After': INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    }
    throw error;
  }
});

/**
 * Mọi route còn lại trong `PROVIDER_ROUTES` (bao gồm `/auth/:uid` resume —
 * prefix `/auth` khớp cả hai) rơi xuống bridge Node của provider.
 *
 * ⚠️ Route Hono KHÔNG khớp ở đây (đã đăng ký ở trên) thì không bao giờ tới
 * bridge — tức bridge chỉ thấy đúng những route provider sở hữu.
 */
app.all(`${PROVIDER_ROUTES.authorization}/*`, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});
app.all(PROVIDER_ROUTES.authorization, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});
app.all(PROVIDER_ROUTES.token, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});
app.all(PROVIDER_ROUTES.jwks, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});
app.all(PROVIDER_ROUTES.revocation, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});
app.all(PROVIDER_ROUTES.end_session, async (c) => {
  const runtime = await getRuntime(c.env as AuthEnv);
  return await dispatchToNode(runtime, c.req.raw, c.env as AuthEnv, c.executionCtx);
});

export default app;
