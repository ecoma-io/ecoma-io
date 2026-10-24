import { chromium, request, type FullConfig, type Page } from '@playwright/test';

import { PROTOTYPE_ROUTES, waitForRouteReady } from './support/prototype';

/**
 * Nóng bốn route prototype **trước** khi chạy test, theo hai vế khác nhau.
 *
 * Việc này không phải để "che" lỗi: nó tách "app còn đang khởi động" khỏi "app
 * thật sự có lỗi". Setup fail-loud: server không lên, hoặc route trả sai mã, là
 * **mọi** test dừng với lý do rõ ràng thay vì 100+ lần timeout mơ hồ.
 *
 * Hai vế là hai cách khác nhau để `nuxt dev` làm đỏ một test vô can:
 *
 * 1. `assertRoutesRespond` — lần GET đầu tiên của mỗi route phải chịu JIT compile
 *    SSR, có thể mất hàng chục giây.
 * 2. `warmUpBrowserClient` — Vite pre-bundle dependency **theo lượt tải đầu tiên
 *    của browser**, không theo HTTP request. Khi phát hiện dependency mới lúc
 *    runtime, dev server gửi `full-reload` để client tự tải lại trang; lần reload
 *    đó huỷ navigation đang bay. Đã đo được trên CI: `page.goto('/staff')` đỏ với
 *    `net::ERR_ABORTED`, và 116 ms sau browser tự GET lại `/` — đúng trang đang
 *    mở, tức dev server thay trang chứ app không trả lỗi.
 *
 * Vế 1 không chạm tới cơ chế của vế 2: request context không tải module client nên
 * không kích hoạt pre-bundle. Đo lại ở local với cache dependency nguội (xoá
 * `apps/backoffice/node_modules/.cache/vite/client/deps`): không warm-up browser
 * thì reload buộc rơi vào **giữa** giai đoạn test — bản ghi document là `/`, `/`
 * (cái đầu `net::ERR_ABORTED`) rồi `/staff`; có warm-up browser thì nó rơi hết vào
 * giai đoạn warm-up và giai đoạn test chỉ còn đúng bốn lần điều hướng, không lần
 * nào bị huỷ.
 *
 * Giới hạn, nói thẳng: đây là **dời** một sự kiện của dev server ra trước khi test
 * chạy, không phải làm cho race đó thành bất khả. Cache dependency đã nóng thì
 * không có reload nào cả, nên vế 2 gần như miễn phí.
 */

/**
 * Bao lâu không có document request mới thì coi như dev server đã thôi thay trang.
 *
 * Đo được: reload buộc tới khoảng 0.4s sau lần tải đầu ở local và ~2.6s trên CI,
 * nên warm-up bốn route (vài giây) thường đã "ăn" luôn nó; con số này chỉ là
 * khoảng lặng xác nhận ở cuối.
 */
const QUIET_MS = 3_000;

/** Trần chờ của vế warm-up browser; vượt trần là server còn thay trang liên tục. */
const WARM_UP_CAP_MS = 30_000;

/**
 * Vế 1 — kiểm server đã lên và mọi route trả 200.
 *
 * Chạy trước vế 2 để lỗi "server chưa lên / route 500" đọc được ngay, thay vì đội
 * lốt thành một lần timeout của locator trong vế browser.
 */
async function assertRoutesRespond(baseURL: string): Promise<void> {
  const context = await request.newContext({
    baseURL,
    // Chờ server `nuxt dev` JIT-compile mỗi route trong lần GET đầu tiên.
    // CI có thể chậm hơn đáng kể so với local; 120s đủ bảo vệ khỏi timeout không
    // liên quan đến hành vi UI, nhưng vẫn hạn chế hơn webServer.timeout (180s).
    timeout: 120_000,
  });

  try {
    for (const route of PROTOTYPE_ROUTES) {
      const response = await context.get(route.path);

      if (response.status() !== 200) {
        throw new Error(
          `Route ${route.path} returned HTTP ${response.status()} during test server startup (expected 200).`,
        );
      }
    }
  } finally {
    await context.dispose();
  }
}

/**
 * Vế 2 — tải đủ bốn route bằng browser thật để Vite pre-bundle xong dependency
 * client, rồi chờ dev server thôi thay trang.
 *
 * Viewport mặc định (1280×720, bằng `Desktop Chrome`) là nhánh desktop của shell —
 * đúng nhánh mà suite chạy.
 */
async function warmUpBrowserClient(baseURL: string): Promise<void> {
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ baseURL });

    for (const route of PROTOTYPE_ROUTES) {
      await page.goto(route.path);

      try {
        await waitForRouteReady(page, route.path);
      } catch (cause) {
        // Đo được trên merge queue: cấu hình thiếu làm route **không** sẵn sàng,
        // và lỗi gốc (`waiting for getByTestId('backoffice-sample-notice')`) không
        // nói lý do — đọc như một flake của `nuxt dev` thay vì một gate bị tắt.
        throw new Error(
          `${route.path} not ready after warm-up. This suite only checks the prototype surface, and the dev server must run with NITRO_PUBLIC_BACKOFFICE_DATA_MODE=prototype (set in playwright.config.ts). If that mode is off, the app renders the unavailable state: no fixtures and no backoffice-sample-notice banner — this is configuration, not the app.`,
          { cause },
        );
      }
    }

    await waitForDevServerToSettle(page);
  } finally {
    await browser.close();
  }
}

/**
 * Chờ tới khi hết document request mới trong `QUIET_MS`.
 *
 * Không có cờ nào trên trang nói "đã reload xong": lần reload thay cả document nên
 * mọi tín hiệu của trang cũ đều biến mất. Bằng chứng duy nhất còn lại là **im
 * lặng** — không document request nào nữa. Khi cache dependency đã nóng, lần chờ
 * duy nhất này là toàn bộ chi phí của vế warm-up browser.
 *
 * Vượt `WARM_UP_CAP_MS` thì báo lỗi thay vì đi tiếp: server thay trang liên tục là
 * bất thường, và chạy test trên server như vậy chỉ tạo ra đỏ khó đọc.
 */
async function waitForDevServerToSettle(page: Page): Promise<void> {
  const deadline = Date.now() + WARM_UP_CAP_MS;

  while (Date.now() < deadline) {
    // `waitForRequest` là event-driven: không có sleep cố định ở đường đi thường,
    // `QUIET_MS` chỉ là ngưỡng để kết luận "không còn gì tới nữa".
    const reload = await page
      .waitForRequest((req) => req.resourceType() === 'document', { timeout: QUIET_MS })
      .catch(() => null);

    if (reload === null) {
      return;
    }

    await page.waitForLoadState('load');
  }

  throw new Error(
    `Dev server kept replacing the page after ${String(WARM_UP_CAP_MS)} ms of warm-up — stopping the suite instead of running tests on an unstable server.`,
  );
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;

  if (baseURL === undefined) {
    throw new Error('baseURL not found on the first Playwright project — webServer did not start.');
  }

  await assertRoutesRespond(baseURL);
  await warmUpBrowserClient(baseURL);
}
