# ADR-022: Use One Navigation API Observer in the Browser SDK

- Status: Accepted
- Date: 2026-10-10
- Supersedes: [ADR-021](ADR-021-navigation-api-as-the-browser-observer.md)

## Context

Maintaining a navigation package and bridge for each Router adds framework dependencies, version compatibility work, lifecycle code, and duplicated navigation semantics. The Browser SDK already has a generic observer contract and a browser Navigation API observer. The project will use that observer as the only SDK navigation integration.

## Decision

1. `createBrowserAnalytics()` creates and subscribes the generic Navigation API observer. Consumers do not install or mount a Router-specific adapter or bridge.
2. `createAnalytics()` remains the lower-level analytics factory. The Browser SDK entry composes it with the generic observer and owns observer cleanup through `destroy()`.
3. Remove `observer-next`, `observer-react-router`, `observer-tanstack-router`, and `router-adapters` packages and their build, CI, Docker, and workspace references.
4. Keep the Next.js, React Router, and TanStack Router Playground applications as test targets. They exercise the same Browser SDK entry and do not contain SDK-specific Router observation logic.
5. Observe committed same-document navigation through `navigation.currententrychange`. Do not intercept navigation, wrap History methods, or add a History API fallback.
6. Emit the initial document when the observer is subscribed. Map `push`, `replace`, and `traverse` to the existing navigation contract; ignore state-only entry updates, hash-only changes, and duplicate pathname/search identities.
7. If Navigation API is unavailable, emit the initial document only. Publish a browser support matrix only after the planned compatibility validation.

## Consequences

- Browser SDK integration no longer depends on Router libraries or React Router context.
- Navigation type reflects browser entry changes and the observer cannot prevent or alter application navigation.
- Browsers without Navigation API do not receive client-side Page View tracking until a separately approved strategy is implemented.
- Framework rendering may update document title after entry commit; the observer treats title as best effort.
- The three Playground applications remain useful for compatibility checks, but they do not imply a promise of support for every version of each Router or browser.
