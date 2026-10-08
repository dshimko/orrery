// SPDX-License-Identifier: Apache-2.0
import type { Logger } from '@orrery/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export type MemoryLogger = Logger & { entries: readonly LogEntry[] };

/** A logger that records every call, for asserting on adapter behaviour. */
export function createMemoryLogger(): MemoryLogger {
  const entries: LogEntry[] = [];
  const record =
    (level: LogLevel) =>
    (message: string, context?: Record<string, unknown>): void => {
      entries.push(context === undefined ? { level, message } : { level, message, context });
    };
  return {
    entries,
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
}

const noop = (): void => undefined;

export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
