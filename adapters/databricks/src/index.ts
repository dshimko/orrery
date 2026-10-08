// SPDX-License-Identifier: Apache-2.0
// Server-side Databricks adapter: SQL files, federation modes, auth.
export { DatabricksAdapter, type DatabricksDeps } from './adapter.js';
export { QueryPoller } from './poller.js';
export { QUERY_NAMES, QUERY_SPECS, type QueryName } from './queries.js';
export { loadQueryRegistry } from './registry.js';
export { resolveTargets } from './targets.js';
export { createStatementClient } from './client.js';
export { createTokenProvider } from './auth.js';
export { buildDiscovery, complexityOf, loadInventory } from './discovery/index.js';
export { buildEvents, buildSnapshot, parseEvidence } from './convert/index.js';
export { SqlError } from './contracts.js';
export type {
  AllowedQuery,
  QuerySource,
  Row,
  SqlClient,
  SqlParam,
  Target,
  TokenProvider,
} from './contracts.js';
