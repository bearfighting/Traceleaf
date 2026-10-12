# ADR-023: Protocol version upgrades require explicit approval

- Status: Accepted
- Date: 2026-10-11

## Context

The repository previously documented that breaking Event Protocol changes
would use `schema_version: 2`. The project owner has set a different version
policy: keep the project on the unified Protocol V1 definition and do not
upgrade the protocol version unless explicitly requested.

## Decision

1. The current unified Event Protocol remains `schema_version: 1`.
2. Changes to the protocol definition do not by themselves authorize a schema
   version increment. This includes breaking changes.
3. Upgrade the protocol version only after the project owner explicitly asks
   for that version upgrade.
4. Keep the source schemas, examples, fixtures, generated language types, and
   consumers synchronized with approved definition changes while preserving
   `schema_version: 1` unless an upgrade is explicitly requested.

## Consequences

- `schema_version` remains 1 as the project's selected protocol label; it is
  not an automatic signal that every definition change is backward-compatible.
- Definition changes can affect compatibility with already deployed
  Collectors or SDKs. Record and validate the concrete compatibility impact
  as part of each change, without incrementing the version unless explicitly
  requested.
- The previous default that breaking changes start at `schema_version: 2` is
  superseded by this decision.
