import { defineCollection, defineContentConfig, z } from '@nuxt/content';

/**
 * Content config của `apps/home` — bề mặt public hợp nhất.
 *
 * Hai collection, đúng hai bề mặt content của `ecoma.io`:
 *
 * - `docs` — documentation tree (landing, section index, leaf page); mọi page
 *   của documentation nằm trong đó, không tách collection theo section:
 *   section chỉ là một directory trong content tree, và navigation suy ra từ
 *   chính tree đó.
 * - `blog` — article list phẳng (không có section lồng nhau như docs), điều
 *   hướng previous/next chạy trên danh sách phẳng các article của cùng locale.
 *
 * Mỗi collection giữ nguyên semantic source của app cũ sở hữu nó: `docs` từ
 * `apps/docs/content.config.ts`, `blog` từ `apps/blogs/content.config.ts`
 * (schema + source không đổi). Content path khớp thẳng public URL ở cả hai:
 * `defineLocalSource`-style glob với `prefix` bằng đúng phần cố định trước
 * wildcard, giữ nguyên segment locale trong stem, nên item id
 * `en/docs/getting-started/installation` → path
 * `/en/docs/getting-started/installation`. Không có map locale thủ công ở đâu.
 *
 * `docs/api` không có content và không có route: mount đó là boundary của
 * `api-reference` (mount lồng nhau, deepest-first trong `PUBLIC_MOUNTS`) —
 * `parsePublicLayoutPath` từ chối nó trước khi bất kỳ collection nào được query.
 */

/**
 * Schema của collection `blog` — nguyên văn từ `apps/blogs` cũ.
 *
 * Trường `cover` là **reference asset tương đối** (ví dụ
 * `../../../assets/cover-url-model.svg`) — `nuxt-content-assets` walk toàn bộ
 * frontmatter (`walkMeta`) và rewrite mọi value khớp asset index thành URL
 * public tại thời điểm build, nên ở runtime `cover` đã là `/assets/...`,
 * không phải path tương đối nữa.
 */
const blogSchema = z
  .object({
    /** Tiêu đề hiển thị của article — dùng cho listing, SEO title và pager. */
    title: z.string(),
    /** Mô tả ngắn một dòng — meta description, card listing và excerpt. */
    description: z.string(),
    /**
     * Ngày xuất bản, ISO date (`YYYY-MM-DD`).
     *
     * Dùng `z.string()` với regex chứ không `z.date()`: frontmatter parse ra
     * **string**, và adapter sqlite lưu cột DATE trả về string khi query —
     * khai báo `z.date()` sẽ lệch kiểu giữa schema và runtime. Regex pin đúng
     * hình dạng dữ liệu để sort theo string là sort theo thời gian, rồi
     * `refine` với `Date.parse` đảm bảo là ngày **có thật** (`2026-02-31` khớp
     * regex nhưng không tồn tại — lọt vào DB thì xếp sai thứ tự editorial và
     * sai `datePublished` mà không có lỗi nào báo).
     */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
        message: 'date phải là một ngày có thật (YYYY-MM-DD)',
      }),
    /** Tên tác giả của article. */
    author: z.string(),
    /** Tags chủ đề — dùng cho badge trên card và article. Tag archive không thuộc slice này. */
    tags: z.array(z.string()),
    /** Đánh dấu article ứng viên featured trên landing. */
    featured: z.boolean(),
    /**
     * Cover image — **tùy chọn**, reference tương đối tới asset dùng chung
     * `content/assets/` (graphic cover language-neutral, một bản duy nhất).
     * `nuxt-content-assets` rewrite value thành URL public `/assets/...` lúc
     * build; article không khai báo cover render không hình, không bao giờ sinh
     * `<img>` hỏng. Alt text đi kèm trong `coverAlt` — hai trường đi cùng nhau
     * để informative image không bao giờ thiếu mô tả.
     */
    cover: z.string().optional(),
    /** Mô tả alt của cover — bắt buộc khi bài khai `cover` (refine ở dưới). */
    coverAlt: z.string().min(1).optional(),
  })
  // Cặp `cover`/`coverAlt` đi cùng nhau: khai cover mà thiếu alt vẫn pass
  // từng field một cách riêng lẻ, rồi hậu quả bị che ở runtime
  // (`normalizeArticleCover` trả `undefined` — cover biến mất im lặng), còn
  // consumer mới đọc thẳng `cover` (sitemap, OG image) sẽ sinh `<img>` thiếu
  // alt. Content là editorial — người viết không phải developer — nên vi phạm
  // a11y phải **fail ở build**, không âm thầm.
  .refine((article) => article.cover === undefined || article.coverAlt !== undefined, {
    message: 'coverAlt là bắt buộc khi bài khai báo cover',
    path: ['coverAlt'],
  });

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: [
        // Hai source `en/**` và `vi/**` là cách duy nhất khai báo content
        // localized mà content path khớp thẳng public URL. Không có map locale
        // thủ công ở đâu.
        { include: 'en/**', prefix: '/en' },
        { include: 'vi/**', prefix: '/vi' },
      ],
    }),
    blog: defineCollection({
      type: 'page',
      source: [
        // Lưu ý `prefix` là string **override** phần cố định mà module tự suy
        // ra từ glob (`fixed` trước `*`), không phải thêm đoạn mới: đặt `/en`
        // ở đây sẽ cắt mất segment `blog` khỏi mọi `path`/`stem` trong
        // database. Prefix phải là toàn bộ phần cố định của glob.
        { include: 'en/blog/**', prefix: '/en/blog' },
        { include: 'vi/blog/**', prefix: '/vi/blog' },
        // Graphic **language-neutral** dùng chung hai locale (một SVG diagram
        // không có chữ không cần duplicate cho từng locale). Prefix `/assets`
        // biến reference tương đối `../../assets/energy-flow.svg` từ
        // `en/blog/x.md` thành URL public `/assets/energy-flow.svg` — đúng
        // một bản duy nhất trên trang, không nhân đôi theo số locale.
        // Reference từ article đi lên một tầng (`en/blog/<slug>/` →
        // `en/blog/`) rồi sang `assets/`, thứ tự tham chiếu không đổi theo
        // locale nên Markdown hai bản đọc cùng một asset.
        { include: 'assets/**', prefix: '/assets' },
      ],
      schema: blogSchema,
    }),
  },
});
