// SPDX-License-Identifier: Apache-2.0
// Guards the one-strings-file rule: user-facing English belongs in src/strings.ts, so a literal
// elsewhere in src that reads like text fails here unless it is a known non-UI literal.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const STRINGS_FILE = 'strings.ts';

/** Non-UI literals that look like text. Keep this short; every entry needs a reason. */
const ALLOWED: readonly { reason: string; test: (value: string) => boolean }[] = [
  { reason: 'CSS color', test: (v) => /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(v) },
  { reason: 'font stack', test: (v) => /^(Cinzel|Barlow),/.test(v) },
  { reason: 'canvas font size unit', test: (v) => /^\s*px\s*$/.test(v) },
  {
    reason: 'Path2D data',
    test: (v) => /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]+$/.test(v) && /^[Mm]/.test(v),
  },
  { reason: 'media query', test: (v) => v === '(prefers-reduced-motion: reduce)' },
  { reason: 'Intl option value', test: (v) => v === '2-digit' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && entry.name !== STRINGS_FILE ? [path] : [];
  });
}

/** True for a literal that reads like words, a capitalized word, or a sentence. */
function looksLikeText(value: string): boolean {
  return (
    /[A-Za-z]{2,}\s+\S/.test(value) ||
    /\s[A-Za-z]{2,}/.test(value) ||
    /^[A-Z][a-z]{2,}/.test(value) ||
    /[A-Za-z]{3,}[.!?]\s*$/.test(value)
  );
}

function literalsOf(path: string): { value: string; line: number }[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: { value: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    const parent = node.parent as ts.Node | undefined;
    const isModuleSpecifier =
      parent !== undefined && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
    if (isText && !isModuleSpecifier) {
      const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      found.push({ value: node.text, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('no hard-coded user-facing text outside strings.ts', () => {
  it('finds no text-like string literals in src', () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      literalsOf(path)
        .filter(({ value }) => looksLikeText(value))
        .filter(({ value }) => !ALLOWED.some((a) => a.test(value)))
        .map(({ value, line }) => `${relative(SRC, path)}:${line} ${JSON.stringify(value)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('recognizes text it must catch and literals it must allow', () => {
    for (const text of ['Day closed clean', 'Hub', 'No data', ' UTC: moves', 'spend per hour']) {
      expect(looksLikeText(text), text).toBe(true);
    }
    for (const id of ['sun-hand', 'calendar-day:', 'coinSide', 'In', 'left', 'timeZoneName']) {
      expect(looksLikeText(id), id).toBe(false);
    }
    expect(ALLOWED.some((a) => a.test('M-14 0v5c0 3 6 5 14 5'))).toBe(true);
    expect(ALLOWED.some((a) => a.test('Day closed clean'))).toBe(false);
  });
});
