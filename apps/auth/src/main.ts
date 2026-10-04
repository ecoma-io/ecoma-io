import { Hono } from 'hono';

import { buildJwks } from '@ecoma-io/identity-auth-application';
import {
  INTERNAL_BODY_LIMIT_BYTES,
  type VerifyFailureReason,
} from '@ecoma-io/identity-auth-contracts';

import { isAuthenticatedInternalRequest } from './account-client';
import { type AuthConfig, type AuthEnv, loadAuthConfig } from './config';

/**
 * `auth` là API-only Worker của bounded context `identity`.
 *
 * KHÔNG có UI ở đây — login và consent UI thuộc `account` (`apps/account`).
 * Xem docs/overview/01-architecture.md §2.
 *
 * ⚠️ Endpoint nào chưa được implement thì **KHÔNG trả 200 với body rỗng hay
 * "sẽ có sau"**. Một endpoint stub trả thành công là một lời hứa sai với
 * resource server: nó sẽ dựng vào một phản hồi không có ý nghĩa. Thiếu route
 * thì Hono trả 404, và 404 là sự thật.
 *
 * Trạng thái hiện tại (xem PR body):
 *   - `GET /health` — có.
 *   - `GET /.well-known/openid-configuration` — có.
 *   - `GET /.well-known/jwks.json` — có, chỉ public material.
 *   - `POST /internal/session/verified` — chưa implement (cần `account`).
 *   - `/authorize`, `/token` — CHƯA implement; 404.
 */
const app = new Hono();

/**
 * `Retry-After` cho nhánh `503` khi kho nonce không gọi được — đơn vị **giây**.
 *
 * `docs/overview/03-operations.md` §3.2 chốt "DB không lấy được connection ⇒ 503 +
 * `Retry-After`", nên header này là phần của hợp đồng trạng thái, không phải tuỳ chọn
 * hiển thị. Giá trị ngắn vì sự cố ở đây là transient (Hyperdrive chưa cấp connection,
 * database restart): phía gọi nên lùi lại rồi thử lại, không retry trong cùng request.
 *
 * ⚠️ Đây **không phải** ngưỡng load shedding mà mục 10 của cùng tài liệu để ngỏ — ngưỡng
 * đó vẫn chưa chốt và hằng này không quyết định nó.
 */
const INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS = '5';

/**
 * Cấu hình đã nạp, cache theo isolate.
 *
 * ⚠️ Không cache thì mỗi request sẽ import lại PKCS#8 và tạo handle khoá mới
 * — đó là thao tác đắt trên đường phục vụ, và làm một endpoint đọc JWKS tốn
 * nhiều hơn một endpoint bình thường. Cache theo isolate là hợp lệ vì
 * `AuthEnv` của một Worker không đổi trong vòng đời isolate.
 *
 * ⚠️ Cache theo PROMISE, không theo giá trị. `cachedConfig ??= await ...` chỉ
 * gán SAU khi resolve, nên N request đầu đến đồng thời trên isolate vừa ấm sẽ
 * cùng thấy `undefined` và cùng chạy `loadAuthConfig` — mỗi lần lặp lại thao
 * tác import PKCS#8 mà cache tồn tại để tránh. Gán promise vào biến đồng bộ
 * thì lời gọi đầu tiên "đặt cọc" và các lời gọi sau await đúng promise đó.
 *
 * ⚠️ Cache lỗi KHÔNG. Một `loadAuthConfig` thất bại phải thử lại ở request sau —
 * vì nếu ta nhớ cả lỗi, thì việc thêm secret và restart là cách duy nhất để
 * phục hồi, và lỗi cấu hình tạm thời sẽ trở thành vĩnh viễn.
 */
let cachedConfigPromise: Promise<AuthConfig> | undefined;

async function getConfig(env: AuthEnv): Promise<AuthConfig> {
  cachedConfigPromise ??= loadAuthConfig(env).catch((error: unknown) => {
    cachedConfigPromise = undefined;
    throw error;
  });
  return await cachedConfigPromise;
}

app.get('/health', (c) =>
  c.json({
    service: 'auth',
    status: 'ok',
    time: new Date().toISOString(),
  }),
);

/**
 * Discovery document (OIDC Core §4).
 *
 * ⚠️ `token_endpoint_auth_methods_supported` khai báo `none` — `auth` chỉ hỗ trợ
 * public client, tức là client giữ `code_verifier` và không có secret. Đây là
 * hệ quả của việc không implement `client_secret_basic`; khai sai ở đây sẽ khiến
 * client thử một luồng mà Worker không có.
 *
 * ⚠️ `revocation_endpoint` KHÔNG được khai báo khi chưa implement RFC 7009, và
 * `introspection_endpoint` không tồn tại theo D3 (access token verify offline).
 * Khai một endpoint không có là hướng client vào một 404.
 *
 * ⚠️ Endpoint này dựng từ `config.issuer`, KHÔNG hardcode. Issuer là một phần
 * của hợp đồng tin cậy của resource server: client so `iss` trong token với
 * `issuer` ở đây. Hardcode nó nghĩa là discovery và token lệch nhau ngay khi
 * deploy sang môi trường khác — và sự lệch đó chỉ lộ ra ở lúc xác thực token.
 */
app.get('/.well-known/openid-configuration', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  return c.json({
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: ['openid', 'profile'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'aud', 'iss', 'exp', 'iat', 'nbf', 'client_id', 'scope'],
  });
});

/**
 * JWKS — CHỈ khoá công khai.
 *
 * ⚠️ Handler này đọc `signingKeyProvider` từ `c.env`, và provider chỉ có thể
 * được dựng khi PEM trong Worker Secret hợp lệ. Nếu thiếu, `loadAuthConfig`
 * đã ném lúc khởi động — nên không có nhánh nào ở đây phát ra `d`.
 */
app.get('/.well-known/jwks.json', async (c) => {
  const config = await getConfig(c.env as AuthEnv);
  return c.json(buildJwks([await config.signingKeyProvider.publicJwk()]));
});

/**
 * `POST /internal/session/verified` — `account` báo identity đã xác minh.
 *
 * ⚠️ **Xác thực trước khi xử lý nghiệp vụ.** Body PHẢI được đọc trước khi xác
 * thực vì canonical string của envelope HMAC bao gồm body — nhưng đọc một cách
 * KHÔNG GIỚI HẠN thì khác: request chưa xác thực ép Worker giữ toàn bộ payload
 * trong bộ nhớ, đó là một đường từ chối dịch vụ.
 *
 * ⚠️ Giới hạn ở đây là 64 KiB — envelope nội bộ chỉ mang handle, sub, refs và
 * event_id, xa dưới ngưỡng này. Nếu contract lớn hơn thì phải nâng ngưỡng có
 * chủ đích, không phải bỏ.
 *
 * ⚠️ Route này CHƯA implement nghiệp vụ: nó không bind danh tính, không sinh
 * handle Y/Z. Nó tồn tại để chỗ kiểm tra envelope có một đường thật, và trả
 * `501` — một câu trả lời trung thực — thay vì `200` rỗng.
 */

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

/** Route nội bộ duy nhất của `auth` — dùng cho cả đăng ký route lẫn dòng log từ chối. */
const INTERNAL_VERIFIED_ROUTE = '/internal/session/verified';

/**
 * Ghi MỘT dòng log cho một lần từ chối internal.
 *
 * `docs/services/auth/03-operations.md` §3 chốt hợp đồng log của đường nội bộ: chỉ
 * `reason` cùng `event`, `route`, `method`, `status`, **không** giá trị header, và
 * **không** message của driver. Hàm này là chỗ duy nhất thực hiện hợp đồng đó ở chiều
 * `account → auth`; chiều ngược lại làm việc tương đương trong
 * `logInternalRejection` của `apps/account/server/middleware/internal-auth.ts`.
 *
 * ⚠️ **Vì sao chỉ `reason` mới là thứ đáng ghi.** `replayed_nonce` là dấu vết duy nhất
 * của một lần phát lại thật, và `db_unreachable` là dấu vết duy nhất của việc kho nonce
 * không gọi được — tức là hai trạng thái mà response cố tình **không** phân biệt (401
 * chung cho mọi lý do, để không thành oracle dò chữ ký). Bỏ dòng log này thì cả hai sự
 * kiện biến mất khỏi hệ thống: response không nói, và không còn nơi nào khác nói.
 *
 * ⚠️ **Tập trường ở đây là tập ĐÓNG, và đó là lý do không cần bộ lọc allowlist.** Bốn
 * trường còn lại là hằng của route; `reason` là mã trong union đóng của `verifyRequest`
 * cộng `db_unreachable`. Không có byte nào từ request đi vào dòng log — kể cả `route`
 * và `method`, vì lấy chúng từ request (`c.req.path`) sẽ đưa dữ liệu do người gọi kiểm
 * soát vào log (log injection bằng newline/ký tự điều khiển). Logger của `account` cần
 * allowlist vì app đó có nhiều route và nhiều nguồn dữ liệu đi vào; ở đây không có
 * đường nào để một giá trị lạ tới được sink.
 *
 * ⚠️ **Nuốt mọi lỗi** (NFR-004, `03-operations.md` §3): observability không được nằm
 * trên serving path, nên một lần ghi log thất bại không được làm request đổi trạng thái.
 *
 * ⚠️ `no-console` của `.oxlintrc.json` bị tắt ở đúng một dòng dưới đây, cùng lý do đã
 * ghi ở `apps/account/server/utils/logger.ts`: Workers không có sink nào khác, log chỉ
 * đi qua `console.*`, và `observability.enabled` trong `wrangler.jsonc` đã bật sẵn. Mức
 * `log` (không phải `warn`) là cố ý để khớp chiều ngược lại — một sự kiện cùng loại ở
 * hai chiều phải có cùng mức, nếu không thì truy vấn theo mức sẽ chỉ thấy một nửa.
 *
 * @param reason Mã lý do từ chối — **chỉ mã**, không bao giờ là message của driver `pg`
 *   (message của nó có thể chứa connection string).
 * @param status Trạng thái thật của response: 401 cho từ chối xác thực, 503 cho kho
 *   nonce/DB không gọi được.
 */
function logInternalRejection(
  reason: VerifyFailureReason | 'db_unreachable',
  status: 401 | 503,
): void {
  try {
    // oxlint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: 'internal_auth.rejected',
        route: INTERNAL_VERIFIED_ROUTE,
        method: 'POST',
        status,
        reason,
      }),
    );
  } catch {
    // Cố tình im lặng — xem JSDoc ở trên.
  }
}

app.post(INTERNAL_VERIFIED_ROUTE, async (c) => {
  const config = await getConfig(c.env as AuthEnv);

  // Từ chối NGAY khi `Content-Length` đã nói quá lớn — không cần đọc một byte
  // nào. `Content-Length` có thể vắng mặt (chunked), nên bước kiểm kích thước
  // thật bên dưới vẫn là chốt chặn; bước này chỉ tiết kiệm bộ nhớ.
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > INTERNAL_BODY_LIMIT_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }

  // ⚠️ Streaming read, không `arrayBuffer()`: `arrayBuffer()` chấp nhận tải
  // trọng rồi mới từ chối — đúng thứ comment đầu route này cảnh báo.
  // Body null (request không tải trọng) là byte rỗng, không phải stream trống
  // — `new ReadableStream()` không có source không bao giờ đóng, `read()` treo.
  const raw =
    c.req.raw.body === null
      ? new Uint8Array()
      : await readBodyLimited(c.req.raw.body, INTERNAL_BODY_LIMIT_BYTES);
  if (raw === null) {
    return c.json({ error: 'payload_too_large' }, 413);
  }

  // ⚠️ **`raw` đi thẳng vào verify — KHÔNG `new TextDecoder().decode(raw)` ở đây.**
  //
  // Bản trước decode non-fatal rồi ký chuỗi kết quả, nên byte không hợp lệ UTF-8 hoá thành
  // U+FFFD **trước khi** băm: hai payload byte khác nhau decode ra cùng một chuỗi ⇒ cùng
  // `bodyHash` ⇒ cùng chữ ký. Chữ ký khi đó nói "tôi đã thấy chuỗi này" trong khi thứ được
  // xác thực là một ảnh chiếu mất thông tin của payload, và một sửa đổi byte-level trên đường
  // đi (WAF, proxy, một `content-length` guard ở tầng trước) không làm chữ ký sai đi.
  //
  // Không decode, không parse: chính vì vậy một body JSON dị dạng bị từ chối vì **chữ ký
  // không khớp**, không vì parse lỗi — và một body không hợp lệ UTF-8 vẫn verify được bình
  // thường khi bên ký cũng ký đúng byte đó.
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
    // ⚠️ `db_unreachable` là 503, không phải 401: claimNonce là đường duy nhất vào
    // kho nonce, và khi DB chết ta **không thể** khẳng định nonce chưa từng thấy.
    // Khẳng định điều đó bằng `false` sẽ mở cửa sổ replay vĩnh viễn — fail-closed
    // nghĩa là từ chối, và 503 là mã ổn định cho "DB không gọi được" (cùng quy ước
    // với `account` middleware).
    if (auth.reason === 'db_unreachable') {
      // ⚠️ `Retry-After` là phần của hợp đồng 503 của nền tảng, không phải trang trí:
      // `docs/overview/03-operations.md` §3.2 và §3.2c chốt "DB không lấy được connection
      // ⇒ 503 + `Retry-After`". Thiếu header thì phía gọi không phân biệt được sự cố
      // tạm thời với sự cố vĩnh viễn, và mọi retry/backoff về sau không có cơ sở.
      //
      // ⚠️ Giá trị là **gợi ý retry cho kênh nội bộ**, KHÔNG phải ngưỡng load shedding mà
      // `docs/overview/03-operations.md` mục 10 để ngỏ (`Ngưỡng chưa chốt … phải chốt
      // trước D3 metering`). Ngưỡng đó vẫn chưa chốt; hằng này không quyết định nó.
      //
      // ⚠️ Log TRƯỚC khi trả: đây là sự kiện duy nhất nói rằng kho nonce không gọi được,
      // và response 503 không mang thông tin nào để phân biệt nó với một sự cố khác.
      logInternalRejection(auth.reason, 503);
      return c.json({ error: 'service_unavailable' }, 503, {
        'Retry-After': INTERNAL_DB_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
    }
    logInternalRejection(auth.reason, 401);
    return c.json({ error: 'unauthorized' }, 401, {
      'WWW-Authenticate': 'HMAC realm="ecoma-internal"',
    });
  }

  return c.json(
    {
      error: 'not_implemented',
      detail: 'route xac thuc chay duoc, nghiep vu binding danh tinh chua implement',
    },
    501,
  );
});

export default app;
