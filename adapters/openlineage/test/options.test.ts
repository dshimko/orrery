// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseOptions, replaySettings } from '../src/options.js';

const file = { kind: 'file', path: 'events.json' };
const marquez = { kind: 'marquez', url: 'https://m.example.org' };

describe('parseOptions', () => {
  it('accepts a file source and a Marquez source', () => {
    expect(parseOptions({ source: file }).source).toEqual(file);
    const parsed = parseOptions({
      source: {
        kind: 'marquez',
        url: 'https://marquez.example.org/api',
        namespace: 'n',
        apiKey: '${env:MARQUEZ_KEY}',
      },
    });
    expect(parsed.source).toMatchObject({ kind: 'marquez', namespace: 'n' });
  });

  it('rejects missing options and unknown keys with a readable message', () => {
    expect(() => parseOptions(undefined)).toThrow(/Invalid openlineage options/);
    expect(() => parseOptions({ source: { ...file, extra: 1 } })).toThrow(/key/i);
    expect(() => parseOptions({ source: file, other: true })).toThrow(
      /Invalid openlineage options/,
    );
    expect(() => parseOptions({ source: { kind: 'kafka' } })).toThrow(
      /Invalid openlineage options/,
    );
  });

  it.each([
    ['http://marquez.example.org', /Use https/],
    ['ftp://example.org', /Use https/],
    ['not a url', /absolute URL/],
    ['https://user:pw@example.org', /credentials/],
    ['https://example.org/?token=1', /query string/],
    ['https://example.org/#x', /query string or fragment/],
  ])('rejects the Marquez URL %s', (url, message) => {
    expect(() => parseOptions({ source: { kind: 'marquez', url } })).toThrow(message);
  });

  it.each(['http://localhost:5000', 'http://127.0.0.1:5000', 'http://[::1]:5000'])(
    'allows plain http for loopback (%s)',
    (url) => {
      expect(parseOptions({ source: { kind: 'marquez', url } }).source).toMatchObject({ url });
    },
  );

  it('rejects a literal API key without echoing it', () => {
    const attempt = (): unknown =>
      parseOptions({ source: { ...marquez, apiKey: 's3cr3t-literal' } });
    expect(attempt).toThrow(/environment reference/);
    expect(attempt).not.toThrow(/s3cr3t-literal/);
  });

  it('accepts replay for files and rejects it for Marquez', () => {
    expect(parseOptions({ source: file, replay: false }).replay).toBe(false);
    expect(
      parseOptions({ source: file, replay: { anchor: '2026-01-01T09:00:00Z', period: 'hour' } })
        .replay,
    ).toEqual({ anchor: '2026-01-01T09:00:00Z', period: 'hour' });
    expect(() => parseOptions({ source: marquez, replay: { period: 'day' } })).toThrow(
      /file sources only/,
    );
    expect(() => parseOptions({ source: file, replay: { anchor: 'soon' } })).toThrow(
      /Invalid openlineage options/,
    );
  });
});

describe('replaySettings', () => {
  it('defaults to a daily replay of the file with no shift', () => {
    expect(replaySettings(parseOptions({ source: file }))).toEqual({
      anchorMs: undefined,
      periodMs: 86_400_000,
    });
  });

  it('honors period and anchor, and turns off with false', () => {
    const options = parseOptions({
      source: file,
      replay: { anchor: '2026-01-01T09:00:00Z', period: 'hour' },
    });
    expect(replaySettings(options)).toEqual({
      anchorMs: Date.parse('2026-01-01T09:00:00Z'),
      periodMs: 3_600_000,
    });
    expect(replaySettings(parseOptions({ source: file, replay: false }))).toBeUndefined();
  });

  it('never replays a Marquez source', () => {
    expect(replaySettings(parseOptions({ source: marquez }))).toBeUndefined();
  });
});
