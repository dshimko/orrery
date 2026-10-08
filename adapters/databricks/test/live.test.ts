// SPDX-License-Identifier: Apache-2.0
// Live smoke test against a real workspace. Runs only with ORRERY_LIVE=1, ORRERY_CONFIG pointing
// at a config file, and the credentials that config references in the environment. Never prints
// configuration or tokens.
import { readFileSync } from 'node:fs';
import { adapterList, parseConfigOrThrow, type AdapterContext } from '@orrery/core';
import { silentLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { DatabricksAdapter } from '../src/adapter.js';

const configPath = process.env['ORRERY_CONFIG'];
const wanted = process.env['ORRERY_LIVE_ENV'];
const enabled = process.env['ORRERY_LIVE'] === '1' && configPath !== undefined && configPath !== '';

const suite = enabled ? describe : describe.skip;

const clock: AdapterContext['clock'] = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

suite(
  'databricks live smoke (needs ORRERY_LIVE=1, ORRERY_CONFIG, and the credentials it references)',
  () => {
    it('reads topology and a snapshot and both survive a JSON round trip', async () => {
      const config = parseConfigOrThrow(readFileSync(configPath ?? '', 'utf8'), 'ORRERY_CONFIG');
      const env = config.environments.find(
        (candidate) =>
          adapterList(candidate).includes('databricks') && (!wanted || candidate.id === wanted),
      );
      if (!env) throw new Error('No databricks environment found in ORRERY_CONFIG.');
      const adapter = new DatabricksAdapter();
      await adapter.init(env, {
        clock,
        logger: silentLogger,
        env: process.env,
        peers: config.environments,
      });

      try {
        const topology = await adapter.topology();
        const snapshot = await adapter.snapshot();

        expect(topology.envId).toBe(env.id);
        expect(snapshot.spokes.length).toBe(topology.spokes.length);
        expect(JSON.parse(JSON.stringify(topology))).toEqual(topology);
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
      } finally {
        await adapter.dispose();
      }
    }, 120_000);
  },
);
