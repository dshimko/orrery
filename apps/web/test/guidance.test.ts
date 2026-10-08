// SPDX-License-Identifier: Apache-2.0
import type { LegendEntry } from '@orrery/orloj';
import { describe, expect, test } from 'vitest';
import {
  HOWTO_STORAGE_KEY,
  type KeyLike,
  type StorageLike,
  initialAnnotation,
  isCloseKey,
  isDismissed,
  isHowToKey,
  legendRows,
  rememberDismissed,
} from '../src/lib/guidance.js';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('first visit and dismissal', () => {
  test('shows on a first visit with empty storage', () => {
    expect(initialAnnotation({}, false, fakeStorage())).toBe(true);
  });

  test('stays off after the dismissal was remembered', () => {
    const storage = fakeStorage();
    expect(rememberDismissed(storage)).toBe(true);
    expect(storage.data[HOWTO_STORAGE_KEY]).toBe('1');
    expect(isDismissed(storage)).toBe(true);
    expect(initialAnnotation({}, false, storage)).toBe(false);
  });

  test('works when storage throws: shows, and remembering reports failure', () => {
    expect(initialAnnotation({}, false, throwingStorage)).toBe(true);
    expect(rememberDismissed(throwingStorage)).toBe(false);
  });

  test('works when storage is unavailable', () => {
    expect(initialAnnotation({}, false, null)).toBe(true);
    expect(rememberDismissed(null)).toBe(false);
  });

  test('howto=1 forces on even after dismissal, howto=0 forces off on a first visit', () => {
    expect(
      initialAnnotation({ howto: '1' }, false, fakeStorage({ [HOWTO_STORAGE_KEY]: '1' })),
    ).toBe(true);
    expect(initialAnnotation({ howto: '0' }, false, fakeStorage())).toBe(false);
  });

  test('wall mode never shows annotation, even when forced', () => {
    expect(initialAnnotation({ howto: '1' }, true, fakeStorage())).toBe(false);
    expect(initialAnnotation({}, true, fakeStorage())).toBe(false);
  });
});

function key(overrides: Partial<KeyLike>): KeyLike {
  return { key: '?', ctrlKey: false, metaKey: false, altKey: false, target: null, ...overrides };
}

describe('key handling', () => {
  test('? toggles from the page and from a button', () => {
    expect(isHowToKey(key({}))).toBe(true);
    expect(isHowToKey(key({ target: { tagName: 'BUTTON' } }))).toBe(true);
  });

  test.each(['INPUT', 'SELECT', 'TEXTAREA', 'input'])('? is ignored in a %s', (tagName) => {
    expect(isHowToKey(key({ target: { tagName } }))).toBe(false);
  });

  test('? is ignored in a contenteditable element', () => {
    expect(isHowToKey(key({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
  });

  test.each(['ctrlKey', 'metaKey', 'altKey'] as const)('? is ignored with %s held', (modifier) => {
    expect(isHowToKey(key({ [modifier]: true }))).toBe(false);
  });

  test('other keys do not toggle', () => {
    expect(isHowToKey(key({ key: '/' }))).toBe(false);
  });

  test('Escape closes only when on and not typing', () => {
    expect(isCloseKey(key({ key: 'Escape' }), true)).toBe(true);
    expect(isCloseKey(key({ key: 'Escape' }), false)).toBe(false);
    expect(isCloseKey(key({ key: 'Escape', target: { tagName: 'INPUT' } }), true)).toBe(false);
    expect(isCloseKey(key({ key: 'Enter' }), true)).toBe(false);
  });
});

describe('legendRows', () => {
  const entries: LegendEntry[] = [
    { part: 'sun-hand', number: 1, name: 'Sun hand', definition: 'Now.' },
    {
      part: 'spend',
      number: 9,
      name: 'Spend',
      definition: 'Cost.',
      unavailableReason: 'No cost data.',
    },
  ];

  test('keeps order, number, name, and definition', () => {
    const [first] = legendRows(entries);
    expect(first).toEqual({
      part: 'sun-hand',
      number: 1,
      name: 'Sun hand',
      definition: 'Now.',
      reason: null,
    });
  });

  test('shows the reason in place of the definition when unavailable', () => {
    const rows = legendRows(entries);
    expect(rows.map((row) => row.number)).toEqual([1, 9]);
    expect(rows[1]).toMatchObject({ definition: null, reason: 'No cost data.' });
  });

  test('returns an empty list for no entries', () => {
    expect(legendRows([])).toEqual([]);
  });
});
