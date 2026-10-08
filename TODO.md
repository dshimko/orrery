# TODO

Cross-milestone backlog. Each item: where, what, and the fix direction.

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

- **Spoke colors** come from `packages/render/src/scene/palette.ts`. Move them into
  `visuals` config (decision 37).
- **Measure 60 fps on Intel and AMD integrated GPUs** with `ORRERY_PERF=1` (decision 33).
- **Accessibility gate:** decide between a dev-only axe exception (MPL-2.0) and an
  allowlisted alternative before milestone 4 (decision 4).
