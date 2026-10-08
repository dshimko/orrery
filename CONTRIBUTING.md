# Contributing

Thanks for helping. Orrery is Apache-2.0, and contributions are accepted under that license.

## Setup

Requirements: Node 20 LTS (see `.nvmrc`), pnpm 10 (`corepack enable`), and
[gitleaks](https://github.com/gitleaks/gitleaks#installing) for the pre-commit hook.

```sh
pnpm install         # also installs the pre-commit hook
pnpm test            # unit tests
pnpm build           # every package and the web app
pnpm test:e2e        # Playwright (run `pnpm exec playwright install chromium` once)
```

## Before you open a pull request

CI runs every gate below and fails on any error. Run the same gates locally:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm check:spdx \
  && pnpm check:licenses && pnpm check:denylist && pnpm test:coverage \
  && pnpm build && pnpm check:size && pnpm test:e2e
```

## Rules

- Every source file starts with `SPDX-License-Identifier: Apache-2.0`.
- Dependencies must be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, or 0BSD; web
  fonts may be OFL-1.1. Check the license before adding anything.
- No organization details: no company or site names, people, real hostnames, workspace ids,
  catalog names, or schemas in code, tests, fixtures, docs, or commit messages. Use neutral
  names such as "Site 01", "Region A", "Sales", "Finance".
- `packages/core` and `packages/render` stay vendor-neutral. Platform specifics belong in an
  adapter.
- Forks: put your organization's terms in `.orrery-denylist` (see `.orrery-denylist.example`),
  and make sure `pnpm check:denylist` passes before pushing upstream.
- Record design decisions and any differences from the spec in `docs/decisions.md`.
