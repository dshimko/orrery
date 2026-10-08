# Orrery: working notes

The spec is `docs/BUILD_PROMPT.md`. Deviations and decisions are in `docs/decisions.md`, and
the open backlog is in `TODO.md`. Run every gate before calling a milestone done (see
`CONTRIBUTING.md`).

## Common pitfalls

- **Never use `Math.random`** in the model, adapters, or renderer. Use `lcg` and `rand01` from
  `@orrery/core`, keyed by environment seed and object or event (stability rule 5).
- **Adapters run only on the server.** The browser gets JSON from `apps/server`.
- **Any request can be an amplifier.** Time ranges must be bounded (events ≤ 24 h, live stream
  lookback ≤ 15 min), costs weighted in the rate limiter, and long loops must yield
  (`setImmediate`) and honor socket backpressure. An unbounded `since` once froze the server.
- **Pass the caller's `AbortSignal` into `adapter.events(since, until, signal)`.** Otherwise
  a disconnected client leaves adapter work running.
- **Visual baselines are Linux arm64 only.** Regenerate them with `pnpm test:visual:update`
  (Docker), never on macOS.
- **pnpm and licenses:** check every new dependency against the allowlist. Vite stays
  pinned at 7.3.7 because Vite 8 pulls in MPL-2.0 `lightningcss`.
- **YAML flow maps:** quote `${env:NAME}` inside `{ ... }`, or the file will not parse.
