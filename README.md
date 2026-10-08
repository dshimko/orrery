# Orrery

Orrery is an open-source lakehouse activity visualizer. Its home page, the **Orloj** clock
view, shows one astronomical clock face per environment (for example dev, stg, prod). From
there you can fly into any environment's **system view**: a 3D solar system of sources,
pipelines, data products, freshness, workloads, and consumers, live or in replay.

> Status: milestone 3 (system view). The views and adapters land in later milestones; see
> `docs/BUILD_PROMPT.md`.

## Quick start

```sh
corepack enable
pnpm install
pnpm build
ORRERY_CONFIG=config/examples/demo.yaml node apps/server/dist/main.js
# open http://127.0.0.1:8787/env/prod
```

For development, run `pnpm dev:server` and `pnpm --filter @orrery/web dev` together. Vite
proxies `/api` to the server.

## Configuration

Orrery is configured with a single `orrery.config.yaml`, whose path is set by `ORRERY_CONFIG`.
See `config/examples/` for examples. The JSON Schema in
`packages/core/schema/orrery.config.schema.json` gives editors validation and autocompletion.

## Repository layout

| Path               | Contents                                               |
| ------------------ | ------------------------------------------------------ |
| `apps/web`         | Orloj clock view, system view, panels (React and Vite) |
| `apps/server`      | Config loading, adapter registry, snapshot and SSE API |
| `packages/core`    | Domain model, event union, config schema, metaphor map |
| `packages/render`  | Framework-free Three.js system view                    |
| `packages/orloj`   | Framework-free Canvas 2D clock faces                   |
| `packages/testkit` | Adapter contract suite, fixtures, seeded clock         |
| `adapters/*`       | Mock, Databricks, and OpenLineage adapters             |

## License

Apache-2.0. See `LICENSE` and `NOTICE`. Databricks is named only to describe compatibility;
this project is not affiliated with or endorsed by Databricks, Inc.
