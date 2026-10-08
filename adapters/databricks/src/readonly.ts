// SPDX-License-Identifier: Apache-2.0
// Guard for the server-side query allowlist: only single, read-only SELECT/WITH statements run.

const FORBIDDEN_KEYWORDS: readonly string[] = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'OPTIMIZE',
  'VACUUM',
  'CALL',
  'SET',
  'USE',
  'REFRESH',
  'ANALYZE',
  'MSCK',
  'RESTORE',
  'CLONE',
  'REPAIR',
  'PUT',
  'GET',
  'LIST',
  'REMOVE',
  'EXECUTE',
  // Functions with side effects or external reach.
  'http_request',
  'ai_query',
  'ai_gen',
  'read_files',
  'read_kafka',
  'read_kinesis',
  'read_pubsub',
  'read_pulsar',
  'read_state_metadata',
  'read_statestore',
  'cloud_files_state',
];

const FORBIDDEN_PATTERN = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');
const DOC_COMMENT = /^--[ \t]*Doc:[ \t]*https:\/\/docs\.databricks\.com\/\S+/;
const QUOTES: ReadonlySet<string> = new Set(["'", '"', '`']);

/**
 * Replaces comments and the contents of string literals and quoted identifiers with spaces,
 * keeping every character at its original index. Throws on unterminated comments or literals.
 */
function blankCommentsAndLiterals(name: string, sql: string): string {
  const out = sql.split('');
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    const next = sql.charAt(i + 1);
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql.charAt(i) !== '\n') out[i++] = ' ';
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error(`${name}: unterminated block comment.`);
      for (; i < end + 2; i += 1) out[i] = ' ';
    } else if (QUOTES.has(ch)) {
      i = blankQuoted(name, sql, out, i, ch, isRawPrefix(sql, i));
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** True when the quote at `index` opens a raw literal (`r'...'`, `R"..."`): no escapes inside. */
function isRawPrefix(sql: string, index: number): boolean {
  if (index === 0 || sql.charAt(index) === '`') return false;
  if (sql.charAt(index - 1).toLowerCase() !== 'r') return false;
  return index === 1 || !/[A-Za-z0-9_$]/.test(sql.charAt(index - 2));
}

function blankQuoted(
  name: string,
  sql: string,
  out: string[],
  start: number,
  quote: string,
  isRaw: boolean,
): number {
  let i = start + 1;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch === '\\' && quote !== '`' && !isRaw) {
      out[i] = ' ';
      if (i + 1 < sql.length) out[i + 1] = ' ';
      i += 2;
    } else if (ch === quote) {
      if (sql.charAt(i + 1) === quote) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      } else {
        return i + 1;
      }
    } else {
      out[i] = ' ';
      i += 1;
    }
  }
  throw new Error(`${name}: unterminated string literal or quoted identifier.`);
}

/** The `--` comment lines before the first statement line (e.g. SPDX header, Doc URL). */
function leadingComments(sql: string): string[] {
  const lines: string[] = [];
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('--')) break;
    lines.push(line);
  }
  return lines;
}

/**
 * Validates one query file and returns the SQL to execute (trailing semicolon removed).
 * Throws an Error naming the file for any violation. Messages never echo SQL text.
 */
export function assertReadOnly(name: string, sql: string): string {
  if (!leadingComments(sql).some((line) => DOC_COMMENT.test(line))) {
    throw new Error(
      `${name}: the leading comment block must include "-- Doc: https://docs.databricks.com/..." recording the source documentation.`,
    );
  }
  const stripped = blankCommentsAndLiterals(name, sql);
  const body = stripped.trimEnd();
  const terminator = body.endsWith(';') ? body.length - 1 : -1;
  const analysed = terminator === -1 ? body : body.slice(0, terminator);
  if (analysed.includes(';')) throw new Error(`${name}: only one statement is allowed.`);
  if (analysed.includes('?')) {
    throw new Error(`${name}: use named :parameters, not positional "?" placeholders.`);
  }
  const keyword = /^\s*([A-Za-z]+)/.exec(analysed)?.[1]?.toUpperCase();
  if (keyword !== 'SELECT' && keyword !== 'WITH') {
    throw new Error(`${name}: a query must start with SELECT or WITH.`);
  }
  const forbidden = FORBIDDEN_PATTERN.exec(analysed)?.[1];
  if (forbidden !== undefined) {
    throw new Error(`${name}: forbidden keyword ${forbidden.toUpperCase()} in a read-only query.`);
  }
  const executable = terminator === -1 ? sql : sql.slice(0, terminator);
  return executable.trimEnd();
}
