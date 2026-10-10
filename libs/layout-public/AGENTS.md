# layout-public Instructions

- Brand artwork is owned by `logo` (`scope:shared`). The header renders it via `EcomaLogo` with CSS-only sizing (`h-6 w-auto`); keep the intrinsic `width`/`height` attributes intact (they are the artwork ratio, not the display size). The footer also renders `EcomaLogo`, on a white plate owned by this library: the artwork wordmark (`#161616`) is unreadable on the `slate-950` footer and recoloring is forbidden — do not "fix" contrast by editing the asset; add surface styling in the consumer instead.
- The application name and the public mount are **separate**. `blogs` is served at `/blog`, `api-reference` at `/docs/api`.
- Locale placement is owned by `i18n-public`. Consume it; do not re-decide the ordering here.
- **Locale availability** is a resource-level input (`availableLocales` prop on `PublicShell`/`PublicHeader`). `layout-public` never derives it from content, filesystem, translation data, Blogs, Docs, Nuxt Content, or any application; it only resolves via `resolveLocaleContext` and filters the locale switcher. The current locale is always kept valid in that context.
- Every URL built here is locale-first. `locale = 'vi', mount = '/blog'` yields `/vi/blog`, never `/blog/vi`.
- Never special-case an application. Adding a mount is a data change, not a branch.
- A mount matches only on a full segment boundary, so `/blogging` never falls into `blog`.
- Resolve mounts deepest-first so a nested mount such as `/docs/api` wins over `/docs`.
- Never construct a public URL by string concatenation — build it through this library.
- `PUBLIC_MOUNTS` is ordered for correct matching; use `PUBLIC_MOUNTS_IN_DECLARATION_ORDER` for display.
