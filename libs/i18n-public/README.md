# i18n-public

Thư viện **pure, runtime-universal** cho public URL locale của `ecoma.io`: đọc, dựng và đổi locale trên pathname — không hơn.

## Library làm gì

- Quản lý **locale dimension** của public URL: locale là segment đầu tiên, `en` cũng mang prefix `/en`.
- Phân loại pathname thành ba state: `root` / `localized` / `invalid` (kèm typed reason).
- Dựng public path và đổi locale, giữ nguyên phần resource từng byte.

## Library không làm gì

- Không biết **mount** và không biết application — `/blog`, `/docs/api` là resource path opaque, việc gán mount thuộc `layout-public`.
- Không resolve locale từ `Accept-Language`, IP, cookie, browser locale hay hostname.
- Không normalize input: không lowercase, không thêm/bớt slash, không decode/re-encode, không repair path hỏng, không redirect.
- Không render SEO / `hreflang` / translation dictionary.
- Không dependency Nuxt, Vue, Node; không I/O; không mutable global state; không throw cho expected invalid input.

## Supported locales

| Locale | hreflang (BCP-47) |
| ------ | ----------------- |
| `en`   | `en`              |
| `vi`   | `vi-VN`           |

Registry `PUBLIC_LOCALES` là single source of truth; kiểu `PublicLocale` được **derive từ dữ liệu registry** (không union viết tay), và so khớp locale luôn **chính xác từng segment** (`/enabled`, `/en-US`, `/EN` không bao giờ được nhận là `en`).

## Input contract của ba phép xử lý

Ba hàm nhận ba loại input khác nhau — không phải ba góc nhìn của cùng một input:

```text
parsePublicPath()  → public localized pathname  (đã có locale, hoặc '/')
localizePath()     → root-relative resource pathname CHƯA có locale
switchLocale()     → localized public pathname  (phải mang locale để đổi)
```

`localizePath()` **không** phải generic URL normalizer: nó dựng `/<locale><pathname>` cho resource path bất kỳ hợp lệ. `/fr/blog`, `/enabled` là resource (segment đầu không phải supported locale) và được localise bình thường; chỉ đúng supported locale ở segment đầu tiên mới bị chặn (double-localize).

## Public API

```ts
import {
  PUBLIC_LOCALES,
  type PublicLocale,
  type PublicLocaleDefinition,
  type PublicPathResult,
  type PublicPathReason,
  parsePublicPath,
  localizePath,
  switchLocale,
  getLocaleDefinition,
  isPublicLocale,
} from '@ecoma-io/i18n-public';
```

### Kết quả

Mọi phép xử lý pathname trả về cùng một discriminated result — không string trần, không throw:

```ts
type PublicPathResult =
  | { kind: 'root'; path: '/' }
  | { kind: 'localized'; locale: PublicLocale; path: string; remainder: string }
  | { kind: 'invalid'; reason: PublicPathReason };

type PublicPathReason =
  | 'not_a_pathname' // rỗng, không bắt đầu bằng '/', có '?' hoặc '#'
  | 'trailing_slash' // kết thúc '/'
  | 'empty_segment' // chứa '//'
  | 'unsupported_locale' // locale ngoài registry: segment đầu (parse) hoặc locale đích (localize/switch)
  | 'not_localized' // riêng switchLocale: source không mang locale để đổi
  | 'already_localized'; // localizePath nhận input đã có locale
```

Trên variant thành công: `path` là public path đầy đủ (mãi đúng `'/' + locale + remainder`, không bao giờ có trailing slash); `remainder` là phần sau `/<locale>` **verbatim** (`''` ở locale root).

### URL examples

```ts
parsePublicPath('/'); // { kind: 'root', path: '/' }
parsePublicPath('/en/blog'); // { kind: 'localized', locale: 'en', path: '/en/blog', remainder: '/blog' }
parsePublicPath('/blog'); // { kind: 'invalid', reason: 'unsupported_locale' }
parsePublicPath('/en/'); // { kind: 'invalid', reason: 'trailing_slash' }
parsePublicPath('/enabled'); // { kind: 'invalid', reason: 'unsupported_locale' } — không phải locale 'en'

localizePath('vi', '/blog/foo'); // { kind: 'localized', locale: 'vi', path: '/vi/blog/foo', ... }
localizePath('vi', '/'); // { kind: 'localized', locale: 'vi', path: '/vi', remainder: '' }
localizePath('vi', '/fr/blog'); // { kind: 'localized', locale: 'vi', path: '/vi/fr/blog', ... } — 'fr' là resource, không phải locale
localizePath('vi', '/enabled'); // { kind: 'localized', locale: 'vi', path: '/vi/enabled', ... }
localizePath('vi', '/en/blog'); // { kind: 'invalid', reason: 'already_localized' } — không bao giờ /vi/en/blog
localizePath('vi', '/en//blog'); // { kind: 'invalid', reason: 'empty_segment' } — cấu trúc kiểm tra trước locale
localizePath('vi', '/en/'); // { kind: 'invalid', reason: 'trailing_slash' }

switchLocale('/en/blog/foo', 'vi'); // { kind: 'localized', locale: 'vi', path: '/vi/blog/foo', ... }
switchLocale('/', 'vi'); // { kind: 'invalid', reason: 'not_localized' } — '/' không mang locale để đổi
switchLocale('/blog', 'vi'); // { kind: 'invalid', reason: 'not_localized' } — source không có locale; 'vi' vẫn supported
switchLocale('/en/blog', 'fr' as PublicLocale); // { kind: 'invalid', reason: 'unsupported_locale' } — riêng locale ĐÍCH không hỗ trợ

getLocaleDefinition('vi'); // { code: 'vi', hreflang: 'vi-VN' }
getLocaleDefinition('fr'); // undefined
```

## Root semantics

`/` là **locale-resolution entry point** — một parse state riêng, không phải `en` và không phải invalid. Nó không serve content và library này **không** quyết định nó redirect đi đâu: policy resolve (`/` → `/en` hay `/vi`) thuộc về caller. `switchLocale('/', ...)` từ chối với `not_localized` vì root không mang locale để đổi — cùng lý do với source không có locale ở segment đầu tiên.

Hai lý do **không hoán đổi cho nhau**:

| Lý do                | `parsePublicPath`                | `switchLocale`                                                            | `localizePath`                               |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| `unsupported_locale` | segment đầu không trong registry | **chỉ** locale đích không trong registry                                  | **chỉ** locale đích không trong registry     |
| `not_localized`      | không trả                        | source không mang locale để đổi (root `/`, segment đầu không phải locale) | không trả                                    |
| `already_localized`  | không trả                        | không trả                                                                 | input đã mang locale (chống double-localize) |

## Boundary với `layout-public`

```text
i18n-public   → sở hữu locale dimension (segment đầu tiên, registry, parse/build/switch)
layout-public → sở hữu mount (PUBLIC_MOUNTS, gán path → application) — tiêu thụ i18n-public
```

`i18n-public` không import `layout-public`, không biết app name, không biết mount. Không có kế hoạch đảo chiều này.

## Chạy unit test

```bash
pnpm exec nx test i18n-public
```
