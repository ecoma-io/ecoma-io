import { defineCollection, defineContentConfig, z } from '@nuxt/content';

/**
 * Content config của `apps/blogs`.
 *
 * Một collection duy nhất `blog`, type `page` — mọi article của blog nằm trong
 * đó. Blog phẳng (không có section lồng nhau như docs), nên điều hướng
 * previous/next chạy trên danh sách phẳng các article của cùng locale.
 *
 * Ba source:
 *
 * - `en/blog/**` và `vi/blog/**` — content localized mà **content path khớp
 *   thẳng public URL**: `defineLocalSource`-style glob với `prefix` bằng đúng
 *   phần cố định trước wildcard (`en/blog/**` → `/en/blog`), giữ nguyên segment
 *   locale trong stem, nên item id `en/blog/1.foo/article` → path
 *   `/en/blog/foo`. Không có map locale thủ công ở đâu.
 *   Lưu ý `prefix` là string **override** phần cố định mà module tự suy ra từ
 *   glob (`fixed` trước `*`), không phải thêm đoạn mới: đặt `/en` ở đây sẽ
 *   cắt mất segment `blog` khỏi mọi `path`/`stem` trong database.
 * - `assets/**` — graphic **language-neutral** dùng chung hai locale (một SVG
 *   diagram không có chữ không cần duplicate cho từng locale). Prefix `/assets`
 *   biến reference tương đối `../../assets/energy-flow.svg` từ
 *   `en/blog/x.md` thành URL public `/assets/energy-flow.svg` — đúng một bản
 *   duy nhất trên trang, không nhân đôi theo số locale. Reference từ article
 *   đi lên một tầng (`en/blog/<slug>/` → `en/blog/`) rồi sang `assets/`, thứ tự
 *   tham chiếu không đổi theo locale nên Markdown hai bản đọc cùng một asset.
 *
 * Trường `cover` trong schema là **reference asset tương đối** (ví dụ
 * `../../../assets/cover-url-model.svg`) — `nuxt-content-assets` walk toàn bộ
 * frontmatter (`walkMeta`) và rewrite mọi value khớp asset index thành URL
 * public tại thời điểm build, nên ở runtime `cover` đã là `/assets/...`,
 * không phải path tương đối nữa. Reference dùng chung thư mục `assets/` của
 * hai locale vì graphic cover không có chữ language-neutral.
 *
 * `docs` không khai báo ở đây: content của mount đó thuộc app sở hữu nó.
 * Blogs cũng không bao giờ có content dưới `docs/api`.
 */

const blogSchema = z.object({
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
   * hình dạng dữ liệu để sort theo string là sort theo thời gian.
   */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  /** Tên tác giả của article. */
  author: z.string(),
  /** Tags chủ đề — dùng cho badge trên card và article. Tag archive không thuộc slice này. */
  tags: z.array(z.string()),
  /** Đánh dấu article ứng viên featured trên landing. */
  featured: z.boolean(),
  /**
   * Cover image — **tùy chọn**, reference tương đối tới asset colocated
   * (giống reference trong Markdown body). `nuxt-content-assets` rewrite
   * value thành URL public `/assets/...` lúc build; article không khai báo
   * cover render không hình, không bao giờ sinh `<img>` hỏng. Alt text đi
   * kèm trong `coverAlt` — hai trường đi cùng nhau để informative image
   * không bao giờ thiếu mô tả.
   */
  cover: z.string().optional(),
  /** Mô tả alt của cover — bắt buộc khi có `cover`, rỗng khi không có. */
  coverAlt: z.string().optional(),
});

export default defineContentConfig({
  collections: {
    blog: defineCollection({
      type: 'page',
      source: [
        { include: 'en/blog/**', prefix: '/en/blog' },
        { include: 'vi/blog/**', prefix: '/vi/blog' },
        { include: 'assets/**', prefix: '/assets' },
      ],
      schema: blogSchema,
    }),
  },
});
