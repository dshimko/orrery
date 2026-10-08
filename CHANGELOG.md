# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
