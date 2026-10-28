import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Cấu hình Playwright cho suite system E2E `home-public-e2e` — suite system
 * E2E ĐẦU TIÊN của repo, và là skeleton mà ba suite kế tiếp
 * (`identity-login-e2e`, `identity-oidc-e2e`, `backoffice-access-control-e2e`)
 * sẽ copy. Quyết định kiến trúc được ghi tường minh ở đây để suite sau không
 * phải đoán lại.
 *
 * ═══ Quyết định TLS-in-browser (đã kiểm chứng thực nghiệm) ═══
 *
 * Stack local chạy sau Traefik với certificate self-signed `fbi.com` của repo
 * (`deploys/platform-deploy/local-certs/fbi.com.crt`, port Traefik ĐỘNG theo
 * mỗi lần container được tạo lại — giá trị thật nằm ở `ROOT_DOMAIN`/`ROOT_HOST`
 * trong `.env` mà `pnpm dx local-deploy` ghi). TLS phải được VERIFY THẬT SỰ —
 * `ignoreHTTPSErrors: true` hay `NODE_TLS_REJECT_UNAUTHORIZED=0` là đường cấm,
 * vì suite sinh ra để chứng minh chuỗi DNS/TLS/routing/upstream; tắt verification
 * là test nói dối về đúng thứ nó được sinh ra để kiểm.
 *
 * Hai bề mặt, hai cơ chế scoped trust:
 *
 * 1. **Node fetch / API assertion** (đa số test): mỗi request qua `node:https`
 *    với `ca` của riêng cert này — cùng pattern với
 *    `tools/dx/src/deployment/local-platform/local-smoke.mjs` (undici `dispatcher`
 *    của global fetch KHÔNG nhận `node:https.Agent`, đã thử thật — và undici
 *    không phải dependency của workspace). Trust store toàn cục của Node và của
 *    HĐH không bị đụng đến.
 * 2. **Browser** (chỉ test nào cần nội dung render thật): Chromium launch arg
 *    `--ignore-certificate-errors-spki-list=<hash>` với hash là base64 SHA-256
 *    của DER SubjectPublicKeyInfo, tính TẠI CONFIG LOAD từ chính cert file
 *    đã commit. Đây KHÔNG phải "tắt verification": Chromium vẫn verify mọi
 *    certificate và vẫn từ chối certificate tự ký KHÁC — chỉ đúng public key
 *    nằm trong danh sách được chấp nhận.
 *
 *    ĐÃ KIỂM CHỨNG (Chromium 156.0.8078.4 — build 1248 mà `@playwright/test`
 *    1.64.1 tải, Playwright `chromium.launch()`):
 *    - cert `fbi.com` + đúng SPKI hash → trang render 200;
 *    - certificate tự ký KHÁC (self-signed.badssl.com) với đúng hash đó trong
 *      danh sách → vẫn bị từ chối `ERR_CERT_AUTHORITY_INVALID` (scoping giữ
 *      đúng nghĩa "pin 1 public key", không phải tắt verification);
 *    - hash sai (valid base64) → vẫn bị từ chối.
 *    ⚠️ Lưu ý thực nghiệm: hash sai định dạng base64 khiến Chromium log
 *    `Invalid SPKI` rồi HÀNH XỬ NHƯ KHÔNG CÓ FLAG (mọi cert bị từ chối) —
 *    an toàn theo hướng fail-closed, nhưng lần đầu thêm cert mới hãy chạy một
 *    test browser để xác nhận hash được parse.
 *
 *    Playwright parse riêng `--ignore-certificate-errors` từ args (đổi thành
 *    `ignoreHTTPSErrors` context-wide — quá rộng), nhưng cờ `spki-list`
 *    đi thẳng vào Chromium và hoạt động đúng semantic pin-per-key.
 *
 * ═══ Không `webServer` ═══
 *
 * Stack là external state, quản bởi `pnpm dx local-deploy` — Playwright không
 * tự dựng server. Gate "stack phải đang sống" thuộc `global-setup.ts`
 * (fail-closed: stack không có → suite ĐỎ, không bao giờ skip).
 *
 * ⚠️ Hệ quả phải biết khi debug graph Nx: `@nx/playwright/plugin` EVAL config
 * này lúc DỰNG PROJECT GRAPH (để suy target `e2e`), và config throw khi thiếu
 * `ROOT_DOMAIN`/`ROOT_HOST` — tức thiếu env là **toàn bộ graph Nx fail**, cả
 * với lệnh không liên quan gì đến suite này. Đây là fail-loud CÓ CHỦ ĐÍCH
 * (message nêu đúng remedy), nhưng ba suite kế tiếp phải biết: một config
 * system-test throw-loud làm mọi lệnh `nx` trong worktree chưa deploy đỏ.
 * Playwright chạy thật (qua target `system-test`) không bao giờ gặp throw này
 * — nó chạy SAU khi Nx đã load `.env` vào task env.
 */

/**
 * Thư mục suite. ⚠️ `__dirname` không tồn tại ở ESM — Nx load config này qua
 * Node native TypeScript stripping (config chạy như ESM), nên path tự resolve
 * từ `import.meta.url`; dùng `__dirname` là graph Nx fail ngay lúc load plugin
 * `@nx/playwright` (đã gặp thật).
 */
const SUITE_DIR = dirname(fileURLToPath(import.meta.url));

/** Path cert local, resolve từ thư mục suite — thiếu là config load fail (ENOENT), đúng ý. */
const LOCAL_CERT_PATH = join(SUITE_DIR, '../../../deploys/platform-deploy/local-certs/fbi.com.crt');

/** PEM của cert local — dùng cho mọi Node request của suite (xem khối TLS ở đầu file). */
export const LOCAL_CA_PEM = readFileSync(LOCAL_CERT_PATH, 'utf8');

/**
 * SPKI hash (base64 SHA-256 của DER SubjectPublicKeyInfo) — pin public key của
 * cert local cho cờ `--ignore-certificate-errors-spki-list` của Chromium.
 * Tính tại config load: cert đổi → hash đổi → browser trust theo cert MỚI,
 * không có hash hardcode nào phải nhớ cập nhật.
 */
function computeSpkiHash(pem: string): string {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/u, '')
    .replace(/-----END CERTIFICATE-----/u, '')
    .replace(/\s+/gu, '');
  const der = Buffer.from(body, 'base64');
  return createHash('sha256').update(der).digest('base64');
}

const SPKI_HASH = computeSpkiHash(LOCAL_CA_PEM);

/** Tách `host:port` từ giá trị `ROOT_DOMAIN`/`ROOT_HOST`, mặc định port 443. */
function withOrigin(raw: string): string {
  const hostname = raw.split(':')[0];
  const port = raw.includes(':') ? raw.split(':')[1] : '443';
  return `${hostname}:${port}`;
}

/**
 * Origin gốc của stack local — giữ nguyên `host:port`. `pnpm dx local-deploy`
 * ghi `ROOT_HOST=<host>:<port>` (key sở hữu từ trước); #353 thêm `ROOT_DOMAIN`
 * với cùng giá trị cho system test. Đọc `ROOT_DOMAIN` trước, fallback
 * `ROOT_HOST` cho worktree chưa redeploy kể từ khi #353 merge.
 *
 * ⚠️ Port PHẢI giữ trong baseURL: Traefik local nghe trên port ĐỘNG map ra
 * loopback, không phải 443. Đã cắt port thử (`raw.split(':')[0]`) thì mọi
 * navigation browser đi đúng DNS `fbi.com` nhưng đập vào `:443` trên máy dev
 * — `ERR_CONNECTION_REFUSED` cho cả suite browser trong khi API assertion
 * (nhớ port qua `local-origin.ts`) vẫn xanh: đúng bệnh "một nửa suite xanh
 * chỉ vì nửa kia nhắm sai origin".
 *
 * Nx load `.env` của repo root ngay khi CLI boot (`loadRootEnvFiles` trong
 * `nx.js` — trước khi mọi plugin chạy), nên qua `nx run`/`npx playwright test`
 * dưới target Nx thì biến có sẵn cả khi plugin `@nx/playwright` eval config
 * lúc dựng graph. Chạy `npx playwright test` TRỰC TIẾP (ngoài Nx) thì không —
 * fallback đọc file `.env` của repo root ở dưới phủ đúng trường hợp đó. Vẫn
 * throw khi cả hai nguồn rỗng: fail loud, không sinh suite âm thầm nhắm vào
 * origin không tồn tại.
 */
function resolveStackOrigin(): string {
  const raw = process.env.ROOT_DOMAIN ?? process.env.ROOT_HOST;
  if (raw !== undefined && raw.trim().length > 0) {
    return withOrigin(raw.trim());
  }
  // Fallback cho lệnh gọi ngoài Nx: parse `.env` repo root (không đè env đã có).
  const envPath = join(SUITE_DIR, '../../../.env');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/u)) {
      const match = /^ROOT_(?:DOMAIN|HOST)=(.*)$/u.exec(line.trim());
      if (match && match[1].trim().length > 0) {
        return withOrigin(match[1].trim());
      }
    }
  } catch {
    // `.env` vắng mặt — rơi xuống throw bên dưới với message chỉ đúng remedy.
  }
  throw new Error(
    'ROOT_DOMAIN (or ROOT_HOST) is not set and no .env file defines it. ' +
      'Run `pnpm dx local-deploy` first to deploy the local stack — it writes the ' +
      'dynamic Traefik port into the repo-root .env. Refusing to run a system E2E ' +
      'suite against a guessed or missing origin.',
  );
}

const ROOT_ORIGIN = resolveStackOrigin();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // `retries: 0` kể cả trên CI — cùng triết lý `apps/backoffice/playwright.config.ts`:
  // retry biến một flake thật thành một lần xanh và không ai đọc lại log; với
  // system E2E thì flake còn đáng ngờ hơn nữa, vì nó có thể là dấu hiệu routing
  // /restart loop thật của stack. Chỗ đỏ là bug cần sửa, không phải bug cần che.
  retries: 0,
  // Ghim worker (không để mặc định `cpus/2`): stack local là một dev machine
  // chạy đủ 11 container; số worker lớn hơn làm SSR home đói và test timeout —
  // triệu chứng giống lỗi app. Ghim cùng số ở local và CI để thứ được kiểm ở
  // đây đúng là thứ chạy trên CI.
  workers: 2,
  // Reporter `github` ghi annotation ngay trên PR; `html` sinh `playwright-report/`
  // để job CI upload kèm trace/screenshot khi đỏ. `open: 'never'` vì runner không
  // có trình duyệt để mở.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // Home phục vụ ở apex host — mọi browser navigation mặc định trỏ đây.
    baseURL: `https://${ROOT_ORIGIN}`,
    // ⚠️ KHÔNG BAO GIỜ `ignoreHTTPSErrors: true` — xem khối quyết định TLS ở
    // đầu file. Browser test nào cần cert local phải qua project-level
    // `launchOptions` bên dưới, không phải qua nút tắt verification toàn cục.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // SPKI pin scoped cho cert local — semantic "tin ĐÚNG public key này",
        // không phải "tin mọi certificate". Hash tính từ cert file đã commit
        // nên cert rotate theo repo là browser tự theo.
        launchOptions: {
          args: [`--ignore-certificate-errors-spki-list=${SPKI_HASH}`],
        },
      },
    },
  ],
});
