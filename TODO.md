# TODO

Cross-milestone backlog. Each item: where, what, and the fix direction.

## From the milestone 5 Databricks review

- **[LOW] Late system-table data in live mode.** A run that lands in the system tables up to an
  hour late does not retract a "past target" freshness event that was already sent
  (`adapters/databricks/src/convert/events.ts` `crossingEvents`). Hold back crossings newer
  than `now - ingestion lag`.
- **[LOW] Degradation notes are shared across viewers in on-behalf-of-user mode.** If one viewer
  lacks access to an optional table, another viewer's health says "degraded"
  (`adapters/databricks/src/sources.ts` `Degradations`). These notes carry only query names and
  error codes. Key them per viewer.

## From the milestone 3 server review

- **[MEDIUM] Rate limits are per environment, not per client.** One client inside the limit
  can cause 429s for other viewers of the same environment (`apps/server/src/rate-limit.ts`,
  `routes/context.ts`). Key buckets by client (IP or session) with a bounded LRU, and keep a
  global cap.
- **[LOW] Malformed URLs bypass the error envelope and security headers.** `GET /%` returns
  Fastify's default 400 body without CSP, nosniff, or referrer headers (`apps/server/src/app.ts`).
  Handle it with Fastify's `frameworkErrors` option, or set the headers in `onSend`.
- **[LOW] Fork adapter package names go straight to `import()`.** `data:` or `file:` URLs
  would execute (`apps/server/src/registry.ts`, `packages/core/src/config/environment.ts`).
  Config is operator-controlled; if that changes, validate it as an npm package name.

## Product follow-ups

- **Databricks gaps (decisions 52 and 53):** `sqlPredicate` matchers (needs a design for safely
  executing config-supplied SQL), `dashboardTag`, the schedule from job triggers, promotion
  events, volume, and passing `promotion.tagKey` to adapters. Run the live smoke test against a
  real workspace and refresh `test/fixtures` from the recordings.
- **Spoke palette is duplicated** in `packages/render/src/scene/palette.ts` and
  `packages/orloj/src/constants.ts`. Move it into core `visuals` config (together with
  decision 37).
- **[LOW] Orloj text polish:** "releases this month" overlaps a calendar numeral, and "spend
  per hour" is clipped by its niche. Bundle Cinzel and Barlow (OFL-1.1) and tune positions.
- **[LOW] Watch the Orloj visual baseline for flakiness.** One of four container runs failed
  (the first one, while Corepack was downloading). Add an app-side "ready" signal if it recurs.
- **Failing-environment faces show a generic message.** Pass the adapter's client-safe health
  message (for example "The databricks adapter is not available yet.") through to the face.
- **Spoke colors** come from `packages/render/src/scene/palette.ts`. Move them into
  `visuals` config (decision 37).
- **Measure 60 fps on Intel and AMD integrated GPUs** with `ORRERY_PERF=1` (decision 33).
