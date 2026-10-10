/**
 * Logic thuần của listing blog: thứ tự article, selection featured, related và
 * previous/next — tách khỏi route/component để test được mọi bất biến mà không
 * cần dựng Nuxt runtime.
 *
 * Bất biến được pin ở đây:
 *
 * - **Locale isolation**: mọi hàm nhận một danh sách article **đã lọc theo
 *   locale** ở tầng query (`where('path', 'LIKE', '/<locale>/blog/%')`); các
 *   hàm này không bao giờ trộn article hai locale, và related/pager loại chính
 *   article hiện tại ra khỏi kết quả.
 * - **Deterministic ordering**: mới nhất trước, so `date` giảm dần; hai article
 *   cùng ngày (EN/VI cùng ngày hoặc demo data trùng ngày) được phá hoài bằng
 *   `stem` tăng dần — `stem` là đường dẫn content có số ordering prefix
 *   (`en/blog/1.url-model`), ổn định và không trùng, nên sort toàn phần luôn
 *   xác định.
 * - **Featured fallback**: article featured đầu tiên theo cùng thứ tự được
 *   chọn; khi không article nào `featured === true`, bài mới nhất được dùng
 *   thay thế — landing luôn có một hero, nhưng Hero không bao giờ rỗng và
 *   không bao giờ bị suy từ dữ liệu ngoài danh sách đã lọc.
 */

/**
 * Cover đã chuẩn hóa của một article — cặp URL public + alt text.
 *
 * `cover` trong database đã được `nuxt-content-assets` rewrite thành URL
 * public (`/assets/...`) tại thời điểm build, nên helper này chỉ còn việc
 * chuẩn hóa cặp giá trị: cover không URL hoặc không alt thì coi như không có
 * cover — component không bao giờ render `<img>` thiếu src hay thiếu alt.
 */
export type BlogArticleCover = {
  /** URL public của ảnh cover (đã resolve), ví dụ `/assets/cover-x.svg`. */
  readonly src: string;
  /** Alt text bắt buộc — informative image không được thiếu mô tả. */
  readonly alt: string;
};

/** Dữ liệu listing tối thiểu của một article — mọi hàm thuần dưới đây chạy trên shape này. */
export type BlogArticleSummary = {
  /** Path public canonical, ví dụ `/en/blog/url-model`. */
  readonly path: string;
  /** Stem content, ví dụ `en/blog/1.url-model` — tie-break của ordering. */
  readonly stem: string;
  readonly title: string;
  readonly description: string;
  /** Ngày xuất bản, ISO `YYYY-MM-DD` — so theo chuỗi là so theo thời gian. */
  readonly date: string;
  readonly author: string;
  readonly tags: readonly string[];
  readonly featured: boolean;
  /** Cover đã chuẩn hóa — `undefined` khi article không có cover hợp lệ. */
  readonly cover?: BlogArticleCover;
};

/**
 * Chuẩn hóa cặp trường `cover`/`coverAlt` thô từ database thành cover hiển
 * thị được. `undefined` khi thiếu URL, thiếu alt, hoặc alt rỗng — cả ba đều
 * nghĩa là "không có cover hiển thị được", thay vì render hình hỏng.
 */
export function normalizeArticleCover(
  cover: string | undefined,
  coverAlt: string | undefined,
): BlogArticleCover | undefined {
  if (typeof cover !== 'string' || cover === '') {
    return undefined;
  }
  if (typeof coverAlt !== 'string' || coverAlt.trim() === '') {
    return undefined;
  }
  return { src: cover, alt: coverAlt };
}

/**
 * Sắp article theo thứ tự hiển thị: `date` giảm dần, tie-break `stem` tăng.
 *
 * Trả về mảng mới — không mutate input (caller có thể re-use danh sách gốc cho
 * featured query).
 */
export function orderArticlesByDateDesc(
  articles: readonly BlogArticleSummary[],
): BlogArticleSummary[] {
  return articles.toSorted((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0;
  });
}

/**
 * Chọn article featured: article `featured === true` đầu tiên theo thứ tự hiển
 * thị, hoặc fallback là bài mới nhất khi không có article nào featured.
 *
 * Trả `undefined` cho danh sách rỗng — landing không render hero khi blog
 * trống, thay vì tự chế một hero không có article.
 */
export function pickFeaturedArticle(
  articles: readonly BlogArticleSummary[],
): BlogArticleSummary | undefined {
  if (articles.length === 0) {
    return undefined;
  }
  const ordered = orderArticlesByDateDesc(articles);
  return ordered.find((article) => article.featured) ?? ordered[0];
}

/**
 * Related articles: cùng **tag đầu tiên** của article hiện tại, cùng locale
 * (danh sách input đã lọc theo locale), loại chính article hiện tại, mới nhất
 * trước, giới hạn `limit`.
 *
 * Chọn "tag đầu tiên" thay vì "giao của mọi tag" để thứ tự tag trong
 * frontmatter mang ý nghĩa (tag đầu là chủ đề chính), và để một article chỉ
 * chung tag phụ vẫn có cơ hội xuất hiện khi tag chính thiếu ứng viên.
 */
export function pickRelatedArticles(
  articles: readonly BlogArticleSummary[],
  current: BlogArticleSummary,
  limit: number,
): BlogArticleSummary[] {
  const primaryTag = current.tags[0];
  if (primaryTag === undefined) {
    return [];
  }
  return orderArticlesByDateDesc(articles)
    .filter((article) => article.path !== current.path && article.tags.includes(primaryTag))
    .slice(0, limit);
}
