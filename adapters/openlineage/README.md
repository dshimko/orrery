# OpenLineage adapter

`@orrery/adapter-openlineage` (`adapter: openlineage`) renders [OpenLineage](https://openlineage.io/)
`RunEvent`s as a solar system, so Orrery also works outside Databricks. It is read-only: it reads a
file once, or sends `GET` requests to a Marquez server, and never writes anywhere.

Try it: `ORRERY_CONFIG=config/examples/openlineage.yaml pnpm dev:server` (or the same file from a
packaged app). It renders the public Marquez seed events in `samples/` (see `samples/README.md`
for provenance and license).

## Options

`options` is validated strictly; unknown keys are errors.

```yaml
environments:
  - id: sample
    adapter: openlineage
    options:
      source:
        kind: file
        path: adapters/openlineage/samples/metadata.json # relative to the working directory
      replay: { period: hour } # optional, file sources only
```

```yaml
options:
  source:
    kind: marquez
    url: https://marquez.example.org # https; http only for localhost, 127.0.0.1, [::1]
    namespace: food_delivery # optional: only events of jobs in this namespace
    apiKey: '${env:MARQUEZ_API_KEY}' # optional bearer token, an env reference only
```

**File source.** A JSON array of RunEvents, or one JSON event per line. The file is read once at
start (50 MB limit). Entries that are not RunEvents are skipped and reported in health with their
line or item number (never their content). A file with no valid event fails the environment.

**Marquez source.** Only `GET /api/v1/events/lineage` is called (`sortDirection`, `after`,
`before`, `limit`, `offset`; response `{ events, totalCount }`, from Marquez's `spec/openapi.yml`).
Requests time out after 15 s, do not follow redirects, read at most 25 pages of 200 events (a
truncated read is reported in health, and the oldest events are the ones left out), and cache for
30 s. The bearer key comes from the environment and never appears in errors or logs. Topology is
discovered from the last 7 days and refreshed hourly. Live mode polls every 30 s, re-reading a
10-minute overlap, and de-duplicates by (runId, eventType, eventTime).

**Replay (file sources only).** The sample's events are historical. By default the whole sample
repeats every day, so a snapshot or event window at any time shows the same scene as the sample
day. `replay.period: hour` repeats it every hour (the demo config does, so the scene never goes
quiet). `replay.anchor` (an ISO time) moves the sample's earliest event to that instant before
repeating, which sets the time of day the burst happens. `replay: false` serves the events at their
recorded times. Each repetition `k` keeps a run's events together and gets run id `<runId>@<k>`.
Replay never applies to Marquez, whose events are real.

## Mapping

Matchers in the topology decide where each thing belongs. All clauses of a matcher must match.

| Matcher                        | Matches                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `catalog`                      | glob on the **namespace** of a dataset (or job)                                                                            |
| `schema`                       | glob on the dataset **name**, or on its **first dotted segment** (`public` matches `public.menus`); on a job, its name     |
| `tag`                          | the dataset's `tags` facet (`[{ key, value }]`); on a job, its job tags                                                    |
| `jobTag`, `pipelineTag`        | the job's `tags` facet and `jobType` facet (`processingType`, `integration`, `jobType`); for a dataset, its producing jobs |
| `sqlPredicate`, `dashboardTag` | **never match** (run events cannot answer them); reported in health as `degraded`                                          |

- **Spokes.** A dataset belongs to the first spoke whose matcher accepts it. Domain spokes are
  tried first (in config order), then ingest spokes, so an ingest spoke is the catch-all for the
  rest of its namespace. Spoke metrics: `pipelines` is the number of jobs writing it, `products`
  its datasets, `complexity` is logarithmic in both, `volume` is 0 (events carry no sizes).
- **Hub.** A dataset no spoke accepts that another job reads is a hub dataset; a run writing one
  from an ingest spoke draws a `transfer`. Other unmatched datasets are ignored.
- **Source groups.** The external sources of a run are its inputs that no observed job produces
  or, when it reads nothing, the job itself (an extract job). The first group whose matcher
  accepts a source gets it as a site (the dataset or job name; at most 8 per group, the first
  8 by name). A source first seen after discovery maps onto a listed site by hash.
- **Use cases.** Sink jobs (no output, or outputs nobody reads) are matched by the use case's
  `match` (a job name or namespace is what `schema` and `catalog` test). `reads` is the spokes of
  the job's inputs (its outputs if it has none). No match leaves `reads: []` and is reported.

### Runs to events

| Run                                                        | Event                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `COMPLETE`, writes an ingest spoke, from a source group    | `source.batch` (`size` is 1 to 4: one pod, plus one per 5 minutes of run)   |
| same, job type `STREAMING`                                 | `source.stream` on every `START`, `RUNNING`, and `COMPLETE`                 |
| `COMPLETE`, writes an ingest spoke, from anywhere else     | `transfer` (ingest to hub)                                                  |
| `COMPLETE`, writes a domain spoke, reads elsewhere         | `copy` (hub to spoke)                                                       |
| `COMPLETE`, writes a domain spoke and reads that spoke too | `product.publish` (spoke to hub)                                            |
| `COMPLETE`, writes hub datasets only                       | `transfer` from the ingest spoke it reads                                   |
| `COMPLETE` of a sink job                                   | `serve.read` per matching use case and spoke read                           |
| `FAIL` or `ABORT`                                          | `alert.open` (`incident` if the job writes an ingest spoke, else `warning`) |
| `FAIL` or `ABORT`, writes an ingest spoke                  | also `ingest.gate` with `reject`                                            |
| next `COMPLETE` of the same job                            | `alert.close`                                                               |
| a spoke refreshed (completion of a run writing it)         | `freshness.change`, age 0                                                   |
| a spoke not refreshed within target x 1.03                 | `freshness.change`, past target                                             |

Event times are the run's own times, never the clock, so any split of a window gives the same
events. There are no `ml.run`, `deploy`, `promotion`, or `federation.query` events.

### Snapshot

- **Freshness** is the minutes since the latest completion of a run writing a dataset in the spoke
  (for streaming jobs, the latest event). A spoke with none in the lookback (2 days, longer for
  longer targets, at most 7) reports 7 days, past target. Past target means age above target x 1.03.
- **Activity** counts runs in the last hour: a running run (latest event under 90 minutes old) is
  1, a completion is 0.5, and 3 is full. Source groups, spokes, and workloads work the same way;
  the hub adds hub-dataset runs to the mean of its spokes; use cases count sink completions
  (2 per hour is full).
- **Counts:** running runs, failed and aborted runs in the last 24 hours, spokes past target,
  open incidents. `deploysToday` is 0.
- **Alerts** are those the stream has opened and not closed, for up to 24 hours.
- **Not available from run events, so fixed:** `schedule: []`, `spendPerHour: 0`, and a calendar
  with zero releases and no promotions (days are numbered and `monthEndClose` is set).

## Files

`src/options.ts` (options schema), `parse.ts` and `file-source.ts` (events in), `marquez.ts`,
`replay.ts` and `file-events.ts` (event sources), `runs.ts`, `matchers.ts`, `model.ts` and
`build-model.ts` (topology), `convert/` (snapshot and events), `live.ts` and `event-store.ts`
(live mode), `adapter.ts`.

## Tests

`pnpm vitest run adapters/openlineage` runs the unit tests and the shared contract suite against
the public sample. No network is used: Marquez is a fake `fetch`.
