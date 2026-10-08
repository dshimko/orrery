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
4. **Accessibility gate: axe is a dev-only exception (MPL-2.0), approved by the project owner
   at milestone 4.** Original note: `axe-core` and
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

## Milestone 3: system view

### Spec differences and acceptance

31. **Screenshot parity with the reference is by side-by-side review, not a pixel diff.** The
    reference places stars, the belt, and every vehicle with unseeded `Math.random`, so no two
    loads of it match each other. `e2e/reference-compare.spec.ts` (opt-in,
    `ORRERY_REFERENCE_COMPARE=1`) captures the reference and the port at the same environment
    and time for review. The pixel gate is `e2e/visual.spec.ts`, against our own seeded
    baselines.
32. **Visual baselines are rendered on Linux arm64 in `mcr.microsoft.com/playwright:v1.64.0-noble-arm64`**
    (`pnpm test:visual:update`, verified reproducible with `sh scripts/visual-baselines.sh check`).
    That image is published for arm64 only, so the CI e2e job runs in it on `ubuntu-24.04-arm`.
    Visual tests skip on other platforms because font rasterization differs.
33. **60 fps is verified on Apple-silicon integrated graphics only.** At 1920×1080 with the prod
    mock at 4×, two runs measured 60 fps mean, p95 17 ms (`ORRERY_PERF=1 pnpm exec playwright
test e2e/perf.spec.ts --headed`, which uses the real GPU). Intel and AMD integrated GPUs are
    not yet measured.
34. **A minimal `apps/server` lands in milestone 3** even though no milestone names it, because
    adapters may only run on the server and the system view needs data. It is read-only, has
    a `{data}` / `{error}` envelope, and enforces a 24 h event window, a 50,000-event cap, and a
    per-environment rate limit. Environments that list several adapters report
    "composition not supported yet" until composition lands.

### Rendering

35. **The render package is two layers.** `sim/` is headless: model, integration, vehicle
    pools, and the camera rig on three's math classes. `scene/` and `view.ts` draw with Three.js.
    All eight stability rules are unit-tested on `sim/` in Node, and rule 8 is also tested in
    a browser (paused frames are byte-identical).
36. **The renderer is driven by events.** Each `PlatformEvent` spawns its vehicle when simulated
    time passes its timestamp, and randomness is keyed by the event, so the same events always
    produce the same vehicles. The page prefetches 15-minute event windows, and refreshes the
    snapshot every 5 simulated minutes and after a scrub.
37. **Spoke colors come from a reference palette in `scene/palette.ts`** because `Spoke` has no
    color field. Moving them into `visuals` config is a candidate follow-up.
38. **Two new deep-link params for reproducible views**, alongside `t`: `date=YYYY-MM-DD` and
    `paused=1`.
39. **The page CSP adds `script-src 'self'`.** The server sends the same CSP as a header.

## Milestone 4: Orloj clock view and navigation

40. **Orloj parity is reviewed side by side, as for the system view.** The opt-in
    `e2e/reference-compare.spec.ts` captures both homes. The pixel gate compares against our
    own seeded baseline (`orloj-home-chromium-linux.png`). Cinzel and Barlow are not bundled
    yet, so text uses fallback serif and sans-serif fonts.
41. **The faces read only `Snapshot` and `Topology`**, unlike the reference, which computed its
    own mock health. The arcs come from `snapshot.schedule`, the moon is `backlog`, and the
    figures use `spendPerHour`, `counts`, and `consumerActivity`. The calendar is
    `snapshot.calendar`, and the rooster follows `previousDayClean`.
42. **Breakpoints apply to the width of the faces container**: 3 columns at ≥ 1,150 px, 2 at
    ≥ 720 px, otherwise 1, never more columns than faces, and scale capped at 1.25. They are
    checked in e2e from the canvas aspect ratio.
43. **An environment shows an error face** when its adapter is unavailable, a fetch fails, or
    health reports an error with no data yet. The other faces keep rendering. In e2e this is
    a second server on `three-env.yaml`, where stg and prod use the not-yet-available
    databricks adapter.
44. **One simulated clock is shared across home, system view, compare, and wall mode.** In-app
    navigation keeps the current simulated time. A URL with `t`, `date`, `speed`, or `paused`
    starts a fresh clock, and a paused clock writes its exact time into the URL.
45. **Compare mode is `/compare?envs=a,b[,c]`** (our reading of the spec's "compare mode"): two
    or three system views side by side on one clock, each with its own data, tier band, and
    incident count.
46. **Wall display mode (`wall=1`)** cycles home and then each environment in promotion order,
    20 s per stop. It holds on an environment with an open warning or incident for up to 3
    stops. Any input pauses the cycle for 60 s, and Escape exits at once.
47. **New deep-link param `view=<camera view>`**, alongside `t`, `date`, `paused`, `speed`,
    `tier`, `workload`, and `focus`. `focus` takes precedence over `view`.
48. **The accessibility gate runs axe** (a dev-only MPL-2.0 exception, decision 4) on the home
    page and the system view and fails on any serious or critical violation. The
    keyboard-only walkthrough covers controls, the summary dialog (Escape returns focus), and
    canvas camera keys.

## Milestone 5: Databricks adapter

49. **The sources were verified against the Databricks docs first** (`docs/databricks-sources.md`),
    and every `.sql` file links its page. Where the docs contradict the spec:
    - `information_schema.catalogs` has no catalog type, so foreign catalogs come from
      `tables.table_type = 'FOREIGN'`.
    - Query history has no list of tables read, so reads come from lineage joined on
      `statement_id`.
    - `event_log()` is owner-only, so pipeline expectations come from the Beta pipeline-events
      table.
    - `last_altered` tracks definition changes, not data, so it is not used for freshness.
50. **Freshness uses a fallback chain:** data-quality monitoring results, then the last
    successful run of matched pipelines or jobs, then the last lineage write. A spoke with no
    evidence reports 7 days and past target.
51. **Optional sources degrade, they do not fail:** Beta or preview tables (data-quality
    monitoring, pipeline events, `zerobus_ingest`) and tables the principal cannot read.
    Health becomes `degraded` and names what is missing.
52. **No `sqlPredicate` or `dashboardTag` matching yet.** `sqlPredicate` would mean executing
    config-supplied SQL, which needs its own design and review. `dashboardTag` has no verified
    system-table source. Both are reported in health and are in `TODO.md`.
53. **Schedule, promotions, and volume are not implemented yet.** The schedule is empty (job
    trigger format unverified), there are no promotion events, and volume is 0. The calendar
    counts releases from job changes tagged with `options.releaseTagKey` (default `release`).
    `promotion.tagKey` is not yet passed to adapters.
54. **Matcher semantics:**
    - Schema clauses (`catalog`, `schema`, `tag`) match schemas, with the environment tag
      stripped from the catalog name.
    - `pipelineTag` and `jobTag` match pipelines and jobs.
    - A pipeline or job is placed in a spoke by its tags, or by the schemas it wrote in the last
      7 days of lineage.
    - An environment without a scope owns every catalog no peer claims.
55. **One run, one vehicle.** A pipeline update triggered by a job that is already attributed
    to a spoke emits no second vehicle. Alerts open when a run fails and close on the next
    success, or after 24 h.
56. **On-behalf-of-user is evaluated per request.** The adapter queries lazily, with no
    queries at `init`. Caches and in-flight requests are keyed by a SHA-256 of the viewer token.
    The forwarded header is trusted only behind the Apps proxy or with
    `ORRERY_TRUST_FORWARDED_TOKEN=1`.
57. **The SQL header order is `-- Doc:` first, then SPDX.** The registry accepts the Doc line
    anywhere in the leading comment block.
58. **Fixes from the milestone 5 review:**
    - **Health is cached per viewer.** In on-behalf-of-user mode it is keyed by a hash of the
      viewer token.
    - **Event-window bounds are snapped** outward to the 30 s poll interval, so callers share
      cache entries. The cache is also bounded by row count.
    - **Snapshot queries take priority** over event-window queries, and no query waits more
      than 30 s for a slot.
    - **Date partition filters are widened by a day** on each side, so a non-UTC warehouse
      session cannot drop rows.
    - **When catalog tags cannot be read** and any related environment scopes by tag, an
      unscoped environment claims nothing and health is `error`.
    - **Live streams end** on auth errors, so the client reconnects with a fresh token, and
      after 15 minutes at most.
    - **Catalog conflicts are checked only against related environments,** those sharing host
      and warehouse or a non-default metastore id. The default `primary` id is a placeholder
      and is not matched.
    - **The read-only guard knows raw literals** and rejects external or side-effecting
      functions (`http_request`, `ai_query`, `read_files`, `EXECUTE`, and others).
    - **Statements are cancelled on every error path.**
    - **Platform catalogs are never owned** (`system`, `samples`, `hive_metastore`, and
      `__*`).
