// SPDX-License-Identifier: Apache-2.0
import { ConfigError } from '@orrery/core';
import { buildServer } from './app.js';
import { loadConfig, resolveListenOptions } from './config.js';
import { createJsonLogger, errorMessage } from './logger.js';

const FATAL_EXIT_CODE = 1;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(FATAL_EXIT_CODE);
}

async function main(): Promise<void> {
  const logger = createJsonLogger();
  let loaded;
  let listen;
  try {
    loaded = await loadConfig(process.env);
    listen = resolveListenOptions(process.env);
  } catch (error) {
    // ConfigError messages are already formatted with formatIssues.
    return fail(error instanceof ConfigError ? error.message : errorMessage(error));
  }
  if (loaded.isDefault) {
    logger.warn('ORRERY_CONFIG is not set; using the demo config', { config: loaded.source });
  }
  const webDir = process.env.ORRERY_WEB_DIR;
  const app = await buildServer({ config: loaded.config, logger, ...(webDir ? { webDir } : {}) });
  let isStopping = false;
  const stop = (signal: string): void => {
    if (isStopping) {
      logger.warn('second signal; exiting now', { signal });
      process.exit(FATAL_EXIT_CODE);
    }
    isStopping = true;
    logger.info('shutting down', { signal });
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error('shutdown failed', { error: errorMessage(error) });
        process.exit(FATAL_EXIT_CODE);
      },
    );
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  await app.listen(listen);
  logger.info('listening', { host: listen.host, port: listen.port, config: loaded.source });
}

main().catch((error: unknown) => {
  fail(`Failed to start: ${errorMessage(error)}`);
});
