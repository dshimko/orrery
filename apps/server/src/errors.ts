// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

/** An error that is safe to show to API clients. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Validates request input with zod, turning failures into a 400 that names each bad field. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  where: 'params' | 'query',
): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${[where, ...issue.path.map(String)].join('.')}: ${issue.message}`)
    .join('; ');
  throw new ApiError(400, 'bad_request', details);
}
