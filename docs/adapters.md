# Writing an adapter

An adapter is the only code that talks to a data platform. It runs on the server, turns platform
data into the model in `@orrery/core`, and knows nothing about visuals. The renderer maps events
to vehicles. Three adapters ship: `mock` (`adapters/mock`), `databricks`
(`adapters/databricks`, see `docs/databricks.md`), and `openlineage` (`adapters/openlineage`, see
its `README.md`; it reads OpenLineage run events from a file or a Marquez server).

An adapter is a package that exports an `AdapterFactory` as its default export. Everything below
is exported by `@orrery/core`.

## The interface

```ts
export interface OrreryAdapter {
  readonly id: string;
  init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void>;
  /** Hub, spokes, sources, use cases, metastores, foreign catalogs. */
  topology(): Promise<Topology>;
  /** Activity, freshness, counts, and open alerts at `at` (default: now). */
  snapshot(at?: Date): Promise<Snapshot>;
  /**
   * Events with `since <= ts < until`, in timestamp order. Without `until` the stream is live:
   * it follows the clock until `ctx.signal` or `signal` aborts. `signal` lets a caller (for
   * example a disconnected client) stop the work promptly.
   */
  events(since: Date, until?: Date, signal?: AbortSignal): AsyncIterable<PlatformEvent>;
  health(): Promise<AdapterHealth>;
  dispose(): Promise<void>;
}

export type AdapterFactory = () => OrreryAdapter;

export interface AdapterHealth {
  status: 'ok' | 'degraded' | 'error';
  message?: string;
  /** ISO timestamp of the last successful read. */
  checkedAt: string;
  /** Catalogs in scope of no environment, reported for the home page health check. */
  unmatchedCatalogs?: string[];
}
```

The return types (`Topology`, `Snapshot`, `PlatformEvent`) are in `packages/core/src/model/`.
`env` is a `ResolvedEnvironment`: the environment's config with its topology resolved
(`env.resolvedTopology`), so `extends`, `exclude`, and `overrides` are already applied.

## Lifecycle

1. **Load.** The server creates one adapter instance per environment by calling the factory.
   An environment lists exactly one adapter today; a list of several (composition) is accepted
   by the schema but the server reports "Adapter composition is not supported yet" (decision 34).
2. **`init(env, ctx)`** runs once. The server bounds loading, the factory, and `init` together
   with a 10 s deadline. On timeout or error it aborts the adapter's `ctx.signal`, calls
   `dispose()` (bounded to 2 s), and the environment shows an error face. One failing
   environment never blocks the others. Do no work in the constructor, and prefer lazy queries in
   `init`: the Databricks adapter runs none there, because in on-behalf-of-user mode there is
   no viewer token yet.
3. **`topology()`, `snapshot(at)`, `events(since, until)`** are called by requests, in any order
   and concurrently. Return fresh objects: the mock adapter returns a `structuredClone` of its
   topology so callers cannot mutate shared state.
4. **`health()`** feeds the home page card. The server bounds it to 10 s and caches the result for
   5 s per environment and viewer, so health must be cheap but may do real work. Report
   problems as `status: 'degraded'` (still renders) or `'error'`, never by throwing for expected
   conditions.
5. **`dispose()`** runs on shutdown. It must be safe to call twice. Abort in-flight work and
   timers.

The server accepts an object as an adapter only if `init`, `topology`, `snapshot`, `events`,
`health`, and `dispose` are all functions.

## `AdapterContext`

| Field       | Type                                  | Use                                                                                                                                                                  |
| ----------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clock`     | `Clock` (`now()`, `sleep(ms, sig)`)   | The only source of "now" and of waiting. Tests and replays inject a fixed or scaled clock. Never call `Date.now()` or `setTimeout` for domain time.                  |
| `logger`    | `Logger`                              | `debug`, `info`, `warn`, `error` with an optional context object. Log query names and error codes, never secrets or SQL parameters.                                  |
| `env`       | `Record<string, string \| undefined>` | The process environment, injected. Read secrets (`${env:NAME}` references) and options such as `MOCK_SEED` from here, never from `process.env`.                      |
| `signal`    | `AbortSignal` (optional)              | Aborts on shutdown or init timeout. Stop live streams and polling when it fires.                                                                                     |
| `peers`     | `ResolvedEnvironment[]` (optional)    | Every configured environment, so an adapter can detect catalogs claimed by two environments.                                                                         |
| `userToken` | `() => string \| undefined`           | In on-behalf-of-user mode, the current viewer's forwarded token (undefined outside a request). Key every cache by viewer so results are never shared across viewers. |

## Events

`PlatformEvent` is a discriminated union on `type`. Every event also has `envId` (must equal the
environment id), `ts` (ISO timestamp), and optionally `workload` (an id from `visuals.workloads`)
and `tier` (`bronze`, `silver`, or `gold`). The renderer spawns a vehicle when simulated time
passes an event's `ts`.

| `type`             | Fields                                                                | What it draws                                                            |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `source.stream`    | `sourceGroupId`, `siteId`, `spokeId`                                  | Cyan laser pulse from the site to the ingest spoke                       |
| `source.batch`     | `sourceGroupId`, `siteId`, `spokeId`, `size`                          | Train of `size` bronze cargo pods from the site                          |
| `ingest.gate`      | `spokeId`, `result` (`pass` or `reject`)                              | Crate at the gantry; `reject` adds red sparks                            |
| `transfer`         | `fromSpokeId`, `hubId`                                                | Shuttle docks at the ingest spoke and flies to the hub                   |
| `copy`             | `hubId`, `spokeId`                                                    | Silver copy flying from the hub out to the spoke                         |
| `product.publish`  | `spokeId`, `hubId`                                                    | Gold capsule returning to the hub, where a product satellite pops in     |
| `ml.run`           | `spokeId`                                                             | Magenta orb from the spoke to a station that reads it                    |
| `serve.read`       | `useCaseId`, `spokeId`                                                | Gold pulse from the hub to the use case's station                        |
| `federation.query` | `foreignCatalogId`                                                    | Pulse on a dotted beam to a foreign-catalog comet (nothing is copied)    |
| `deploy`           | `release`, `spokeId?`                                                 | Violet drone from the shipyard, to the spoke when `spokeId` is set       |
| `freshness.change` | `spokeId`, `ageMinutes`, `targetMinutes`, `pastTarget`                | No vehicle. Freshness orbits follow `snapshot()`; keep both consistent   |
| `promotion`        | `release`, `fromEnvId`, `toEnvId`, `status` (`promoted` or `blocked`) | No vehicle today. Carried in the stream for consumers                    |
| `alert.open`       | `alert` (`Alert`)                                                     | No vehicle. Alerts (pillars, flags, lists) come from `snapshot().alerts` |
| `alert.close`      | `alertId`                                                             | No vehicle. Must close an alert that is open at that point               |

`federation.query` is an addition to the spec's list (decision 19). The views refresh the snapshot
about every 5 simulated minutes and after a scrub (decision 36), so what `snapshot(at)` reports
for alerts and freshness must agree with the events.

Every id in an event must exist in `topology()`: sites are in `sourceGroups[].sites`, `hubId` is
the hub's id, and `spokeId`, `useCaseId`, and `foreignCatalogId` come from the matching lists.

## Determinism and bounds

- **Deterministic.** The same configuration, time, and window give the same snapshot and events.
  Screenshots, tests, and replays rely on it. **Never use `Math.random`** (stability rule 5); derive
  randomness from `lcg`, `rand01`, or `hash32` in `@orrery/core`, keyed by the environment seed
  and the object or event. The mock adapter keys its randomness by seed, emitter, and one-minute
  bucket, so any split of a time range yields identical events (decision 27).
- **Ordered and half-open.** `events(since, until)` returns events with `since <= ts < until`
  in timestamp order. Splitting a window in two must give the same events as the whole.
- **Bounded windows.** The server rejects windows over 24 h, caps a response at 50,000 events,
  limits live lookback to 15 minutes, and allows 32 live streams per environment. Do not
  rely on that: yield between batches, cap result sizes, and cache with a TTL.
- **Honor the caller's signal.** Pass the `signal` argument of `events` into everything the
  call starts (queries, sleeps). A disconnected client otherwise leaves work running. A live
  stream also ends when `ctx.signal` aborts or the adapter is disposed.
- **Live mode.** With no `until`, follow `ctx.clock`: emit what happened since the cursor, then
  `await ctx.clock.sleep(ms, signal)` and repeat until aborted. `adapters/mock/src/adapter.ts` is
  a compact example.
- **Read-only.** Never write to the platform. Run only vetted, parameterized statements.
- **JSON safe.** Everything returned is sent to the browser as JSON, so it must survive a JSON
  round trip. No `Date` objects, `undefined` in arrays, `Map`s, or class instances.

## Registering a fork adapter

Name the adapter in config, then use the name on an environment:

```yaml
adapters:
  orchestrator:
    package: '@example/orrery-adapter-orchestrator'

environments:
  - id: prod
    name: Production
    tier: prod
    topology: base
    adapter: orchestrator
    options: # free-form; your adapter validates it
      endpoint: ${env:ORCH_ENDPOINT}
```

The package's **default export** must be an `AdapterFactory`:

```ts
import type { AdapterFactory } from '@orrery/core';
import { MyAdapter } from './adapter.js';

const factory: AdapterFactory = () => new MyAdapter();
export default factory;
```

The server calls `import(package)` at start. A package that cannot be loaded, or whose default
export is not a factory returning an adapter, makes that environment unavailable with
"The <name> adapter could not be loaded." The details go to the server log. `options` is the
one config block the core schema leaves open (decision 13).

Keep private adapters in `adapters-private/` (git-ignored upstream, see `docs/forking.md`) and never
edit `packages/core`.

### Running a fork adapter

The runtime resolves the package name with Node's normal resolution from the server's own files.

- **From source (`pnpm dev:server`, or `node apps/server/dist/main.js`).** Add the adapter
  directory to `pnpm-workspace.yaml` (for example `adapters-private/*`), add it as a dependency
  of `@orrery/server` (`pnpm --filter @orrery/server add @example/orrery-adapter-orchestrator@workspace:*`),
  and build it. Give it the same `exports` shape as the bundled adapters (a `source` condition
  for `src/` and `dist/` as the default) so both modes work.
- **The bundled server (`pnpm package`) loads only adapters that are bundled in.** The packaging
  script bundles `apps/server` with esbuild and does not install or copy fork packages, so a
  name in `adapters:` fails to load there. Two routes:
  1. Import the adapter in `apps/server/src/registry.ts` (next to `MockAdapter` and
     `DatabricksAdapter`) and add a branch to `createAdapter`. This is a small, contained change in
     the app (not in `packages/core`), and the bundler then includes it.
  2. Build your own bundle with the same esbuild options as `scripts/package.mjs`, with your
     entry point importing your adapter.

## Testing: the contract suite

`@orrery/testkit` exports `runAdapterContract`, the suite every adapter must pass. It registers
Vitest tests, so call it at the top level of a `.test.ts` file:

```ts
// adapters-private/orchestrator/test/contract.test.ts
import { readFileSync } from 'node:fs';
import { parseConfigOrThrow } from '@orrery/core';
import { FixedClock, runAdapterContract, silentLogger } from '@orrery/testkit';
import { MyAdapter } from '../src/adapter.js';

const config = parseConfigOrThrow(
  readFileSync('config/examples/demo.yaml', 'utf8'),
  'config/examples/demo.yaml',
);
const env = config.environments.find((candidate) => candidate.id === 'prod');
if (!env) throw new Error('The demo config has no prod environment.');

runAdapterContract(
  'orchestrator',
  async () => {
    const at = new Date('2026-10-07T10:15:00.000Z');
    return {
      adapter: new MyAdapter(), // do not call init: the suite does
      env,
      ctx: { clock: new FixedClock(at), logger: silentLogger, env: {} },
      at,
    };
  },
  { eventWindowMinutes: 120 },
);
```

`setup` runs before every test and returns a fresh adapter, the resolved environment, the
context, and the instant to test at. `loadExampleEnvironment('demo.yaml', 'prod')` is a shortcut
for the bundled examples. For your own config, parse it with `parseConfigOrThrow` as above.
Options: `deterministic` (default `true`; set `false` for an adapter whose data cannot repeat) and
`eventWindowMinutes` (default 60).

The suite checks that the adapter:

- has a non-empty `id` and initializes;
- returns a topology that matches the environment: `envId`, unique spoke ids drawn from
  `env.resolvedTopology`, use-case `reads` that exist, unique site ids, and known metastores;
- returns a snapshot for a given time: `envId`, `at` equal to the requested ISO time, activities in
  0 to 1, non-negative integer counts, unique alert ids, valid severities, and calendar days
  numbered `1..n`;
- uses `ctx.clock` when `snapshot()` has no argument;
- returns ordered events inside the window whose ids exist in the topology, with `envId` set and
  every `alert.close` matching an open alert;
- is deterministic across two instances, and gives the same events for split and whole windows
  (skipped when `deterministic: false`);
- survives a JSON round trip, reports valid health, and disposes twice without error.

`@orrery/testkit` also exports `FixedClock`, `ScaledClock`, `silentLogger`, `createMemoryLogger`
(records calls for assertions), `collect` (drains an async iterable, with an optional limit), and
the individual `check*` functions.

Add your own tests for what the suite cannot know: your matchers, your error handling, and
cancellation (abort the signal and assert that no further work happens).

## Recorded fixtures

Adapters that call a remote service should never need credentials in CI. The Databricks adapter
shows the pattern:

- The adapter takes its collaborators as constructor dependencies (`DatabricksDeps`: the query
  registry, a SQL client factory, a token provider, and a clock), so tests substitute them.
- `adapters/databricks/test/support/fixture-client.ts` defines `FixtureClient`, a `SqlClient`
  that serves recorded rows from `test/fixtures/<scenario>/<query>.json`, records every call
  (query name, parameters, row limit), and can be told to fail chosen queries. It also checks that
  every supplied parameter is referenced and every reference is supplied, like the real API.
- A `FixtureWorld` maps each metastore to a scenario directory, so one test covers several
  metastores. `test/support/env.ts` builds adapters on the real query registry, so the tests also
  prove that every shipped `.sql` file passes the read-only guard.
- `adapters/databricks/test/contract.test.ts` runs `runAdapterContract` against those fixtures.

Fixtures are sample data with neutral names ("Site 01", "Region A", "Sales"). Never record
real catalog, workspace, or host names into them.

> `Snapshot.schedule` is a rolling window: the windows that start within the next 24 hours of `at`, plus any in progress at `at`. Window ids must be unique across days (the mock suffixes the UTC date, as in `qalert@2026-10-08`).
