# Orrery: build prompt for an open-source lakehouse activity visualizer

Oct 7, 2026

## How to use this prompt

Build the repository with Claude Code from three inputs: this document, the reference mock, and the kickoff prompt below.

1. Create an empty directory and run `git init`.
2. Export this doc as Markdown and save it as `docs/BUILD_PROMPT.md`.
3. Save both reference files in `reference/`: `system-view.html` (one environment as a solar system) and `orloj-home.html` (the Orloj clock view, one face per environment). They are the visual and behavioral source of truth, and single-file prototypes to port, not code to ship.
4. Start Claude Code in that directory and paste the kickoff prompt.

```text
Read docs/BUILD_PROMPT.md in full, then open both files in reference/:
system-view.html and orloj-home.html. Build the orrery repository the spec
describes. The product is Orrery; Orloj is its clock view.

Rules:
- BUILD_PROMPT.md is the spec. The reference files are the visual and
  behavioral source of truth. Port the system view (scene, six-axis camera,
  vehicles) and the Orloj clock view (faces, procession, figures, calendar
  dial) into the packages the spec defines. Do not ship them as single files.
- Work milestone by milestone. Before each one, post a short plan. After it,
  run every CI gate, show the results, and stop for my go-ahead.
- Keep everything vendor-neutral and free of organization details. Use only
  the sample config names.
- Add only MIT, Apache-2.0, BSD, ISC, or 0BSD dependencies; web fonts may be
  OFL-1.1. Check the license before adding anything.
- Where the spec and the references disagree, follow the spec and list the
  difference in docs/decisions.md.
- If something is ambiguous, pick the simplest option that meets the
  acceptance criteria and record it in docs/decisions.md.

Start with milestone 1.
```

Neither the spec nor the reference contains organization details. A private fork adds its configuration later, as described in Prior art and forking.

## Role, goal, and non-negotiables

You are building `orrery`, an open-source web app that shows everything happening on a lakehouse platform as a game-like 3D solar system. It must be environment-agnostic, configuration-driven, and safe to fork into a private corporate repository.

**Goal.** A viewer opens the Orloj clock view, one astronomical clock face per configured environment (for example dev, stg, prod), sees each one's health at a glance, then flies into any environment to watch sources, pipelines, data products, freshness, workloads, and consumers in real time or replay.

**Non-negotiables**

1. **License.** The repository is Apache-2.0. Add `LICENSE`, `NOTICE`, and SPDX headers (`SPDX-License-Identifier: Apache-2.0`) in every source file.
2. **Dependency allowlist.** Runtime and build dependencies may only be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or 0BSD. Web fonts may also be OFL-1.1 (Barlow, Cinzel). GPL, LGPL, AGPL, MPL, SSPL, BUSL, Commons Clause, and unlicensed packages are forbidden. Enforce this in CI and fail the build on violation.
3. **No organization details.** No company names, site names, people, real hostnames, workspace IDs, catalog names, or schemas anywhere in code, tests, fixtures, docs, or commit messages. Sample data uses neutral names such as "Site 01", "Region A", "Sales", "Finance".
4. **No secrets in the repo.** Credentials come only from environment variables or the hosting platform's secret store. Add a pre-commit secret scan.
5. **Configuration over code.** Topology, environment list, naming rules, freshness targets, and visual mappings live in config. A new deployment must never require editing source files.
6. **Vendor-neutral core.** The core model and renderer know nothing about Databricks. Databricks lives in one adapter package. Use the platform name only descriptively, with no logos or trademarks implying endorsement.
7. **Read-only.** The app never writes to the data platform. All queries are `SELECT` against metadata, system, and monitoring tables.
8. **Accessible and testable without a browser GPU.** Every 3D view has a text or table equivalent, a reduced-motion mode, and a headless test path.

## Concept and metaphor mapping

Each environment is one solar system. The hub sits at the center, spokes orbit it, and orbit distance means data age. Implement this mapping as data in `packages/core/src/metaphor.ts` so a fork can restyle it without touching the renderer.

| Platform concept | Scene element | Encoding |
| --- | --- | --- |
| Hub (core platform where most data products live) | Central planet | Ring of satellites, one per data product; satellites pop in when a product publishes |
| Spoke (domain or functional data platform) | Planet in orbit | Size by a selectable metric: pipelines, products, complexity, or volume |
| Ingest spoke (a spoke that receives source data) | Planet with a bronze debris ring and a gantry ring | Debris height shows backlog; gantry flashes on quality pass or reject |
| Freshness | Orbit radius | Log scale of current data age; planets drift outward as data ages and swing in on refresh; ring turns amber past target |
| Sources | Mining asteroids in an outer belt, grouped by configurable region | Beacon brightness follows local shift or activity |
| Medallion tiers | Material and color: bronze cargo, silver crates and shuttles, gold capsules and satellites | Tier filter dims everything outside the chosen tier |
| Use cases and consumers | Stations in low orbit around the hub | Size and status color follow activity and alerts |
| Engineering and release | Shipyard | Release drones fly to spokes on deploy |
| Cross-metastore sharing | Teal tethers between hub and spokes in another metastore | Tether thickness follows read volume |
| Query federation (foreign catalogs) | Comets outside the belt with dotted query beams | Beams pulse when queried; nothing is copied |
| Alerts | Light pillars, expanding rings, floating flags | Red for incident, amber for warning, blue for info |

**Workload types.** Each workload has its own vehicle and a filter that shows only that vehicle. Ship these defaults, configurable by name, color, and source query:

| Workload | Vehicle |
| --- | --- |
| Streaming | Cyan laser pulses from source to ingest spoke |
| Batch loads | Bronze cargo pods |
| Transfer and copy | Shuttles to the hub and silver copies out to spokes |
| Transform and quality | Gantry crates and gold capsules returning to the hub |
| ML training and scoring | Planet auroras and magenta orbs to stations |
| Serving and BI | Gold pulses from hub to stations |
| Build and deploy | Violet drones from the shipyard |

**Orloj clock view.** The home view is one astronomical clock face per environment, modeled on a medieval orloj. It answers when: schedules, freshness, and incidents across the day. The system view answers where and how data moves.

| Clock part | Meaning |
| --- | --- |
| Sun hand on the 24-hour ring | Current UTC time; midnight at the bottom, noon at the top |
| Arcs on the ring | Scheduled windows and incidents: blue planned, amber warning, red incident |
| Silver ticks | Transfers from the ingest spoke to the core |
| Small suns inside the ring | Local noon for each source region and office |
| Rays and medallions | Domain spokes; closer to the hub means fresher; amber halo when past target |
| Moon phase | Ingest backlog |
| Star hand | Next scheduled event |
| Apostle procession | Runs scheduled in the current hour, colored by workload, at the top of each hour |
| Miser, mirror, skeleton, lute | Spend rate, spokes past target, open incidents (the bell rings), consumer activity |
| Calendar dial | Releases per day this month, promotions, month-end close |
| Rooster | Crows after midnight when the previous day had no red incident |

## Visual specification and stability rules

Match the reference mock's look and motion. These numbers are its defaults; expose them in config under `visuals`.

| Element | Default |
| --- | --- |
| World scale | Hub radius 5; product ring radius 7.4, tilted 18 degrees; station orbit 11; asteroid belt radius 128 plus or minus 12; foreign-catalog comets on a 150 by 92 ellipse |
| Freshness orbit | radius = clamp(24 + 22 × log10(age in minutes), 24, 104) |
| Planet size | 1.8 + 3.4 × sqrt(metric ÷ largest metric across spokes) |
| Orbit speed | 2π ÷ (26 × (radius ÷ 30)^1.5) radians per simulated hour |
| Tier colors | dev #3FC1CF, stg #FFB020, prod #6EA8FF |
| Tier and workload colors | bronze #C0804A, silver #D5DEEA, gold #F3D36B, streaming #37D6E8, ML #E070FF, build #9B8CFF, sharing #3FC1CF, federated #B9F3FF, incident #FF4D4F, warning #FFB020 |
| Lighting | Ambient #8EA2C6 at 0.42; one directional sun from (−460, 90, −320); a visible sun with glow; 2,200-point star field |
| Camera | Quaternion orbit around a target with yaw, pitch, roll, pan, and dolly; tween factor 1 − e^(−4.5·dt); release inertia decaying by e^(−2.8·dt); 38 degree field of view |
| Labels | DOM overlay projected every frame |
| Time | 24 simulated hours in 120 seconds at 1×, with 2× and 4× |

Stability rules. The first prototype failed on these, so treat each as a test:

1. Integrate orbital angles over time. Never derive an angle from the current radius.
2. Move every radius, size, and height toward its target with an exponential approach (rate 1.2 to 4 per second). Never set them straight from data.
3. Spokes that refresh more often than every 30 minutes display their mean data age. Longer cadences show the drift and snap back.
4. Status changes such as past-target use 3% hysteresis so a value near a threshold cannot flicker.
5. Randomness is seeded per environment, so layout never reshuffles between frames or reloads.
6. DOM text updates at most four times a second and only when the text changes. Per-frame DOM writes are limited to label transforms.
7. Particles use instanced meshes with fixed caps. Spawning is rate-based with accumulators, independent of frame rate.
8. Acceptance: with time paused and no input, no object or label moves more than 1 px between frames.

Orloj defaults, in face units (one face is 440 by 820, scaled to fit):

| Element | Default |
| --- | --- |
| Layout | 3 faces per row at 1,150 px and wider, 2 from 720 px, 1 below; scale capped at 1.25 |
| Astronomical dial | Center (220, 345), radius 140, gold rim 9; 24-hour ring 22 wide with Cinzel numerals |
| Sky | Blue upper disk, brown dawn band, black night, as on the Prague orloj |
| Spoke distance | 18 + (orbit radius − 24) ÷ 80 × 62, using the system view's freshness orbit |
| Spoke size | 4.5 + 5 × sqrt(pipelines ÷ largest pipeline count across all environments) |
| Zodiac rotation | A quarter turn per simulated day |
| Procession | First 30 simulated minutes of each hour; 3 to 12 figures plus one per release |
| Calendar dial | Center (220, 650), radius 100; current month from the system date |
| Renderer | Canvas 2D in a framework-free package, redrawn each frame, with hit regions for tooltips and a text table under the faces for screen readers |

The eight stability rules apply to both views.

## Environments and home page

Every environment is its own solar system, reached from a home page. Environments are a list in config, not a fixed set, so a deployment can show dev, stg, prod, or any other tiers.

**Orloj clock view (`/`)**

- One astronomical clock face per environment in promotion order, all on one shared clock, each with a tier-colored plaque.
- Faces show the parts listed under Orloj clock view in the concept section; every part has a tooltip.
- Below the faces: an environments-at-a-glance table (incidents, spokes past target, backlog, next event) and an open-alerts list sorted by severity, then time.
- Clicking a face opens a summary with a link to that environment's system view. Alerts link the same way.
- Wall display mode cycles the Orloj view and each system view, holding on any environment with an open incident.

**System view (`/env/:id`)**

- The full solar system with its own time scrubber, filters, alerts, and side panels.
- An environment switcher in the header and a Home button. Camera position is kept per environment.
- A tier color band (for example teal dev, amber stg, blue prod) on the header and scene edge, so screenshots are never ambiguous.

**Environment behavior**

- Each environment has its own adapter instance and credentials. One environment failing to load never blocks the home page; its card shows the error.
- An environment may inherit topology from a base and override parts of it, because dev and stg often mirror prod with fewer spokes.
- Environments can be split by workspace, by metastore, by catalog name pattern (prefix or suffix, such as dev\_sales or sales\_dev), or by tag. The resolver for each strategy is in the adapter, chosen in config.

## Architecture and repository layout

Adapters run only on the server. The browser receives topology and events as JSON and maps them to visuals.

&#91;embedded content: orrery architecture · 3 layers, adapters server-side\]

Stack: pnpm workspaces, Node 20 LTS, TypeScript in strict mode, React 18, Vite, three, zod, Fastify or Express, Vitest, Playwright. Keep the renderer in a framework-free package so a fork can embed it elsewhere.

```text
orrery/
├─ apps/
│  ├─ web/                 # Orloj clock view, system view, panels (React + Vite)
│  └─ server/              # config, adapter registry, snapshot + SSE API
├─ packages/
│  ├─ core/                # domain model, event union, config schema, metaphor map
│  ├─ render/              # framework-free Three.js scene, camera, instancing, labels
│  ├─ orloj/               # framework-free Canvas 2D clock faces
│  └─ testkit/             # adapter contract suite, fixtures, seeded clock
├─ adapters/
│  ├─ mock/
│  ├─ databricks/          # sql/*.sql, federation modes, auth
│  └─ openlineage/
├─ config/
│  ├─ examples/            # single-workspace.yaml, three-env.yaml, multi-metastore.yaml
│  └─ private/             # git-ignored; forks put real config here
├─ deploy/
│  ├─ databricks-app/      # app.yaml, databricks.yml
│  ├─ docker/
│  └─ helm/
├─ reference/           # system-view.html, orloj-home.html
├─ docs/
├─ .github/workflows/
└─ LICENSE, NOTICE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md
```

## Configuration model

One YAML file, `orrery.config.yaml`, validated against a JSON Schema generated from zod types in `packages/core`. The path is set by `ORRERY_CONFIG`; a fork keeps its file in a private overlay directory that is git-ignored in the public repo.

Rules for the schema:

- Everything that identifies a real object is a **matcher**, never a hard-coded name: catalog or schema glob, Unity Catalog tag, job or pipeline tag, or a custom SQL predicate.
- Environments can `extends` a named base topology and override lists by `id`.
- Every secret field accepts only `${env:NAME}` references.
- Unknown keys fail validation, with the path and a suggested fix in the error.

**Environment scope.** An environment owns the catalogs whose names match its `scope.catalogs` globs. The environment tag may sit at the start or the end of the name, so list both forms (`dev_*`, `*_dev`). Matching is case-insensitive and also accepts a Unity Catalog tag (`scope.tag: { env: dev }`) for catalogs that follow neither form. Spoke matchers then run against the catalog name with the environment tag stripped, so `dev_sales` and `sales_dev` both resolve to the Sales spoke. A catalog matching two environments fails validation with both names in the error; catalogs matching none are ignored and listed in the environment's health check.

Example shipped as `config/examples/three-env.yaml`:

```yaml
version: 1
product:
  title: Orrery
  timezone: UTC

topologies:
  base:
    hub:
      id: core
      name: Core platform
    spokes:
      - id: ingest
        name: Regional ingest
        role: ingest
        match: { tag: { domain: ingest } }
        freshness: { cadenceMinutes: 15, targetMinutes: 21 }
      - id: sales
        name: Sales
        role: domain
        match: { schema: "*_sales_*" }
        freshness: { cadenceMinutes: 240, targetMinutes: 280 }
      - id: finance
        name: Finance
        role: domain
        match: { tag: { domain: finance } }
        freshness: { cadenceMinutes: 1440, targetMinutes: 1560, offsetMinutes: 120 }
    sourceGroups:
      - { id: region-a, name: Region A, utcOffset: -6, match: { pipelineTag: { source_region: a } } }
      - { id: region-b, name: Region B, utcOffset: 2, match: { pipelineTag: { source_region: b } } }
    useCases:
      - { id: exec, name: Executive overview, match: { dashboardTag: { use_case: exec } } }
    medallion:
      strategy: schema-suffix   # schema-suffix | catalog-prefix | tag
      bronze: ["*_bronze", "*_raw"]
      silver: ["*_silver"]
      gold: ["*_gold"]

environments:
  - id: dev
    name: Development
    tier: dev
    topology: base
    adapter: mock
    mock: { scale: 0.25, failureRate: 0.12, deploysPerHour: 3, agingFactor: 6 }
  - id: stg
    name: Staging
    tier: stg
    topology: base
    adapter: databricks
    federation: { mode: multi-workspace }
    connection:
      host: ${env:ORRERY_STG_HOST}
      warehouseId: ${env:ORRERY_STG_WAREHOUSE}
      auth: app-service-principal
    scope: { catalogs: ["stg_*", "*_stg"] }
  - id: prod
    name: Production
    tier: prod
    topology: base
    adapter: databricks
    federation:
      mode: multi-metastore    # single-workspace | multi-workspace | multi-metastore
      metastores:
        - { id: primary, host: ${env:ORRERY_PROD_HOST}, warehouseId: ${env:ORRERY_PROD_WAREHOUSE} }
        - { id: secondary, host: ${env:ORRERY_PROD2_HOST}, warehouseId: ${env:ORRERY_PROD2_WAREHOUSE} }
      foreignCatalogs: { show: true }
    connection: { auth: app-service-principal }
    scope: { catalogs: ["prod_*", "*_prod"] }

promotion:
  order: [dev, stg, prod]
  source: job-tag      # job-tag | git-tag | none
  tagKey: release

visuals:
  sizeBy: pipelines
  workloads: default
  theme: dark
```

## Adapters and plugin contract

All data reaches the renderer through one TypeScript interface. Ship three adapters; a fork adds its own by registering a package name in config.

```ts
export interface OrreryAdapter {
  id: string;
  init(env: EnvironmentConfig, ctx: AdapterContext): Promise<void>;
  topology(): Promise<Topology>;            // hub, spokes, sources, use cases, metastores, foreign catalogs
  snapshot(at?: Date): Promise<Snapshot>;   // activity, freshness, counts, open alerts
  events(since: Date, until?: Date): AsyncIterable<PlatformEvent>; // replay and live
  health(): Promise<AdapterHealth>;         // for the home page card
  dispose(): Promise<void>;
}
```

`PlatformEvent` is a discriminated union: `source.stream`, `source.batch`, `ingest.gate` (pass or reject), `transfer`, `copy`, `product.publish`, `freshness.change`, `ml.run`, `serve.read`, `deploy`, `promotion`, `alert.open`, `alert.close`. Each carries `envId`, `ts`, ids of the objects involved, and an optional `workload` and `tier`. The renderer maps events to vehicles; adapters never know about visuals.

**1. Mock adapter (`adapters/mock`)**

- Deterministic, seeded, time-of-day driven. Same seed and time give the same scene, so screenshots and tests are stable.
- Profiles per environment: `scale`, `failureRate`, `deploysPerHour`, `agingFactor`, and a scripted incident list.
- Default script covers a nightly batch, a transfer hold, a predictive maintenance warning, a recall-style cross-domain alert, a schema drift reject, a failed promotion blocked in stg, and a daily finance refresh.
- Exposes `MOCK_SEED` and `MOCK_SPEED` environment variables.

**2. Databricks adapter (`adapters/databricks`)**

- Runs server-side only. The browser never receives a Databricks token.
- Queries through a SQL warehouse using the official Databricks SDK or the SQL Statement Execution API. All queries live as `.sql` files in the adapter so a fork can override any single one by path.
- Federation modes:
  - `single-workspace`: one connection.
  - `multi-workspace`: workspaces share one metastore, so one connection suffices for system tables; workspace id becomes a label.
  - `multi-metastore`: one connection per metastore, queried in parallel and merged. Cross-metastore Delta Sharing is drawn as tethers. A metastore that fails renders as a dimmed region, not an error page.
- Foreign catalogs (Lakehouse Federation) are discovered from the catalog list and drawn as comets; queries against them are drawn as beams, never as copies.
- Polls on an interval per query class (topology hourly, freshness every 5 min, run timelines every 30 s) and converts deltas into `PlatformEvent`s. Caches in memory with a TTL.

**3. OpenLineage adapter (`adapters/openlineage`)**, optional

- Reads run events from any OpenLineage-compatible backend so the app also works outside Databricks.

**Composition.** An environment may list several adapters. Their topologies merge by id and their event streams interleave by time, so a fork can combine Databricks with an external orchestrator or CI system.

## Databricks data sources

Every scene element maps to a documented system table or Unity Catalog feature. Before writing each query, open the current reference page, confirm column names and region availability, and record the doc URL in a comment at the top of the `.sql` file.

| Scene element | Source | Notes |
| --- | --- | --- |
| Hub, spokes, tiers | Catalog, schema, and tag listings in Unity Catalog | Resolve spokes and tiers with the config matchers |
| Source streams and batch pods | `system.lakeflow.pipeline_update_timeline`, `system.lakeflow.job_run_timeline`, `system.lakeflow.zerobus_ingest` | Group by the source-group matcher |
| Planet size by pipelines | `system.lakeflow.pipelines`, `system.lakeflow.jobs` | Count per spoke |
| Copies out and products returning | `system.access.table_lineage`, `system.access.column_lineage` | Edge between spokes and hub defines the arc |
| Freshness orbit | Data quality monitoring results; fallback is last successful write from lineage or table history | Per-spoke target from config |
| Ingest gate pass and reject | Pipeline expectations or data quality results | Reject rate drives red sparks |
| Station reads | `system.access.audit` and query history | Group by use-case matcher |
| Deploys and promotions | `system.lakeflow.jobs` changes plus the configured release tag | Draw drones and home-page lanes |
| Cost overlay | `system.billing.usage` with `system.billing.list_prices` | Optional heat layer |
| Cross-metastore tethers | Delta Sharing shares, recipients, and providers | Only in `multi-metastore` mode |
| Comets | Foreign catalogs from Lakehouse Federation connections | Read-only queries drawn as beams |

Platform facts the adapter must respect:

- A metastore covers a single cloud region, and several workspaces in that region can attach to it ([Databricks docs](https://docs.databricks.com/gcp/en/data-governance/unity-catalog/securable-objects)).
- Databricks recommends Databricks-to-Databricks Delta Sharing for sharing between metastores ([Databricks docs](https://docs.databricks.com/gcp/en/lakehouse-architecture/deployment-guide/storage)).
- Foreign tables from Lakehouse Federation are read-only ([Databricks docs](https://docs.databricks.com/gcp/tables/foreign)).
- Data quality monitoring tracks freshness and completeness per table from historical patterns ([Databricks docs](https://docs.databricks.com/data-quality-monitoring/anomaly-detection/)).
- System table list: [Databricks system tables reference](https://docs.databricks.com/admin/system-tables/).

## Security, auth, and deployment

Ship two deployment targets from one build: a Databricks App and a standalone container.

**Databricks App**

- Databricks Apps supports Node.js apps with React frontends and Express backends ([Databricks docs](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)). Use a Node + TypeScript backend serving the built frontend.
- Each app gets its own service principal, and data access runs as that principal unless user authorization is used ([Databricks docs](https://docs.databricks.com/aws/dev-tools/databricks-apps)). Support both modes in config: `app-service-principal` (default, needs `SELECT` on the system tables listed above) and `on-behalf-of-user` (reads the forwarded user token so Unity Catalog permissions apply per viewer).
- Ship `app.yaml`, a `databricks.yml` bundle, and a `deploy` script. Keep the app bundle under the platform's file size limit; load large assets from the build output, not the repo.
- Note in the README that Databricks Apps needs a workspace tier that supports it.

**Standalone container**

- `Dockerfile` (distroless Node base), `docker-compose.yml` with the mock adapter, and a Helm chart stub.
- Auth for standalone: OAuth machine-to-machine with a service principal, or a personal access token for local development only, read from environment variables.

**Hardening**

- Server-side query allowlist: the backend executes only the `.sql` files shipped with the adapter plus fork-registered files. No free-form SQL from the browser.
- Row limits and timeouts on every query; a per-environment rate limiter.
- Visibility rules in config hide or aggregate whole spokes, metastores, or source groups per viewer group. Redacted objects render as sealed bodies showing counts only.
- Content Security Policy with no third-party script hosts; all assets bundled.
- No telemetry by default.

## Testing, CI, and quality gates

CI must pass on every pull request with no credentials present.

| Gate | Tool | Fails when |
| --- | --- | --- |
| Types and lint | `tsc --noEmit`, ESLint, Prettier | Any error |
| Unit tests | Vitest | Coverage under 80% in `core` and adapters |
| Config validation | Schema test over every file in `config/examples` | Any example fails validation |
| Mock determinism | Snapshot of `snapshot()` and first 500 events for a fixed seed and time | Output drifts without an intentional update |
| Adapter contract | Shared contract suite run against every adapter, with recorded SQL fixtures for Databricks | Any adapter breaks the interface |
| Visual regression | Playwright with WebGL software rendering, Orloj clock view and three system views at fixed seed | Pixel diff above threshold |
| Accessibility | axe on home page and panels; keyboard-only walkthrough test | Any serious violation |
| Licenses | `license-checker` with the allowlist | Any disallowed license |
| Secrets and names | gitleaks plus a denylist test that scans for words listed in a private, git-ignored file | Any hit |
| Bundle size | size-limit | Frontend over 2.5 MB gzipped |

The denylist test lets a fork list its own company and site names locally, so nothing private leaks back into upstream contributions.

## Milestones and acceptance criteria

Work in this order. Stop at the end of each milestone, run all gates, and report what passed before continuing.

1. **Skeleton.** pnpm workspace, license files, CI with all gates (empty tests allowed), config schema, and the `three-env.yaml` example, which mirrors the references' sample config.
   - Accept: `pnpm i && pnpm test && pnpm build` passes; the schema rejects an unknown key with a useful message.
2. **Core and mock adapter.** Domain model, metaphor map, event union, and the seeded mock adapter ported from the references: three environment profiles, scripted incidents, and the freshness model with mean age for short cadences.
   - Accept: the same seed and time produce identical snapshots; each scripted incident appears at its configured time.
3. **System view.** Port `reference/system-view.html` into `packages/render`: hub, spokes, belt, ingest rings, stations, shipyard, comets, freshness orbits, tiers, workload vehicles, alerts, and the six-axis camera with level-horizon and reset.
   - Accept: screenshots match the reference at the same seed and time; all eight stability rules pass as tests; 60 fps at 1080p on integrated graphics with the prod mock.
4. **Orloj clock view and navigation.** Port `reference/orloj-home.html` into `packages/orloj`: faces, procession, figures, calendar dial, rooster, tooltips, glance table, alert list, and the summary panel linking to system views. Then add the environment switcher, per-environment camera memory, wall display, and compare mode.
   - Accept: screenshots match the reference at the same seed and time; layout switches at 1,150 and 720 px; a failing environment shows an error face while others render; deep links such as `/env/stg?t=11:00&focus=spoke:sales` restore state.
5. **Databricks adapter.** SQL files, environment scope by catalog prefix or suffix, three federation modes, foreign-catalog comets, polling and event conversion, service principal and on-behalf-of-user auth.
   - Accept: the contract suite passes with recorded fixtures; a live smoke test runs only when `ORRERY_LIVE=1` and credentials exist.
6. **Packaging.** Databricks App bundle, Docker image, docs site.
   - Accept: the app deploys with the mock adapter in a fresh workspace using only the README steps.
7. **OpenLineage adapter** (optional).
   - Accept: renders the public OpenLineage sample events.

Documentation to ship: `README.md` (quick start with mock), `docs/configuration.md` (every key), `docs/adapters.md` (writing one), `docs/databricks.md` (permissions and queries), `docs/forking.md`, `CONTRIBUTING.md`, `SECURITY.md`, and a `CHANGELOG.md` following Keep a Changelog.

## Prior art and forking

Borrow patterns, not code, unless the license is on the allowlist; credit every influence in `NOTICE` and `docs/prior-art.md`.

| Project | License | What to take |
| --- | --- | --- |
| [Netflix Vizceral](https://github.com/Netflix/vizceral) | Apache-2.0 | Global to regional to service drill-down and animated traffic particles; not maintained, so reference only |
| [vasturiano 3d-force-graph](https://github.com/vasturiano/3d-force-graph) | MIT | Optional dependency for the lineage drill-down inside a spoke, with directional particles and DAG mode |
| [Marquez](https://marquezproject.ai/) and OpenLineage | Apache-2.0 | Event model and the optional OpenLineage adapter |
| [Unity Catalog lineage](https://docs.databricks.com/data-governance/unity-catalog/data-lineage) | Product docs | The 2D lineage view to link out to from detail cards |
| Three.js | MIT | Renderer |

**Forking into a private repository**

1. Fork, then add the private remote; keep `upstream` pointed at the public repo.
2. Put organization config in `config/private/` (git-ignored upstream), and the denylist file in `.orrery-denylist` (also git-ignored).
3. Put private adapters in `adapters-private/` and register them in config. Never edit `packages/core`.
4. Theme overrides go in `config/private/theme.yaml`; logos go in `public/private/`.
5. Contribute fixes upstream from a clean branch; the denylist test must pass before any push to `upstream`.
6. Keep `LICENSE` and `NOTICE` intact; add your own copyright line for new files if your policy requires it.
