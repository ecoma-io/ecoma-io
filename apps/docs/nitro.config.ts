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
    // Cố ý **không** dùng `failOnError: false`: giữ nguyên mặc định để một docs
    // route thật sự hỏng vẫn làm build đỏ. Chỉ đúng những entry point ngoài
    // docs ở trên được miễn.
    ignore: [/^\/$/u, /^\/en\/?$/u, /^\/vi\/?$/u, /^\/en\/blog\/?$/u, /^\/vi\/blog\/?$/u],
  },
};
