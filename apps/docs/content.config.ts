import { defineCollection, defineContentConfig } from '@nuxt/content';

/**
 * Content config của `apps/docs`.
 *
 * Một collection duy nhất `docs`, type `page` — mọi page của documentation
 * (landing, section index, leaf page) đều nằm trong đó, không tách collection
 * theo section: section chỉ là một directory trong content tree, và navigation
 * suy ra từ chính tree đó.
 *
 * Hai source `en/**` và `vi/**` là cách duy nhất khai báo content localized mà
 * **content path khớp thẳng public URL**: `defineLocalSource` lấy phần cố định
 * của glob làm `prefix` (`en/**` → `/en`), và `describeId` giữ nguyên segment
 * locale trong stem, nên item id `en/docs/getting-started/installation` → path
 * `/en/docs/getting-started/installation`. Không có map locale thủ công ở đâu.
 *
 * `blog` không khai báo ở đây: content của mount đó thuộc app sở hữu nó.
 * `docs/api` cũng vậy — mount đó là deployment unit riêng, docs app không
 * content, không route cho nó.
 */
export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: [
        { include: 'en/**', prefix: '/en' },
        { include: 'vi/**', prefix: '/vi' },
      ],
    }),
  },
});
