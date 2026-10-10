# ADR-021: Use the Navigation API for the Generic Browser Observer

- Status: Superseded by [ADR-022](ADR-022-navigation-api-only-browser-sdk.md)
- Date: 2026-10-10

## Context

The browser SDK needs to observe same-document route changes across multiple Router libraries without maintaining a Router-specific adapter for each one. The existing adapters use Router hooks and, in some cases, wrap History methods. Navigation API provides a browser-level committed-entry signal and exposes navigation type information.

The project has an active MVP feature freeze. The maintainer has explicitly authorized a bounded Navigation API implementation and evaluation using the existing Next.js, React Router, and TanStack Router Playground applications.

## Decision

1. The generic browser observer uses `navigation.currententrychange` as its navigation signal and emits the current document as an `initial` event when subscribed.
2. `push` and `replace` map directly to the observer contract; `traverse` maps to `pop`. State-only entry updates with no navigation type are ignored.
3. Page identity is pathname plus search parameters. Hash-only and same-identity changes do not emit Page Views, preserving current product semantics.
4. The observer does not intercept navigation, prevent default behavior, or wrap History methods.
5. This work does not use History API detection or fallback. If Navigation API is unavailable, the observer emits only the initial page. Any unsupported scenario must be documented with a reproducible case before a separate decision reopens adapters or introduces another strategy.
6. Existing framework adapters are frozen during this evaluation. The three existing Router Playground applications exercise the same generic observer; they are not evidence that Router-specific adapters remain the preferred integration.
7. Because framework rendering can update `document.title` after the browser commits the URL, the observer waits up to 500 ms for a title change. If the title remains unchanged, it omits the title from that navigation event instead of reusing the prior page's title.

## Consequences

- The shared `NavigationObserver` contract remains unchanged and can be consumed by Analytics SDK without Router dependencies.
- The generic observer reports committed navigation entries rather than attempted navigations, avoiding Page Views for canceled transitions.
- Page title is best-effort and may be omitted; the generic browser API has no signal that identifies when an arbitrary framework has finished rendering its route.
- Support for older browsers is intentionally limited in this evaluation; a missing Navigation API does not trigger monkey-patching or a Router-specific workaround.
- The acceptance decision depends on evidence from initial, push, replace, back/forward, search, hash-only, rapid navigation, title timing, cancellation, and lifecycle behavior in all three Playground applications.
- This decision is a scoped exception to the MVP freeze. It does not reopen unrelated SDK publication, transport, feature, or adapter work.
