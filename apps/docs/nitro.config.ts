// Nitro config riêng cho `docs`.
//
// Nuxt 4 chuyển cấu hình Nitro ra khỏi `nuxt.config.ts`: docs của Nuxt khuyến
// nghị dùng key `nitro` ở đó, nhưng `@nuxt/schema` 4.5.2 đã gỡ `nitro` khỏi
// `NuxtConfig` (`Omit<ConfigSchema, ... | "nitro">` + `nitro?: never`), nên khai
// báo kiểu sẽ hỏng:
//     error TS2353: 'nitro' does not exist in type 'InputConfig<NuxtConfig, ...>'
// Vì `typescript.typeCheck: true` trong nuxt.config.ts và `.nuxt/tsconfig.node.json`
// có `include: ["../nuxt.config.*"]`, lỗi đó lộ ra ngay trong `nuxt build`.
// File riêng này tránh được cả hai.
//
// Đây là lựa chọn tạm: khi `@nuxt/schema` trả `nitro` vào `NuxtConfig`, chuyển
// nội dung file này thành key `nitro` trong `nuxt.config.ts` cho khớp docs.
//
// Export object thuần, không import `defineNitroConfig` từ `nitro/config`:
// `nitro` là transitive dependency của `nuxt`, không phải dependency trực tiếp
// của workspace package này, nên pnpm không cho resolve từ đây.
//
// `preset: 'static'` — docs là **static site**, không phải ứng dụng SSR.
//
// Đây là điều sửa lỗi `apps/docs` không render được trên Worker (issue #28).
// `@nuxt/content` chọn database adapter ở thời điểm **request**, theo Nitro
// preset; với preset Workers nó đòi D1 (`bindingName: "DB"`), còn adapter mặc
// định lại là sqlite chỉ chạy trên Node. Với `static`, mọi `queryCollection`
// chạy ở **build time** trên Node — nơi sqlite hợp lệ — và output chỉ còn là
// file tĩnh. Sau khi deploy không còn truy vấn content nào ở runtime, nên không
// cần D1, không cần Worker script.
export default {
  preset: 'static',
  hooks: {
    // `404.html` — artifact mà wrangler `not_found_handling: "404-page"` phục
    // vụ cho mọi request không khớp asset (xem wrangler.jsonc). Preset
    // `static` của Nitro **không** seed route này (chỉ `github-pages`/
    // `gitlab-pages` làm), nên phải tự prerender.
    //
    // Hai rào cản cần vượt:
    //
    // 1. Nuxt hardcode `/404.html` vào `PRERENDER_NO_SSR_ROUTES`
    //    (`@nuxt/nitro-server`, `runtime/utils/renderer/app.mjs`) — route này
    //    luôn được render bằng SPA renderer, tức shell rỗng
    //    (`data-ssr="false"`, không một byte HTML của error.vue). Prerender
    //    trực tiếp `/404.html` không bao giờ cho ra trang lỗi SSR thật.
    // 2. Prerenderer của Nitro chỉ ghi file khi response **200** — một route
    //    không match page nào trả 404 và bị đánh dấu `_route.error`.
    //
    // Cách giải: prerender một **URL ảo** `/en/__not-found`. Nó đi đúng
    // pipeline lỗi chuẩn của Nuxt như mọi URL không tồn tại khác (route
    // `[[...slug]]` từ chối qua `validate` → 404 → nitro error handler
    // localFetch `/__nuxt_error?...` → renderer chạy `error.vue` ở chế độ SSR
    // thật, đầy đủ `PublicShell` + shared 404 page). Hook `prerender:generate`
    // chạy sau khi fetch nhưng trước khi ghi: xóa cờ lỗi để route được ghi,
    // và đổi `fileName` thành `404.html` — đĩa nhận HTML của trang lỗi thật
    // dưới đúng tên artifact mà wrangler cần.
    //
    // Nội dung dùng locale mặc định khi build (`en`, xem `app/error.vue`):
    // một file tĩnh duy nhất không biết URL bị lỗi thuộc locale nào.
    //
    // `failOnError` giữ mặc định true cho mọi route khác; route ảo này được
    // miễn một cách có kiểm soát (chỉ đúng `route.route` của nó) thay vì tắt
    // guard toàn cục — một docs route thật sự hỏng vẫn làm build đỏ.
    'prerender:routes': (routes: Set<string>): void => {
      routes.add('/en/__not-found');
    },
    'prerender:generate': (route: {
      route: string;
      error?: Error;
      fileName?: string;
      skip?: boolean;
    }): void => {
      if (route.route === '/en/__not-found') {
        // Chỉ miễn lỗi **dự kiến** — 404 của route ảo. Lỗi khác (throw trong
        // `error.vue`/`PublicShell`, renderer 500 — lỗi build thật) phải để
        // nguyên cờ cho `failOnError` làm build đỏ: nuốt trắng sẽ đổi
        // `fileName` thành `/404.html`, build xanh nhưng artifact là HTML
        // hỏng, và wrangler (`not_found_handling: "404-page"`) phục vụ nó cho
        // **mọi** request không khớp asset. Nitro gắn status vào error object
        // (`statusCode`, hoặc `status` sau khi Nuxt deprecate tên cũ) nhưng
        // type tĩnh không khai báo — kiểu cấu trúc cục bộ thay vì cast rộng.
        type PrerenderRouteError = { statusCode?: unknown; status?: unknown };
        const status = (route.error as PrerenderRouteError | undefined)?.statusCode;
        const altStatus = (route.error as PrerenderRouteError | undefined)?.status;
        if (status === 404 || altStatus === 404) {
          delete route.error;
          route.fileName = '/404.html';
        }
      }
      // Payload JSON của route ảo (`/en/__not-found/_payload.json`) bị crawler
      // queue tiếp từ header `x-nitro-prerender` của response HTML và sẽ được
      // ghi cạnh **URL gốc**, không cạnh `404.html` đã đổi tên — file rác trong
      // artifact deploy (không request nào của trình duyệt chạm tới nó, vì
      // hydration trên URL không tồn tại không bao giờ chạy). Đánh dấu `skip`
      // ngay tại đây: prerenderer bỏ qua ghi đĩa cho route này.
      if (route.route === '/en/__not-found/_payload.json') {
        route.skip = true;
      }
    },
  },
  prerender: {
    // Seed tường minh hai docs landing. Từ đây crawler đi tiếp qua link do
    // sidebar/landing render ra, nên **mọi** document ở cả hai locale — kể cả
    // nested page — đều được sinh thành HTML thật. Seed không suy từ content
    // file: chính route mới là thứ quyết định URL, và crawler đọc đúng URL đó.
    routes: ['/en/docs', '/vi/docs'],
    crawlLinks: true,
    // Crawler đi theo **mọi** link trong HTML, mà shell dùng chung
    // (`layout-public`) còn render global nav và locale switcher. Những link
    // đó trỏ ra ngoài docs:
    //
    //   `/`            — locale-resolution entry point, không mount nào sở hữu
    //   `/en`, `/vi`   — locale root, do locale switcher sinh ra
    //   `/en/blog`…    — mount `blog`, deploy unit khác (`apps/blogs`)
    //
    // Chúng 404 một cách đúng đắn (docs không sở hữu chúng), nên phải loại khỏi
    // prerender thay vì để build đỏ. Dùng **regex** chứ không phải string:
    // `ignore` so string bằng `startsWith`, nên `'/en'` sẽ nuốt luôn
    // `/en/docs`; regex neo hai đầu mới khớp đúng path cần loại. Cờ `u` là yêu
    // cầu của rule `require-unicode-regexp` trong oxlint config của repo.
    //
    // Lưu ý: `ignore` chặn route **hoàn toàn** (`canPrerender` → skip ngay
    // trước khi fetch, không bao giờ ghi file), không chỉ chặn crawler —
    // `/en/__not-found` vì thế không được đứng ở đây.
    //
    // Cố ý **không** dùng `failOnError: false`: giữ nguyên mặc định để một docs
    // route thật sự hỏng vẫn làm build đỏ. Chỉ đúng những entry point ngoài
    // docs ở trên được miễn.
    ignore: [/^\/$/u, /^\/en\/?$/u, /^\/vi\/?$/u, /^\/en\/blog\/?$/u, /^\/vi\/blog\/?$/u],
  },
};
