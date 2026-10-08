// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readEventsFile } from '../src/file-source.js';
import { describeProblems, normalizeEvent, parseRunEvents } from '../src/parse.js';
import { MIN, T0, dataset, ev, wire } from './helpers.js';

const complete = wire(
  ev({ type: 'COMPLETE', atMin: 5, run: 'r1', job: 'j', outputs: [dataset('raw.a')] }),
);
const start = wire(
  ev({ type: 'START', atMin: 0, run: 'r1', job: 'j', inputs: [dataset('x', 'ext')] }),
);

describe('parseRunEvents', () => {
  it('reads a JSON array', () => {
    const result = parseRunEvents(JSON.stringify([start, complete]));
    expect(result.skipped).toBe(0);
    expect(result.events.map((e) => [e.eventType, e.timeMs])).toEqual([
      ['START', T0],
      ['COMPLETE', T0 + 5 * MIN],
    ]);
    expect(result.events[0]?.inputs[0]).toEqual({ namespace: 'ext', name: 'x', tags: {} });
  });

  it('reads newline-delimited JSON, with CRLF and blank lines', () => {
    const text = `${JSON.stringify(start)}\r\n\r\n${JSON.stringify(complete)}\n`;
    expect(parseRunEvents(text).events).toHaveLength(2);
  });

  it('reports malformed lines by number, without their content', () => {
    const text = [
      JSON.stringify(start),
      '{"secret": "hunter2"',
      '',
      JSON.stringify(complete),
      'nope',
    ].join('\n');
    const result = parseRunEvents(text);
    expect(result.events).toHaveLength(2);
    expect(result.skipped).toBe(2);
    expect(result.problems).toEqual(['line 2: not valid JSON', 'line 5: not valid JSON']);
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('reports invalid array items by position', () => {
    const result = parseRunEvents(JSON.stringify([start, { eventTime: 'x' }, 7, complete]));
    expect(result.events).toHaveLength(2);
    expect(result.problems).toEqual([
      'item 2: not a RunEvent (no run)',
      'item 3: invalid RunEvent at event',
    ]);
  });

  it('skips dataset and job events, which have no run', () => {
    const jobEvent = { eventTime: '2026-01-01T00:00:00Z', job: { namespace: 'n', name: 'j' } };
    expect(parseRunEvents(JSON.stringify([jobEvent])).problems).toEqual([
      'item 1: not a RunEvent (no run)',
    ]);
  });

  it('rejects an invalid eventTime and names the field that failed validation', () => {
    expect(normalizeEvent({ ...start, eventTime: 'yesterday' })).toBe('invalid eventTime');
    expect(normalizeEvent({ ...start, run: { runId: '' } })).toBe('invalid RunEvent at run.runId');
  });

  it('treats a missing or unknown event type as OTHER and is case-insensitive', () => {
    const { eventType: _type, ...untyped } = start;
    const types = parseRunEvents(
      JSON.stringify([untyped, { ...start, eventType: 'weird' }]),
    ).events;
    expect(types.map((e) => e.eventType)).toEqual(['OTHER', 'OTHER']);
    expect(normalizeEvent({ ...start, eventType: 'complete' })).toMatchObject({
      eventType: 'COMPLETE',
    });
  });

  it('reads tags and the job type from facets', () => {
    const event = normalizeEvent({
      ...start,
      job: {
        namespace: 'n',
        name: 'j',
        facets: {
          tags: { tags: [{ key: 'team', value: 'a' }, { key: 'empty' }, 'junk', null] },
          jobType: { processingType: 'STREAMING', integration: 'FLINK', jobType: 'JOB', other: 1 },
        },
      },
      inputs: [
        { namespace: 'n', name: 'd', facets: { tags: { tags: [{ key: 'tier', value: 'raw' }] } } },
      ],
    });
    expect(event).toMatchObject({
      job: {
        tags: {
          team: 'a',
          empty: '',
          processingType: 'STREAMING',
          integration: 'FLINK',
          jobType: 'JOB',
        },
        streaming: true,
      },
      inputs: [{ tags: { tier: 'raw' } }],
    });
  });

  it('ignores a malformed tags facet', () => {
    const event = normalizeEvent({
      ...start,
      job: { namespace: 'n', name: 'j', facets: { tags: 5, jobType: 'x' } },
    });
    expect(event).toMatchObject({ job: { tags: {}, streaming: false } });
  });

  it('throws for a document that starts like an array but is not JSON, without its content', () => {
    expect(() => parseRunEvents('[ "secret", ')).toThrow('The content is not valid JSON.');
    expect(() => parseRunEvents('[ "secret", ')).not.toThrow(/secret/);
  });

  it('throws when a JSON array is expected but the content decodes to something else', () => {
    expect(() => parseRunEvents('[1,2')).toThrow('The content is not valid JSON.');
  });

  it('caps reported problems but counts them all', () => {
    const result = parseRunEvents(Array.from({ length: 30 }, () => 'x').join('\n'));
    expect(result.problems).toHaveLength(20);
    expect(result.skipped).toBe(30);
    expect(describeProblems(result)).toBe(
      'Skipped 30 entries that are not valid RunEvents (first: line 1: not valid JSON).',
    );
  });

  it('has nothing to say when nothing was skipped', () => {
    expect(describeProblems(parseRunEvents(JSON.stringify([start])))).toBeUndefined();
  });
});

describe('readEventsFile', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'orrery-ol-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a file relative to the given directory', async () => {
    await writeFile(path.join(dir, 'a.json'), JSON.stringify([start, complete]));
    const result = await readEventsFile('a.json', dir);
    expect(result.events).toHaveLength(2);
  });

  it('names the file, not its content, when it does not exist', async () => {
    await expect(readEventsFile('missing.json', dir)).rejects.toThrow(
      'Cannot read the OpenLineage events file "missing.json": the file does not exist.',
    );
  });

  it('refuses a file over the size cap without reading it', async () => {
    const big = path.join(dir, 'big.json');
    await writeFile(big, '[]');
    await truncate(big, MAX_FILE_BYTES + 1);
    await expect(readEventsFile('big.json', dir)).rejects.toThrow('50 MB limit');
  });

  it('fails when the file holds no valid events, naming the first problem', async () => {
    await writeFile(path.join(dir, 'bad.ndjson'), 'hunter2\n');
    const error = await readEventsFile('bad.ndjson', dir).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"bad.ndjson"');
    expect((error as Error).message).toContain('line 1: not valid JSON');
    expect((error as Error).message).not.toContain('hunter2');
  });

  it('fails for an empty file and for broken JSON', async () => {
    await writeFile(path.join(dir, 'empty.json'), '\n');
    await expect(readEventsFile('empty.json', dir)).rejects.toThrow('it contains no events.');
    await writeFile(path.join(dir, 'broken.json'), '[{"a":');
    await expect(readEventsFile('broken.json', dir)).rejects.toThrow(
      'The content is not valid JSON.',
    );
  });

  it('reports a directory as a read failure', async () => {
    await expect(readEventsFile('.', dir)).rejects.toThrow(/read failed \(EISDIR\)/);
  });
});
