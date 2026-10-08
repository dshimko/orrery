// SPDX-License-Identifier: Apache-2.0
// Fork logo: one small image served at /branding/logo and announced through /api/config.
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const LOGO_URL = '/branding/logo';
export const MAX_LOGO_BYTES = 512 * 1024;
/** Scripts in an SVG must not run even if the logo URL is opened directly. */
export const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const DEFAULT_LOGO_DIR = 'public/private';
const LOGO_TYPES: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface Logo {
  body: Buffer;
  contentType: string;
  isSvg: boolean;
  source: string;
}

function isInside(root: string, candidate: string): boolean {
  return candidate.startsWith(root + path.sep);
}

async function findDefaultLogo(cwd: string): Promise<string | undefined> {
  for (const extension of Object.keys(LOGO_TYPES)) {
    const candidate = path.resolve(cwd, DEFAULT_LOGO_DIR, `logo${extension}`);
    try {
      await lstat(candidate);
      return candidate;
    } catch {
      // Not present; try the next format.
    }
  }
  return undefined;
}

async function readLogo(file: string): Promise<Logo> {
  const extension = path.extname(file).toLowerCase();
  const contentType = LOGO_TYPES[extension];
  if (!contentType) {
    throw new Error(`Logo ${file} must be a .svg, .png, or .webp file.`);
  }
  let resolved: string;
  try {
    resolved = await realpath(file);
    const directory = await realpath(path.dirname(file));
    if (!isInside(directory, resolved)) {
      throw new Error(`Logo ${file} is a symlink that points outside its directory.`);
    }
    const stats = await lstat(resolved);
    if (!stats.isFile()) throw new Error(`Logo ${file} is not a regular file.`);
    if (stats.size > MAX_LOGO_BYTES) {
      throw new Error(`Logo ${file} is larger than ${MAX_LOGO_BYTES / 1024} KB.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Logo ')) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`Cannot read logo ${file} (${code}).`, { cause: error });
  }
  const body = await readFile(resolved);
  if (body.length > MAX_LOGO_BYTES) {
    throw new Error(`Logo ${file} is larger than ${MAX_LOGO_BYTES / 1024} KB.`);
  }
  return { body, contentType, isSvg: extension === '.svg', source: file };
}

/**
 * Loads the logo named by `ORRERY_LOGO`, else `public/private/logo.{svg,png,webp}` under the
 * working directory when one exists. Throws when a logo is present but refused (too large,
 * a symlink out of its directory, or the wrong type), so a bad logo fails startup visibly.
 */
export async function loadLogo(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Promise<Logo | undefined> {
  const configured = env.ORRERY_LOGO?.trim();
  const file = configured ? path.resolve(cwd, configured) : await findDefaultLogo(cwd);
  return file ? readLogo(file) : undefined;
}
