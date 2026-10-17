# Browser and Router Playgrounds

[简体中文](README.zh-CN.md) | [Project overview](../README.md)

These nine workspaces exercise the same generic Browser SDK and browser Navigation API observer in different environments. They are development examples for navigation-observation validation. They do not provide framework-specific Router adapters, production analytics integrations, or backend data collection by default.

## Run a playground

Use the repository's locked Node.js and pnpm versions. Install dependencies once with `pnpm install`, then run the selected workspace's `dev` script from the repository root:

| Playground         | Run command                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| Angular            | `pnpm --filter @web-analytics/angular-playground dev`                                |
| Astro              | `pnpm --filter @web-analytics/astro-playground dev`                                  |
| Next.js App Router | `pnpm --filter @web-analytics/nextjs-router-playground dev` or `pnpm dev`            |
| React Router       | `pnpm --filter @web-analytics/react-router-playground dev` or `pnpm dev:react`       |
| Solid              | `pnpm --filter @web-analytics/solid-playground dev`                                  |
| SvelteKit          | `pnpm --filter @web-analytics/svelte-playground dev`                                 |
| TanStack Router    | `pnpm --filter @web-analytics/tanstack-router-playground dev` or `pnpm dev:tanstack` |
| Vanilla browser    | `pnpm --filter @web-analytics/vanilla-playground dev` or `pnpm dev:vanilla`          |
| Vue                | `pnpm --filter @web-analytics/vue-playground dev`                                    |

Framework dev servers print their local URL when started. The Docker wrapper supports only Next.js, React Router, and TanStack Router; see [Docker development](../docker/README.md).

## Scope and verification

The playgrounds share the Navigation API observation contract. Router libraries render and navigate their own examples; the Browser SDK observes browser-committed navigation and does not hook into those libraries. Most examples use a mock transport for local demonstration. For the browser navigation workflow, run `pnpm e2e:navigation-api` from the repository root. For SDK setup and product boundaries, see the [Browser SDK README](../packages/analytics-browser/README.md), [Navigation API decision](../docs/decisions/ADR-022-navigation-api-only-browser-sdk.md), and [project status](../docs/project-status.md).
