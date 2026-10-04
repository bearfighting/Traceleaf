# M9 Event Protocol Staticization Checklist

- Status: In progress (M9.2 complete; M9.1, M9.3–M9.5 remain open)
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
- [ ] Record the canonical valid/invalid fixtures and current Schema, static parser, and service-level accept/reject results before changing behavior. The shared parity runner could not complete on 2026-10-04 because its pinned `--locked` Cargo invocation requires a lockfile update; see the validation record.
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

- [ ] Ensure untrusted event JSON is checked for all Event V1 structural constraints not guaranteed by Rust types, including strict version/discriminator values, formats, bounds, and conditional requirements.
- [ ] Retain explicit semantic validation for single-Site batches, Custom Event property privacy/size/depth limits, Web Vital range/rating rules, and Web Vital/Page View association and time ordering.
- [ ] Run the shared parity harness (`node experiments/m0b/parity/run.mjs`) and Schema fixture validation (`pnpm protocol:validate`) over the canonical valid/invalid corpus.
- [ ] Compare Schema, Rust parse/serialize, and Collector service outcomes; explain each difference and correct unintended differences before proceeding.
- [ ] Verify invalid inputs retain the existing external `invalid_event_batch` response and that internal detailed errors remain server-side.

**Exit:** Every canonical fixture has an explained and accepted outcome across Schema, Rust, and service layers; required semantic and wire behavior has direct regression coverage.

### M9.4 — Decide production Schema validator lifecycle per contract

- [ ] Review M9.3 evidence and record whether Event Batch V1 production validation remains Schema-based or moves to static decoding plus explicit checks.
- [ ] If production Schema validation is removed, verify all equivalent constraints remain enforced at runtime and Schema/fixture validation remains in CI.
- [ ] If it remains, record the reason and ensure validator construction/lifecycle follows ADR-015; do not use this slice to broaden validator abstractions.
- [ ] Record any change to accepted input, rejection behavior, or runtime validation ownership in an ADR before changing the contract.

**Exit:** The runtime choice is explicit, parity-backed, and preserves external error behavior and CI Schema validation.

### M9.5 — CI integration and final boundary review

- [ ] Ensure CI runs Rust consumer compilation/tests, shared event parity, and Schema/fixture validation. Reuse existing scripts and commands where they already cover these gates.
- [ ] Run `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check`; record actual outcomes and existing warnings.
- [ ] Review Rust module dependency boundaries and repository SQL write ownership for unintended cross-domain coupling.
- [ ] Verify historical raw events and derived facts remain readable and unchanged by the implementation; no migration or backfill is expected for wire-only parser changes.
- [ ] Verify the Site creation → event collection → processing → Analytics API → Dashboard path with the existing applicable end-to-end workflow, and record exactly which workflow was run.
- [ ] Update the M9 checklist and roadmap with completed evidence, known limits, and any deferred work.

**Exit:** Staticization and final boundary evidence are recorded; no protocol, API, reporting, or historical-data regression is introduced.

## Validation record

Append dated command results, fixture/parity findings, runtime validation decision, E2E scope, and any existing warnings here. Do not mark a checklist item complete based solely on planned commands or an earlier run that predates the corresponding change.

### 2026-10-04 — M9.1 baseline inventory

- **Schema structure:** `protocol/events/schemas/event-batch.schema.json` requires `schema_version: 1` and 1–100 events, with `oneOf` references to the Page View, Custom Event, and Web Vital schemas. Page View references `protocol/contexts/browser-context.schema.json`; its conditional rules require `context_schema_version` and `context` together. Batch and Page View allow extension properties; Custom Event, Web Vital, and Browser Context reject unknown fields.
- **Runtime path:** `services/collector/src/validation.rs::Validator::new` builds Draft 2020-12 validators for the batch and each event schema with format checking enabled and an embedded resolver for event/context references. `Validator::validate` validates the batch, parses every event through the matching Serde wire type, and enforces one `site_id` per batch. `validate_event` applies Custom Event property privacy/shape/size/depth rules and Web Vital supported-range/rating checks plus report-after-Page-View timestamp ordering. Rust wire types are hand-maintained in `services/collector/src/protocol.rs`.
- **HTTP and persistence consumers:** `services/collector/src/http.rs::validate_batch` maps any validator failure to HTTP `invalid_event_batch`, then applies capability and five-minute future-time checks before passing typed events and their original JSON payloads to `EventSink`. Capability filtering removes disabled visitor/context fields from both the typed event and payload. `services/collector/src/sink.rs` stores the raw payload and checks Web Vital association with a Page View by site, ID, path, and timestamp; database timestamp conversion can reject values not representable by `chrono`. `services/processor/src/processor.rs` consumes persisted raw payloads for custom properties, Web Vital facts, and browser context normalization. These are service/storage/downstream rules, not all single-document Schema rules.
- **Rule ownership:** Schema owns required fields, primitive types, const/enum/pattern/format constraints, field bounds, unknown-field policy, batch cardinality, context field constraints, and the context/version conditional. Explicit Collector validation owns single-site batches, Custom Event prohibited keys and recursive limits, Web Vital rating/value limits and timestamp ordering. HTTP owns capability availability/enabled checks and the accepted future-time window. Sink/storage owns Web Vital Page View association and representable timestamps; database uniqueness/idempotency and processor fact derivation are persistence/downstream behavior.
- **Fixtures and evidence:** canonical protocol corpus currently has 12 valid and 27 invalid event fixtures (39 total; `protocol/events/fixtures/{valid,invalid}`). `pnpm protocol:validate` passed on 2026-10-04, including the protocol and contract-layout validators. `cargo test -p collector canonical_ -- --nocapture` passed 4 tests; the two Collector canonical event tests accepted/rejected all event fixtures, and the policy tests also passed. This confirms current Collector Schema-backed behavior for fixture acceptance, but does not create a fresh Schema-vs-TS/Rust-static parity matrix. The M0b report's 39/39 Collector event result and 56-fixture prototype results remain historical evidence dated 2026-09-29.
- **Parity runner status:** `node experiments/m0b/parity/run.mjs` failed before producing results: its Rust child invokes `cargo run --offline --locked`, and Cargo 1.98.1 reported that the tracked `experiments/m0b/parity/rust/Cargo.lock` needs updating. The runner did not complete, so no TSV matrix was refreshed; `docs/m0b-step6-parity-matrix.tsv` remains historical. No lockfile or production behavior was changed. Reproducible baseline and M9.1 exit remain open until the lockfile/harness issue is resolved and the parity runner completes.
- **TypeScript ownership:** event consumer types are imported from the `@web-analytics/protocol-ts` package root (`packages/protocol-ts/src/index.ts`), including `EventBatch` and the three event types. The current M2 drift-check script `scripts/generate-m2-configuration-types.mjs` generates configuration contract types only; event TypeScript source types under `packages/protocol-ts/src/` are hand-maintained. M9 consumes the package's existing public entry point and does not add a second generator.
- **M9.2 round-trip risks to probe:** (1) Page View schema-allowed extension fields are dropped by the closed Rust struct on deserialize/serialize, although ingest currently retains the original JSON payload; (2) absent `Option` fields serialize as `null` without `skip_serializing_if`, which can violate Schema; (3) context values pass through `serde_json::Value`, but the surrounding optional field has the same omission risk. Exercise each event/context omission and Page View extension through the actual intended round-trip path, then validate serialized JSON against its Schema. Keep the current production Schema validator decision deferred to M9.4.
- **Documentation validation:** `pnpm format:check:docs` and `git diff --check` passed on 2026-10-04. The checklist is intentionally not marked complete while shared parity evidence is unavailable.

### 2026-10-04 — M9.2 Rust wire round-trip

- **Implementation:** Page View now captures additional Schema-allowed properties in a flattened `BTreeMap<String, serde_json::Value>`. Optional Page View fields and Custom Event `visitor_id` are omitted when absent. Custom Event and Web Vital Rust structs reject unknown fields; Batch and Page View retain their existing extension policies.
- **Regression coverage:** Collector validation tests round-trip a minimal Page View, a context-bearing Page View with extension properties, and a Custom Event without `visitor_id`. Encoded values are checked against the embedded applicable event Schema. Tests also check Page View `null` rejection and unknown-field rejection for Custom Event/Web Vital.
- **Validation:** `cargo test -p collector` passed (63 unit tests passed; PostgreSQL-dependent tests remain ignored); `pnpm protocol:validate`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed. Production validation still uses the original JSON payload and Schema validator; no Event V1 Schema or canonical fixture semantics changed.
