// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertReadOnly } from '../src/readonly.js';
import { loadQueryRegistry } from '../src/registry.js';

/** One backslash, spelled out so template literals cannot swallow it. */
const BS = '\\';
const DOC = '-- Doc: https://docs.databricks.com/en/admin/system-tables/audit-logs.html\n';

describe('assertReadOnly', () => {
  it('accepts a SELECT and removes one trailing semicolon', () => {
    const sql = `${DOC}SELECT a FROM t WHERE x = :x;\n`;
    expect(assertReadOnly('q', sql)).toBe(`${DOC}SELECT a FROM t WHERE x = :x`);
  });

  it('accepts WITH statements and comments after the semicolon', () => {
    const sql = `${DOC}WITH c AS (SELECT 1) SELECT * FROM c; -- done`;
    expect(() => assertReadOnly('q', sql)).not.toThrow();
  });

  it('accepts forbidden words inside strings, comments, and quoted identifiers', () => {
    const sql = [
      DOC,
      '-- DELETE everything? no, this comment just mentions DROP TABLE\n',
      "SELECT /* INSERT UPDATE */ `delete` AS d, 'it''s a DROP; fine' AS s, \"GRANT\" AS g\n",
      "FROM t WHERE action_name = 'DELETE' AND y = 'a\\'; DROP TABLE x'",
    ].join('');
    expect(() => assertReadOnly('q', sql)).not.toThrow();
  });

  it('does not treat identifiers containing keywords as keywords', () => {
    expect(() =>
      assertReadOnly('q', `${DOC}SELECT use_case, settings, listing FROM t`),
    ).not.toThrow();
  });

  it.each([
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
  ])('rejects %s', (keyword) => {
    expect(() =>
      assertReadOnly('q', `${DOC}SELECT 1 FROM t WHERE ${keyword.toLowerCase()} = 1`),
    ).toThrow(new RegExp(`q: forbidden keyword ${keyword}`));
    expect(() => assertReadOnly('q', `${DOC}${keyword} INTO t VALUES (1)`)).toThrow(/q:/);
  });

  it('rejects multiple statements', () => {
    expect(() => assertReadOnly('q', `${DOC}SELECT 1; SELECT 2`)).toThrow(/only one statement/);
    expect(() => assertReadOnly('q', `${DOC}SELECT 1;;`)).toThrow(/only one statement/);
  });

  it('rejects DML hidden after a comment', () => {
    expect(() => assertReadOnly('q', `${DOC}-- harmless\nDELETE FROM t`)).toThrow(/SELECT or WITH/);
    expect(() => assertReadOnly('q', `${DOC}/* x */ DROP TABLE t`)).toThrow(/SELECT or WITH/);
    expect(() => assertReadOnly('q', `${DOC}SELECT 1 /* ; */ ; DROP TABLE t`)).toThrow(
      /only one statement/,
    );
  });

  it('rejects a missing or malformed Doc comment', () => {
    expect(() => assertReadOnly('q', 'SELECT 1')).toThrow(/Doc/);
    expect(() => assertReadOnly('q', '-- Doc: http://example.com/x\nSELECT 1')).toThrow(/Doc/);
    expect(() => assertReadOnly('q', '-- just a comment\nSELECT 1')).toThrow(/Doc/);
  });

  it('rejects positional placeholders, unterminated literals and comments', () => {
    expect(() => assertReadOnly('q', `${DOC}SELECT 1 WHERE a = ?`)).toThrow(/named/);
    expect(() => assertReadOnly('q', `${DOC}SELECT 'oops`)).toThrow(/unterminated/);
    expect(() => assertReadOnly('q', `${DOC}SELECT 1 /* oops`)).toThrow(/unterminated/);
  });
});

describe('assertReadOnly raw literals and side-effecting functions', () => {
  it('treats raw literals as having no escapes, so a trailing backslash cannot hide a statement', () => {
    const doubled = `${DOC}SELECT r'${BS}${BS}', 'x'; DROP TABLE t; --'`;
    const single = `${DOC}SELECT r'${BS}', 'x'; DROP TABLE t; --'`;
    const upper = `${DOC}SELECT R"${BS}", 'x'; DROP TABLE t; --"`;

    expect(() => assertReadOnly('q', doubled)).toThrow(/q:/);
    expect(() => assertReadOnly('q', single)).toThrow(/only one statement|DROP/);
    expect(() => assertReadOnly('q', upper)).toThrow(/q:/);
  });

  it('still accepts a raw literal and an escaped quote in an ordinary literal', () => {
    expect(() => assertReadOnly('q', `${DOC}SELECT r'a\\d+' AS p, 'it\\'s' AS q`)).not.toThrow();
    expect(() => assertReadOnly('q', `${DOC}SELECT bar'x', 1 AS r FROM t`)).not.toThrow();
  });

  it.each([
    "SELECT http_request(conn => 'c', method => 'POST', path => '/x')",
    "SELECT ai_query('m', 'hello')",
    "SELECT ai_gen('hello')",
    "SELECT * FROM read_files('s3://b/p')",
    "SELECT * FROM read_kafka(bootstrapServers => 'h')",
    'SELECT * FROM read_kinesis(streamName => "s")',
    'SELECT * FROM read_pubsub(topicId => "s")',
    'SELECT * FROM read_pulsar(serviceUrl => "s")',
    "SELECT * FROM read_state_metadata('p')",
    "SELECT * FROM read_statestore('p')",
    "SELECT * FROM cloud_files_state('p')",
    "EXECUTE IMMEDIATE 'DROP TABLE t'",
    'SELECT HTTP_REQUEST(1)',
  ])('rejects %s', (statement) => {
    expect(() => assertReadOnly('q', `${DOC}${statement}`)).toThrow(/q: .*(forbidden|SELECT)/);
  });

  it('does not reject identifiers that merely contain a function name', () => {
    const sql = `${DOC}SELECT my_read_files_count, executed_by FROM t`;

    expect(() => assertReadOnly('q', sql)).not.toThrow();
  });
});

describe('loadQueryRegistry', () => {
  let root: string;
  let shipped: string;
  let override: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orrery-registry-'));
    shipped = join(root, 'shipped');
    override = join(root, 'override');
    await mkdir(shipped);
    await mkdir(override);
    await writeFile(join(shipped, 'alpha.sql'), `${DOC}SELECT 'shipped' AS v;\n`);
    await writeFile(join(shipped, 'beta.sql'), `${DOC}SELECT 2 AS v`);
    await writeFile(join(shipped, 'README.md'), 'not sql');
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('loads the shipped directory', async () => {
    const registry = await loadQueryRegistry({ shippedDir: shipped });
    expect(registry.names()).toEqual(['alpha', 'beta']);
    const query = registry.get('alpha');
    expect(query.name).toBe('alpha');
    expect(query.sql.endsWith(';')).toBe(false);
    expect(query.source).toContain('alpha.sql');
  });

  it('loads the adapter default directory from the module location', async () => {
    const registry = await loadQueryRegistry();
    expect(Array.isArray(registry.names())).toBe(true);
  });

  it('lets an override replace a shipped query and adds fork-registered ones', async () => {
    await writeFile(join(override, 'alpha.sql'), `${DOC}SELECT 'forked' AS v`);
    await writeFile(join(override, 'fork_query.sql'), `${DOC}SELECT 3 AS v`);
    const registry = await loadQueryRegistry({ shippedDir: shipped, overrideDir: override });
    expect(registry.names()).toEqual(['alpha', 'beta', 'fork_query']);
    expect(registry.get('alpha').sql).toContain('forked');
    expect(registry.get('beta').sql).toContain('2 AS v');
  });

  it('throws for names that are not allowlisted', async () => {
    const registry = await loadQueryRegistry({ shippedDir: shipped });
    expect(() => registry.get('gamma')).toThrow(/not in the allowlist/);
    expect(() => registry.get('../alpha')).toThrow(/not in the allowlist/);
  });

  it('rejects invalid file names, naming the file', async () => {
    await writeFile(join(override, 'Bad-Name.sql'), `${DOC}SELECT 1`);
    await expect(loadQueryRegistry({ shippedDir: shipped, overrideDir: override })).rejects.toThrow(
      /Bad-Name\.sql/,
    );
  });

  it('rejects a read-write file, naming the file', async () => {
    await writeFile(join(override, 'evil.sql'), `${DOC}DELETE FROM t`);
    await expect(loadQueryRegistry({ shippedDir: shipped, overrideDir: override })).rejects.toThrow(
      /evil\.sql.*SELECT or WITH/,
    );
  });

  it('rejects symlinks, including ones pointing outside the directory', async () => {
    const outside = join(root, 'outside.sql');
    await writeFile(outside, `${DOC}SELECT 1`);
    await symlink(outside, join(override, 'linked.sql'));
    await expect(loadQueryRegistry({ shippedDir: shipped, overrideDir: override })).rejects.toThrow(
      /linked\.sql.*symlink/,
    );
  });

  it('rejects directories named like queries and oversize files', async () => {
    await mkdir(join(override, 'dir.sql'));
    await expect(loadQueryRegistry({ shippedDir: shipped, overrideDir: override })).rejects.toThrow(
      /dir\.sql/,
    );
    await rm(join(override, 'dir.sql'), { recursive: true });
    await writeFile(join(override, 'big.sql'), `${DOC}SELECT 1 /* ${'x'.repeat(300_000)} */`);
    await expect(loadQueryRegistry({ shippedDir: shipped, overrideDir: override })).rejects.toThrow(
      /too large/,
    );
  });

  it('reports a missing directory', async () => {
    await expect(loadQueryRegistry({ shippedDir: join(root, 'nope') })).rejects.toThrow(
      /cannot be read/,
    );
  });
});
