// SPDX-License-Identifier: Apache-2.0
// Reads a file of RunEvents once, with a size cap.
import { open } from 'node:fs/promises';
import path from 'node:path';
import { parseRunEvents, type ParseResult } from './parse.js';

/** Largest file read, in bytes. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const TOO_LARGE = `it is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`;

/** A problem with the file itself; the message is safe to show. */
class FileProblem extends Error {}

function reasonOf(error: unknown): string {
  if (error instanceof FileProblem) return error.message;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' ? 'the file does not exist.' : `read failed (${code ?? 'error'}).`;
}

async function readText(resolved: string): Promise<string> {
  const handle = await open(resolved, 'r');
  try {
    const { size } = await handle.stat();
    if (size > MAX_FILE_BYTES) throw new FileProblem(TOO_LARGE);
    const text = await handle.readFile({ encoding: 'utf8' });
    if (text.length > MAX_FILE_BYTES) throw new FileProblem(TOO_LARGE);
    return text;
  } finally {
    await handle.close();
  }
}

function parseText(text: string): ParseResult {
  let result: ParseResult;
  try {
    result = parseRunEvents(text);
  } catch (error) {
    throw new FileProblem(error instanceof Error ? error.message : 'It could not be parsed.');
  }
  if (result.events.length > 0) return result;
  throw new FileProblem(
    result.skipped > 0
      ? `none of its ${result.skipped} entries is a valid RunEvent (first: ${result.problems[0] ?? 'unknown'}).`
      : 'it contains no events.',
  );
}

/** Reads and parses `file` (relative to `cwd`). Errors name the file, never its content. */
export async function readEventsFile(file: string, cwd: string): Promise<ParseResult> {
  try {
    return parseText(await readText(path.resolve(cwd, file)));
  } catch (error) {
    throw new Error(`Cannot read the OpenLineage events file "${file}": ${reasonOf(error)}`, {
      cause: error,
    });
  }
}
