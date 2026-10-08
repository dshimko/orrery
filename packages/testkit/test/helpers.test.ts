// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { collect, createMemoryLogger, loadExampleEnvironment, silentLogger } from '../src/index.js';

describe('collect', () => {
  it('drains a finite source', async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1;
      yield 2;
    }
    await expect(collect(source())).resolves.toEqual([1, 2]);
  });

  it('stops early and closes the iterator at the limit', async () => {
    let closed = false;
    async function* source(): AsyncGenerator<number> {
      try {
        for (let i = 0; ; i++) yield i;
      } finally {
        closed = true;
      }
    }
    await expect(collect(source(), 3)).resolves.toEqual([0, 1, 2]);
    expect(closed).toBe(true);
  });

  it('returns nothing for a zero limit', async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1;
    }
    await expect(collect(source(), 0)).resolves.toEqual([]);
  });
});

describe('loggers', () => {
  it('records entries with and without context', () => {
    const logger = createMemoryLogger();
    logger.info('hello');
    logger.error('bad', { code: 1 });
    expect(logger.entries).toEqual([
      { level: 'info', message: 'hello' },
      { level: 'error', message: 'bad', context: { code: 1 } },
    ]);
  });

  it('silentLogger accepts every level', () => {
    expect(() => {
      silentLogger.debug('a');
      silentLogger.info('a');
      silentLogger.warn('a');
      silentLogger.error('a');
    }).not.toThrow();
  });
});

describe('loadExampleEnvironment', () => {
  it('loads the dev environment from three-env.yaml', () => {
    const env = loadExampleEnvironment('three-env.yaml', 'dev');
    expect(env.id).toBe('dev');
    expect(env.resolvedTopology.spokes.length).toBeGreaterThan(0);
  });

  it('throws listing known ids for an unknown environment', () => {
    expect(() => loadExampleEnvironment('three-env.yaml', 'nope')).toThrow(/dev, stg, prod/);
  });

  it('throws for a missing file', () => {
    expect(() => loadExampleEnvironment('missing.yaml', 'dev')).toThrow();
  });
});
