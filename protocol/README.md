# Protocol and Contract Layout

This directory is organized by stable contract meaning and version, not by
the project phase in which a contract was introduced.

```text
events/schemas/         Unified initial event envelope schemas
events/examples/        Canonical event examples
events/fixtures/        Valid and invalid protocol fixtures
contexts/               Unified Browser Context schema
capabilities/            Internal Analytics capability contracts and dependencies
contracts/<service>/    HTTP and Analytics API service contracts
contracts/configuration/current/  Configuration schemas, admin API and audit contracts
scenarios/<domain>/      Cross-service semantic scenarios
```

Event and context schemas are the cross-language source of truth. Service
contracts describe transport or query behavior, while scenarios describe
processing semantics that are shared by more than one implementation.

The unified Event Protocol uses `schema_version: 1`; this is the complete
current contract, including Visitor ID and Browser Context. Do not add
`phase-*` or temporary Event Protocol `v1`/`v2` rollout directories under
`protocol/`. Internal service contracts use `current/` when they have no
independent public version.

Keep the Event Protocol at `schema_version: 1` when its definition changes.
Do not increment the schema version, even for a breaking definition change,
unless the project owner explicitly requests a version upgrade. See
[ADR-023](../docs/decisions/ADR-023-protocol-version-upgrades-require-explicit-approval.md).
