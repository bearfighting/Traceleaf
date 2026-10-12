# Static Product Site Plan

> Status: In progress. This is a separate public-site workstream and does not expand the frozen analytics MVP.

## Purpose

Create a lightweight public site for ordinary developers who want to self-host their analytics and avoid being tied to a hosted platform. The site should explain Traceleaf, show what the existing product looks like, provide a basic getting-started guide, and offer a place to publish product updates.

The site is informational. It does not connect to the Dashboard, Analytics API, Collector, or database, and it does not provide real account or analytics operations.

## Audience and message

- Primary audience: individual developers and small teams evaluating self-hosted website analytics.
- Initial product message: developers can run and control their own analytics stack instead of depending on a hosted analytics platform.
- Content must distinguish shipped capabilities from planned or unverified capabilities. Avoid enterprise positioning in the initial release.

## Proposed site structure

### Site-wide header and footer

- Header navigation: Traceleaf wordmark/logo linking to Home, Home, Docs (initially linking to Getting Started), Product, and Updates.
- Keep the navigation labels visible and direct. Do not add dropdowns until the documentation section has more than one useful destination.
- Footer: Traceleaf wordmark, a short product description, links to Home, Getting Started, Product, Updates, and the public source repository; include the applicable license and copyright information.
- Header and footer must work on narrow screens and provide clear keyboard focus states.

### Internationalization and color theme

- Set up locale-aware routes and translation boundaries in the initial site structure so adding or revising translations does not require restructuring pages later. English uses the root path; Simplified Chinese uses `/zh-cn/` so static hosting can serve the default locale directly without runtime redirects.
- First-release locales: English and Simplified Chinese. Translate all public navigation, page copy, metadata, and initial Updates content for both locales; do not ship navigation to an untranslated page.
- Keep locale switching explicit and accessible. Preserve the corresponding page when a translation exists, and provide a clear fallback when it does not.
- Support light, dark, and system color themes from the first release. Provide a visible theme control, persist the user's explicit choice, and avoid a flash of the wrong theme during page load.
- Check contrast, focus indicators, charts, and the animated product demo in both themes.

## Design system and component approach

- Use Next.js, shadcn/ui, and Tailwind CSS, matching the existing repository's frontend conventions.
- Prefer shadcn/ui components and its established component ecosystem over creating bespoke controls. Add or adapt a component only when the site needs a distinct interaction or visual treatment.
- Before page implementation, define the important design primitives as semantic CSS variables and connect them to Tailwind/shadcn theme tokens: background and foreground, card and muted surfaces, primary and accent colors, borders, focus ring, typography, radius, and any needed chart/demo colors. Define light and dark values together.
- Compose layouts with standard Tailwind utility classes and existing theme tokens. Avoid scattered arbitrary color, font-size, radius, and spacing values, repeated long class strings, and one-off CSS overrides. Use named component variants or shared layout components when a pattern repeats; do not build an abstraction for a single use.
- Keep tokens expressive of interface roles rather than page-specific appearance, so the marketing pages, Updates, and demo remain consistent across locales and themes.

### Home

- Concise product description and self-hosting value proposition.
- A clear path to the product demo and getting-started guide.
- A short overview of the data flow: website, browser SDK, self-hosted services, and Dashboard.
- Recent product updates from Updates.

### Product demo

- Present a carefully designed, representative view of the existing Dashboard.
- Use fixed sample data and label it as illustrative.
- Animate a short narrative, such as a page navigation producing an event and the corresponding analytics view appearing.
- Do not send events, query an API, require a server, or imply that the demo is live data.

### Getting started

- Explain prerequisites and the shortest supported path to try Traceleaf.
- Link to existing setup and deployment documentation where suitable.
- Only document steps that are currently available and verified. Clearly identify any platform or browser limitations already documented by the project.

### Updates

- Use **Updates** as the initial navigation label and section name. It can cover product news, release notes, and practical articles without implying that the site is only a personal blog or only formal version announcements.
- Static index and static article pages.
- Keep article copy in repository-managed bilingual content and generate each article page at build time; do not add a CMS for the initial release.
- Add a simple post type or category such as Product update, Release, and Guide, only where it helps readers scan the list.
- Show publication date, title, summary, and article body. Include a link to the getting-started guide where relevant.
- Publish one introductory article with the first release, covering the project's motivation, what Traceleaf currently does, and its longer-term vision. Keep current capabilities and future aspirations clearly separated, and provide English and Simplified Chinese versions.

## Visual demo and motion

- Build the demo from HTML, CSS, and SVG so it remains crisp, responsive, accessible, and part of the static site.
- Use fixed, clearly illustrative sample data and UI based on the real product.
- Use Motion for React for coordinated, step-based demo sequences if its client-side bundle and static export behavior fit the implementation. Use CSS for simple transitions and hover/focus states.
- Provide pause and replay controls for the main sequence. Respect `prefers-reduced-motion`; in reduced-motion mode, show the complete static state without staged movement.
- Keep meaningful labels and values available as regular page content; animation must not be the only way to understand the demo.
- Do not use video in the initial version.

## Proposed implementation direction

- Keep the public site separate from `apps/dashboard`; it must not import Dashboard features or depend on its authentication or API flows.
- Reuse the repository's established Next.js, React, Tailwind CSS, and shadcn/ui conventions where that reduces maintenance, while keeping the public site independently buildable and deployable.
- Use the independent `apps/website` workspace app with Next.js static export. The exported output is ordinary static assets suitable for static hosting, without requiring a Next.js server at runtime.
- Keep Updates content in the repository and generate its pages at build time.
- Add no backend, database, CMS, account system, analytics API integration, or live demo data source for the initial site.
- Confirm dependency versions and Next.js static export constraints against the repository's installed version before implementation.

## Implementation sequence

1. **Confirm scope and content claims**
   - Review current MVP scope, setup instructions, browser support notes, and deployment guidance.
   - Confirm the public site's relationship to the frozen MVP and which product claims are safe to publish.
   - The home-page message is self-hosting/deployment freedom together with privacy. Use “Getting Started” as the primary action and “View the product demo” as the secondary action, after verifying the guide.

2. **Set up the independent static site**
   - Add the site as a separate workspace application.
   - Configure static output and verify it has no runtime dependency on Dashboard or backend services.
   - Establish semantic CSS design tokens for light and dark themes, then build responsive layouts from shadcn/ui components and Tailwind utilities.
   - Add locale-aware route/content structure and light/dark/system theme support before building page-specific layouts.

3. **Build the Home and Product Demo pages**
   - Write and review concise developer-focused copy.
   - Create representative Dashboard visuals from fixed sample data.
   - Add the navigation-to-analytics animation, pause/replay controls, and reduced-motion behavior.

4. **Build Getting Started**
   - Link to or adapt only verified repository instructions.
   - Keep setup steps synchronized with the SDK and deployment documentation.

5. **Build Updates**
   - Define a lightweight bilingual content format for Updates.
   - Add a static index and article template, then publish the bilingual introductory article about the project's motivation, current capabilities, and vision.

6. **Review and prepare deployment**
   - Check accessibility, keyboard operation, responsive behavior, reduced motion, links, metadata, and illustrative-data labeling.
   - Build the static output and verify it can be served without the application server.
   - Document the chosen static hosting configuration after the hosting target is selected.

## Acceptance criteria

- The site builds to static files and can be hosted without a Node.js application server.
- All first-release locales have translated navigation, page copy, metadata, and published Updates content.
- Light, dark, and system themes work across all pages, and an explicit theme preference persists across navigation and reloads.
- It is built and deployed independently from `apps/dashboard`.
- No site page requires a Dashboard login or makes requests to Traceleaf backend services.
- The Home page explains the product and self-hosting value to a developer who has not seen the repository.
- Home-page content presents self-hosting/deployment freedom and privacy as complementary product values.
- The Product Demo resembles actual product capabilities, uses clearly labeled fixed sample data, and does not imply live operation.
- The main animation can be paused and replayed, and reduced-motion preferences produce a useful static presentation.
- Getting Started instructions match currently verified setup and deployment behavior.
- Updates index and article pages are generated statically from repository-managed content.
- English and Simplified Chinese are available throughout the initial site, including the introductory Updates article.
- Shared visual primitives use semantic theme tokens for both light and dark themes; repeated UI patterns reuse shadcn/ui components or named variants rather than one-off hard-coded styling.
- Navigation, focus states, text contrast, and demo controls work on narrow and wide screens and with keyboard input.

## Explicitly out of scope for the initial site

- Live analytics, server-side rendering that requires a runtime server, API or database integration.
- Dashboard functionality, authentication, user accounts, or site management.
- CMS or browser-based article editing.
- Video-based product demos.
- Enterprise-specific marketing, sales funnels, or customer-specific content.
- Product features or browser support claims that have not been verified and documented.

## Pre-publication review

1. Review the Quick Start content against the repository guide and ensure command prerequisites are clear.
2. Review the introductory Updates article for precise capability and release-status claims.
3. Add Updates categories only when there are enough posts to benefit from them; the initial bilingual project introduction is established.

Hosting provider and domain selection are deferred until deployment preparation. The public product name is Traceleaf. The header/footer layout and the Updates section name are established by this plan.
