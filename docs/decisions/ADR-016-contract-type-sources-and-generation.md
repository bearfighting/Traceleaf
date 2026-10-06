# ADR-016：按 Contract 类别确定类型来源与生成策略

- Status: Accepted
- Date: 2026-09-29
- Related: [M0b checklist](../archive/development/m0b-protocol-static-runtime-checklist.md), [Step 2 generator feasibility](../archive/development/m0b-step2-generator-feasibility.md), [Step 3 generated type quality](../archive/development/m0b-step3-generated-type-quality.md), [Step 6 parity report](../archive/development/m0b-step6-parity-report.md), [ADR-015](ADR-015-validation-lifecycle-and-staged-static-migration.md)

## Context

M0b evaluated Event Batch V1 and Stored Environment Policy V1 with real schemas and fixtures. `json-schema-to-typescript` produced repeatable TypeScript output. `typify` produced usable policy Rust structures, but raw Serde does not enforce all constraints. The tested Toolkit path produced incompatible or unsupported results. No event Rust generation path was demonstrated. The Step 6 parity run also found event Serde round-trip failures for omitted optional fields and loss of Schema-allowed Page View extension fields.

## Decisions

1. **Generate TypeScript per contract.** Use pinned `json-schema-to-typescript` to generate and commit event and Stored Environment Policy types. Keep the output in `packages/protocol-ts/src/generated/` and export it from the package root. Generation produces static types; it does not validate untrusted JSON at runtime.
2. **Use different Rust strategies by contract.** Continue maintaining event wire types in the Collector by hand and verify them against shared canonical fixtures. Generate Stored Environment Policy structures with pinned `typify`; add explicit validation for constraints the generated structures do not guarantee, including the supported schema version, non-empty origins, and uniqueness.
3. **Preserve event wire behavior.** Rust Page View types must retain extension fields allowed by the Schema. Optional fields absent from input must be omitted on serialization where `null` is forbidden by the Schema. These are acceptance requirements for the follow-up integration work; this ADR does not implement them.
4. **Reject the tested Toolkit release for production; retain Toolkit as the long-term preferred candidate.** Do not use the tested SDK 0.7.0 commit for production generation. The project aims to optimize and re-evaluate Toolkit as its primary Schema-to-TypeScript/Rust converter against the project-specific capability and acceptance requirements in the Toolkit findings report. Keep the current generator strategy until those gates pass.
5. **Keep artifacts in this monorepo.** Do not create a separate protocol repository without a demonstrated independent publishing or consumer requirement. TypeScript artifacts are consumed through `@web-analytics/protocol-ts`. Rust event types remain in the Collector protocol module; generated policy structures belong in a dedicated generated module in the Collector crate and are consumed through its policy runtime module.
6. **Follow each Schema's compatibility contract.** Stored Environment Policy V1 rejects undeclared fields and schema versions other than V1. Event documents accept extensions only where their Schema allows them; the Page View Rust model preserves those allowed extensions. Event V1 version/discriminator constants remain strict.
7. **Require drift, compile, and parity checks.** The eventual integration must pin generator/toolchain versions, commit generator lock information, and provide a check mode that fails on stale output. CI must run TypeScript package typecheck/tests, Rust consumer compile/tests, shared fixture parity (`node experiments/m0b/parity/run.mjs`), and Schema fixture validation (`pnpm protocol:validate`). This ADR selects the gates but does not wire them into build scripts or CI.
8. **Keep runtime validation separate.** Generated or hand-maintained types are not a substitute for runtime validation of untrusted input. Runtime lifecycle and staged static validation remain governed by ADR-015.

### M2 configuration contract source matrix

M2.3 fixes the source and supported consumer entry point for each in-scope configuration contract. Generated TypeScript implementation files are not consumer entry points; consumers import the public aliases from the @web-analytics/protocol-ts package root.

| Contract                                | TypeScript source and consumer entry                                                                                                    | Rust source and consumer entry                                                                                         | Rationale and boundary                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored Environment Policy V1            | Generated by pinned json-schema-to-typescript under packages/protocol-ts/src/generated/; public wire types exported by the package root | Generated by pinned typify under services/collector/src/generated/; module is compiled by the Collector policy module  | M0b evaluated both generators on this schema. Explicit policy constraints and runtime validation remain separate. The generated Rust model is not yet the active runtime DTO. |
| Stored Site Capabilities V1             | Generated by pinned json-schema-to-typescript under packages/protocol-ts/src/generated/; public wire types exported by the package root | Hand-maintained runtime DTO and CapabilitySnapshot in configuration-runtime; consumed through that crate's runtime API | Rust consumers use a validated runtime view and capability semantics, not a shared serialized DTO.                                                                            |
| Capability Update                       | Generated by pinned json-schema-to-typescript under packages/protocol-ts/src/generated/; request type exported by the package root      | Hand-maintained private request boundary type in Analytics API site management                                         | API handling applies capability dependency and mandatory-capability rules beyond the request shape.                                                                           |
| Environment Policy Update               | Generated by pinned json-schema-to-typescript under packages/protocol-ts/src/generated/; request type exported by the package root      | Hand-maintained private request boundary type in Analytics API site management                                         | Request and stored-policy contracts differ; handling canonicalizes/checks origins and constructs the stored document.                                                         |
| Conversion/Funnel Definition Set Update | Generated by pinned json-schema-to-typescript under packages/protocol-ts/src/generated/; request type exported by the package root      | serde_json::Value retained at the Analytics API boundary in M2.3; semantic validation remains in site management       | The existing JSON-oriented semantic/privacy checks remain the boundary owner. A structural Rust model is deferred to definition revision migration.                           |

This matrix records the M2.3 generation scope: TypeScript output for all five configuration schemas and generated Rust structures only for Stored Environment Policy. It does not change runtime validation or wire behavior. Changes to these choices require updating this ADR and the M2 checklist before changing generated artifacts.

## Alternatives considered

- **Adopt the tested Toolkit release immediately:** rejected because its outputs were incomplete, wire-incompatible, or unsupported. Keep Toolkit as the future preferred candidate and re-evaluate after it meets the project-specific gates.
- **Manual maintenance for every language and contract:** not selected because repeatable TypeScript generation was demonstrated and can reduce routine drift when paired with committed output and CI checks.
- **Generate every Rust type:** not selected because event Rust generation was not demonstrated and policy generation still needs explicit constraints and wire behavior checks.
- **Separate protocol repository:** deferred because current consumers and release needs are within this monorepo.

## Consequences

- M2.3 has integrated pinned TypeScript generation for the five in-scope configuration Schemas and generated Stored Environment Policy Rust structures, with package exports and a reproducible drift check. The generated policy structure is compiled but has not replaced the active runtime DTO or validator.
- M2.4 remains responsible for explicit policy constraints, date-time behavior, and shared fixture parity; generated types do not change runtime validation on their own.
- The event Rust extension map and optional-field serialization behavior must be addressed before claiming event wire round-trip parity.
- Policy date-time parsing in the Collector remains a documented Schema parity difference pending a separate decision; this ADR does not change production behavior.
- The parity prototype and canonical fixtures remain the evidence base for future generation and migration work.

### M2.3 pinned generation workflow

- TypeScript generator: exact json-schema-to-typescript 16.0.0, pinned in packages/protocol-ts/package.json and pnpm-lock.yaml. Run pnpm --filter @web-analytics/protocol-ts generate:configuration or check with pnpm --filter @web-analytics/protocol-ts check:configuration.
- Rust generator: exact cargo-typify 0.8.0, installed with cargo install cargo-typify --version 0.8.0 --locked. The repository toolchain pins Rust/rustfmt 1.98.1; generated regex support uses regress 0.12.0, pinned through Cargo.lock.
- Shared command: node tooling/contracts/generate-configuration-contract-types.mjs regenerates the selected five TS schemas and the policy Rust schema; --check compares regenerated bytes against committed files. The script verifies generator versions and formats Rust output with the pinned toolchain.
- TypeScript refinement: for schemas whose capability settings definition requires an object with maxProperties: 0 and additionalProperties: false, the generator deterministically narrows json-schema-to-typescript output from {} to Record<string, never>. Compile-time probes verify empty objects remain assignable while strings, arrays, and objects with properties are rejected; generated files are not hand-edited.
- TypeScript artifacts: packages/protocol-ts/src/generated/{environment-policy,capabilities,capability-update,environment-policy-update,conversion-funnel-definition-set-update}.ts; public aliases are exported only from packages/protocol-ts/src/index.ts.
- Rust artifact: services/collector/src/generated/environment_policy.rs; included by the Collector policy module for consumer-crate compilation. It remains an unused generated wire structure until a later policy model migration; it does not replace the active DTO or runtime Schema validator in M2.3.
- The generator accepts --artifact-root DIR for isolated stale-output checks. Schema inputs and installed tool versions still come from the repository; only generated-output comparison is redirected.
- Schema Transformation Toolkit has no production generation command or dependency in this workflow.
