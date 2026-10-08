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
- **CI runs Node 20, and a newer local Node can hide breakage.** Check the `engines` field of
  every new tool. size-limit 13 and later need Node 22, so it is pinned at 12.1.0. For a quick
  check, run a gate on Node 20 with `docker run --rm -v "$PWD:/repo:ro" -w /repo
node:20-bookworm-slim node <script>`.
- **CI runners are slower than a laptop.** Tests that fast-forward a clock must take
  timestamps from that clock, and e2e tests wait for `data-ready` signals, not fixed sleeps.
