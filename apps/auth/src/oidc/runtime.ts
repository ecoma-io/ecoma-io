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

import { createProvider } from './provider';
import { createIssuanceGateFromDeps } from './issuance-gate';
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
 * Composition của gate cấp phát production (SR-015/FR-020): nối các phần phụ
 * thuộc THẬT của isolate vào factory thuần `createIssuanceGateFromDeps` (toàn bộ
 * logic kiểm — account status, revocation, grant status, audit — nằm ở
 * `issuance-gate.ts`, một đường duy nhất dùng chung với testcontainers; bản
 * inline cũ bị xoá để không còn dual path drift).
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
export function createIssuanceGate(
  env: AuthEnv,
  config: AuthConfig,
  postgresClient: PostgresClientLike,
): ReturnType<typeof createIssuanceGateFromDeps> {
  const account = new AccountClient({
    binding: env.ACCOUNT_SERVICE as {
      fetch: (request: Request) => Promise<Response>;
    },
    secret: config.internalSecret,
  });
  return createIssuanceGateFromDeps({
    postgresClient,
    // `nowMs` được ghi ở runtime thật (mỗi lần hỏi là một mốc hiện hành), cùng
    // cách wiring mà `main.ts` dùng cho đường session/verified.
    checkStatus: (accountId) => account.checkStatus({ accountId, nowMs: Date.now() }),
  });
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
    // SR-015/FR-020: gate cấp phát là BẮT BUỘC ở runtime production, và là
    // CÙNG MỘT factory với đường testcontainers (`issuance-gate.ts`) — một
    // đường logic duy nhất, không bản inline riêng để trôi lệch. Test không
    // truyền gate là test trình duyệt protocol thuần; acceptance của gate nằm
    // ở (a) adapter upsert-gate + (b) composition này + (c) runtime-gate.spec.
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
    throw new Error('node server cannot provide an ephemeral port');
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
