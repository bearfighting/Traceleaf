# ADR-019: Preserve Historical Page View Queries Without Capability Configuration

- Status: Accepted
- Date: 2026-10-01
- Related: M3 Site Registry rollout, ADR-013, ADR-014

## Context

M3 backfills Site identities from configuration and historical analytics sources. A historical-only Site can therefore have a Registry row and Page View facts without a `site_capability_configurations` row. The Analytics API capability gate previously treated every missing capability snapshot as unavailable, hiding that historical Page View data even though the Registry identity and analytics facts were present.

## Decision

When no capability snapshot is available, the Analytics API may serve read-only Page View `overview`, `timeline`, and `pages` queries only if the Site exists in `site_registry` and has no capability configuration row. This preserves historical Page Views while setup remains incomplete.

Other reports still require their existing capability snapshot. A present but invalid capability document does not use this path. The exception grants no Collector ingest authorization and does not change configuration or lifecycle state.

## Consequences

- Historical-only Registry Sites can be queried through the existing Page View API without fabricated capability defaults.
- New analytics capabilities remain unavailable until their configuration contract exists.
- The API performs a small Registry/configuration existence query only after its cached capability lookup and refresh both return no snapshot.
- Regression tests must cover historical queries for a Registry identity with analytics facts and no policy or capability configuration.
