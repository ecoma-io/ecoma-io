// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import type { BlogArticleSummary } from '~/utils/blog-articles';
import type { BlogUiStrings } from '~/utils/blog-ui-strings';
import { blogUiStrings } from '~/utils/blog-ui-strings';

/**
 * Render test cho các view component của blog — **trong jsdom**, qua
 * `@vue/test-utils` mount. Phạm vi: các nhánh render có điều kiện mà suite
 * static-output không với tới được, vì suite đó chỉ assert trên HTML của seed
 * hiện tại (blog không rỗng, cover luôn theo slug cụ thể):
 *
 * - landing **rỗng** vẫn có đúng một `<h1>` (không mất heading cấp một);
 * - landing có hero: đúng một `<h1>`, cover render với alt;
 * - card: có/không cover, link với aria-label, date theo locale prop;
 * - tag list: ẩn hẳn khi rỗng.
 *
 * Nuxt auto-import cung cấp `computed`/`NuxtLink`/`useRoute` như biến toàn
 * cục; ở đây chỉ có `@vitejs/plugin-vue`, nên: SFC import `computed` tường
 * minh (same pattern PublicShell của layout-public), `useRoute` stub qua
 * `vi.stubGlobal`, `NuxtLink` đăng ký stub qua mount option
 * `global.components`.
 */

/** Path mà `useRoute()` trả về — mount đọc giá trị hiện hành. */
const currentPath = '/en/blog';
vi.stubGlobal(
  'useRoute',
  () =>
    ({
      path: currentPath,
    }) as unknown as ReturnType<typeof useRoute>,
);

/**
 * Stub `NuxtLink` giữ đúng shape HTML prerender (`<a href>`): functional
 * component nhận prop `to` + slot default. Đăng ký qua mount option
 * `global.components` — component resolver, không phải biến toàn cục.
 */
const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.());
  },
});

/** Options mount chung — NuxtLink resolve ở mọi tầng của cây. */
function mountOptions(props: Record<string, unknown>) {
  return {
    props,
    global: { components: { NuxtLink: NuxtLinkStub } },
  };
}

/** Landing props chuẩn — override theo từng test. */
function landingProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locale: 'en',
    featured: article({ path: '/en/blog/pick', featured: true }),
    rest: [],
    availableLocales: ['en'],
    ui: UI,
    ...overrides,
  };
}

/** Card props chuẩn — override theo từng test. */
function cardProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    article: article({ path: '/en/blog/a' }),
    locale: 'en',
    ui: UI,
    ...overrides,
  };
}

/** Fixture article — đủ field của `BlogArticleSummary`, override được. */
function article(overrides: Partial<BlogArticleSummary> & { path: string }): BlogArticleSummary {
  return {
    stem: `en/blog/${overrides.path.split('/').pop()}`,
    title: `Article at ${overrides.path}`,
    description: 'A short description',
    date: '2026-09-02',
    author: 'John Martin',
    tags: ['meta'],
    featured: false,
    ...overrides,
  };
}

const UI: BlogUiStrings = blogUiStrings('en');

let BlogLandingView: Component;
let BlogArticleCard: Component;
let BlogTagList: Component;

beforeAll(async () => {
  // Dynamic import sau khi stub: import tĩnh bị ESM hoist lên trước `stubGlobal`.
  BlogLandingView = (
    (await import('~/components/blogs/BlogLandingView.vue')) as {
      default: Component;
    }
  ).default;
  BlogArticleCard = (
    (await import('~/components/blogs/BlogArticleCard.vue')) as {
      default: Component;
    }
  ).default;
  BlogTagList = (
    (await import('~/components/blogs/BlogTagList.vue')) as {
      default: Component;
    }
  ).default;
});

describe('BlogLandingView', () => {
  it('renders exactly one h1 when the blog has a featured hero', async () => {
    const wrapper = mount(BlogLandingView, mountOptions(landingProps()));
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.find('h1').text()).toContain('Article at /en/blog/pick');
  });

  it('renders exactly one h1 with the surface name when the blog is empty', async () => {
    // Blog rỗng là landing hợp lệ — nhưng không được mất heading cấp một:
    // hierarchy cho screen reader và tín hiệu chủ đề cho SEO.
    const wrapper = mount(BlogLandingView, mountOptions(landingProps({ featured: undefined })));
    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.find('h1').text()).toBe(UI.blog);
    expect(wrapper.text()).toContain(UI.latest);
  });

  it('renders one h1 per landing even when rest carries cards', async () => {
    const wrapper = mount(
      BlogLandingView,
      mountOptions(landingProps({ rest: [article({ path: '/en/blog/other' })] })),
    );
    expect(wrapper.findAll('h1')).toHaveLength(1);
  });

  it('labels the hero "Featured" only when the hero article is actually featured', async () => {
    // Fallback bài mới nhất không phải featured — gắn nhãn "Featured" cho bài
    // không featured là mô tả sai nội dung cho người đọc và screen reader.
    const fallbackHero = mount(
      BlogLandingView,
      mountOptions(
        landingProps({ featured: article({ path: '/en/blog/fallback', featured: false }) }),
      ),
    );
    expect(fallbackHero.text()).not.toContain(UI.featured);

    const featuredHero = mount(BlogLandingView, mountOptions(landingProps()));
    expect(featuredHero.text()).toContain(UI.featured);
  });

  it('renders the hero cover inside main with alt when present, no img when absent', async () => {
    const covered = article({
      path: '/en/blog/covered',
      featured: true,
      cover: { src: '/assets/cover-x.svg', alt: 'A real alt' },
    });
    const withCover = mount(BlogLandingView, mountOptions(landingProps({ featured: covered })));
    // `find('img')` đầu tiên là logo của header — cover của hero nằm trong
    // landmark `main`; giới hạn tìm kiếm vào đó.
    const img = withCover.find('main img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/assets/cover-x.svg');
    expect(img.attributes('alt')).toBe('A real alt');

    const bare = mount(
      BlogLandingView,
      mountOptions(landingProps({ featured: article({ path: '/en/blog/bare', featured: true }) })),
    );
    expect(bare.find('main img').exists()).toBe(false);
  });

  it('recomputes the shell path when the locale prop changes', async () => {
    // Contract của PublicShell: chrome phản ứng khi path đổi — client-side
    // navigate /en/blog → /vi/blog tái dùng instance component, path phải
    // theo prop mới chứ không giữ snapshot lúc setup.
    const wrapper = mount(BlogLandingView, mountOptions(landingProps()));
    expect(wrapper.find('header a[href="/en/blog"]').exists()).toBe(true);
    await wrapper.setProps({ locale: 'vi', availableLocales: ['vi'] });
    expect(wrapper.find('header a[href="/vi/blog"]').exists()).toBe(true);
  });
});

describe('BlogArticleCard', () => {
  it('renders title link with the read-more accessible name and meta row', async () => {
    const wrapper = mount(BlogArticleCard, mountOptions(cardProps()));
    const link = wrapper.find('a');
    expect(link.attributes('href')).toBe('/en/blog/a');
    expect(link.attributes('aria-label')).toBe('Article at /en/blog/a — Read more');
    expect(wrapper.text()).toContain('John Martin');
  });

  it('formats the date in the locale prop, not a composable snapshot', async () => {
    const wrapper = mount(
      BlogArticleCard,
      mountOptions(cardProps({ locale: 'vi', ui: blogUiStrings('vi') })),
    );
    // Tháng tiếng Việt không phải "September" — card phải đi theo locale
    // được truyền xuống, nguồn duy nhất của trang.
    expect(wrapper.find('time').text()).not.toContain('September');
  });

  it('renders the cover img when present and no img when absent', async () => {
    const withCover = mount(
      BlogArticleCard,
      mountOptions(
        cardProps({
          article: article({ path: '/en/blog/a', cover: { src: '/assets/c.svg', alt: 'Alt' } }),
        }),
      ),
    );
    expect(withCover.find('img').exists()).toBe(true);

    const without = mount(BlogArticleCard, mountOptions(cardProps()));
    expect(without.find('img').exists()).toBe(false);
  });
});

describe('BlogTagList', () => {
  it('renders one list item per tag with a distinct accessible name', () => {
    const wrapper = mount(BlogTagList, { props: { tags: ['meta', 'design'], label: 'Tags' } });
    expect(wrapper.findAll('li')).toHaveLength(2);
    // Component một-root (`<ul>`): attribute nằm trên wrapper root element.
    expect(wrapper.find('ul').attributes('aria-label')).toBe('Tags');
  });

  it('renders nothing when the tag list is empty', () => {
    // Danh sách có nhãn nhưng rỗng khiến screen reader đọc nhãn rồi dừng ở
    // vùng trống — ẩn hẳn là đúng.
    const wrapper = mount(BlogTagList, { props: { tags: [], label: 'Tags' } });
    expect(wrapper.find('ul').exists()).toBe(false);
  });
});
