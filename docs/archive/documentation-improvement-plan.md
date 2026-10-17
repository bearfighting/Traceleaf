# Documentation Improvement Plan

## Status and intent

- Status: completed record; Phases 1–5 and the overall acceptance criteria were completed on 2026-10-17.
- Updated: 2026-10-17.
- Owner: project maintainers.
- Goal: make Traceleaf understandable to new users and contributors, keep documentation aligned with the shipped product, and establish sustainable language and maintenance rules.

This archived plan records the documentation work and its acceptance evidence. Current unfinished and deferred work remains exclusively in [Project Status](../project-status.md).

## Current state

- The root `README.md` and `README.zh-CN.md` are peer English and Simplified Chinese landing pages with a Playground quick start, full-stack guide, architecture map, MVP summary, and project-state links.
- In-scope apps, packages, services, tools, protocol, Docker, and the shared `examples/` index have English and Simplified Chinese README editions, with corresponding setup and scope guidance.
- `docs/README.md` and `docs/README.zh-CN.md` are task-based indexes with matching destinations and lifecycle classifications for current references, decisions, proposals, completed records, superseded decisions, and historical archives.
- Some feature plans remain active proposals while others preserve completed implementation or release evidence. `docs/project-status.md` remains the single current list of unfinished, deferred, and release-blocking work.
- Markdown formatting, internal relative links and anchors, and the declared bilingual README pairs are checked by `pnpm format:check:docs`. The check uses Node.js built-ins and does not access external links.

## Principles

1. Treat accuracy as more important than marketing language. Clearly distinguish shipped behavior, verified behavior, deferred work, and future direction.
2. Give each fact one authoritative home. Other documents should link to it instead of maintaining competing copies.
3. Make the first screen of the root README explain the project quickly: identity, purpose, health/release signals, and a path to try it.
4. Keep English as the primary language for new design documents, ADRs, architecture notes, and technical specifications. Existing documents remain in their current language unless they are revised as part of an approved documentation task.
5. Maintain English and Simplified Chinese editions of the root README and user-facing READMEs for independently useful subprojects. Each edition must link to its counterpart and describe the same supported capabilities and setup requirements.
6. Write for the reader's task. User guides explain how to operate Traceleaf; design records explain a decision or proposal; READMEs introduce a project or component.
7. Avoid unnecessary translation work. Internal historical records, generated contracts, fixture notes, and narrowly scoped implementation records do not need bilingual duplication unless maintainers identify a real audience for both languages.
8. Keep documentation checks lightweight, reproducible, and aligned with existing repository scripts. Do not add a dependency solely for cosmetic checks.

## Language policy

| Document type                                                                | Primary language                               | Required editions                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Root project README                                                          | English                                        | `README.md` and `README.zh-CN.md`                                                                                  |
| README for an independently useful app, package, service, tool, or protocol  | English                                        | `README.md` and `README.zh-CN.md`                                                                                  |
| New design documents, ADRs, architecture notes, and technical specifications | English                                        | One English canonical document; add a Chinese summary or translation when it materially helps project participants |
| User guides and operational runbooks                                         | English as the default for new work            | Add or retain a Chinese edition when it serves Chinese-speaking operators; cross-link language editions            |
| Historical records, generated files, schemas, fixtures, and code comments    | Existing convention or machine-readable format | No blanket translation requirement                                                                                 |

English and Chinese READMEs are peer user-facing editions, not one-line stubs. They may use different natural phrasing, but must agree on product state, features, requirements, commands, ports, links, and safety constraints.

## README landing-page direction

The root README should provide a polished but restrained open-source project introduction:

1. Traceleaf symbol or horizontal logo, project name, concise English descriptor, and a Chinese-edition link.
2. A small set of truthful badges, selected only when their destinations and current state can be verified. Candidate badges include CI, latest release, license, and documentation. Do not add popularity, security, coverage, or release badges without authoritative evidence.
3. A short purpose statement that identifies the audience, the self-hosted value, and the problem Traceleaf solves.
4. Key differentiators and current capabilities, with links to the canonical MVP scope and explicit caveats where release or deployment status matters.
5. A readable architecture/data-flow diagram and a component map that explains what each major workspace area does.
6. A short “Try it locally” section with prerequisites and the minimum safe startup path, linked to the complete Getting Started guide.
7. Links to deployment, operations, project status, protocol, contribution, security, license, and documentation index pages where those files exist.

The README must not imply that an unreleased artifact is publicly downloadable or that a local verification proves production readiness. The landing page should remain concise; lengthy setup, configuration, and operations procedures belong in dedicated guides.

## Component README inventory

Inventory checked against `pnpm-workspace.yaml`, every workspace `package.json`, the root `Cargo.toml`, and each Cargo member manifest on 2026-10-17. English is the canonical content language; every in-scope component below has a peer Simplified Chinese edition decision. “Add pair” means `README.md` plus `README.zh-CN.md`; existing files are English unless stated otherwise.

| Component / manifest source    | Language and audience                                                 | Existing documentation                                 | README decision                                                           |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Root project (`package.json`)  | TypeScript, Rust, Docker; users, operators, contributors              | `README.md` (Chinese-oriented)                         | Keep as root pair; create the English edition and make both peer editions |
| `apps/website`                 | TypeScript/Next.js; site users and website developers                 | English `README.md`                                    | Add Chinese peer                                                          |
| `apps/dashboard`               | TypeScript/React; operators and dashboard developers                  | No README                                              | Add pair                                                                  |
| `packages/analytics-browser`   | TypeScript; Browser SDK consumers and maintainers                     | English `README.md`                                    | Add Chinese peer                                                          |
| `packages/analytics-core`      | TypeScript; SDK and platform developers                               | English `README.md`                                    | Add Chinese peer                                                          |
| `packages/observer-core`       | TypeScript; browser SDK developers                                    | English `README.md`                                    | Add Chinese peer                                                          |
| `packages/protocol-ts`         | TypeScript; protocol consumers and maintainers                        | English `README.md`                                    | Add Chinese peer                                                          |
| `packages/transport`           | TypeScript; SDK maintainers                                           | No README                                              | Add pair; explain its supported boundary and internal consumption         |
| `packages/playground-support`  | TypeScript; example maintainers                                       | No README                                              | Add pair; describe shared example utilities                               |
| `services/collector`           | Rust; operators and backend developers                                | No README                                              | Add pair                                                                  |
| `services/processor`           | Rust; operators and backend developers                                | No README                                              | Add pair                                                                  |
| `services/analytics-api`       | Rust; API consumers, operators, backend developers                    | No README                                              | Add pair                                                                  |
| `crates/configuration-runtime` | Rust; backend developers                                              | No README                                              | Add pair                                                                  |
| `tools/db-migrator`            | Rust; database operators and maintainers                              | No README                                              | Add pair                                                                  |
| `tools/site-registry-importer` | Rust; site administrators and operators                               | English `README.md`                                    | Add Chinese peer; preserve safety guidance                                |
| `protocol/`                    | JSON Schema and protocol artifacts; implementers                      | English `README.md`                                    | Add Chinese peer; identify machine-readable source of truth               |
| `docker/`                      | Docker Compose and shell/Node tooling; local developers and operators | English `README.md`                                    | Add Chinese peer                                                          |
| `examples/`                    | Nine framework/browser playgrounds; SDK evaluators and maintainers    | No examples index; Next.js has agent instructions only | Add one bilingual examples index; no per-playground README requirement    |

The nine package workspaces under `examples/` are `angular-playground`, `astro-playground`, `nextjs-router-playground`, `react-router-playground`, `solid-playground`, `svelte-playground`, `tanstack-router-playground`, `vanilla-playground`, and `vue-playground`. Their individual READMEs are not required: the shared index will name each, give its purpose and run entry point, and state that playgrounds validate the generic observer rather than provide Router adapters or analytics integrations.

`db/migrations/`, `tests/fixtures/`, generated contracts under `protocol/`, and archived records are internal, machine-oriented, or historical documentation. They do not receive standalone product README pairs. Existing scoped notes such as `db/migrations/README.md`, `tests/fixtures/geo/README.md`, and `protocol/contracts/configuration/current/README.md` remain owned by their respective implementation areas and are not duplicated in the component map. `CLAUDE.md` and `AGENTS.md` are agent/contributor instructions, not product READMEs.

Use a shared README template with sections selected to fit the component: purpose and status, responsibilities, boundaries/dependencies, requirements, local development, tests/build, configuration, deployment or consumption, security notes, and links to related docs. Do not copy the full root project overview into every component README.

## Documentation information architecture

- `docs/README.md` and `docs/README.zh-CN.md` are a bilingual, cross-linked documentation index. Organize links by reader task: overview/status, getting started, deployment/operations, SDK/protocol, architecture/decisions, and historical records.
- Lifecycle labels are: **current reference**, **accepted decision**, **active proposal**, **completed record**, **superseded**, and **historical**. Apply a label to every linked design/planning record; guides and authoritative references use current reference.
- `docs/project-status.md` remains the sole authority for unfinished, deferred, and release-blocking work. Other documents may record their own implementation evidence and link to project status, but must not create a competing current backlog.
- Preserve history. Do not move or rewrite records as part of inventory; archive moves require implementation state to be reflected in current references and project status first.
- Machine-readable protocol contracts remain authoritative for data; human documentation explains and links to them.

### Verified current documentation and lifecycle inventory

Lifecycle below reflects document headers and project-status authority as reviewed on 2026-10-17. It is a classification, not a request to move or rewrite any file.

| Path or set                                                                                                                                                                                              | Lifecycle                            | Notes                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `docs/project-status.md`, `docs/mvp-scope.md`                                                                                                                                                            | Current reference                    | Status is the only live unfinished/deferred/release-blocking list; MVP scope records the freeze        |
| `docs/getting-started.md`, `docs/operations.md`, `docs/deployment-linux.md`, `docs/deployment-raspberry-pi.md`, `docs/ingest-key.md`, `docs/versioning-and-release-process.md`, `docs/event-protocol.md` | Current reference                    | User, operator, release, and protocol guidance                                                         |
| `docs/testing/postgres-test-isolation-plan.md`                                                                                                                                                           | Current reference                    | Implementation is complete; project status links here for current component commands and lifecycle     |
| `docs/browser-sdk-ingestion-contract-audit.md`                                                                                                                                                           | Completed record                     | Retain audit evidence; protocol and current operational guides remain authoritative                    |
| `docs/browser-sdk-integration-plan.md`                                                                                                                                                                   | Active proposal                      | Contains implementation and release evidence; remaining release gates defer to project status          |
| `docs/deployment-prebuilt-images-plan.md`                                                                                                                                                                | Completed record                     | Implementation is recorded; remaining publication/hardware gates are in project status                 |
| `docs/static-product-site-plan.md`                                                                                                                                                                       | Active proposal                      | Public-site workstream                                                                                 |
| `docs/dashboard-chart-design.md`                                                                                                                                                                         | Active proposal                      | Design, implementation, and metric semantics; non-blocking chart QA is listed only in project status   |
| `docs/website-dashboard-preview-alignment-plan.md`, `docs/traceleaf-brand-unification-plan.md`                                                                                                           | Completed record                     | Both explicitly record completed implementation/acceptance                                             |
| `docs/platform-release-v1.0.0.md`                                                                                                                                                                        | Completed record                     | Release evidence and remaining gates; project status is authoritative for open gates                   |
| `docs/archive/documentation-improvement-plan.md`                                                                                                                                                         | Historical                           | Completed documentation standards and acceptance record                                                |
| `docs/decisions/ADR-001` through `ADR-020`, and `ADR-023`, `ADR-026`                                                                                                                                     | Accepted decision                    | ADR-004 is a scoped decision for PR4; its later transport-package implementation was a subsequent step |
| `docs/decisions/ADR-021-navigation-api-as-the-browser-observer.md`                                                                                                                                       | Superseded                           | Explicitly superseded by ADR-022                                                                       |
| `docs/decisions/ADR-022-navigation-api-only-browser-sdk.md`                                                                                                                                              | Accepted decision                    | Current Navigation API-only browser SDK boundary; supersedes ADR-021                                   |
| `docs/decisions/ADR-024-simplified-sdk-and-platform-releases.md`                                                                                                                                         | Accepted decision                    | Its initial version baseline is superseded by ADR-025                                                  |
| `docs/decisions/ADR-025-project-version-baseline-1.0.0.md`                                                                                                                                               | Accepted decision                    | Current project version baseline; supersedes the baseline in ADR-024                                   |
| `docs/archive/README.md`, `docs/archive/development/README.md`, `docs/archive/refactoring/README.md`, and all Markdown below `docs/archive/`                                                             | Historical                           | Archive indexes identify development/refactoring history; individual records remain preserved          |
| `protocol/contracts/configuration/current/*`                                                                                                                                                             | Current reference / machine contract | Current machine-readable configuration contracts plus their local explanatory README                   |

This inventory covers all tracked Markdown paths discovered with `git ls-files '*.md'`, grouped above by lifecycle and purpose. Workspace-local `README.md` decisions are in the component table; archived docs are grouped rather than individually retitled. `AGENTS.md`, app/example `CLAUDE.md` files, migration/fixture notes, and generated contract material are internal instructions or artifacts, not documentation-index design/planning entries.

**Inventory follow-up (resolved in Phase 4):** The chart-specific state, responsive, accessibility, color, data-consistency, and project-validation checks are now listed once in `docs/project-status.md` as non-release-blocking quality work. The 2026-10-16 full Dashboard acceptance remains recorded separately and is not reopened by these follow-up checks. Custom Events interval ranking is recorded as deferred capability scope and excluded from that QA list. `docs/dashboard-chart-design.md` links to project status and no longer carries an unfinished checklist.

## Phased work plan

### Phase 1: Inventory and standards

- [x] Cross-check pnpm and Cargo manifests; record each in-scope component, audience, existing README, and bilingual README decision.
- [x] Inventory the nine playgrounds through one planned bilingual index and classify migrations, fixtures, generated contracts, and archive files as internal/historical.
- [x] Inventory guides, ADRs, plans, release records, and archives with lifecycle labels; do not move or rewrite source documents during inventory.
- [x] Set README filenames (`README.md`, `README.zh-CN.md`), canonical language for design records/ADRs, bilingual docs-index policy, and Chinese operator-guide scope.
- [x] Preserve `docs/project-status.md` as the single authority for unfinished/deferred/release-blocking work.
- [x] Mark CONTRIBUTING and SECURITY policies as planned additions for the README phase; exact badges are deferred to that phase and must use repository-verifiable sources.

**Exit criteria:** satisfied by the inventory and standards above. This phase records classifications and policy only; no README rewrite, policy file creation, archive move, or badge addition is part of it.

### Phase 2: Root project landing page

- Write the English root README and its Simplified Chinese peer from the same verified product baseline.
- Add a logo, concise descriptor, trustworthy badges, value proposition, feature summary, architecture/component map, quick local-start path, and topic links.
- Verify the GitHub-rendered first screen is legible in light and dark themes and the diagram remains readable on narrow screens.
- Add clear contribution, security, and license destinations; create missing policy files only when their content and maintainer ownership are confirmed.

**Completion record (2026-10-17):** Added equivalent, cross-linked English and Simplified Chinese root READMEs. Both use the repository's symbol logo and verified CI/MIT badges, describe the frozen MVP and its open release/deployment acceptance, and offer the mock-transport Playground followed by the full-stack guide. No contribution or security policy files were added because their content and ownership remain unconfirmed. Formatting, documentation formatting, link targets, and whitespace checks passed. The centered Markdown layout and compact Mermaid flow were reviewed in source for GitHub light/dark theme compatibility and narrow-screen readability; a live GitHub rendering check was not available in this local workflow.

**Exit criteria:** complete. Both READMEs are accurate, cross-linked, and lead from project purpose through the local Playground and full-stack startup guide.

### Phase 3: Component READMEs

- Add the agreed English and Simplified Chinese READMEs to each in-scope component.
- Replace terse package descriptions with accurate responsibility, boundary, usage, and verification guidance.
- Cross-link component docs to the root overview and authoritative technical guides.

**Exit criteria:** every in-scope independently useful component has two complete, equivalent-language editions, or a recorded reason why a second edition is unnecessary.

**Completion record (2026-10-17):** Added peer English and Simplified Chinese READMEs for Website, Dashboard, all six package workspaces, three Rust services, configuration runtime, both Rust tools, protocol, and Docker. Added a bilingual `examples/` index covering all nine playgrounds and their workspace run commands. Updated existing English component READMEs with counterpart links and current responsibility/development guidance where needed. The Site Registry Importer translation preserves its read-only default, explicit apply and disposable-database constraints, secret/report protections, review workflow, and target-runbook safeguards. Documented commands and boundaries were checked against package/workspace manifests, Compose configuration, protocol contracts, and operator guidance. Prettier, `pnpm format:check:docs`, relative-link, and whitespace checks passed; product tests were not run.

**Exit criteria:** complete. Every in-scope component and the shared Playground index have mutually linked English and Simplified Chinese editions with matching supported scope, setup expectations, and safety constraints.

### Phase 4: Documentation index and lifecycle cleanup

- Convert the documentation index to a task-based English structure and add its Chinese counterpart.
- Fix broken, stale, ambiguous, and duplicate links found in the inventory.
- Mark completed plans and proposals clearly; archive completed plans only after current references and the single project-status list are accurate.
- Reconcile the Dashboard chart acceptance checklist recorded in the inventory follow-up with `docs/project-status.md`; keep any remaining approved work only in project status and link to it from the design record.
- Align existing user-facing documentation language with the policy as each file is materially revised; do not bulk-translate historical records.

**Exit criteria:** readers can identify the authoritative document for each task, and every indexed document has an accurate lifecycle label.

**Completion record (2026-10-17):** Replaced the Chinese-only index with a task-based English index and added a cross-linked Simplified Chinese peer using the same destinations and lifecycle meanings. Classified current references, accepted decisions, active proposals, completed records, superseded decisions, and historical archives. Reconciled chart-specific follow-up checks into the sole project-status list as non-release-blocking quality work, preserving the separate 2026-10-16 Dashboard product acceptance; removed the duplicate chart checklist and excluded deferred Custom Events interval ranking. Relative link targets in the indexes and reviewed status/design/plan documents, mirrored index destinations, lifecycle classifications, documentation formatting, and whitespace checks passed; product tests were not run.

**Exit criteria:** complete. The bilingual index identifies authoritative documents by reader task and labels indexed records with their current lifecycle.

### Phase 5: Ongoing quality checks

- [x] Ensure Markdown formatting is covered by the existing docs format check.
- [x] Add a deterministic repository-native link and README-pair check without external network access.
- [x] Check peer links, heading structure, required overview/status links, and command signatures.
- [x] Add documentation verification to the shared local and CI command.

**Completion record (2026-10-17):** Added a Node.js built-in checker for maintained documentation links and anchors plus an explicit 18-pair bilingual README manifest. The checker verifies peer links, matching heading levels, overview/status links, and matching command signatures. Added checker tests and wired the check into `pnpm format:check:docs`, the repository test script, and every Quality workflow run, including pull requests. The implementation adds no dependency and makes no network requests. Validation passed with `pnpm format:check:docs`, `pnpm test`, and `git diff --check`. The plan was moved to this archive after acceptance.

## Out of scope

- Rewriting all archived records or translating every Markdown file.
- Changing product scope, APIs, protocol semantics, deployment defaults, or release promises while editing documentation.
- Adding unverified claims, invented testimonials, unsupported comparison claims, or decorative badges without reliable data.
- Creating a docs website or adopting a documentation platform before the Markdown information architecture is stable.
- Automatically generating Chinese translations without technical review.

## Overall acceptance criteria

- A new visitor can identify Traceleaf's purpose, audience, core advantages, current capabilities, major components, and project maturity from the root README.
- Root and in-scope component READMEs have English and Simplified Chinese editions, mutual language links, and equivalent verified instructions.
- English is the default language for new design documents and ADRs; existing history remains intact unless deliberately revised.
- Each active guide, decision, proposal, implementation record, and archived document is discoverable and labeled correctly.
- Project status remains the sole authority for unfinished and deferred work.
- Internal documentation links and supported Markdown formatting checks pass from the repository root.
- Every documented command, port, requirement, feature, release artifact, and security statement is verified against the current implementation or explicitly labeled as planned/deferred.

## Phase 1 decisions carried into implementation

- All in-scope apps, packages, services, tools, the configuration crate, protocol, and Docker workflow receive peer English and Simplified Chinese README editions. Common service details may link to shared operator guidance, but do not replace either component README.
- The examples section uses one bilingual index for all nine playgrounds.
- New design documents and ADRs are English canonical; docs index is bilingual. Operator guides receive Chinese editions when they serve Chinese-speaking operators; this is determined per guide during the relevant documentation phase.
- `CONTRIBUTING.md` and `SECURITY.md` are planned additions in the root README phase, with content and maintenance ownership to be established there. Their absence is not an inventory blocker.
- Badge selection remains open until the README phase, when each candidate destination and current state can be verified. No popularity, security, coverage, or release claim is presumed.
- Completed plans remain where they are during this phase. Any later archive decision must preserve current authoritative guidance and project-status ownership.
