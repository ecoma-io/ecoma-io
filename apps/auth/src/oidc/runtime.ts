/**
 * Runtime của isolate: config + pool postgres + Provider + Node bridge, dựng LƯỜI.
 *
 * ## Chọn bridge nào — và vì sao
 *
 * Mission cho hai phương án: `httpServerHandler` hoặc `handleAsNodeRequest`. Chọn
 * **`handleAsNodeRequest(port, request, env, ctx)`**:
 *
 * - Hono giữ `/health`, `/.well-known/*` và `/internal/*` — những route KHÔNG cần
 *   Koa: envelope HMAC đọc header/body Web-native, response là JSON thuần. Cho
 *   chúng qua Node là một tầng chuyển đổi không cần thiết.
 * - Còn lại (`/auth`, `/auth/:uid` resume, `/token`, `/jwks.json`, `/revocation`,
 *   `/session/end`) là toàn bộ pipeline Koa của provider — cookies, redirect,
 *   form_post, error rendering. Viết lại chúng trên Hono là tự duy trì một bản
 *   sao của provider.
 * - `httpServerHandler` biến TOÀN BỘ Worker thành một server Node duy nhất
 *   (ExportedHandler thay thế fetch handler), tức Hono phải sống BÊN TRONG Node
 *   request — đảo ngược đúng thứ bậc ta cần: Hono là đường chính, provider là
 *   khách mời trên một tập route hẹp.
 * - `handleAsNodeRequest` cho phép một server Node shared, port cố định trong
 *   isolate, và mỗi request Worker nào cần provider thì cầu qua đó. Không có
 *   socket thật — workerd nội bộ hoá cả vòng đời.
 *
 * ## Vòng đời
 *
 * Provider + pool postgres sống theo isolate: `AuthEnv` không đổi trong vòng đời
 * isolate nên dựng một lần là đúng (cùng luật với `cachedConfigPromise` của
 * `main.ts` trước đây). ⚠️ Cache theo PROMISE và KHÔNG cache lỗi — một lần dựng
 * thất bại (secret sai, DB không kết nối được lúc load clients) phải được phép
 * thử lại ở request sau, không được biến thành vĩnh viễn.
 *
 * ⚠️ **Không node-local state có ý nghĩa phục hồi**: mọi trạng thái protocol nằm
 * trong `db-auth` (`oidc_state` + `authorization_transactions`), còn server Node
 * chỉ là một bộ máy stateless — isolate chết thì request sau dựng lại từ DB,
 * đúng mô hình recovery của `01-architecture.md`.
 */

import { type AuthConfig, type AuthEnv, loadAuthConfig } from '../config';
import {
  type PostgresClientLike,
  createPostgresClient,
} from '@ecoma-io/identity-auth-infrastructure';
import { AccountClient } from '../account-client';
import { checkRevocationAtIssuance, insertAuditEvent } from '../authorization-store';
import { allowsIssuance } from '@ecoma-io/identity-auth-contracts';

import { createProvider } from './provider';
import type { IssuanceGate } from './adapter';
import type { Provider } from 'oidc-provider';

import type { NodeStyleServer } from 'cloudflare:node';

/**
 * Runtime đã dựng cho một isolate.
 *
 * `nodeServer` + `nodePort`: server `node:http` bọc `provider.callback()`, đã
 * `listen(0)` — port ephemeral do runtime Worker cấp, dùng cho mọi lời gọi
 * `handleAsNodeRequest` sau đó.
 */
export interface AuthRuntime {
  readonly config: AuthConfig;
  readonly postgresClient: PostgresClientLike;
  readonly provider: Provider;
  readonly nodeServer: NodeStyleServer;
  readonly nodePort: number;
}

/**
 * Gate cấp phát production (SR-015/FR-020): kiểm tra lại account + revocation
 * TẠI MỖI lần phát token, thay vì chỉ lúc push `session.verified`.
 *
 * Vị trí bám là `adapter.upsert` — `base_model.js:77-89` của oidc-provider 9.12.2
 * đưa MỌI issuance (authorization code lúc resume, refresh token lúc rotation)
 * qua `adapter.upsert(jti, payload, ttl)`, với payload luôn mang `accountId` +
 * `clientId` (+ `grantId`). Một điểm nghẽn, mọi đường phát.
 *
 * ⚠️ Fail-closed bằng THROW, không phải boolean: adapter chỉ hiểu "ném = chặn",
 * và một lỗi infrastructure (Account unreachable, postgres chết) phải lan lên
 * thành lỗi 5xx của request đó — không được nuốt thành "cho phép".
 */
function createIssuanceGate(
  env: AuthEnv,
  config: AuthConfig,
  postgresClient: PostgresClientLike,
): IssuanceGate {
  const account = new AccountClient({
    binding: env.ACCOUNT_SERVICE as {
      fetch: (request: Request) => Promise<Response>;
    },
    secret: config.internalSecret,
  });
  return {
    assertIssuable: async ({ accountId, clientId, grantId }) => {
      // ⚠️ Phân biệt CHÍNH XÁC hai nhóm lỗi: policy denial (audit
      // `token_issue_denied`) khác hạ tầng chết (Account unreachable, DB
      // chết) — nhãn `access_denied` cho một lỗi hạ tầng là sai dữ liệu audit
      // và tạo ra cảnh báo giả cho người đọc audit. Hạ tầng NÉM nguyên trạng.
      const status = await account.checkStatus({ accountId, nowMs: Date.now() });
      if (!allowsIssuance(status)) {
        await denyAudit(
          postgresClient,
          accountId,
          clientId,
          grantId ?? undefined,
          'account_status',
        );
        throw new Error(`issuance gate: account status "${status}" khong cho phep cap token`);
      }
      const revocation = await checkRevocationAtIssuance(postgresClient, {
        sub: accountId,
        clientId,
        grantId: grantId ?? undefined,
      });
      // ⚠️ `!== 'not_revoked'` chứ không phải `=== 'revoked'`: bất kỳ giá trị nào
      // ngoài "không thu hồi" (kể cả một giá trị union tương lai) phải chặn —
      // cùng quy ước fail-closed với session-verified-handler.ts.
      if (revocation !== 'not_revoked') {
        await denyAudit(postgresClient, accountId, clientId, grantId ?? undefined, 'revocation');
        throw new Error('issuance gate: token da bi revoke (subject/client/grant)');
      }
      // Hàng "đã cấp" — fire-and-forget: mất hàng audit không được biến một
      // issuance thành công thành 5xx (SR-010 là quan sát, không phải điều
      // kiện cấp — AGENTS.md: observability không là dependency serving path).
      try {
        await insertAuditEvent(postgresClient, {
          eventType: 'token_issued',
          subjectRef: accountId,
          clientId,
          grantId: grantId ?? undefined,
          outcome: 'success',
        });
      } catch (error: unknown) {
        // oxlint-disable-next-line no-console
        console.error('audit write failed', error);
      }
    },
  };
}

/**
 * Audit hàng bị chặn cấp — cũng fire-and-forget (try/catch riêng): lỗi audit
 * KHÔNG được thay đổi lỗi nghiệp vụ đang lan (vẫn là chặn issuance,
 * fail-closed giữ nguyên).
 */
async function denyAudit(
  postgresClient: PostgresClientLike,
  accountId: string,
  clientId: string,
  grantId: string | null | undefined,
  reason: string,
): Promise<void> {
  try {
    await insertAuditEvent(postgresClient, {
      eventType: 'token_issue_denied',
      subjectRef: accountId,
      clientId,
      grantId: grantId ?? undefined,
      outcome: 'denied',
      errorCode: 'access_denied',
      details: { reason },
    });
  } catch (error: unknown) {
    // oxlint-disable-next-line no-console
    console.error('audit write failed', error);
  }
}

let cachedRuntimePromise: Promise<AuthRuntime> | undefined;

/**
 * Dựng (hoặc trả lại) runtime của isolate.
 *
 * ⚠️ Thứ tự dựng: config trước (validate secret), postgres trước provider (factory
 * load clients), server Node CUỐI — nếu provider ném thì không để lại listener mồ côi.
 * `listen(0)` + `address().port` là cặp lệnh chuẩn của `node:http` và mirror
 * declaration của `cloudflare:node` (`NodeStyleServer.address()`).
 */
async function buildRuntime(env: AuthEnv): Promise<AuthRuntime> {
  const config = await loadAuthConfig(env);

  const postgresClient = createPostgresClient(config.hyperdrive);

  const provider = await createProvider({
    config,
    postgresClient,
    signingPem: config.signingKeyPem,
    // SR-015/FR-020: gate cấp phát là BẮT BUỘC ở runtime production. Test tự
    // dựng provider của nó (oidc-fullflow.spec) và cố ý không truyền gate —
    // nghĩa là suite đó không cover đường này; acceptance của gate nằm ở
    // kết hợp (a) adapter upsert-gate, (b) chính hàm này.
    issuanceGate: createIssuanceGate(env, config, postgresClient),
  });

  const { createServer } = await import('node:http');
  // `provider.callback()` là `(req, res) => void` theo chữ ký Koa; `createServer`
  // nhận đúng hình dạng đó. Cast qua `NodeStyleServer` của `cloudflare:node` là an
  // toàn: `listen`/`address` là hai method mà cả hai type cùng mô tả.
  const nodeServer = createServer(provider.callback()) as unknown as NodeStyleServer;
  nodeServer.listen(0);
  const address = nodeServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : undefined;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    // Không có port thì không có đường cầu nào — ném để cache giữ nguyên `undefined`
    // và request sau dựng lại, thay vì giữ một runtime không dùng được.
    throw new Error('node server khong cap duoc port ephemeral');
  }

  return { config, postgresClient, provider, nodeServer, nodePort: port };
}

/**
 * Lấy runtime của isolate, dựng nếu chưa có.
 *
 * ⚠️ Cache promise + reset khi lỗi: cùng bộ luật với JSDoc `getConfig` của `main.ts` —
 * gán promise vào biến đồng bộ để N request đồng thời cùng await một lần dựng, và
 * một lỗi phải xoá cache để không thành vĩnh viễn.
 */
export function getRuntime(env: AuthEnv): Promise<AuthRuntime> {
  cachedRuntimePromise ??= buildRuntime(env).catch((error: unknown) => {
    cachedRuntimePromise = undefined;
    throw error;
  });
  return cachedRuntimePromise;
}

/**
 * Ghi đè `X-Forwarded-Proto` từ URL scheme của request Worker.
 *
 * ⚠️ GHI ĐÈ (không fallback-giữ): bridge `cloudflare:node` không có TLS socket
 * nên koa tính protocol từ header này — chỉ khi `provider.proxy = true`
 * (koa/lib/request.js:411-416). Giữ giá trị client gửi là giả mạo protocol
 * (client http gửi `x-forwarded-proto: https` để né secure-cookie). URL scheme
 * của `Request` trong Workers thì ngược lại: nó phản ánh scheme thật mà Cloudflare
 * edge nhận (http hay https do route/redirect của ta quyết định), không phải
 * một header client có thể đặt tùy ý. Provider bật `proxy` cùng lúc — hai nửa
 * của một cơ chế, tách một nửa là sai ngữ nghĩa bảo mật.
 *
 * Export cho acceptance test: server Node cục bộ trong test bọc handler bằng
 * chính transform này để request đi đúng ngữ nghĩa bridge (test http thuần
 * không có header thì provider sẽ chết `secure cookie` y như workerd không vá).
 */
export function withForwardedProto(request: Request): Request {
  const proto = new URL(request.url).protocol.replace(':', '');
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-proto', proto);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // `duplex: 'half'` bắt buộc khi body là stream (Node 18+/undici kiểm);
    // với body null thì không có tác dụng. `RequestInit` của TS DOM lib không
    // khai field này (nó là extension undici) — cast khớp đúng runtime.
    duplex: 'half',
    // `redirect` không mang qua — bridge trả Response Web đã xử lý xong.
  } as RequestInit);
}

/**
 * Cầu một request Web sang server Node của provider.
 *
 * Tách riêng để test được stub — và để `main.ts` không import `cloudflare:node`
 * trực tiếp (module chỉ tồn tại trên workerd; test Node môi trường import sẽ ném).
 */
export async function dispatchToNode(
  runtime: AuthRuntime,
  request: Request,
  env: AuthEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { handleAsNodeRequest } = await import('cloudflare:node');
  return handleAsNodeRequest(runtime.nodePort, withForwardedProto(request), env, ctx);
}
