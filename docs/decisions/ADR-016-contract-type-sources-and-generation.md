# ADR-016：按 Contract 类别确定类型来源与生成策略

- Status: Accepted
- Date: 2026-09-29
- Related: [M0b checklist](../m0b-protocol-static-runtime-checklist.md), [Step 2 generator feasibility](../m0b-step2-generator-feasibility.md), [Step 3 generated type quality](../m0b-step3-generated-type-quality.md), [Step 6 parity report](../m0b-step6-parity-report.md), [ADR-015](ADR-015-validation-lifecycle-and-staged-static-migration.md)

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

## Alternatives considered

- **Adopt the tested Toolkit release immediately:** rejected because its outputs were incomplete, wire-incompatible, or unsupported. Keep Toolkit as the future preferred candidate and re-evaluate after it meets the project-specific gates.
- **Manual maintenance for every language and contract:** not selected because repeatable TypeScript generation was demonstrated and can reduce routine drift when paired with committed output and CI checks.
- **Generate every Rust type:** not selected because event Rust generation was not demonstrated and policy generation still needs explicit constraints and wire behavior checks.
- **Separate protocol repository:** deferred because current consumers and release needs are within this monorepo.

## Consequences

- Generation is a follow-up implementation task; this ADR does not change production types, runtime validation, package exports, or build behavior.
- The event Rust extension map and optional-field serialization behavior must be addressed before claiming event wire round-trip parity.
- Policy date-time parsing in the Collector remains a documented Schema parity difference pending a separate decision; this ADR does not change production behavior.
- The parity prototype and canonical fixtures remain the evidence base for future generation and migration work.
