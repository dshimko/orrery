# Running Orrery in a corporate environment

This page covers testing and deploying Orrery from a private corporate fork. It assumes you have
read [forking.md](forking.md). Nothing here requires editing source files.

## 1. Keep corporate details out of the public repo

- **Commit identity.** Commits record your name and email. If the fork may ever push upstream,
  use a neutral identity for this repo only:
  `git config user.email "<id>+<user>@users.noreply.github.com"`.
- **Denylist.** Before your first commit, copy `.orrery-denylist.example` to `.orrery-denylist`
  (git-ignored) and list your company, site, and product names, workspace hosts, and catalog
  prefixes, one per line. Then `pnpm check:denylist` and the pre-commit hook fail on any match.
  The hook also runs gitleaks, from a local binary or the pinned Docker image.
- **Private files stay untracked.** Put everything real in git-ignored locations:

  | What             | Where                                                        |
  | ---------------- | ------------------------------------------------------------ |
  | Config           | `config/private/orrery.config.yaml`                          |
  | Theme overrides  | `config/private/theme.yaml` (a partial `visuals:` block)     |
  | Logo             | `public/private/logo.svg` (or `.png`, `.webp`)               |
  | Query overrides  | any directory, referenced by `environments[].options.sqlDir` |
  | Private adapters | `adapters-private/`                                          |

## 2. Write and validate the config

1. Start from `config/examples/three-env.yaml` (Databricks) or `demo.yaml` (mock only), and
   copy it to `config/private/orrery.config.yaml`.
2. For each environment, set `scope.catalogs` to your catalog naming. List both forms if
   environments are a prefix or a suffix (`dev_*`, `*_dev`). A catalog that matches two
   environments is an error that names both.
3. Map spokes, source groups, and use cases with matchers: `catalog`, `schema`, `tag`,
   `pipelineTag`, `jobTag`. Use cases match the data they read (for Databricks, reads of
   schemas matching the use case's `catalog`, `schema`, or `tag`).
4. Put every host, warehouse id, and credential in `${env:NAME}` references. Literal secrets
   are rejected.
5. Validate it without starting the server:

   ```sh
   pnpm validate-config config/private/orrery.config.yaml
   ```

   Every problem is printed with its path, and unknown keys get a "Did you mean" suggestion. The
   full reference is [configuration.md](configuration.md).

## 3. Build behind a corporate network

| Need                         | Setting                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm registry mirror          | `registry=` in your user `~/.npmrc` (not the repo's)                                                                                                                          |
| Corepack downloading pnpm    | `COREPACK_NPM_REGISTRY=<mirror>`                                                                                                                                              |
| Playwright browsers          | `PLAYWRIGHT_DOWNLOAD_HOST=<mirror>`, only needed for e2e tests                                                                                                                |
| Docker base images           | `docker build --build-arg BUILDER_IMAGE=<mirror>/node:24-bookworm-slim --build-arg RUNTIME_IMAGE=<mirror>/distroless/nodejs24-debian12:nonroot -f deploy/docker/Dockerfile .` |
| TLS-inspecting proxy (build) | `NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem` for pnpm and Node                                                                                                                  |

Node 24 LTS is the project's version, and Node 22.19 is the minimum.

## 4. Runtime networking: proxy and corporate CA

The server reaches Databricks and Marquez with Node's built-in `fetch`, which **ignores
`HTTPS_PROXY` by default**. Behind an outbound proxy, set all of:

```sh
NODE_USE_ENV_PROXY=1                 # makes fetch honor the proxy variables (verified on Node 22.23 and 24)
HTTPS_PROXY=http://proxy.internal:8080
NO_PROXY=localhost,127.0.0.1         # add internal hosts that must bypass the proxy
NODE_EXTRA_CA_CERTS=/etc/ssl/corp-ca.pem   # if the proxy re-signs TLS
```

`NODE_OPTIONS=--use-system-ca` is an alternative to `NODE_EXTRA_CA_CERTS` on hosts whose OS
trust store already has the corporate CA. Distroless images have no OS store, so mount the CA
file and use `NODE_EXTRA_CA_CERTS` there. A Databricks App calls its own workspace from inside
Databricks and normally needs none of this.

**Inbound:** behind your own ingress or load balancer, set `ORRERY_TRUST_PROXY=1` so the rate
limiter sees client addresses. Exactly one proxy hop is trusted. Set
`ORRERY_TRUST_FORWARDED_TOKEN=1` only if that ingress authenticates users and sets
`x-forwarded-access-token`; never expose the server directly with it set.

## 5. Environment variables

**Server and runtime**

| Variable                                                               | Default                                     | Purpose                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `ORRERY_CONFIG`                                                        | `config/examples/demo.yaml`, with a warning | Config file (relative paths resolve against the working directory)         |
| `PORT` / `HOST`                                                        | `8787` / `127.0.0.1`                        | Listen address; under Databricks Apps, `DATABRICKS_APP_PORT` and `0.0.0.0` |
| `ORRERY_WEB_DIR`                                                       | `apps/web/dist`                             | Built web app to serve                                                     |
| `ORRERY_THEME`                                                         | `config/private/theme.yaml` if present      | Theme overlay                                                              |
| `ORRERY_LOGO`                                                          | `public/private/logo.*` if present          | Header logo                                                                |
| `ORRERY_TRUST_PROXY`                                                   | off (on under Databricks Apps)              | Trust one inbound proxy hop for client addresses                           |
| `ORRERY_TRUST_FORWARDED_TOKEN`                                         | off (on under Databricks Apps)              | Accept `x-forwarded-access-token` for on-behalf-of-user                    |
| `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS` | unset                                       | Outbound proxy and CA (section 4)                                          |
| `MOCK_SEED` / `MOCK_SPEED`                                             | unset                                       | Mock adapter seed override and live speed                                  |

**Databricks credentials** (referenced from config, or injected by Databricks Apps)

| Variable                                           | Used by                                          |
| -------------------------------------------------- | ------------------------------------------------ |
| `DATABRICKS_HOST`                                  | Default `connection.host` under Databricks Apps  |
| `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` | `auth: app-service-principal` (injected by Apps) |
| Your own names, for example `ORRERY_PROD_HOST`     | `${env:…}` references in your config             |

**Packaging and tests**

| Variable                | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `ORRERY_PACKAGE_CONFIG` | Bake a private config into `pnpm package` as `config/orrery.yaml`            |
| `ORRERY_LIVE=1`         | Run the live Databricks smoke test (with `ORRERY_CONFIG`, `ORRERY_LIVE_ENV`) |
| `ORRERY_MARQUEZ_URL`    | Run the live Marquez test                                                    |
| `ORRERY_PERF=1`         | Frame-time benchmark on the real GPU                                         |

## 6. A first corporate test run

```sh
pnpm install && pnpm build
pnpm validate-config config/private/orrery.config.yaml
export ORRERY_CONFIG=config/private/orrery.config.yaml
export ORRERY_PROD_HOST=... ORRERY_PROD_WAREHOUSE=...   # whatever your config references
export DATABRICKS_CLIENT_ID=... DATABRICKS_CLIENT_SECRET=...   # or use the Databricks App
node apps/server/dist/main.js
# open http://127.0.0.1:8787/ and check each environment's health in the glance table
ORRERY_LIVE=1 ORRERY_LIVE_ENV=prod pnpm vitest run adapters/databricks/test/live.test.ts
```

If an environment fails, the server log names the missing field or variable, never its value,
and the other environments keep working. For the grants the principal needs, see
[databricks.md](databricks.md). For a Databricks App deployment, see
`deploy/databricks-app/README.md`.
