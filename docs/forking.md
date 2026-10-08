# Forking into a private repository

Orrery is built so that a company can run it against its own platform without leaking
organization details back into the public project. Real config, private adapters, and the list of
names to keep out of the code stay in a private repository. Everything else tracks upstream.

What is private lives in paths that `.gitignore` already excludes:

| Path                | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `config/private/*`  | Your `orrery.config.yaml` and query overrides      |
| `.orrery-denylist`  | Terms that must never appear in a contribution     |
| `adapters-private/` | Adapters that only your organization uses          |
| `public/private/`   | Your logo (`logo.svg`, `logo.png`, or `logo.webp`) |

## 1. Create the private repository and keep `upstream`

Clone the public repository under the name `upstream`, create an empty private repository on your
git host, and make that `origin`:

```sh
git clone --origin upstream https://github.com/<public-owner>/orrery.git orrery-private
cd orrery-private
git remote add origin git@git.example.com:platform/orrery-private.git
git push -u origin main
```

`upstream` stays pointed at the public repository and `origin` is private, so a plain
`git push` goes to the private one. To make a stray push to `upstream` fail, disable its push URL:

```sh
git remote set-url --push upstream DISABLED
git remote -v
```

Pull in new upstream work whenever you like:

```sh
git fetch upstream
git merge upstream/main        # or: git rebase upstream/main
```

Because your private material sits in git-ignored paths and new directories, merges rarely
conflict. Keep it that way: add, do not edit.

## 2. Private config in `config/private/`

Put your real configuration in `config/private/`. Start from an example and replace the names:

```sh
cp config/examples/three-env.yaml config/private/orrery.config.yaml
ORRERY_CONFIG=config/private/orrery.config.yaml pnpm dev:server
```

The file describes your topology (matchers, freshness targets), environments, and which adapter
each uses. Credentials never go in it: secret fields accept only `${env:NAME}` references, and
you set those variables in the process environment or your platform's secret store. See
`docs/configuration.md`.

Databricks query overrides also belong here. A same-named `.sql` file replaces a shipped query,
and other valid names are added (`docs/databricks.md`):

```yaml
options:
  sqlDir: config/private/sql
```

Upstream ignores everything in `config/private/` except its README. Leave it that way and keep
these files untracked: store them in your deployment tooling or a separate private
configuration repository. The denylist scan (next step) covers every tracked file, so real names
committed under `config/private/` would fail it. It has no per-path exclusion.

## 3. The denylist

List the organization, site, and host names that must never appear in code, tests, fixtures, docs,
or commit messages. The file is git-ignored, so the list itself never leaves your machine:

```sh
cp .orrery-denylist.example .orrery-denylist
$EDITOR .orrery-denylist      # one term per line, # comments allowed
pnpm check:denylist
```

`pnpm check:denylist` scans every tracked or untracked-but-not-ignored file for each term
(case-insensitive, whole words) and exits 1 with `path:line` for each hit. With no
`.orrery-denylist` it passes and says so. The pre-commit hook in `.githooks/` runs it after
gitleaks on every commit. `pnpm install` points `core.hooksPath` at `.githooks`, so the hook
is on by default, and the hook fails (rather than skipping) when neither gitleaks nor Docker is
available.

The check scans file contents only. It does not scan commit messages or author metadata, so read
those before you push. Git-ignored files, such as `config/private/*` while untracked, are not
scanned.

## 4. Private adapters in `adapters-private/`

An adapter for a system only you use goes in its own package under `adapters-private/`, for
example `adapters-private/orchestrator/`. Register it by name in your config and make the package's
default export an `AdapterFactory`. `docs/adapters.md` walks through the interface, the contract
tests, how to load it from source, and how to include it in the packaged server.

Never edit `packages/core`. If an adapter needs something the core model cannot express, open an
upstream issue or contribution. The one small change a fork usually makes in the app is importing
its adapter in `apps/server/src/registry.ts`, and only for the bundled server.

To have pnpm see the directory, add it to `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - adapters/*
  - adapters-private/*
```

## 5. Look and feel

Everything you can restyle today is a `visuals` key in your config file or in a theme file
(below). The reference in
`docs/configuration.md` lists them all:

- `visuals.colors` (tier plaque and band colors by tier id, bronze, silver, gold, workload and
  alert colors)
- `visuals.workloads` (replace the seven default workloads: name, vehicle, color)
- `visuals.world`, `freshnessOrbit`, `planetSize`, `orbitSpeed` (scene scale and motion)
- `visuals.lighting`, `camera`, `time` (lighting, camera feel, and the clock speed)
- `visuals.orloj` (clock face geometry, breakpoints, and procession)
- `visuals.sizeBy` (what sizes planets: pipelines, products, complexity, or volume)

### Theme overrides in `config/private/theme.yaml`

To keep look-and-feel changes out of your main config, put them in `config/private/theme.yaml`
(or point `ORRERY_THEME` at another file). The file has one top-level key, `visuals`, holding
any part of the visuals block:

```yaml
# config/private/theme.yaml
visuals:
  lighting:
    ambientIntensity: 0.6
  camera:
    fovDeg: 42
  time:
    speeds: [1, 3, 6]
```

At startup the server merges it over the `visuals` of your main config: objects merge key by
key, while arrays and scalars replace the value (so `speeds` above is exactly `[1, 3, 6]`). The
merged result is validated with the same schema as the main config, so a typo or a bad value
stops startup with the file name and the path (for example `visuals.camera.fovDeg`), and an
unknown key is rejected. Any other top-level key in the file is rejected too. The server logs
`theme applied` with the file it used, and `/api/config` returns the merged visuals. With no
theme file nothing changes.

### Logo in `public/private/`

Put a `logo.svg`, `logo.png`, or `logo.webp` in `public/private/` (or set `ORRERY_LOGO` to a
file path). The server serves it at `/branding/logo`, and `/api/config` reports
`branding: { logoUrl }`, which is `"/branding/logo"` when a logo exists and `null` otherwise. The
web app shows it in the header when it is set.

The file must be at most 512 KB and must not be a symlink that leaves its directory, or startup
fails with the reason. SVG logos are served with a `Content-Security-Policy` that disables
scripts, but keep them to plain shapes and text anyway.

The concept-to-scene mapping is data in `packages/core/src/metaphor.ts`, which a fork can restyle
without touching the renderer.

**Not yet supported**

- Private assets in `public/private/` other than the logo.
- `visuals.theme: light`. The key is accepted and validated, but the views are dark in every case.
- Spoke colors. They come from a built-in palette in the renderer, not from config (decision 37).
- Custom fonts. The Cinzel and Barlow web fonts are not bundled yet, so text uses fallback fonts
  (decision 40).
- `product.timezone`. Accepted, but every view uses UTC.

## 6. Contributing upstream from a clean branch

Never contribute from your private `main`. Start from upstream, bring over only the change, and
check it before it leaves your machine:

```sh
git fetch upstream
git switch -c fix/short-description upstream/main
git cherry-pick <commit>        # or: git checkout private-branch -- path/to/file
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm check:spdx \
  && pnpm check:licenses && pnpm check:denylist && pnpm test
git log upstream/main..HEAD --format='%an <%ae>%n%B'    # read for names and emails
```

`.orrery-denylist` is untracked, so it is still in your working tree on this branch, and
`pnpm check:denylist` uses it. It must pass before you push. Push the branch to a public fork of
the project (or to `upstream` if you have write access) and open the pull request from there.

To make the check unskippable, a `pre-push` hook can run it when the destination is the public
repository. This is a suggestion, not something the repository ships:

```sh
#!/bin/sh
# .githooks/pre-push (the hook gets the remote name as $1)
[ "$1" = "upstream" ] || exit 0
node scripts/check-denylist.mjs
```

Contributions follow `CONTRIBUTING.md`: SPDX headers, the dependency license allowlist, and
neutral sample names ("Site 01", "Region A", "Sales").

## 7. License and notices

Keep `LICENSE` and `NOTICE` intact. Apache-2.0 requires you to retain them, and any copyright,
patent, and attribution notices, in what you distribute. State your changes in the files you
modify. If your policy requires it, add your own copyright line to the files you create, below the
SPDX header:

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Example Corp.
```

Keep the SPDX header on every new source file. `pnpm check:spdx` enforces it, and
`pnpm check:licenses` enforces the dependency allowlist (MIT, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, ISC, 0BSD; OFL-1.1 for fonts). Databricks is named only to describe compatibility, and
your fork should not imply that Databricks endorses it.
