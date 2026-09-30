# M2 Implementation Plan: Configuration Models and Capability Registry

- Status: in progress
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
- [ ] Before M2.4 enables format assertion, run the preflight against every deployment database and repair findings; record environment, date, result, and remediation evidence without timestamp values.
- [x] Record migration order in the [inventory](m2-configuration-contract-inventory.md): stored policy, capabilities/registry, definition revisions, then each update contract with its stored consumer.

**Exit criteria:** in-scope contracts and consumers are recorded; date-time behavior and deployment gate are explicit; production behavior remains unchanged. Database audit remains a per-environment gate before M2.4 enables strict format assertion.

**Evidence:** [contract inventory](m2-configuration-contract-inventory.md), [ADR-017](decisions/ADR-017-policy-date-time-compatibility.md), [M2.1 completion record](m2.1-scope-and-compatibility.md), and `node scripts/audit-policy-datetimes.mjs --fixtures`.

### M2.2 — Construct and reuse runtime Schema validators

- [x] Construct the Collector policy validator once during process startup and inject it into `RuntimePolicyManager`; refresh reuses it (`services/collector/src/main.rs`, `runtime_policy.rs`).
- [x] Ensure refresh loops and request handlers do not load, parse, or compile Schema documents; policy refresh and management handlers only call compiled validators.
- [x] Remove duplicate capability Schema compilation and duplicate per-document validation; `CapabilityRuntime` owns one `CapabilitySchemaValidator` and supplies it to `CapabilitySnapshot::from_document`.
- [x] Construct the capability, environment-policy update, and definition-set update validators at Analytics API state composition and share them through `SiteManagementState`. `state`, `state_with_definition_version`, and `connect` are fallible, so initialization errors stop startup before listener binding.
- [x] Preserve outward behavior: event validation was untouched; invalid stored policy retains last-good and reports stale; management request error mapping remains unchanged. Strict policy `date-time` assertions remain deferred to M2.4.
- [x] Retain canonical malformed-policy fixture assertions; test the startup-built policy validator rejecting a schema-invalid document, Collector last-good/stale and no-last-good behavior, CapabilityRuntime schema rejection and stale snapshot retention, management validator initialization failure, and database-free valid/invalid fixture responses for all three management validators.

**Exit criteria:** every in-scope runtime validator is constructed at startup or an equivalent composition boundary, injected/owned by its consumer, and never compiled in a hot path; existing API and policy failure behavior is unchanged.

**Evidence:** startup and injection: `services/collector/src/main.rs`, `services/collector/src/runtime_policy.rs`, `crates/configuration-runtime/src/lib.rs`, `services/analytics-api/src/site_management/{validation,state}.rs`, `services/analytics-api/src/{state,lib}.rs`. Verified with `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test -p configuration-runtime`, `cargo test -p collector runtime_policy::tests`, `cargo test -p analytics-api --lib`, `cargo test -p analytics-api --test http`, and `./scripts/test.sh`. PostgreSQL-backed tests are ignored without a migrated database. The Collector policy lifecycle test is included in `pnpm test:integration`; both PostgreSQL test binaries compile here, but their ignored cases were not executed without a configured test database. `./scripts/check.sh` reached formatting and failed on eight pre-existing protocol fixture formatting warnings; no production schema or fixture was changed in M2.2.

### M2.3 — Integrate pinned configuration type generation

- [x] Record a per-contract type-source decision for Stored Environment Policy, Stored Site Capabilities, and the three in-scope update requests, including language, generated/hand-maintained choice, consumer entry point, and rationale in [ADR-016](decisions/ADR-016-contract-type-sources-and-generation.md).
- [x] Pin json-schema-to-typescript 16.0.0 in packages/protocol-ts/package.json and pnpm-lock.yaml; pin cargo-typify 0.8.0 using its release lockfile and repository Rust toolchain 1.98.1.
- [x] Generate all five M2 configuration TypeScript contracts and the Stored Environment Policy Rust structure from the repository Schemas without hand edits.
- [x] Add generated files under packages/protocol-ts/src/generated/ and services/collector/src/generated/; expose TypeScript types only through the @web-analytics/protocol-ts package root, and compile the Rust module through Collector.
- [x] Add deterministic generation and --check commands. Verify a deliberately modified TypeScript artifact in an isolated artifact-root copy fails with Generated file is stale.
- [x] Narrow the generated capabilities settings types for the Schema maxProperties: 0 rule with deterministic generation-time refinement; compile-time probes cover empty-object acceptance and rejection of strings, arrays, and non-empty objects.
- [x] Typecheck/build the protocol package and compile/lint the Collector consumer crate.
- [x] Keep Schema Transformation Toolkit out of production generation pending its documented acceptance gates.

**Exit criteria:** generation is reproducible from a clean checkout, output drift is detected, and generated types compile through supported consumer entry points.

**Evidence:** pnpm --filter @web-analytics/protocol-ts generate:configuration; pnpm --filter @web-analytics/protocol-ts check:configuration; pnpm --filter @web-analytics/protocol-ts typecheck; pnpm --filter @web-analytics/protocol-ts build; cargo install cargo-typify --version 0.8.0 --locked; cargo fmt --all -- --check; cargo check -p collector; cargo clippy -p collector --all-targets -- -D warnings; pnpm protocol:validate. The generated-file drift check passed, and the isolated mutation probe exited 1 on a stale TS artifact. Protocol package typecheck includes the settings constraint probes. Generator/tool pins, commands, paths, and the intentionally unused policy output are documented in ADR-016. Runtime policy migration and explicit typify constraints remain M2.4 work.

### M2.4 — Add explicit constraints and shared fixture parity

- [x] Document per-contract constraints and consumer/type boundaries, including revisions without a stored Schema, in [M2.4 parity assessment](m2.4-configuration-parity.md).
- [x] Add a repeatable Schema fixture runner: `node scripts/m2-configuration-parity.mjs`; it distinguishes Schema-valid/service-invalid semantic fixtures and strict date-time candidates.
- [x] Exercise stored fixtures through Rust parsing and explicit rules, and all management update fixtures through production Schema and service rules; see the M2.4 parity assessment for the per-fixture outcome matrix.
- [x] Extend `node scripts/audit-policy-datetimes.mjs` to inspect both stored policy and capability tables in read-only transactions; fixture mode covers the capability date-time candidate. Executed both result paths against disposable PostgreSQL 18.6 tables; see the parity report.
- [ ] Run that preflight against every deployment and record remediation.
- [x] Record strict Stored Capabilities updated_at behavior in [ADR-018](decisions/ADR-018-capability-date-time-compatibility.md); assertions remain disabled until deployment evidence is complete.
- [x] Record policy integer bounds as an implementation-range exception without changing Schema or wire format.
- [x] Add representative TypeScript positive/negative probes for non-empty Origins, schema version, date-time string limits, funnel step minimum, and unconstrained definition IDs; package typecheck passes.
- [x] Check the production policy creation, capability replacement, ingest-key addition, and definition revision serialization paths against their stored/update Schemas; revisions have no standalone stored Schema.
- [x] Keep Schema unchanged and document known differences in the parity assessment.

**Exit criteria:** fixture outcomes match or have a documented exception; unknown-field/version behavior is explicit; strict format assertions remain gated until policy and capability preflight evidence is complete. Current status: in progress.

**Evidence:** [M2.4 parity assessment](m2.4-configuration-parity.md), [ADR-017](decisions/ADR-017-policy-date-time-compatibility.md), [ADR-018](decisions/ADR-018-capability-date-time-compatibility.md), `node scripts/m2-configuration-parity.mjs`. Per-deployment database audit results remain outstanding and block M2.4 closure; generated TypeScript probes prove static assignability only.

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
