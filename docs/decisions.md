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

## Milestone 6: packaging

59. **One artifact for both targets:** `pnpm package` bundles the server with esbuild into
    `build/app/server/main.mjs`, next to `web/`, `sql/`, `config/`, a dependency-free
    `package.json`, and `app.yaml`. The package is about 3.5 MB, well inside the Databricks
    Apps limits of 10 MB per file and 25 MB total, and nothing is installed at deploy time.
    `scripts/verify-package.mjs` starts it and checks health, a snapshot, and the page with its
    CSP.
60. **Fork adapters have to be bundled in.** A bundled server cannot `import()` an npm package
    that is not in the bundle. A fork adds its adapter to the workspace and the registry, then
    runs `pnpm package` (`docs/adapters.md`). `ORRERY_PACKAGE_CONFIG` bakes a private config
    into the package.
61. **Runtime defaults for hosting:** the port is `PORT`, then `DATABRICKS_APP_PORT`, then 8787.
    The host is `HOST`, else `0.0.0.0` under Databricks Apps, else `127.0.0.1`. Relative
    `ORRERY_CONFIG` and `ORRERY_WEB_DIR` paths resolve against the working directory.
62. **The container is distroless and non-root** (`gcr.io/distroless/nodejs24-debian12:nonroot`; see decision 74).
    Compose runs it with a read-only root filesystem, all capabilities dropped, and
    `no-new-privileges`. Health is probed from outside at `/api/health`, because distroless
    has no shell.
63. **The Helm chart is a stub:** lint-clean, non-root, with a read-only root filesystem and
    health probes. An optional inline config is mounted as a ConfigMap.
64. **The docs site is static HTML** built by `scripts/docs-site.mjs` with `marked`. Raw HTML
    and unsafe link schemes are escaped, and broken relative links or anchors fail the build.
    The configuration reference is generated from the JSON Schema, and a test fails if a key
    has no description or the page is stale.
65. **Not validated:** the Databricks App bundle and `deploy.sh`, because there is no Databricks
    CLI or workspace in this environment. The milestone 6 acceptance criterion (deploy to a
    fresh workspace from the README steps alone) is open in `TODO.md`.

## Milestone 7: OpenLineage adapter

66. **Two sources, one conversion path.** `options.source` is a `file` (read once, 50 MB cap) or
    a `marquez` server. Both feed an `EventSource` that returns RunEvents for a window, and
    one set of pure functions turns runs into the topology, snapshots, and events. Only
    `GET /api/v1/events/lineage` is used (verified in Marquez's `spec/openapi.yml`); the
    namespace, dataset, and job endpoints add nothing the events do not carry.
67. **Matchers read OpenLineage identity.** `catalog` is the namespace, `schema` is the dataset
    name or its first dotted segment (so both `public` and `public.menu*` work), `tag` is the
    `tags` facet, and `jobTag` / `pipelineTag` are job `tags` and `jobType` facets (for a dataset,
    those of its producers). `sqlPredicate` and `dashboardTag` never match, as for Databricks, and
    are reported in health. Domain spokes are tried before ingest spokes, so an ingest spoke
    works as the catch-all of its namespace.
68. **Sources are unproduced inputs, or the job itself.** The sample has no external input
    datasets (every table is produced by a job), so a job that reads nothing counts as an extract
    source and each such job is a site (8 per group at most). Sites are ids derived from the
    source name by hash, so they are stable as sources come and go.
69. **Spoke roles pick the vehicle** (see `adapters/openlineage/README.md`): ingest writes
    draw `source.batch` or `source.stream` from a matched group, else `transfer`; domain writes
    draw `copy`, or `product.publish` when the run also reads that spoke; sink jobs draw
    `serve.read`; failures open alerts closed by the next completion of the job. Event times are
    the run's own, so splits of a window are identical.
70. **Replay is a convenience for files only.** Recorded events are historical, so the file
    source repeats the whole sample every `day` (default) or `hour`, as many times as the window
    needs (run `k` gets id `<runId>@<k>`). `replay.anchor` moves the earliest event to a chosen
    instant (the brief proposed shifting by whole days; repeating the sample is equivalent on the
    sample's day and also fills the days before it, so freshness is never "7 days" at midnight).
    Marquez data is never replayed.
71. **Known gaps from run events:** no deploys, promotions, ML runs, spend, volume, schedule, or
    federation; the calendar is zeros. A Marquez read is capped at 25 pages of 200 events and
    health says when it was cut.
72. **The sample is Marquez's seed.** `docker/metadata.template.json` at a pinned commit, with
    fixed times (as `seed.sh` would render) and the demo database credentials removed
    (`adapters/openlineage/samples/README.md`). The packaged app carries it at the same relative
    path, so `config/openlineage.yaml` runs from `build/app` as well as from the repo root.
73. **Marquez response bodies are read as a stream and capped at 20 MB** while reading. This
    covers chunked responses without `Content-Length` (found at milestone 7 integration). The
    milestone 7 acceptance runs in e2e: a third server on `config/examples/openlineage.yaml`
    renders the public Marquez sample on the Orloj home and the system view
    (`e2e/openlineage.spec.ts`).

## Runtime update (after milestone 7)

74. **Node 24 LTS replaces Node 20,** which is end of life and unsupported by Vercel and other
    hosts. `.nvmrc`, CI, and the Docker builder use 24, and the runtime image is
    `gcr.io/distroless/nodejs24-debian12:nonroot`. The supported floor is Node 22.19 (root
    `engines`; size-limit 14 needs at least 22.19). The packaged server targets `node22`
    (`engines >=22.12`), because the Databricks Apps runtime is reported as Node 22.16
    (unverified, `docs/databricks-sources.md`). `@types/node` tracks 22, so code stays within
    the floor. This supersedes the Node 20 reasoning in decision 5. Vite stays on 7.3 for the
    license reason in decision 6, and Vitest 4.1 still works; moving to Vitest 5 is optional.

## Backlog pass (after milestone 7)

75. **Rate limits are per client, with a global cap per environment.** The client is a hash of
    the trusted viewer token, else the request IP. Behind a trusted proxy (`DATABRICKS_APP_PORT`
    or `ORRERY_TRUST_PROXY=1`) exactly one hop is trusted, so the client is the address that
    proxy appended, never a value the client wrote. Client buckets are kept in an LRU of 10,000
    per environment.
76. **Fork theming is implemented:**
    - **Theme:** `config/private/theme.yaml` (or `ORRERY_THEME`) deep-merges a partial
      `visuals` over the config and is validated with the core schema.
    - **Logo:** `public/private/logo.{svg,png,webp}` (or `ORRERY_LOGO`) is served at
      `/branding/logo`. An SVG gets a sandboxing CSP, and logos are capped at 512 KB.
      `/api/config` gains `branding.logoUrl`, an additive field.
    - **Header:** the web app shows the logo in the header.
77. **Spoke colors live in config:** `visuals.palette`, with ingest first and then the domain
    colors, plus `visuals.spokeColors` for overrides. A core helper resolves them for both the
    renderer and the Orloj view (this supersedes decision 37). The web app self-hosts Cinzel
    and Barlow (OFL-1.1, `@fontsource`), and the Orloj canvas waits for the fonts, up to 2.5 s.
78. **Databricks:**
    - degradation notes and row-limit flags are kept per viewer (LRU of 1,000);
    - live mode holds back past-target crossings for a 60-minute ingestion lag;
    - comets are opt-in (`foreignCatalogs.show: true`);
    - the release tag key comes from `promotion.tagKey` (when `source` is `job-tag`), then
      `options.releaseTagKey`, then `release`.
79. **OpenLineage:**
    - **Validated against a real Marquez** (0.51.1, run in Docker). Marquez sends absent lists
      and facets as JSON `null`, which the parser now accepts; before this, every real event was
      rejected.
    - **Reads are time-sliced and budgeted:** 1-hour slices for events and 6-hour slices for
      discovery, at most 200 pages per load, and truncation is reported in health. Marquez
      treats `after` as inclusive and `before` as exclusive.
    - **Run facets are used:** error messages become alert text, nominal times fill the
      schedule, and output statistics drive batch size and spoke volume.
    - **The live store is capped** at 100,000 events.
80. **Validated but unapplied config keys are marked "Reserved"** in the generated reference:
    `product.timezone`, `visuals.theme`, `visuals.workloads[].source`, and
    `visuals.stability.meanAgeCadenceMinutes`.

81. **`sqlPredicate` is removed from the matcher schema.** It would have meant executing SQL
    supplied in config, and no adapter supported it. A config that still uses it fails
    validation with the unknown-key error. Matchers are now `catalog`, `schema`, `tag`,
    `pipelineTag`, `jobTag`, and `dashboardTag`. This supersedes the `sqlPredicate` part of
    decisions 10 and 52.

82. **`dashboardTag` is removed from the matcher schema** (no verified source in either
    adapter). Example use cases now use `tag: { use_case: … }`; Databricks resolves a use case
    by reads of schemas carrying that tag. Supersedes the `dashboardTag` parts of decisions 10,
    52 and 81.

83. **The Databricks job schedule and promotion events are out of scope.** The schedule stays
    empty (no verified job trigger format), and the adapter emits no promotion events. The
    backlog item was dropped by the project owner.

84. **Live mode is the default, and replay is explicit.**
    - **Clock:** the web clock has a `live` mode that follows the wall clock. Pausing, speed
      changes, scrubbing, or any time parameter in the URL (`t`, `date`, `paused`, `speed`,
      `mode=replay`) switch to replay, and "Back to live" returns. Live pages write no clock
      parameters to the URL.
    - **Data:** live pages poll snapshots every 30 s of real time, always sending an explicit
      `at` (so tests can fake the browser clock), and refresh when the tab becomes visible. The
      system view streams events over SSE, reconnecting with 1–30 s backoff and resuming from
      the last event.
    - **Status and alerts:** a freshness indicator turns amber after two failed polls. New
      warnings and incidents raise an in-app banner, a tab-title count, and a polite screen-reader
      announcement, with no browser notifications or sound. Replay suppresses the banner.
    - **Upcoming:** the next 24 hours of `snapshot.schedule` across environments, top 8 on
      home. The schedule is now a rolling 24-hour window (`docs/adapters.md`).
    - **Time display:** times show in UTC and in the browser's time zone. The Orloj dial stays
      UTC, and its tooltips add local time.
    - **Renderer:** honors `TimeState.live`. Orbits advance at real time, and vehicles move at
      their 1× pace.
    - **Orloj captions:** laid out from the niche bottom, so two-line labels stay inside.

85. **The four Orloj niche figures are icon glyphs.** The miser, mirror, skeleton-with-bell and
    lute of the original port are replaced by the symbols in `reference/orloj-icons.svg` (coins,
    hourglass, bell, eye), drawn with `Path2D` at 0.66 on the 64-unit grid and centered 16 units
    above each niche's center (paths in `packages/orloj/src/draw/icons.ts`). Encodings:
    - **Coins (spend rate):** 1 to 4 coins by spend level (share of the 520/h full-purse rate),
      with thresholds at 25%, 50% and 75%.
    - **Hourglass (freshness):** amber when any spoke is past target, otherwise gold. The top
      sand is the share of spokes within target.
    - **Bell (incidents):** swings with ring waves while incidents are open, driven by the
      decorative clock. Red when any open alert is an incident, amber when only warnings.
    - **Eye (consumers):** the pupil grows from 2.5 to 7 units with activity, and rays appear
      above 45%.
      Tooltip titles are now "Spend rate", "Freshness", "Incidents" and "Consumers", and hit-region
      parts are `spend`, `freshness`, `incidents` and `consumers`. Supersedes the miser, mirror,
      skeleton and lute figures of the Orloj port.
86. **Visual tolerance depends on the view.** The Canvas 2D Orloj renders byte-stably, so its
    baseline allows 0.1% of pixels to differ. At the old 1%, all twelve niche icons could
    change without the test noticing. The WebGL system views vary by up to about 0.2% between
    runs under software rendering, so they keep 1%.
87. **Adapters declare unavailable snapshot parts.** `Snapshot.unavailable?: Partial<Record<SnapshotPart,
string>>` is additive: a missing key means the part is available. Reasons are client-safe
    plain text of at most 200 characters, and the contract suite checks them.
    - **Databricks:** always marks `schedule` (decision 83). It marks `calendar`, `spend`,
      `backlog`, and `consumers` per viewer when their source queries can't be read
      (decision 78). `backlog` is marked only when both run histories fail.
    - **OpenLineage:** marks `spend` and `calendar`, and marks `schedule` when no run carries a
      nominal time.
    - **Mock:** marks nothing.
88. **In-product guidance for the Orloj view:**
    - **Strings:** all Orloj text lives in one i18n-ready module (`packages/orloj/src/strings.ts`,
      `ORLOJ_STRINGS`), which can be overridden through `OrlojOptions.strings`. Its wording
      follows `reference/orloj-home.html`, and a test keeps user-facing literals out of other
      files.
    - **Labels and tooltips:** faces carry permanent "UTC now", "fresher", and "next" labels,
      which scale with the face and are hidden at one column. Every part's tooltip gives its
      definition, its current value (or the adapter's reason when the part is unavailable), and
      the click action.
    - **"How to read":** a button, or the `?` key, turns on annotation mode. It numbers each
      available part on the first face with leader lines and one-line definitions, and dims
      the other faces. It shows on a first visit, and dismissal is remembered in `localStorage`
      (`orrery.orloj.howToRead.dismissed`). The `howto=1` or `howto=0` parameter forces it on
      or off.
    - **Legend:** a collapsible "How to read the clock" legend (closed by default) lists every
      part, numbered to match the annotation, with purpose and how-to-use lines. Parts with no
      data from the active adapter show the reason instead of a definition.
    - **Wall display:** shows only a one-line key strip.
    - **Tests:** axe runs with the legend open and with annotation on, there is a keyboard path
      to the toggle, and annotation mode has its own 0.1% visual baseline.
