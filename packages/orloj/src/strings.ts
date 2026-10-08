// SPDX-License-Identifier: Apache-2.0
// All user-facing Orloj text, in one i18n-ready module. Pass `strings` in OrlojOptions to
// override any key. Values are plain text (never HTML). {placeholders} are filled by `fill()`.
// Wording follows reference/orloj-home.html, so labels, tooltips, annotation, and the web
// legend say the same thing.
import type { SnapshotPart } from '@orrery/core';
import type {
  LegendEntry,
  OrlojFace,
  OrlojPart,
  OrlojStringOverrides,
  OrlojStrings,
} from './types.js';

/** Every part, in teaching order: the legend and annotation numbers follow this order. */
export const ORLOJ_PARTS: readonly OrlojPart[] = [
  'sun-hand',
  'hour-ring',
  'arcs',
  'spokes',
  'moon',
  'star-hand',
  'noon-suns',
  'procession',
  'spend',
  'freshness',
  'incidents',
  'consumers',
  'calendar',
  'rooster',
];

export const ORLOJ_STRINGS: OrlojStrings = {
  howToReadTitle: 'How to read the clock',
  howToReadDismissHint: 'Press ? or Esc to close the labels.',
  legendTitle: 'How to read the clock',
  legendPurpose:
    'An astronomical clock for the data platform. One face per environment, in promotion order: it shows what runs when, how fresh the data is, and whether anything is broken.',
  legendHowToUse:
    'Hover a part for what it is and its current value. Click a face to open its system view. Press ? to label the parts on the first face.',
  wallKey:
    'Sun hand: UTC now. Arcs: scheduled windows. Spokes closer to the hub: fresher data. Star hand: next event. Bell: open incidents.',
  labelSunNow: 'UTC now',
  labelFresher: 'fresher',
  labelNext: 'next',
  tooltipWithValue: '{definition} Now: {value}. Click the face to open the system view.',
  tooltipWithReason: '{definition} {reason} Click the face to open the system view.',
  parts: {
    'sun-hand': {
      name: 'Sun hand',
      short: 'Current UTC time; midnight down, noon up',
      definition: 'Current UTC time on the 24-hour ring. Midnight at the bottom, noon at the top.',
    },
    'hour-ring': {
      name: 'Hour ring',
      short: 'The 24 UTC hours the sun hand travels',
      definition: 'The 24-hour UTC ring the sun hand travels; arcs and ticks sit on it.',
    },
    arcs: {
      name: 'Arcs on the ring',
      short: 'Windows: blue planned, amber warning, red incident',
      definition:
        'Scheduled windows and incidents: blue planned, amber warning, red incident. Silver ticks are transfers to the core.',
    },
    spokes: {
      name: 'Spokes and medallions',
      short: 'Closer to the hub means fresher data',
      definition:
        'Each domain spoke sits on a ray from the hub. Closer to the hub means fresher data; an amber halo means past its freshness target.',
    },
    moon: {
      name: 'Moon',
      short: 'Ingest backlog; full means the yard is full',
      definition: 'Ingest backlog. A full moon means the bronze yard is full.',
    },
    'star-hand': {
      name: 'Star hand',
      short: 'Points at the next scheduled event',
      definition: 'Points at the next scheduled event.',
    },
    'noon-suns': {
      name: 'Small suns',
      short: 'Local noon of each source region and office',
      definition:
        'Local noon for each source region (letters) and office (O1 to O3, ES for the engineering studio).',
    },
    procession: {
      name: 'Procession',
      short: 'Hourly parade of runs, colored by workload',
      definition:
        'At the top of every hour, the apostle windows parade the runs scheduled for that hour, colored by workload.',
    },
    spend: {
      name: 'Coins (spend)',
      short: 'Spend rate; the stack grows with spend',
      definition: 'Coins: spend rate (the stack grows with spend).',
    },
    freshness: {
      name: 'Hourglass (freshness)',
      short: 'Spokes past target; amber when any are late',
      definition: 'Hourglass: spokes past freshness target (amber when any are late).',
    },
    incidents: {
      name: 'Bell (incidents)',
      short: 'Open incidents; red or amber when ringing',
      definition: 'Bell: open incidents (swings and turns red or amber).',
    },
    consumers: {
      name: 'Eye (consumers)',
      short: 'Consumer activity; the pupil widens with reads',
      definition: 'Eye: consumer activity (the pupil widens with reads).',
    },
    calendar: {
      name: 'Calendar dial',
      short: 'Releases per day; dots promotions; gold month-end',
      definition:
        'Releases per day this month; dots are promotions, the gold mark is month-end close.',
    },
    rooster: {
      name: 'Rooster',
      short: 'Crows after a day with no red incident',
      definition: 'Crows just after midnight when the day passed without a red incident.',
    },
  },
  unavailable: {
    schedule: 'No schedule data from this adapter.',
    calendar: 'No release calendar from this adapter.',
    spend: 'No spend data from this adapter.',
    backlog: 'No ingest backlog data from this adapter.',
    consumers: 'No consumer activity data from this adapter.',
  },
  hit: {
    sunHandTitle: 'Sun hand: current UTC time',
    sunHandValue: '{time}',
    moonTitle: 'Moon: ingest backlog',
    moonValue: '{percent}% of the bronze yard in use',
    starHandTitle: 'Next scheduled',
    starHandValue: '{label}',
    spokeTitle: '{name}{suffix}',
    spokeIngestSuffix: ' (ingest spoke)',
    spokeValue:
      'data age {age} against a {target} target{pastTarget}; {pipelines} pipelines, {products} products{secondary}',
    spokePastTarget: ', past target',
    spokeSecondary: ', secondary metastore',
    noonTitle: '{name} local noon',
    noonValue: '{text}',
    processionTitle: 'Hourly procession',
    processionRelease: 'Release figure: {reason}',
    spendTitle: 'Spend rate',
    spendValue: '{spend} compute units per hour at current activity',
    freshnessTitle: 'Freshness',
    freshnessValue: '{late} of {total} spokes past their freshness target',
    incidentsTitle: 'Incidents',
    incidentsNone: 'No open incidents. The bell rings when one opens',
    incidentsCount: '{count} open incidents',
    consumersTitle: 'Consumers',
    consumersValue: '{percent}% of peak use-case activity across offices',
    calendarTitle: 'Release calendar',
    calendarValue: '{releases} releases and {promotions} promotions so far this month',
    roosterTitle: 'Rooster',
    roosterCrowing: 'crowing, because yesterday passed without a red incident',
    roosterQuiet: 'quiet',
    plaqueDefinition: 'The environment name and its tier.',
    plaqueValue: 'tier {tier}',
    hubTitle: '{name}',
    hubText: 'Hub of the {env} system with {products} data products.',
    dayTitle: 'Day {day}{today}',
    dayToday: ' (today)',
    dayPast: '{releases} releases',
    dayPlanned: 'Planned',
    dayPromotion: ', promotion',
    dayMonthEnd: '. Month-end close.',
    errorTitle: 'No data for this environment',
  },
  model: {
    utc: 'UTC',
    ageMinutes: '{n} min',
    ageHours: '{n} h',
    ageDays: '{n} d',
    noData: 'No data is available for this environment yet.',
    defaultHubName: 'Hub',
    nothingScheduled: 'Nothing scheduled',
    severityIncident: 'Incident',
    severityWarning: 'Warning',
    severityPlanned: 'Planned',
    kindTransfer: 'transfer',
    kindRelease: 'release',
    kindScripted: 'scheduled event',
    arcFallback: '{severity} {kind}.',
    arcTitle: '{title} {start} to {end}',
    tickText: '{time} {utc}: consolidated silver moves from the ingest spoke to the core.',
    starLabel: '{title} at {time} {utc}',
    noonText: '{time} {utc}. Local time now {local}.',
    officeCode: 'O{n}',
    studioCode: 'ES',
    processionText: '{count} scheduled runs this hour: {mix}. They parade at the top of each hour.',
  },
  canvas: {
    calendarReleases: 'releases',
    calendarMonth: 'this month',
    calendarTitle: 'Release calendar',
    calendarNext: 'Next: {text}',
    roosterCrowing: 'Day closed clean',
    errorTitle: 'No data',
    figureSpend: 'spend per hour',
    figureFreshness: 'past target',
    figureIncidents: 'incidents',
    figureConsumers: 'consumer activity',
  },
  aria: {
    prefix: 'Orloj clock view, one clock face per environment.',
    noEnvironments: 'No environments.',
    faceNoData: '{name}: no data',
    face: '{name}: {incidents}, {spokes} past target',
    incidentOne: '{n} open incident',
    incidentMany: '{n} open incidents',
    spokeOne: '{n} spoke',
    spokeMany: '{n} spokes',
    summary: '{prefix} {faces}.',
    faceSeparator: '. ',
  },
};

/** Replaces each `{key}` with its value; a placeholder with no value is left visible. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

/** The defaults with `overrides` merged over them, one nested key at a time. */
export function resolveStrings(overrides?: OrlojStringOverrides): OrlojStrings {
  if (!overrides) return ORLOJ_STRINGS;
  const parts = Object.fromEntries(
    ORLOJ_PARTS.map((part) => [part, { ...ORLOJ_STRINGS.parts[part], ...overrides.parts?.[part] }]),
  ) as OrlojStrings['parts'];
  return {
    ...ORLOJ_STRINGS,
    ...definedOnly(overrides),
    parts,
    unavailable: { ...ORLOJ_STRINGS.unavailable, ...overrides.unavailable },
    hit: { ...ORLOJ_STRINGS.hit, ...overrides.hit },
    model: { ...ORLOJ_STRINGS.model, ...overrides.model },
    canvas: { ...ORLOJ_STRINGS.canvas, ...overrides.canvas },
    aria: { ...ORLOJ_STRINGS.aria, ...overrides.aria },
  };
}

function definedOnly(overrides: OrlojStringOverrides): Partial<OrlojStrings> {
  const {
    parts: _parts,
    unavailable: _unavailable,
    hit: _hit,
    model: _model,
    canvas: _canvas,
    aria: _aria,
    ...flat
  } = overrides;
  return Object.fromEntries(
    Object.entries(flat).filter(([, value]) => value !== undefined),
  ) as Partial<OrlojStrings>;
}

/** The snapshot source behind a part, for parts an adapter may be unable to supply. */
const PART_SOURCE: Readonly<Partial<Record<OrlojPart, SnapshotPart>>> = {
  arcs: 'schedule',
  'star-hand': 'schedule',
  calendar: 'calendar',
  spend: 'spend',
  moon: 'backlog',
  consumers: 'consumers',
};

export function partSource(part: OrlojPart): SnapshotPart | undefined {
  return PART_SOURCE[part];
}

/** The reason a source is unavailable, or undefined when it has data. Falls back to the default. */
export function unavailableReason(
  unavailable: Partial<Record<SnapshotPart, string>> | undefined,
  source: SnapshotPart,
  strings: OrlojStrings,
): string | undefined {
  const reason = unavailable?.[source];
  if (reason === undefined) return undefined;
  return reason.trim() === '' ? strings.unavailable[source] : reason;
}

/**
 * One legend entry per part, numbered in teaching order. A part gets `unavailableReason` only
 * when every loaded face (no error, with a snapshot) lacks its source; one face with data
 * keeps it available.
 */
export function legendEntries(
  faces: readonly OrlojFace[],
  overrides?: OrlojStringOverrides,
): LegendEntry[] {
  const strings = resolveStrings(overrides);
  const loaded = faces.filter((f) => !f.error && f.snapshot !== null);
  return ORLOJ_PARTS.map((part, index) => {
    const entry: LegendEntry = {
      part,
      number: index + 1,
      name: strings.parts[part].name,
      definition: strings.parts[part].definition,
    };
    const source = partSource(part);
    if (source === undefined || loaded.length === 0) return entry;
    const reasons = loaded.map((f) => unavailableReason(f.snapshot?.unavailable, source, strings));
    const first = reasons[0];
    return first !== undefined && reasons.every((r) => r !== undefined)
      ? { ...entry, unavailableReason: first }
      : entry;
  });
}
