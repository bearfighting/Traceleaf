# M3 Site Registry and Legacy Backfill Checklist

- Status: planned
- Prerequisites: M0a semantic baseline and M2 persisted-configuration contract
- Related: [Platform improvement roadmap](platform-improvement-roadmap.md), [M0a baseline](m0a-baseline-and-decisions.md), [ADR-013](decisions/ADR-013-site-identity-and-lifecycle.md), [ADR-014](decisions/ADR-014-runtime-configuration-authority.md), [M2 implementation checklist](m2-implementation-checklist.md)

## Goal and scope

Create a durable Site Registry while preserving every existing `site_id` and its configuration and analytics history. M3 prepares the database and migration evidence for M4; it does not switch runtime configuration authority.

In scope: Registry storage and reference constraints; inventory and reconciliation of legacy Site IDs; an idempotent backfill/preflight tool; ingestion and historical-query compatibility evidence.

Out of scope: removing Collector TOML fallback or importing TOML policies/keys into runtime authority (M4); Site list/detail/create APIs or onboarding UI (M5/M6); changing Site IDs, deleting/re-writing analytics data, changing report semantics, or creating Sites solely from runtime heartbeats or transient processing state.

## Frozen rules

- Preserve existing Site IDs exactly; names and URLs are mutable metadata, not identity.
- Missing/uncertain legacy metadata is allowed and must be marked for attention. Never derive the authoritative Website URL from an Allowed Origin.
- Keep `lifecycle_status` (`active`/`archived`) distinct from derived `setup_status` (`ready`/`needs_attention`). Missing configuration does not imply archival.
- Preserve capability state, activation windows, environment policies, definitions, keys/digests, audit, raw events and derived facts.
- During M3, preserve current effective behavior: a present DB policy takes precedence, while a missing DB row may still use the existing TOML fallback until M4. After M4 removes that fallback, missing, disabled, or archived DB policy must fail closed while historical analytics remain queryable. A temporary DB outage with a valid last-known-good snapshot remains a separate stale state.
- Import is idempotent; weaker legacy hints must not overwrite administrator-confirmed metadata. Configuration runtime state is not an identity source.

## Source inventory

The preflight report must show per-source Site ID counts, overlaps, source-only IDs, metadata conflicts, and policy/environment coverage. Never log plaintext ingest keys or commit reports containing secrets.

| Source                                 | Evidence to collect                                                            | Notes                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_capability_configurations`       | Site IDs and capability documents                                              | Preserve configuration and activation history; do not apply new-site defaults.                                                                          |
| `site_capability_activation_windows`   | Site IDs and activation history                                                | Include as configuration references; preserve every row.                                                                                                |
| `definition_revision_watermarks`       | Site IDs and definition versions                                               | Reconciliation evidence only; these rows do not replace the revision source or create a Site by themselves.                                             |
| `configuration_audit.resource.site_id` | Site ID and resource kind from the JSON resource                               | Extract only the ID and kind; do not log key material or other sensitive values.                                                                        |
| Legacy capability configuration        | `analytics_feature_flags`                                                      | Reconcile with capability rows created by the configuration migration; retain any discrepancy for review.                                               |
| Analytics processing metadata          | `analytics_generations`, `analytics_watermarks`, `analytics_rebuild_queue`     | Cross-check only; progress/queue rows cannot create Registry identities by themselves.                                                                  |
| `site_environment_policies`            | Site IDs and environments                                                      | Policy is not authoritative URL metadata; preserve disabled/empty state.                                                                                |
| `site_definition_revisions`            | Site IDs and revision history                                                  | Preserve all revisions and audit links.                                                                                                                 |
| Raw events                             | Distinct `raw_events.site_id`                                                  | Include event-only sites.                                                                                                                               |
| Derived facts and aggregates           | Distinct IDs from analytical fact and aggregate tables only                    | Include IDs with no surviving raw rows; do not update facts during backfill. Processing-state tables above are cross-checks, not Site-creation sources. |
| Dashboard configuration                | `DASHBOARD_SITES`, `DASHBOARD_DEFAULT_SITE`                                    | Candidate metadata only; record provenance and conflicts.                                                                                               |
| Collector TOML                         | Site/environment entries, origins, key presence                                | Record evidence, never key values; do not infer canonical URL from origin.                                                                              |
| Legacy `dev-seed`                      | Historical seed inputs                                                         | Development-only evidence, not runtime authority.                                                                                                       |
| Definitions file importer              | `ANALYTICS_DEFINITIONS_FILE` and explicit `--import-definitions-if-empty` path | Read site IDs from the file; ordinary Processor startup does not import it.                                                                             |

Before implementation, enumerate all site-scoped fact tables from migrations and queries. This list is a discovery baseline, not permission to omit any found during that audit.

## Implementation slices

### M3.1 — Preflight and inventory

- [x] Check M1/M2 evidence. M2 is marked complete in its checklist; M1 modules and boundary tests are present, but the roadmap has no explicit M1 completion record.
- [x] Enumerate site-scoped tables, config inputs, seed/import paths and candidate ID sources from migrations and consumers.
- [x] Query the current local development DB read-only for distinct IDs and per-table counts; no reusable CLI was added.
- [x] Reconcile DB and static IDs and record overlaps, source-only IDs, metadata gaps and policy coverage below.
- [x] Keep key values out of output; retain per-ID mapping only in the local `/tmp` report.
- [x] Capture and review the development-database inventory. It represents this local environment only, not future deployments.

**Exit (local development, 2026-09-30):** static and database ID inventories are reconciled, but metadata provenance and test-fixture disposition remain open. Treat this as an inventory result, not approval to import every observed ID as a live Site. Each target deployment needs its own read-only preflight before M3.3 import or later foreign-key rollout.

#### Local development findings (2026-09-30)

- Migrations define 29 tables with a `site_id` column. Of these, 27 are configuration, analytics, or processing tables inventoried for candidates; `configuration_runtime_state` and `configuration_capability_runtime_state` are excluded from identity discovery. Their current totals are 1 distinct ID/2 rows and 9 distinct IDs/66 rows, respectively.
- The 27 candidate tables contain 9 distinct database Site IDs in total. Seven IDs occur in `site_capability_configurations` (7 rows) and activation windows (69 rows); `site_environment_policies` contains 1 ID/1 row; definitions contain 0 rows. `configuration_audit.resource.site_id` adds/overlaps two IDs across 6 audit rows.
- Raw events contain 32 rows across 3 IDs. Analytics facts and aggregates plus processing metadata contain 4 distinct IDs; all four also occur in capability configuration. No ID appears only in historical analytics data. Five database IDs do not occur in analytics facts or aggregates; one of these appears in legacy analytics processing metadata.
- Current static sources contribute three IDs: Dashboard list/default and dev-seed use `site_example`; Collector TOML contains `site_example` and `site_disabled`; the explicit definitions file contains `site_playground`. Two IDs overlap database sources; `site_disabled` is the sole static-only ID. Combined, the known candidate set is 10 IDs.
- Seven of the nine database-observed IDs match IDs hard-coded in integration tests (`analytics_api_test`, `analytics_api_phase6`, `analytics_api_phase6_rebuild_state`, `geo_api_test`, `another_geo_api_test`, `capability_runtime_aggregate_test`, `site_definition_revision_processor`). Treat these as observed database identities with likely fixture/test provenance; do not auto-exclude or import them as live Sites based on their names. Record an explicit disposition during M3.3 source approval.
- The sole database environment policy is `site_example/development`, enabled, with one Allowed Origin and one key digest (the key value was not queried or recorded). Collector TOML lists development and production for `site_example` and production for `site_disabled`; those origins remain migration evidence, not authoritative Website URLs.
- Effective Compose configuration resolves `DEV_SEED_ORIGINS` to three localhost origins, while the existing database policy has one Allowed Origin. `dev-seed` uses `ON CONFLICT (site_id, environment) DO NOTHING`, so it does not reconcile this mismatch on an existing row. The cause and intended policy are unresolved; preserve the observed database value and review seed/config provenance before any M4 cutover. Do not expose key material.
- No current source provides reliable display-name and canonical-URL metadata for these candidates. TOML Allowed Origins and event URLs are evidence for manual review only, not authoritative Website URLs. No candidate ID or metadata was inferred from runtime state.
- Detailed per-ID mappings are in `/tmp/m3.1-site-id-source-details.txt`; complete per-table counts, including empty tables, are in `/tmp/m3.1-site-id-inventory-summary.txt`. Both local reports stay outside version control and contain no key values.
- **Open items:** before M3.3 source approval/apply, explicitly disposition likely test/fixture IDs, the five database IDs absent from analytics facts/aggregates (including the one also present in processing metadata), and the `site_disabled` TOML-only ID. Reconcile the Compose seed-origin/database-policy difference before M4 policy cutover. Run target-specific read-only preflight before each M3.3 import and later foreign-key rollout. Decide separately whether M1 should be formally marked complete. During M3.1 inventory, no migration was applied and no database or runtime data was changed; M3.2 adds the separate additive schema migration.

### M3.2 — Registry schema and references

- [x] Specify minimum Registry fields/constraints required by ADR-013 and current storage; do not freeze M5 API fields.
- [x] Specify the metadata/configuration inputs and rules that derive `setup_status` per ADR-013. The value is a view, not separately stored authority.
- [x] Decide existing-table reference policy and orphan handling; add constraints only after importer and target preflight establish that every referenced ID exists.
- [x] Decide metadata precedence: Registry metadata is fill-only for backfill (COALESCE(existing, imported)); non-null Registry values are never overwritten by legacy hints. Conflicts remain in the dry-run/reconciliation report for explicit review. Allowed Origins are never Website URL inputs.
- [x] Add the additive SQLx migration `20260930001800_create_site_registry.sql`; never edit an applied migration.
- [x] Extend migration regression assertions for the new migration version, Registry table and setup-status view.
- [x] Document deployment ordering, service compatibility and rollback boundary below.

#### M3.2 schema and reference decision (2026-09-30)

- `site_registry.site_id` preserves the existing `VARCHAR(64)` identity exactly. Nullable `display_name` and `website_url` allow historical records with incomplete metadata; values, when present, cannot be blank. `lifecycle_status` is constrained to `active`/`archived` and defaults to `active`; `created_at` is database-defaulted, while Site Management/importer writes must set `updated_at` on an actual row change. Idempotent no-op imports must not advance it. The migration does not invent IDs or metadata.
- `setup_status` is not persisted. `site_registry_setup_status` derives `ready` only when display name and canonical Website URL exist, Page Views is enabled in the capability document, and at least one environment policy is enabled with a non-empty Allowed Origin list and at least one stored ingest-key digest. Otherwise it returns `needs_attention`. Archived lifecycle does not rewrite setup status. This view is onboarding completeness only, never Collector authorization. Application validation remains responsible for HTTP(S) URL syntax per ADR-013.
- Backfill provenance and value conflicts are handled by M3.3. Apply may fill null metadata from an approved source but never replace non-null metadata; disagreements are reported for review. No currently inventoried source provides a reliable canonical Website URL.
- The Registry becomes the intended parent for direct Site references only after M3.3 has imported and reconciled all identity-source IDs in that target database. Do not attach foreign keys in this migration: `site_capability_configurations` is not a complete parent for analytics-only identities, and adding constraints before backfill would break writes or preserve unsafe cascades. After importer and orphan preflight, add `ON DELETE RESTRICT` references for these durable tables: `analytics_feature_flags`, `site_capability_configurations`, `site_capability_activation_windows`, `site_environment_policies`, `site_definition_revisions`, `raw_events`, `page_view_totals`, `page_view_daily`, `page_view_routes`, `normalized_event_context`, `visitor_event_facts`, `visitor_daily`, `sessions`, `session_events`, `session_daily`, `dimension_event_facts`, `dimension_daily`, `web_vital_facts`, `custom_event_facts`, `conversion_facts`, `funnel_step_facts`, `geo_event_metadata`, and `geo_country_facts`. Keep `configuration_audit.resource.site_id` as immutable JSON audit evidence without an FK; runtime-state tables are excluded from Registry identity and FK policy. Processing metadata (`analytics_generations`, `analytics_watermarks`, `analytics_rebuild_queue`, `definition_revision_watermarks`) is cross-check evidence and receives no FK.
- Deployment order: apply this additive schema migration before the importer; existing services do not read the Registry and retain their current behavior. SQLx applies the migration transactionally; it creates only a new table and view, with no backfill or rewrite of existing rows, so no application-level site lock is needed. PostgreSQL DDL locks still apply, and the deployment job should avoid long-running schema transactions. Importer remains explicit and idempotent. Rollback before any Registry writes may drop the new view/table with a reviewed down migration; after Site rows are written, rollback must preserve them and use a reviewed forward migration or backup restore, never cascade-delete history.

**Exit:** schema and reference policy are reviewable, and migration is compatible with current services.

### M3.3 — Idempotent importer

- [ ] Dry-run and apply use the same candidate collection and reconciliation logic.
- [ ] Import the union of approved identity sources; never synthesize IDs from name, URL, Origin, runtime heartbeat, or transient processing progress. Use processing metadata only to reconcile candidate sources.
- [ ] Approve explicit metadata precedence; report conflicts rather than silently choosing disputed values.
- [ ] Flag incomplete metadata without changing existing effective policy.
- [ ] Repeated runs do not duplicate sites, downgrade confirmed metadata, or change unchanged rows.
- [ ] Record per-source counts and outcomes; make partial failure retryable. Enforce a single-run lock if concurrent execution is unsupported.

**Exit:** dry-run predicts apply; apply and repeat apply converge to identical identities and reconciliation totals.

### M3.4 — Compatibility and recovery

- [ ] An enabled, valid DB policy continues to accept events under its existing policy/environment.
- [ ] Verify the unchanged transition behavior: an explicitly present valid DB policy continues to take precedence; an explicitly disabled DB policy remains disabled; a missing DB row continues to follow any configured TOML fallback until M4 removes that fallback. Historical reports remain queryable in each case.
- [ ] Reserve the post-cutover fail-closed assertion for M4: once TOML fallback is removed, an explicitly missing, disabled, or archived DB policy rejects new events.
- [ ] Raw events, derived facts, definitions, key digests and audit rows are unchanged.
- [ ] Event-only, definition-only, policy-only and capability-only IDs are represented.
- [ ] Conflicting/missing metadata is reported and does not block queries or mutate policy.
- [ ] Verify rerun and partial-failure retry on a disposable database.
- [ ] Document backup, preflight, apply, postflight, expected counts and failure recovery; no undocumented manual SQL.

**Exit:** preservation and compatibility checks pass, with an actionable runbook and explicit rollback boundary.

### M3.5 — Rollout and M4 handoff

- [ ] Run preflight for each target environment before migration; retain sensitive reports outside source control.
- [ ] Apply migration/importer and reconcile preflight, importer and postflight counts.
- [ ] Review unresolved metadata conflicts and assign follow-up; do not invent URLs to make the report clean.
- [ ] Confirm services that do not read Registry remain compatible during rollout.
- [ ] Publish completion evidence and the TOML/definitions-file inventory M4 must reconcile.

**Exit:** all candidate IDs are in Registry or have a reviewed exception; counts reconcile; history is intact; M4 has a concrete authority-cutover inventory.

## Acceptance checklist

- [ ] Every discovered historical Site ID is represented without changing its ID.
- [ ] Importer is repeatable and does not duplicate sites or overwrite confirmed metadata with untrusted hints.
- [ ] Sites without reliable URLs are flagged; none were inferred from Allowed Origin.
- [ ] M3 preserves current DB/TOML transition behavior. After M4 removes TOML fallback, missing, disabled, or archived DB policy fails closed while historical queries remain available.
- [ ] Historical Analytics queries work for IDs found only in analytics data.
- [ ] Raw/derived analytics data, definition revisions, key digests and audit records are preserved.
- [ ] Redacted source reconciliation report is complete and reviewed.
- [ ] Migration/importer tests cover source union, metadata conflicts, idempotency and retry.
- [ ] Runbook covers target-specific preflight, apply, postflight and recovery.
- [ ] Roadmap and M4 handoff evidence are updated.

## Decisions to close during M3

1. Exact Registry columns/constraints and whether the ADR-013-derived setup status is cached; its derivation remains authoritative.
2. Foreign-key rollout and handling of any orphan IDs found during preflight.
3. Metadata provenance and precedence for Dashboard environment values, TOML and dev-seed inputs.
4. Importer form (CLI, migration companion or reusable admin tool); preflight remains read-only and apply explicit.
5. Whether data volume requires batches and a resumable progress marker.
6. Operator rollback: define backup restore versus reviewed compensating migration. Never automatically delete Registry or analytics rows as rollback.

## M4 handoff

M3 does not make the database runtime authority. M4 separately reconciles each TOML site/environment, origin and key against DB policy; reviews historical `ANALYTICS_DEFINITIONS_FILE` imports; then removes or explicitly gates TOML fallback. Preserve last-known-good behavior for temporary DB outages while explicit missing, disabled or archived DB policy fails closed.
