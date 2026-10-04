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

Append dated command results, fixture/parity findings, runtime validation decision, E2E scope, and any existing warnings here. Do not mark a checklist item complete based solely on planned commands or an earlier run that predates the corresponding change.

### 2026-10-04 — M9.1 baseline inventory

- **Schema structure:** `protocol/events/schemas/event-batch.schema.json` requires `schema_version: 1` and 1–100 events, with `oneOf` references to the Page View, Custom Event, and Web Vital schemas. Page View references `protocol/contexts/browser-context.schema.json`; its conditional rules require `context_schema_version` and `context` together. Batch and Page View allow extension properties; Custom Event, Web Vital, and Browser Context reject unknown fields.
- **Runtime path:** `services/collector/src/validation.rs::Validator::new` builds Draft 2020-12 validators for the batch and each event schema with format checking enabled and an embedded resolver for event/context references. `Validator::validate` validates the batch, parses every event through the matching Serde wire type, and enforces one `site_id` per batch. `validate_event` applies Custom Event property privacy/shape/size/depth rules and Web Vital supported-range/rating checks plus report-after-Page-View timestamp ordering. Rust wire types are hand-maintained in `services/collector/src/protocol.rs`.
- **HTTP and persistence consumers:** `services/collector/src/http.rs::validate_batch` maps any validator failure to HTTP `invalid_event_batch`, then applies capability and five-minute future-time checks before passing typed events and their original JSON payloads to `EventSink`. Capability filtering removes disabled visitor/context fields from both the typed event and payload. `services/collector/src/sink.rs` stores the raw payload and checks Web Vital association with a Page View by site, ID, path, and timestamp; database timestamp conversion can reject values not representable by `chrono`. `services/processor/src/processor.rs` consumes persisted raw payloads for custom properties, Web Vital facts, and browser context normalization. These are service/storage/downstream rules, not all single-document Schema rules.
- **Rule ownership:** Schema owns required fields, primitive types, const/enum/pattern/format constraints, field bounds, unknown-field policy, batch cardinality, context field constraints, and the context/version conditional. Explicit Collector validation owns single-site batches, Custom Event prohibited keys and recursive limits, Web Vital rating/value limits and timestamp ordering. HTTP owns capability availability/enabled checks and the accepted future-time window. Sink/storage owns Web Vital Page View association and representable timestamps; database uniqueness/idempotency and processor fact derivation are persistence/downstream behavior.
- **Fixtures and evidence:** canonical protocol corpus currently has 12 valid and 27 invalid event fixtures (39 total; `protocol/events/fixtures/{valid,invalid}`). `pnpm protocol:validate` passed on 2026-10-04, including the protocol and contract-layout validators. `cargo test -p collector canonical_ -- --nocapture` passed 4 tests; the two Collector canonical event tests accepted/rejected all event fixtures, and the policy tests also passed. This confirms current Collector Schema-backed behavior for fixture acceptance, but does not create a fresh Schema-vs-TS/Rust-static parity matrix. The M0b report's 39/39 Collector event result and 56-fixture prototype results remain historical evidence dated 2026-09-29.
- **Parity runner status at baseline:** The initial `node experiments/m0b/parity/run.mjs` attempt failed because the standalone lockfile omitted Collector's `regress` dependency. M9.3 refreshed that lockfile offline and completed the run; results are recorded below. This successful run postdates M9.2 and does not replace the requested pre-change parity baseline.
- **TypeScript ownership:** event consumer types are imported from the `@web-analytics/protocol-ts` package root (`packages/protocol-ts/src/index.ts`), including `EventBatch` and the three event types. The current M2 drift-check script `scripts/generate-m2-configuration-types.mjs` generates configuration contract types only; event TypeScript source types under `packages/protocol-ts/src/` are hand-maintained. M9 consumes the package's existing public entry point and does not add a second generator.
- **M9.2 round-trip risks to probe:** (1) Page View schema-allowed extension fields are dropped by the closed Rust struct on deserialize/serialize, although ingest currently retains the original JSON payload; (2) absent `Option` fields serialize as `null` without `skip_serializing_if`, which can violate Schema; (3) context values pass through `serde_json::Value`, but the surrounding optional field has the same omission risk. Exercise each event/context omission and Page View extension through the actual intended round-trip path, then validate serialized JSON against its Schema. Keep the current production Schema validator decision deferred to M9.4.
- **Documentation validation:** `pnpm format:check:docs` and `git diff --check` passed on 2026-10-04. At this inventory checkpoint M9.1 was still open pending shared parity evidence; the later M9.1 baseline entry records its completion.

### 2026-10-04 — M9.2 Rust wire round-trip

- **Implementation:** Page View now captures additional Schema-allowed properties in a flattened `BTreeMap<String, serde_json::Value>`. Optional Page View fields and Custom Event `visitor_id` are omitted when absent. Custom Event and Web Vital Rust structs reject unknown fields; Batch and Page View retain their existing extension policies.
- **Regression coverage:** Collector validation tests round-trip a minimal Page View, a context-bearing Page View with extension properties, and a Custom Event without `visitor_id`. Encoded values are checked against the embedded applicable event Schema. Tests also check Page View `null` rejection and unknown-field rejection for Custom Event/Web Vital.
- **Validation:** `cargo test -p collector` passed (63 unit tests passed; PostgreSQL-dependent tests remain ignored); `pnpm protocol:validate`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed. Production validation still uses the original JSON payload and Schema validator; no Event V1 Schema or canonical fixture semantics changed.

### 2026-10-04 — M9.3 Runtime checks and parity

- **Runtime ownership:** The Collector validates incoming batches and events with embedded Draft 2020-12 schemas before Serde decoding. This covers structural constraints including versions, discriminators, formats, field bounds, unknown-field policies, and Browser Context conditionals. Existing explicit checks remain responsible for single-Site batches, Custom Event property privacy and recursive limits, Web Vital ranges and rating consistency, and Page View/Web Vital timestamp ordering. HTTP maps validator failures to the generic `invalid_event_batch` response; internal parser diagnostics are not returned.
- **Parity harness:** Added the missing `regress` entry to `experiments/m0b/parity/rust/Cargo.lock` through offline Cargo resolution. `node experiments/m0b/parity/run.mjs` completed with 56 fixtures: zero TypeScript-static, Rust-static, or current-Collector differences from fixture expectations, and zero Rust serialized-schema rejections. The harness refreshed `docs/m0b-step6-parity-matrix.tsv`.
- **Explained differences:** Nine Schema-vs-expected differences are intentional semantic constraints the JSON Schemas do not express: six Custom Event property privacy/shape/size/depth cases, one mixed-Site batch, one inconsistent Web Vital rating, and one Web Vital report preceding its Page View. Static Rust, TypeScript, and current Collector reject all nine as expected. Three Typify/Serde differences are confined to environment-policy comparison and outside M9 event scope. All 12 valid event fixtures now serialize to Schema-valid JSON.
- **Service behavior and verification:** `cargo test -p collector` passed (65 unit tests and 15 non-PostgreSQL integration tests; PostgreSQL-dependent tests remain ignored), including canonical fixture acceptance/rejection, HTTP rejection tests for `invalid_event_batch`, and in-memory Sink association tests. Added an ignored PostgreSQL integration test that exercises the production `PostgresSink` for same/prior-batch matches, site/ID/path/time mismatches, and transaction rollback. The integration test compiled but was not run because `DATABASE_URL` is unset in this environment. `pnpm protocol:validate` passed across protocol and configuration fixtures. The current parity result is post-M9.2; the reconstructed pre-M9.2 baseline and its differences are recorded in the M9.1 section below.

### 2026-10-04 — M9.4 Production validation lifecycle decision

- **Decision:** Keep JSON Schema validation in the production Event Batch V1 path. M9.3 demonstrates parity on the post-M9.2 wire model, but the static Rust validator still runs only in the parity experiment; `Validator::validate` is the production entry point and applies the embedded batch/event schemas before typed Serde decoding. The schemas also enforce structural constraints not guaranteed by wire types alone, including formats, field bounds, and conditional Browser Context requirements. Static decoding plus explicit checks is not yet wired into Collector production parsing, so removing Schema validation now would create an unverified runtime gap.
- **Lifecycle:** `services/collector/src/main.rs` constructs `Validator::new()` once at startup and injects it into the HTTP state; `services/collector/src/http.rs` stores/reuses it through `Arc<Validator>`. HTTP maps validation failures to `invalid_event_batch` without returning validator diagnostics. This matches ADR-015; no runtime refactor or new ADR is needed. Schema and fixtures remain CI gates.
- **Historical baseline attempt:** The initial run could not complete because the standalone Cargo lockfile needed an offline update and pnpm could not run `exec tsc` (`unable to open database file`). The successful isolated retry and complete baseline are recorded below; it supersedes the incomplete attempt.
- **M9.4 verification:** `cargo test -p collector` passed (65 unit tests and 15 non-PostgreSQL integration tests); 9 PostgreSQL integration tests and 1 optional MMDB smoke test were ignored. HTTP tests cover the generic validation rejection. `pnpm protocol:validate`, `pnpm format:check`, `pnpm format:check:docs`, and `git diff --check` passed. The initial format check identified formatting in the M9.3 PostgreSQL association test; it was corrected and the full format check then passed. Source inspection confirmed startup construction/injection and the generic HTTP error mapping. PostgreSQL integration tests were not run because they require a migrated database.

### 2026-10-04 — M9.1 isolated historical baseline retry

- **Snapshot:** Created `/tmp/web-analytics-m9-pre-m92-retry` from `git archive 0c23f3d`; the source corresponds to `0c23f3d0e93bae064c8948750329fb1a3459ebd4`. All experiment outputs and Cargo-generated files were confined to this `/tmp` snapshot.
- **Rust static lane:** `cargo run --offline --manifest-path experiments/m0b/parity/rust/Cargo.toml` completed successfully in the isolated snapshot (Cargo resolved/updated only the snapshot's lockfile). The standalone Rust program emitted fixture results, but this is only one lane and does not generate the parity matrix.
- **Full harness:** `node experiments/m0b/parity/run.mjs` failed before compilation because the archive has no installed JS dependencies (`ERR_MODULE_NOT_FOUND: Cannot find package 'ajv'`). Linked the main checkout's existing `node_modules` into the snapshot and retried. The harness then stopped at its `pnpm exec tsc` step; the equivalent direct command, `pnpm exec tsc --strict --skipLibCheck --target ES2022 --module ES2022 --moduleResolution Bundler --outDir /tmp/web-analytics-m9-pre-m92-retry/artifacts/m0b-parity/typescript experiments/m0b/parity/typescript/static-validator.ts`, failed with `[ERROR] unable to open database file`. The `node` harness consequently exited 1 with empty captured stdout/stderr at its compile-status check. No Schema/TypeScript/Rust/Collector cross-lane matrix or fixture-level difference count was produced.
- **Outcome at this retry checkpoint:** M9.1 remained open because no cross-lane matrix had been produced. The subsequent completed-baseline entry records the workaround and successful matrix; no parity source, matrix, lockfile, or historical commit in the main checkout was changed by this retry.

### 2026-10-04 — M9.1 isolated historical baseline completed

- **Snapshot and toolchain:** Reused `/tmp/web-analytics-m9-pre-m92-retry`, created from `git archive 0c23f3d` (`0c23f3d0e93bae064c8948750329fb1a3459ebd4`). Cargo's offline lockfile resolution changed only the snapshot. The snapshot linked the checkout's existing `node_modules`; its TypeScript compiler is 6.0.3, matching the version pinned by the historical `pnpm-lock.yaml`.
- **Harness adaptation:** pnpm 11.5.2 fails inside the repository with `unable to open database file` (the commit requires pnpm 12.6.0). To run the exact compiler against the historical source, changed only the snapshot's `experiments/m0b/parity/run.mjs` to invoke `node_modules/.bin/tsc` directly. Direct TypeScript compilation succeeded. The committed harness and package manager setup in the main checkout were untouched.
- **Command and artifacts:** Ran `node experiments/m0b/parity/run.mjs` in the snapshot; it completed successfully and emitted `/tmp/web-analytics-m9-pre-m92-retry/artifacts/m0b-parity/results.json` and `results.tsv`. `results.tsv` contains 56 fixture rows plus its header: 12 valid event, 27 invalid event, and 17 environment-policy fixtures.
- **Parity results:** There were 9 Schema-vs-expected differences, all event fixtures for semantic/business rules outside JSON Schema (six Custom Event property restrictions, one mixed-Site batch, one inconsistent Web Vital rating, and one Web Vital preceding its Page View). TypeScript static, Rust static, and Collector current each had zero differences from fixture expectations. Cross-lane differences therefore total 9 and are fully explained by Schema accepting those nine semantic-invalid fixtures. Typify/Serde had 3 expectation differences, all in the environment-policy lane and outside M9 event scope.
- **Pre-M9.2 round-trip baseline:** Rust serialization produced Schema-invalid output for 10 of the 12 valid event fixtures, exposing the pre-M9.2 optional-field `null` and extension-field round-trip gaps. This is recorded as baseline evidence; it does not change the accept/reject parity counts.
- **Outcome and boundary:** M9.1 is complete: the full historical Schema/TS/Rust/Collector acceptance matrix was generated and the differences are accounted for. The original parity matrix was not copied or rewritten; all generated artifacts and the adapted runner remain under `/tmp`. At the time of this baseline run, only this checklist was changed in the main checkout; `git diff --check` passed.

### 2026-10-04 — M9.5 CI, boundaries, and workflow verification

- **CI integration:** Added `node experiments/m0b/parity/run.mjs` to `scripts/test.sh`. The existing `quality.yml` pull request and full-validation jobs run `pnpm test`; that script already runs `cargo test --workspace` and `pnpm protocol:validate`, so CI now also runs the shared Schema/TypeScript/Rust/Collector parity matrix on those paths.
- **Validation commands:** `pnpm test`, `pnpm check`, `pnpm build`, `pnpm format:check`, and `pnpm format:check:docs` passed on 2026-10-04. `pnpm test` reported M0b parity at 56 fixtures / 9 explained cross-lane differences / 0 Collector expectation differences; Rust workspace tests, protocol Schema/fixture checks, and package tests passed. `pnpm check` passed with five existing unused eslint-disable warnings in generated protocol TypeScript and a Vite config warning from Dashboard tests. `pnpm build` passed for the Rust workspace, packages, Dashboard, and playgrounds. `git diff --check` passed after the M9.5 documentation update.
- **Module and SQL ownership review:** `pnpm check` ran `cargo test -p analytics-api --test module_boundaries` (2 passed). Source review found Analytics API report/query code read-only; Site Management owns site registry, configuration, and management audit writes; Collector inserts accepted raw event payloads and geo metadata; Processor reads raw events and owns processed markers, watermarks, and derived facts. Processor's explicit `--import-definitions-if-empty` path also writes initial definition revisions and audit rows as the documented legacy import exception (ADR-014); ordinary processing reads definition revisions. No M9 change crosses those write boundaries.
- **Historical data compatibility:** The M9 code diff from `0c23f3d` changes Collector protocol/validation/sink code and adds Collector storage test coverage; it includes no migration. Event V1 production Schema validation remains in front of typed decoding, and the sink continues persisting the original JSON payload. Processor reads those raw payloads for facts, so historical rows require no rewrite, backfill, or schema change.
- **End-to-end workflows:** `pnpm e2e:analytics` passed all 10 fixtures through Collector, Processor, and Analytics API. The first `pnpm e2e:site-onboarding` attempt was interrupted while the Next.js image downloaded dependencies very slowly; its unique Compose resources were cleaned up. A subsequent full rerun passed: Site creation, one-time key handling, Browser SDK ingest, runtime configuration application, processing, Analytics API, Dashboard Settings, and Dashboard operational-error states. The test Compose project, network, and volume were removed after success; the pre-existing `db-audit-purger` remained running.
- **M9.5 status:** CI parity integration, required checks, boundaries, historical compatibility, and the complete onboarding E2E are complete. `pnpm e2e:site-onboarding` exited 0 on 2026-10-04.
