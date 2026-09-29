# M2 Implementation Plan: Configuration Models and Capability Registry

- Status: planned
- Prerequisites: M0a, M0b, M1
- Scope: stored configuration contracts, existing management API contracts, runtime configuration views, capability registry validation, and Schema validator lifecycle
- Out of scope: Site Registry migrations and Site creation API (M3/M5), event wire model migration (M9), and adoption of Schema Transformation Toolkit before it passes its project-specific acceptance gates
- Decision references: [ADR-015](decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md), [ADR-016](decisions/ADR-016-contract-type-sources-and-generation.md), [M0b checklist](m0b-protocol-static-runtime-checklist.md), [M0b final summary](m0b-final-summary.md)

This checklist turns the M2 roadmap item into reviewable implementation slices. Mark a checkbox complete only when its evidence is recorded in the Evidence column or linked from the slice report. Do not mark a slice complete solely because its types compile: runtime input validation and Schema parity are separate acceptance requirements.

## Scope and contract inventory

| Contract / consumer                      | Included work                                                                                                               | Exclusions                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Stored Environment Policy V1             | Generated TypeScript and Rust structures; explicit validation; Collector load/refresh lifecycle; last-good/stale behavior   | Site Registry identity and migrations                             |
| Existing configuration JSONB documents   | Versioned models and minimal runtime views for fields consumed by Collector, Processor, and Analytics                       | Unrelated analytics event models                                  |
| Existing management API update contracts | Request/response types and field/cross-field validation for contracts already defined in protocol                           | New Site create/list/detail API contracts, assigned to M5         |
| Capability manifest / registry           | Validate IDs, dependencies, support state, and runtime-relevant fields; prevent drift between manifest and runtime registry | Replacing documentation-only manifest metadata without a decision |

## Work plan

### M2.1 — Freeze scope, compatibility, and date-time behavior

- [x] Inventory contracts, models, consumers, validators, and fixture evidence in [M2 configuration contract inventory](m2-configuration-contract-inventory.md).
- [x] Confirm the existing update contracts: Environment Policy, Capability, and Conversion/Funnel Definition Set. New Site APIs remain M5; Site Registry remains M3; event wire types remain M9; audit events are out of scope.
- [x] Select Schema-strict behavior for stored policy `updated_at` and `ingest_keys[].created_at`; see [ADR-017](decisions/ADR-017-policy-date-time-compatibility.md).
- [x] Record compatibility behavior: invalid policies are stale and retain last-good state; without last-good, they are not applied.
- [x] Add the read-only preflight, require an explicit `DATABASE_URL` with a database name and one explicit hostname, reject multi-host URLs, require a writable primary, ignore inherited libpq routing variables and `PGOPTIONS`, reject URL `options` and `target_session_attrs`, and verify its canonical fixture mode.
- [ ] Before M2.2/M2.4 enables format assertion, run the preflight against every deployment database and repair findings; record environment, date, result, and remediation evidence without timestamp values.
- [x] Record migration order in the [inventory](m2-configuration-contract-inventory.md): stored policy, capabilities/registry, definition revisions, then each update contract with its stored consumer.

**Exit criteria:** in-scope contracts and consumers are recorded; date-time behavior and deployment gate are explicit; production behavior remains unchanged. Database audit remains a per-environment gate before M2.2.

**Evidence:** [contract inventory](m2-configuration-contract-inventory.md), [ADR-017](decisions/ADR-017-policy-date-time-compatibility.md), [M2.1 completion record](m2.1-scope-and-compatibility.md), and `node scripts/audit-policy-datetimes.mjs --fixtures`.

### M2.2 — Construct and reuse runtime Schema validators

- [ ] Construct the Collector policy validator once during process startup and hold/inject it for policy loads and refreshes.
- [ ] Ensure refresh loops and request handlers do not load, parse, or compile Schema documents.
- [ ] Find and remove duplicate Schema validator construction in configuration runtime paths, reusing the validator owned by the application/runtime boundary.
- [ ] Construct existing management API validators at application startup and share them with handlers.
- [ ] Preserve current outward error semantics: invalid event batches keep their existing error response; invalid policy updates retain last-good configuration and stale state.
- [ ] Add or update lifecycle tests that demonstrate reuse across repeated refreshes/requests and retain malformed-policy handling tests.

**Exit criteria:** every in-scope runtime validator is constructed at startup or an equivalent composition boundary, injected/owned by its consumer, and never compiled in a hot path; existing API and policy failure behavior is unchanged.

**Evidence:** _Add code references and targeted test commands/results._

### M2.3 — Integrate pinned configuration type generation

- [ ] Pin the selected `json-schema-to-typescript` version and lockfile for stored policy and in-scope TypeScript configuration contracts.
- [ ] Pin `typify` and the Rust toolchain/dependency inputs for Stored Environment Policy structures.
- [ ] Before generating additional contracts, record a per-contract type-source decision (generated or hand-maintained, target language, and public consumer entry point) for stored capabilities and each in-scope update request; do not infer these choices from the Stored Environment Policy decision in ADR-016.
- [ ] Add deterministic generation commands that consume repository Schemas and their references without hand-editing generated output.
- [ ] Commit generated files at the paths selected by ADR-016 and expose them only through the intended package/crate public entry points.
- [ ] Add a generator `--check` (or equivalent) that fails when committed output is stale; verify it detects a deliberately changed generated file in an isolated copy.
- [ ] Compile/typecheck generated outputs with the actual consumer packages/crates.
- [ ] Keep Schema Transformation Toolkit out of the production generation path until its documented acceptance gates pass.

**Exit criteria:** generation is reproducible from a clean checkout, output drift is detected, and generated types compile through supported consumer entry points.

**Evidence:** _Add exact commands, tool versions, output paths, and results._

### M2.4 — Add explicit constraints and shared fixture parity

- [ ] Implement explicit Stored Environment Policy rules not guaranteed by generated structures or Serde: supported `schema_version`, non-empty origins, and unique origins.
- [ ] Apply date-time behavior according to the M2.1 decision; keep the corresponding fixture outcomes synchronized with the Schema contract.
- [ ] Identify constraints for each remaining configuration/management contract that static types cannot express, including formats, bounds, unknown-field policy, and cross-field rules.
- [ ] Run canonical valid/invalid fixtures through Schema, generated-type parsing plus explicit validation, and the production consumer where applicable.
- [ ] Check serialized wire JSON as well as parse acceptance wherever the consumer writes configuration documents.
- [ ] Explain every disagreement before declaring parity; do not weaken a Schema or fixture silently to make the implementation pass.

**Exit criteria:** all in-scope fixture outcomes match the agreed contract or have an approved, documented compatibility exception; unknown-field and version behavior is explicit.

**Evidence:** _Add a per-fixture result matrix and test commands/results._

### M2.5 — Establish static runtime views and capability registry

- [ ] Define minimal typed runtime views for the configuration fields each of Collector, Processor, and Analytics actually consumes.
- [ ] Parse and validate untrusted JSONB/HTTP input at the boundary before constructing runtime views; do not treat compile-time types as runtime validation.
- [ ] Define capability registry source-of-truth fields and distinguish runtime behavior fields from descriptive metadata.
- [ ] Validate capability IDs, dependency references, duplicates, and supported-state combinations against the manifest and consumers.
- [ ] Add a drift check so manifest IDs/dependencies and the runtime registry cannot diverge silently.
- [ ] Migrate consumers by contract while retaining documented compatibility behavior for persisted documents and existing HTTP responses.
- [ ] Keep new Site creation request types and Site Registry persistence work in their assigned M5/M3 milestones.

**Exit criteria:** consumers depend on the smallest validated static view they need; capability references are checked and drift-gated; JSONB and HTTP inputs still receive full runtime validation.

**Evidence:** _Add the registry source, consumer map, drift command, and targeted test results._

## Cross-slice verification and completion

- [ ] `pnpm protocol:validate` passes for all in-scope Schemas and canonical fixtures.
- [ ] Generated TypeScript package typecheck/tests pass.
- [ ] Rust generation check, formatting, clippy, and targeted crate tests pass through repository scripts.
- [ ] Shared Schema/TypeScript/Rust/consumer parity results are recorded and all differences are explained.
- [ ] CI runs generator drift checks, compile/type checks, Schema fixture validation, and relevant parity tests.
- [ ] Roadmap and this checklist agree on completed work and any deferred contracts.

**M2 completion gate:** every in-scope persisted or HTTP document is runtime-validated at its boundary; runtime validators are reused rather than compiled in hot paths; generated artifacts are reproducible and checked for drift; configuration consumers use validated static views; capability references cannot silently drift; and compatibility exceptions are documented with tests.

## Deferred work

- Site Registry schema/migrations, identity references, and legacy backfill: M3.
- New Site creation/list/detail API contract: M5.
- Event Rust wire migration, Page View extension preservation, and optional-field serialization parity: M9.
- Replacing production Schema validation with static runtime validation for any contract remains gated by that contract's parity evidence and an explicit migration decision under ADR-015.
