// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './config.js';
import { ApiError } from './errors.js';

export const DEFAULT_WEB_DIR = path.join(REPO_ROOT, 'apps/web/dist');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface StaticFile {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Decodes the URL path (without query) and rejects anything that could escape the web root. */
function safeRelativePath(rawUrl: string): string {
  const rawPath = rawUrl.split('?')[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new ApiError(400, 'bad_path', 'The request path is malformed.');
  }
  const segments = decoded.split('/');
  if (decoded.includes('\0') || decoded.includes('\\') || segments.includes('..')) {
    throw new ApiError(400, 'bad_path', 'The request path is not allowed.');
  }
  return segments.filter((segment) => segment !== '' && segment !== '.').join('/');
}

async function readIfFile(root: string, relative: string): Promise<Buffer | undefined> {
  try {
    const resolved = await realpath(path.resolve(root, relative));
    if (!isInside(root, resolved)) return undefined;
    return await readFile(resolved);
  } catch {
    // Missing files, directories, and symlinks out of the root all count as not found.
    return undefined;
  }
}

function describe(relative: string, body: Buffer): StaticFile {
  const extension = path.extname(relative).toLowerCase();
  const isIndex = relative === 'index.html';
  return {
    body,
    contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
    cacheControl: isIndex ? 'no-cache' : 'public, max-age=3600',
  };
}

/**
 * Resolves a request URL to a file under `webDir`. Paths without a file extension that match
 * nothing fall back to index.html so client-side routes work; missing assets stay 404.
 * Returns undefined when nothing should be served.
 */
export async function resolveStatic(
  webDir: string,
  rawUrl: string,
): Promise<StaticFile | undefined> {
  const relative = safeRelativePath(rawUrl);
  let root: string;
  try {
    root = await realpath(webDir);
  } catch {
    return undefined;
  }
  if (relative !== '') {
    const body = await readIfFile(root, relative);
    if (body) return describe(relative, body);
    if (path.extname(relative) !== '') return undefined;
  }
  const index = await readIfFile(root, 'index.html');
  return index ? describe('index.html', index) : undefined;
}
