// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';

/** Tracked plus untracked-but-not-ignored files, so checks see what a commit would contain. */
export function repoFiles(cwd = process.cwd()) {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  return out.split('\0').filter(Boolean);
}
