// SPDX-License-Identifier: Apache-2.0
// Scans every repo file for terms listed in the git-ignored `.orrery-denylist` (one per line,
// `#` comments allowed). Forks list their own organization and site names there so nothing
// private leaks into upstream contributions. With no denylist file, the check passes.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { repoFiles } from './repo-files.mjs';

export const DENYLIST_FILE = '.orrery-denylist';
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;

/** @param {string} text */
export function parseDenylist(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive whole-word matches of each term, reported with line numbers.
 * @param {string} text
 * @param {string[]} terms
 * @returns {{ term: string, line: number }[]}
 */
export function findTerms(text, terms) {
  const hits = [];
  const patterns = terms.map((term) => ({
    term,
    re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, 'iu'),
  }));
  text.split('\n').forEach((lineText, index) => {
    for (const { term, re } of patterns) {
      if (re.test(lineText)) hits.push({ term, line: index + 1 });
    }
  });
  return hits;
}

function main() {
  if (!existsSync(DENYLIST_FILE)) {
    console.log(`Denylist: no ${DENYLIST_FILE} file, nothing to check`);
    return;
  }
  const terms = parseDenylist(readFileSync(DENYLIST_FILE, 'utf8'));
  const failures = [];
  for (const path of repoFiles()) {
    if (
      path === DENYLIST_FILE ||
      path === `${DENYLIST_FILE}.example` ||
      BINARY.test(path) ||
      !existsSync(path)
    )
      continue;
    for (const hit of findTerms(readFileSync(path, 'utf8'), terms)) {
      failures.push(`${path}:${hit.line}: denylisted term "${hit.term}"`);
    }
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`Denylist: ok (${terms.length} term(s) checked)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
