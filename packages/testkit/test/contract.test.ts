// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'vitest';

// Gate: adapter contract. The shared suite lands with the adapter interface in milestone 2 and
// runs against every adapter (Databricks with recorded SQL fixtures in milestone 5).
describe('adapter contract', () => {
  it.todo('runs the shared contract suite against the mock adapter');
  it.todo('runs the shared contract suite against the databricks adapter with recorded fixtures');
});
