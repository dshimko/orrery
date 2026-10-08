# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
