// SPDX-License-Identifier: Apache-2.0
import type { Logger } from '@orrery/core';

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Text sink; defaults to stderr so stdout stays free for the process owner. */
export type LogSink = (line: string) => void;

const stderrSink: LogSink = (line) => {
  process.stderr.write(line);
};

/** Reduces any thrown value to a message, with no stack and no extra properties. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON-lines logger. Callers pass only non-secret context. */
export function createJsonLogger(sink: LogSink = stderrSink): Logger {
  const write =
    (level: Level) =>
    (message: string, context?: Record<string, unknown>): void => {
      sink(
        `${JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...context })}\n`,
      );
    };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
