# Decisions

Each entry records where the build departs from `docs/BUILD_PROMPT.md` or settles an
ambiguity. Newest milestone last.

## Milestone 1: skeleton

### Spec differences

1. **The spec's `three-env.yaml` sample is not valid YAML.** An unquoted `${env:...}` inside
   a flow mapping (`{ id: primary, host: ${env:ORRERY_PROD_HOST}, ... }`) makes `{` a flow
   indicator, so the file does not parse. The shipped example quotes the four values in the
   two `metastores` lines. Block-style values such as `host: ${env:ORRERY_STG_HOST}` parse
   fine and are left as written.
2. **`license-checker` is replaced by `pnpm licenses list`.** `license-checker` does not
   follow pnpm's symlinked `node_modules` reliably. pnpm's built-in report covers the whole
   tree with no extra dependency. `scripts/check-licenses.mjs` applies the allowlist and
   understands SPDX `OR` and `AND`.
3. **Dev-only license exception: `minimatch` (BlueOak-1.0.0). Approved by the project owner.** ESLint
   and typescript-eslint require `minimatch@^10.2`, which is BlueOak-1.0.0. That license is
   permissive but not on the allowlist. It is lint tooling and never bundled. The exception
   lives in `license-exceptions.json`, and the gate still fails if an excepted package
   enters the production tree.
4. **The accessibility gate cannot use axe yet. Needs a decision.** `axe-core` and
   `@axe-core/playwright` are MPL-2.0, which the allowlist forbids. Milestone 1 has no UI
   to audit, and its Playwright smoke test checks landmarks, headings, and keyboard
   reachability. The options are a dev-only exception for axe (test tooling, never
   shipped) or an allowlisted alternative.

### Toolchain under the license allowlist and Node 20

5. **Version pins for Node 20 LTS:** Vitest 4.1 and Vite 7.3. Vitest 5 needs Node 22 or
   later. TypeScript is 6.0.3 because typescript-eslint 8 supports TypeScript below 6.1.
6. **Vite is pinned to 7.3.7 workspace-wide** (`pnpm.overrides`). Vitest otherwise pulls in
   Vite 8, which depends on `lightningcss` (MPL-2.0).
7. **No `@vitejs/plugin-react`.** Its Babel toolchain brings in `caniuse-lite` (CC-BY-4.0).
   Vite's built-in esbuild compiles JSX (`jsx: 'automatic'`). The cost: no React fast
   refresh in dev, so edits trigger a full page reload.
8. **Packages resolve each other through a `source` export condition.** Typecheck, tests,
   and Vite read workspace packages from `src/` with no build step first. Published builds
   use `dist/`.

### Config schema

9. **Topology inheritance.** A topology may `extends` another. List entries (`spokes`,
   `sourceGroups`, `useCases`) merge with the base by `id`, field by field, and new ids are
   appended. `exclude: [ids]` drops inherited entries, which covers dev and stg having fewer
   spokes. An environment can apply the same shape under `overrides`. Completeness is
   checked after resolution, and errors carry the environment path plus the topology name.
10. **Matcher keys:** `catalog`, `schema` (globs), `tag`, `pipelineTag`, `jobTag`,
    `dashboardTag` (key/value maps), and `sqlPredicate`. At least one is required. When
    several are present, all must match.
11. **Secret fields** are `connection.clientId`, `clientSecret`, and `token`, and accept only
    `${env:NAME}`. `host` and `warehouseId` are not secrets, so they may be literal or an env
    reference. Forks keep real values in `config/private/`.
12. **Auth modes:** `app-service-principal` (default), `on-behalf-of-user`, plus `oauth-m2m`
    and `pat` for the standalone container, as the Security section describes.
13. **Fork adapters** are registered as `adapters: { <name>: { package: <npm name> } }`.
    Their per-environment settings go in `options`. That is the one block the core schema
    leaves open, because the adapter validates it.
14. **"A catalog matching two environments fails validation" is checked at runtime.** It
    needs the live catalog list, so it lands with environment scoping in milestone 5.
    Static validation cannot decide whether two globs overlap on real names.
15. **Every visual default from the spec is exposed under `visuals`**, grouped as `world`,
    `freshnessOrbit`, `planetSize`, `orbitSpeed`, `colors`, `lighting`, `camera`, `time`,
    `stability`, and `orloj`. The spec gives the values but not the key names, so the names
    are ours.
16. **The JSON Schema is generated from zod and committed** at
    `packages/core/schema/orrery.config.schema.json`. A unit test and a CI diff keep it in
    sync. Cross-reference checks (unknown topology, duplicate ids, promotion order) exist
    only in zod, not in the JSON Schema.

### Gates

17. **Gates that milestone 1 cannot exercise are placeholders** (allowed by the spec): mock
    determinism and adapter contract are `it.todo`, and visual regression is a
    `test.fixme`. Each becomes real in the milestone that delivers its subject.
18. **The pre-commit hook runs gitleaks from the local binary, or from the pinned container
    image when Docker is available, and fails when neither exists** rather than skipping the
    scan silently. CI downloads a pinned gitleaks release and verifies its checksum.
