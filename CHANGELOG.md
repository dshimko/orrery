# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- `sqlPredicate` matchers (decision 81). Configs that use it fail validation with the
  unknown-key error; use `catalog`, `schema`, `tag`, `pipelineTag`, or `jobTag`.
- `dashboardTag` matchers (decision 82). No adapter had a verified source for them. Configs
  that use it fail validation with the unknown-key error; use `tag: { use_case: … }` for
  Databricks use cases.

### Added

- `@orrery/adapter-openlineage`: an optional read-only adapter that renders OpenLineage
  RunEvents from a JSON or NDJSON file or a Marquez server (`GET /api/v1/events/lineage` only,
  https unless loopback, bearer key from an env reference, bounded pages, 30 s live polling),
  with matcher-based topology, sample replay for files, and recorded-fixture-free tests on a
  fake `fetch`. `config/examples/openlineage.yaml` renders the public Marquez seed events
  (`adapters/openlineage/samples`, Apache-2.0, credited in `NOTICE`). The server now starts
  `adapter: openlineage` environments, and the package ships the sample.
- Packaging: `pnpm package` builds one deployable bundle (`build/app`) for the Databricks App
  (`app.yaml`, `deploy/databricks-app` bundle and deploy script) and a distroless Docker image
  (`deploy/docker`, `docker-compose.yml`), plus a Helm chart stub (`deploy/helm/orrery`).
- Docs: a generated configuration reference, plus guides for writing adapters, forking, and
  prior art, and a static docs site (`pnpm docs:build`) with a link checker.
- `@orrery/adapter-databricks`: a read-only adapter over the SQL Statement Execution API with
  an allowlist of 18 documented queries (fork-overridable via `options.sqlDir`), catalog
  scoping by prefix, suffix, or tag, the three federation modes, foreign-catalog comets,
  polling with TTL caches, service-principal, OAuth M2M, PAT, and on-behalf-of-user auth,
  recorded fixtures for the shared contract suite, and a live smoke test (`ORRERY_LIVE=1`).
- `docs/databricks.md` (permissions, auth, queries) and `docs/databricks-sources.md`
  (verified system-table reference).
- `@orrery/orloj`: framework-free Canvas 2D Orloj clock faces with the sky, 24-hour ring
  arcs, sun and star hands, spoke medallions, moon, procession, figures, calendar dial,
  rooster, tooltips, and error faces.
- The Orloj home page with an environments-at-a-glance table, cross-environment alerts, a
  summary dialog, a shared clock, wall display mode, compare mode (`/compare`), and the
  `view` deep link.
- axe accessibility checks and milestone 4 Playwright tests (layout breakpoints, failure
  isolation, deep links).
- `@orrery/render`: the framework-free 3D system view ported from the reference, with a
  headless simulation layer, six-axis camera, instanced vehicles, alerts, tier and workload
  filters, and DOM labels throttled to 4 Hz.
- `@orrery/server`: a read-only API (config, environments, topology, snapshot, events, SSE
  stream) with per-environment failure isolation and rate limiting, a CSP, and static serving
  of the web app.
- The `/env/:id` system view page with time scrubber, filters, panels, alerts, an environment
  switcher, a data-table text equivalent, and deep links (`t`, `date`, `paused`, `speed`,
  `tier`, `workload`, `focus`).
- Playwright tests for the system view, visual-regression baselines, an opt-in comparison
  with the reference, and an opt-in frame-time benchmark.
- Domain model in `@orrery/core`: `Topology`, `Snapshot`, the `PlatformEvent` union, and the
  `OrreryAdapter` contract; the metaphor map with orbit, size, and speed formulas; stability
  helpers; seeded randomness.
- `@orrery/adapter-mock`: a deterministic, seeded, time-of-day driven mock ported from the
  reference prototypes, with three environment profiles, per-tier incident scripts, the
  freshness model, and the `MOCK_SEED` and `MOCK_SPEED` variables.
- `@orrery/testkit`: fixed and scaled clocks, and the shared adapter contract suite.
- `config/examples/demo.yaml`: an all-mock demo matching the reference prototypes.
- pnpm workspace skeleton: `apps/web`, `apps/server`, `packages/{core,render,orloj,testkit}`,
  and `adapters/{mock,databricks,openlineage}`.
- Config schema in `@orrery/core` (zod, with generated JSON Schema), with strict unknown-key
  errors that suggest a fix, `${env:NAME}`-only secret fields, topology `extends`, and
  overrides by id.
- Example configs: `three-env.yaml`, `single-workspace.yaml`, `multi-metastore.yaml`.
- CI gates: types, lint, format, unit and coverage, config validation, SPDX headers, license
  allowlist, gitleaks and denylist, bundle size, and Playwright smoke tests.
