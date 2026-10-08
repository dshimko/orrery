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

## Milestone 2: core model and mock adapter

### Spec differences

19. **New event type `federation.query`.** The spec's `PlatformEvent` union has no event for
    queries against foreign catalogs, yet the scene draws them as comet beams. This is an
    additive change.
20. **Scripted incidents carry `targets` (a list of `kind:id` refs), `title`, and `text`**
    in place of a single `target`. The reference anchors several objects per incident, for
    example a station and three sites. Refs use the deep-link form (`spoke:sales`).
21. **Schema additions needed by the reference:** use cases take an optional `site` and
    `utcOffset` (the Orloj suns), topologies take an optional `shipyard`, and the mock profile
    takes `promotesTo`. `federation.metastores[].host` and `warehouseId` are now optional in
    the schema and required only for the databricks adapter.
22. **The config's `Topology` is renamed `TopologyConfig`.** `Topology` now names the domain
    type that adapters return.

### Mock adapter

23. **`config/examples/demo.yaml` is the all-mock config that matches the references**
    (seven spokes, five regions, six use cases, seeds 11/22/33). `three-env.yaml` stays as
    the spec's sample. Freshness targets equal cadence + 2 × the reference's lag, which
    reproduces the spec's sample numbers (for example ingest 15 → 21).
24. **A built-in world fixture supplies what a real adapter would discover**: metrics, sites
    per region, which spokes a use case reads, activity curves, and station notes. These are
    keyed by the ids in `demo.yaml`. Unknown ids get stable seeded defaults, so the mock runs
    any topology.
25. **Freshness sawtooth uses absolute time.** Cycles longer than a day (cadence ×
    `agingFactor`) continue across days instead of restarting at midnight as in the
    reference. Results are identical to the reference whenever the cycle divides 24 hours,
    which covers every prod spoke.
26. **Past target is computed without state:** age > target × (1 + 3%). `freshness.change`
    fires when that flips and when a refresh lands, so events and snapshots always agree.
    Mock ages only rise between refreshes, so the one-sided band cannot flicker. The renderer
    applies full two-sided hysteresis (`withHysteresis`) to its own displayed state.
27. **Events use counter-based randomness per one-minute bucket**, keyed by seed, emitter,
    and minute. Any split of a range yields identical events. Mean rates equal the
    reference's rates ÷ 12, since the reference rates are per real second and one second at
    1× is 12 simulated minutes. Exact counts differ from the reference, which used
    `Math.random`.
28. **`MOCK_SEED` overrides every environment's seed**, hashed with the environment id.
    **`MOCK_SPEED` multiplies simulated time from `init()`** for `snapshot()` without a time
    and for the live event stream.
29. **The mock uses the spec's stability defaults as constants** (30-minute mean-age cadence,
    3% band), because adapters do not receive the `visuals` config.
30. **Fast-aging tiers get a looser target**, target × max(1, `agingFactor` × 0.6), as in
    the reference. Otherwise dev would show every spoke past target.
