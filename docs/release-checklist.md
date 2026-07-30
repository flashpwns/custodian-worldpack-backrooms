# Alpha release checklist

1. Start from clean `main`; run `npm ci`, `npm test`, and `npm run conformance`.
2. Run `npm run build:alpha` and `npm run verify:alpha` on each target platform.
3. Inspect the artifact audit and package contents; do not include `.env`, saves, logs, research captures, or media.
4. Upload the macOS and Windows artifact directories/archives manually to a reviewed release draft.
5. State that builds are unsigned; do not claim notarization or Windows signing.
6. Do not publish npm packages or create tags/releases until separately authorized.
