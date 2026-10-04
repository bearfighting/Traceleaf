# M9 Event Protocol Staticization Checklist

- Status: Complete (M9.1–M9.5 complete)
- Prerequisites: M0b event contract, canonical fixtures, and static type strategy accepted; ADR-016 and ADR-015
- Roadmap: [Platform Improvement Roadmap](platform-improvement-roadmap.md)
- Design: [Protocol Schema and Static Runtime Models](protocol-static-runtime-design.md)
- Decisions: [ADR-015 Validation Lifecycle and Staged Static Migration](decisions/ADR-015-validation-lifecycle-and-staged-static-migration.md), [ADR-016 Contract Type Sources and Generation](decisions/ADR-016-contract-type-sources-and-generation.md)
- Scope: Collector Event Batch V1 / event parsing only, plus final architecture and end-to-end boundary evidence explicitly listed below

## Goal

Move Collector event decoding to versioned, hand-maintained Rust wire types with explicit runtime checks where static decoding alone does not enforce the Event V1 contract. Demonstrate that valid and invalid canonical inputs behave consistently with the JSON Schemas and preserve the required wire round-trip behavior before deciding whether production event Schema validation can be removed.

This work does not change Event V1 wire semantics, Analytics API contracts, report meaning, historical data, or the Site/Session rules. Generated TypeScript types and generator drift checks are already handled by the shared M2 generation workflow; M9 must consume and validate that existing workflow rather than build a second one.

## Frozen constraints

- Keep Event Batch, Page View, Custom Event, Web Vital, and Browser Context Schemas and canonical fixtures as CI validation inputs.
- Rust event wire types remain hand-maintained in the Collector protocol module unless a new decision supersedes ADR-016.
- Static Rust types do not replace runtime validation of untrusted JSON. Explicit checks must cover contract constraints that Serde types do not enforce.
- Preserve Page View extension fields allowed by Schema. Preserve optional-field omission on serialization whenever Schema forbids `null`.
- Keep event version and discriminator checks strict, and preserve current batch/event semantic checks such as single-Site batches, Custom Event property restrictions, and Web Vital/Page View relations.
- Preserve external rejection behavior, including the Collector's `invalid_event_batch` response; internal parser diagnostics are not a public contract.
- Do not remove production Schema validation until parity evidence has been reviewed and the per-contract runtime decision is recorded. If Schema validation remains, document why; if removed, document the compatibility rationale and retained CI gates.
- Do not generate analytics data or change Site, visitor, session, report, or historical-data behavior as part of event protocol staticization.

## Delivery slices

### M9.1 — Establish the event contract and compatibility baseline

- [x] Inventory Event Batch V1, event sub-schemas, `$ref` relationships, Rust wire types, production Schema validator, explicit semantic checks, and all consumers of parsed events.
- [x] Record the canonical valid/invalid fixtures and current Schema, static parser, and service-level accept/reject results before changing behavior.
- [x] Identify which constraints are Schema rules, which are explicit event/business semantics, and which are persistence or downstream processing rules.
- [x] Confirm TypeScript event types are consumed through `@web-analytics/protocol-ts`; record the actual M2 generation boundary without duplicating generation infrastructure.

**Exit:** There is a reproducible baseline and a written map from each contract rule to its runtime owner and test evidence.

### M9.2 — Complete Rust wire types and round-trip behavior

- [x] Keep the Rust event model versioned and aligned to Event Batch V1 discriminators and required fields.
- [x] Preserve Schema-allowed Page View extension fields through deserialize, event handling, and serialize paths wherever those values are expected to round-trip.
- [x] Ensure absent optional fields serialize as omitted fields when `null` is forbidden; cover each affected event/context field with tests.
- [x] Add round-trip probes for minimal and context-bearing Page Views, Page View extensions, and an omitted Custom Event visitor ID; validate encoded event JSON against the embedded event Schema.
- [x] Confirm strict unknown-field behavior for Custom Event and Web Vital while Page View retains extensions.

**Exit:** Rust decode/encode round trips preserve required wire data and all serialized fixtures remain Schema-valid.

### M9.3 — Add explicit runtime validation and establish parity

- [x] Ensure untrusted event JSON is checked for all Event V1 structural constraints not guaranteed by Rust types, including strict version/discriminator values, formats, bounds, and conditional requirements. Production continues to run the existing Schema validator before Serde decoding.
- [x] Retain explicit semantic validation for single-Site batches, Custom Event property privacy/size/depth limits, Web Vital range/rating rules, and Web Vital/Page View association and time ordering; canonical invalid fixtures and Sink regression tests cover the rejection cases.
- [x] Run the shared parity harness (`node experiments/m0b/parity/run.mjs`) and Schema fixture validation (`pnpm protocol:validate`) over the canonical valid/invalid corpus.
- [x] Compare Schema, Rust parse/serialize, and Collector service outcomes; explain each difference and correct unintended differences before proceeding.
- [x] Verify invalid inputs retain the existing external `invalid_event_batch` response and that internal detailed errors remain server-side.

**Exit:** Every canonical fixture has an explained and accepted outcome across Schema, Rust, and service layers; required semantic and wire behavior has direct regression coverage.

### M9.4 — Decide production Schema validator lifecycle per contract

- [x] Review M9.3 evidence and record whether Event Batch V1 production validation remains Schema-based or moves to static decoding plus explicit checks.
- [n/a] Production Schema validation remains in place, so the removal-only verification does not apply.
- [x] If it remains, record the reason and ensure validator construction/lifecycle follows ADR-015; do not use this slice to broaden validator abstractions.
- [x] Record any change to accepted input, rejection behavior, or runtime validation ownership in an ADR before changing the contract.

**Exit:** The runtime choice is explicit, parity-backed, and preserves external error behavior and CI Schema validation.

### M9.5 — CI integration and final boundary review

- [x] Ensure CI runs Rust consumer compilation/tests, shared event parity, and Schema/fixture validation. Reuse existing scripts and commands where they already cover these gates.
- [x] Run `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check`; record actual outcomes and existing warnings.
- [x] Review Rust module dependency boundaries and repository SQL write ownership for unintended cross-domain coupling.
- [x] Verify historical raw events and derived facts remain readable and unchanged by the implementation; no migration or backfill is expected for wire-only parser changes.
- [x] Verify the Site creation → event collection → processing → Analytics API → Dashboard path with the existing applicable end-to-end workflow, and record exactly which workflow was run.
- [x] Update the M9 checklist and roadmap with completed evidence, known limits, and any deferred work.

**Exit:** Staticization and final boundary evidence are recorded; no protocol, API, reporting, or historical-data regression is introduced.

## Validation record

Keep this record concise: list the final evidence for each delivery slice, fixtures/parity counts, lifecycle decisions, E2E scope, and material limitations. Historical failed attempts are summarized only where they explain the final method.

### M9.1 — Baseline and contract ownership (2026-10-04)

- **Contract:** Event Batch V1 requires `schema_version: 1` and 1–100 events. Batch and Page View schemas allow extensions; Custom Event, Web Vital, and Browser Context schemas reject unknown fields. Page View requires `context_schema_version` and `context` together. The Collector validates Draft 2020-12 schemas with format checking before Serde parsing, then applies single-Site batch, Custom Event property, and Web Vital semantic rules. HTTP adds capability and future-time checks; Sink enforces Web Vital/Page View association and timestamp representability.
- **Consumers and ownership:** HTTP maps validation failures to `invalid_event_batch`, then passes typed events and original JSON to `EventSink`. The sink persists original payloads; Processor consumes those payloads for normalization and fact generation. Event TS types are hand-maintained under `packages/protocol-ts/src/` and consumed through the package root; M2 generates configuration types only. Rust event wire types remain hand-maintained in `services/collector/src/protocol.rs`.
- **Historical baseline:** Reconstructed from `0c23f3d0e93bae064c8948750329fb1a3459ebd4` in `/tmp/web-analytics-m9-pre-m92-retry`. After Cargo's offline lockfile update, the Rust static lane passed. The full harness initially hit missing JS dependencies and pnpm 11.5.2's `unable to open database file`; linking the checkout's dependencies and changing only the snapshot runner to call the pinned TypeScript 6.0.3 compiler directly allowed `node experiments/m0b/parity/run.mjs` to complete.
- **Baseline results:** `artifacts/m0b-parity/results.tsv` in that snapshot contains 56 fixtures: 12 valid and 27 invalid event fixtures plus 17 environment-policy fixtures. Schema accepts nine semantic-invalid event fixtures; TypeScript static, Rust static, and Collector each match all fixture expectations. Three Typify/Serde expectation differences are policy-only. Pre-M9.2 Rust serialization emitted Schema-invalid JSON for 10 of 12 valid event fixtures. The nine Schema differences and ten serialization failures are distinct measurements.

### M9.2 — Rust wire round trips (2026-10-04)

- Page View preserves Schema-allowed extension properties through deserialize/serialize. Optional Page View fields and Custom Event `visitor_id` are omitted when absent. Custom Event and Web Vital reject unknown fields.
- Collector tests cover minimal and context-bearing Page Views, extensions, omitted Custom Event `visitor_id`, Schema validation of serialized values, Page View `null` rejection, and strict unknown-field behavior.
- `cargo test -p collector` passed (63 unit tests at this stage); `pnpm protocol:validate`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed.

### M9.3 — Runtime checks and current parity (2026-10-04)

- Production continues to validate embedded Event V1 schemas before Serde parsing. Explicit Collector checks enforce single-Site batches, Custom Event property privacy/shape/size/depth, Web Vital ranges and ratings, and Web Vital/Page View ordering and association. HTTP preserves the generic `invalid_event_batch` response.
- The post-M9.2 parity run covered 56 fixtures: zero TypeScript-static, Rust-static, Collector expectation, or Rust serialized-schema failures. Nine Schema-vs-expectation differences are intentional semantic rules absent from JSON Schema; three Typify/Serde differences are outside event scope.
- Collector tests passed (65 unit tests and 15 non-PostgreSQL integration tests). PostgreSQL association coverage was added and compiled; it runs in the PostgreSQL integration workflow (`pnpm test:integration`). `pnpm protocol:validate` passed.

### M9.4 — Production Schema lifecycle (2026-10-04)

- Keep JSON Schema validation in production because static decoding plus explicit checks is not wired into the Collector's production parsing path and does not independently enforce all structural constraints. `main.rs` constructs the validator once, HTTP state reuses it through `Arc<Validator>`, and failures remain mapped to `invalid_event_batch`, consistent with ADR-015.
- No ADR change was needed: the runtime choice does not change accepted input or external rejection behavior. The validator-removal verification is not applicable.

### M9.5 — CI, compatibility, and end-to-end review (2026-10-04)

- Added `node experiments/m0b/parity/run.mjs` to `scripts/test.sh`. The CI quality workflow runs `pnpm test`, which now covers Rust workspace tests, Schema/fixture validation, and shared event parity.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed. Existing output included five unused eslint-disable warnings in generated protocol TypeScript and a Vite configuration warning in Dashboard tests. `pnpm check` also passed the two analytics-api module-boundary tests.
- SQL ownership review found report queries read-only; Site Management owns registry/configuration/audit writes; Collector writes raw events and geo metadata; Processor writes processing state and derived facts. Processor's explicit legacy definitions import remains the documented ADR-014 exception. No M9 changes cross these boundaries.
- The M9 code diff contains no migration or backfill. Production Schema validation and original raw payload persistence remain, so existing raw events and derived facts need no rewrite.
- `pnpm e2e:analytics` passed all 10 fixtures. `pnpm e2e:site-onboarding` passed the full Site creation → SDK ingest → processing → Analytics API → Dashboard path, including one-time key handling and Dashboard operational-error states. The isolated Compose resources were removed after the run; the pre-existing `db-audit-purger` remained running.
