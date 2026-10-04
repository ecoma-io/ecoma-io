# i18n-public Instructions

- The locale is the **first** public URL segment. `/en/blog` is valid; `/blog/vi` is not.
- English carries its prefix like every other locale. There is no unprefixed variant.
- Locale policy is locale-first on a single domain `ecoma.io`. There is no market domain (`ecoma.io.vn`); locale lives in the path, never in the hostname.
- `/` is a locale-resolution entry point. It never serves content and never redirects to unprefixed content.
- This library owns the **locale dimension only**. It must not know which application serves a path.
- Never resolve a locale from `Accept-Language` or IP — that is policy, not a default.
- Parsing fails with a typed reason rather than guessing a locale or repairing a path.
- Never emit a locale after a mount, and never emit a trailing slash.
- Mount metadata and app→mount mapping belong in `layout-public`, not here.
