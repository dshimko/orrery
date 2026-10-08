// SPDX-License-Identifier: Apache-2.0
export { ConfigError, formatIssues, type ConfigIssue } from './errors.js';
export { BUILTIN_ADAPTERS, adapterList, type Environment } from './environment.js';
export { CONFIG_SCHEMA_ID, configJsonSchema } from './json-schema.js';
export {
  parseConfig,
  parseConfigOrThrow,
  validateConfig,
  type ConfigResult,
  type OrreryConfig,
  type ResolvedEnvironment,
} from './load.js';
export { mergeById, resolveTopology } from './resolve.js';
export { OrreryConfigInput } from './root.js';
export { envRefName, suggestKey } from './strict.js';
export { Topology, type Matcher } from './topology.js';
export { DEFAULT_WORKLOADS, type Visuals, type Workload } from './visuals.js';
