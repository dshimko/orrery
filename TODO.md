# TODO

Cross-milestone backlog. Each item: where, what, and the fix direction. Items closed in the
post-milestone-7 backlog pass are recorded in `docs/decisions.md` (75–80).

## Blocked on resources this environment does not have

- **Databricks App deploy:** run `deploy/databricks-app/deploy.sh` against a fresh workspace
  (milestone 6 acceptance) and fix anything the README steps miss.
- **Live Databricks smoke test:** `ORRERY_LIVE=1` against a real workspace. Refresh
  `adapters/databricks/test/fixtures` from the recordings and confirm the two unverified
  queries (`catalog_tags`/`schema_tags` columns, the pipeline-expectations VARIANT path).
- **60 fps on Intel and AMD integrated GPUs** with `ORRERY_PERF=1` (decision 33). Only Apple
  silicon has been measured.

## Needs a design decision

- **`dashboardTag`, the job schedule, and promotion events for Databricks:** there is no
  verified system-table source for dashboard tags or the job trigger format. Promotion events
  need a rule for detecting a release in the next environment.
- **Fork adapter package names go straight to `import()`** (`apps/server/src/registry.ts`).
  Config is operator-controlled, so this is acceptable today. Validate names if config ever
  comes from a less-trusted source.

## Open, low priority

- **[LOW] Marquez paging with identical timestamps:** Marquez orders only by `event_time`, so
  events with equal timestamps across a page boundary could repeat or be skipped. It is not
  observed with the seed data, and the adapter cannot add a tiebreaker.
- **[LOW] Orloj calendar:** the day "10" numeral sits close to the center disc on the left; it
  does not collide.
- **[LOW] Reserved config keys** (decision 80): apply them, or remove them in a versioned config
  change.
