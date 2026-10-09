# logo Instructions

- The SVG under `src/assets/` is the **source of truth artwork**. Keep it byte-identical: never redraw, recolor, crop, restyle or optimize it in a code change; an artwork update replaces the file itself and goes through the artwork owner.
- Render the logo **through `<img>`**, never inline the SVG markup: the file carries an internal `<style>` with generic classes (`.a`/`.b`) that would leak into the host page when inlined.
- This library owns the **primary horizontal logo only**. Do not add stacked, symbol, wordmark or colorway variants without an official design; do not synthesize variants by editing the SVG.
- The component exposes the smallest possible API. No links, no router, no layout, no locale logic — brand linking and sizing belong to the consumer (attribute fallthrough is the customization path). The filtered attributes, by design: image-source attrs (`src`, `srcset`, `imagesrcset`) can never fall through — the bundled artwork is the source of truth and must never be silently replaced; `width`/`height` also never fall through — overriding one of the pair distorts the artwork, so consumer sizing goes through CSS only.
- The `width`/`height` attributes on the `<img>` are **copies of the artwork's intrinsic size**. When the artwork file is replaced, update those two numbers in the same change.
- No runtime dependency on other workspace libraries; keep `scope:shared` so every bounded context may consume it, and `runtime:universal` (no Node globals) so it stays SSR/SSG-safe.
- Never integrate a consumer (app, `PublicHeader`, favicon, PWA icons) in this library's changes — consumer integration happens in the consumer's own PR.
