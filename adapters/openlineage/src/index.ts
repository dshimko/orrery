// SPDX-License-Identifier: Apache-2.0
// Optional adapter reading OpenLineage run events from a file or a Marquez server.
import type { AdapterFactory } from '@orrery/core';
import { OpenLineageAdapter } from './adapter.js';

export { OpenLineageAdapter, type OpenLineageDeps } from './adapter.js';
export { parseOptions, OpenLineageOptions } from './options.js';
export { parseRunEvents } from './parse.js';
export { MarquezSource, MarquezError } from './marquez.js';

const factory: AdapterFactory = () => new OpenLineageAdapter();
export default factory;
