# Orrery

Orrery is an open-source lakehouse activity visualizer. Its home page, the **Orloj** clock
view, shows one astronomical clock face per environment (for example dev, stg, prod). From
there you can fly into any environment's **system view**: a 3D solar system of sources,
pipelines, data products, freshness, workloads, and consumers, live or in replay.

> Status: milestone 6 (packaging).

Orrery is read-only, runs its adapters only on the server, and is configured with one YAML file.
The default demo uses a deterministic mock adapter, so no credentials are needed.

## Quick start

Requirements: Node 24 LTS (Node 22.19+ also works) and pnpm 10 (`corepack enable`).

**Development server** (mock data, hot reload for the web app):

```sh
pnpm install
pnpm dev:server                    # API on http://127.0.0.1:8787
pnpm --filter @orrery/web dev      # Vite dev server, proxies /api to the server
```

**Built package** (one bundled server file plus the web build):

```sh
pnpm install
pnpm package && cd build/app && node server/main.mjs
# open http://127.0.0.1:8787/ (Orloj home) or /env/prod
```

**Docker:**

```sh
docker compose up --build
# open http://127.0.0.1:8787
```

With no `ORRERY_CONFIG`, the server runs the all-mock `config/examples/demo.yaml` (packaged as
`config/demo.yaml`). Set `ORRERY_CONFIG` to your own file to change environments, topology, or
adapters.

## Databricks App

The package deploys as a Databricks App with the mock adapter first, then switches to the
Databricks adapter. Steps are in [deploy/databricks-app/README.md](deploy/databricks-app/README.md).
Databricks Apps needs a workspace tier that supports it; check availability for your cloud and tier
before you start.

## Documentation

- [Configuration](docs/configuration.md): every config key, matchers, `${env:NAME}` secrets,
  `extends` and `overrides`, environment scope, and validation errors.
- [Writing an adapter](docs/adapters.md): the `OrreryAdapter` interface, events, the contract test
  suite, and registering a fork adapter.
- [Databricks adapter](docs/databricks.md): permissions, authentication, queries, and known limits.
- [Forking into a private repository](docs/forking.md): private config, denylist, private
  adapters, and contributing upstream.
- [Prior art](docs/prior-art.md), [design decisions](docs/decisions.md), and the
  [specification](docs/BUILD_PROMPT.md).
- [Contributing](CONTRIBUTING.md), [security policy](SECURITY.md), and [changelog](CHANGELOG.md).

`pnpm docs:build` renders these pages to static HTML in `build/docs/`, and
`pnpm docs:build --check` verifies the links between them.

## Repository layout

| Path               | Contents                                                    |
| ------------------ | ----------------------------------------------------------- |
| `apps/web`         | Orloj clock view, system view, panels (React and Vite)      |
| `apps/server`      | Config loading, adapter registry, snapshot and SSE API      |
| `packages/core`    | Domain model, event union, config schema, metaphor map      |
| `packages/render`  | Framework-free Three.js system view                         |
| `packages/orloj`   | Framework-free Canvas 2D clock faces                        |
| `packages/testkit` | Adapter contract suite, seeded clock                        |
| `adapters/*`       | Mock, Databricks, and OpenLineage adapters                  |
| `config/`          | Example configs; `config/private/` is git-ignored for forks |
| `deploy/`          | Databricks App bundle, Docker image, and Helm chart         |
| `docs/`            | Documentation, design decisions, and the specification      |
| `scripts/`         | Packaging, docs generation, and repository checks           |

## License

Apache-2.0. See `LICENSE` and `NOTICE`. Databricks is named only to describe compatibility;
this project is not affiliated with or endorsed by Databricks, Inc.
