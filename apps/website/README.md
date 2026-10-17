# Traceleaf public site

[简体中文](README.zh-CN.md) | [Project overview](../../README.md)

The public site is an independent Next.js application that exports static HTML, CSS, and JavaScript. It does not use the Dashboard or backend services at runtime.

## Development

From the repository root:

```bash
pnpm dev:website
```

The English site is at `/`; Simplified Chinese pages are under `/zh-cn/`.

## Static build

```bash
pnpm --filter @traceleaf/website build
```

Next.js writes the deployable static site to `apps/website/out/`. Serve that directory with any static file host. No Next.js server is needed after the build.

## Content and styling

- Bilingual UI and initial Updates copy are in `lib/content.ts`.
- Shared page layouts and site navigation are in `components/`.
- Semantic light/dark theme tokens and responsive site-level primitives are in `app/globals.css`.
- The product preview uses fixed illustrative data. It never requests analytics services.
- Motion for React is used for small staged product-preview transitions; CSS handles the chart sequence and reduced-motion fallback.
