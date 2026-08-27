import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTcx, formatTcxActivityTiming, parseTcxLaps, sanitizeTcx } from './tcx.js';

const fixtureUrl = new URL('../test/fixtures/2026-08-23-run-01.sanitized.tcx', import.meta.url);

function tcx(points) {
  const rows = points.map(({ time, hr }) => `
    <Trackpoint>
      <Time>${time}</Time>
      ${hr === null ? '' : `<HeartRateBpm><Value>${hr}</Value></HeartRateBpm>`}
    </Trackpoint>`).join('');
  return `<TrainingCenterDatabase><Activities><Activity><Lap><Track>${rows}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
}

describe('analyzeTcx', () => {
  it('odtwarza atomowe wyniki biegu z 23.08', () => {
    const source = readFileSync(fixtureUrl, 'utf8');
    const result = analyzeTcx(source, { targetMin: 150, targetMax: 162 });

    expect(result).toMatchObject({
      startedAt: '2000-01-01T00:00:00.000Z',
      timeInTarget: 1169,
      timeAboveTarget: 1376,
      timeBelowTarget: 87,
      analyzedDuration: 2632,
      excludedDuration: 0,
      lapCount: 9,
      trackpointCount: 2641,
      nonPositiveIntervals: 8,
    });
  });

  it('formatuje godzinę pierwszej próbki w jawnej strefie Warszawy', () => {
    expect(formatTcxActivityTiming('2026-08-27T16:05:09.000Z')).toEqual({
      startedAt: '2026-08-27T16:05:09.000Z',
      timeZone: 'Europe/Warsaw',
      localDate: '2026-08-27',
      localTime: '18:05:09',
    });
  });

  it('traktuje 150 i 162 jako domknięte granice', () => {
    const source = tcx([
      { time: '2000-01-01T00:00:00Z', hr: 149 },
      { time: '2000-01-01T00:00:01Z', hr: 150 },
      { time: '2000-01-01T00:00:02Z', hr: 162 },
      { time: '2000-01-01T00:00:03Z', hr: 163 },
      { time: '2000-01-01T00:00:04Z', hr: 150 },
    ]);

    expect(analyzeTcx(source, { targetMin: 150, targetMax: 162 })).toMatchObject({
      timeBelowTarget: 1,
      timeInTarget: 2,
      timeAboveTarget: 1,
      analyzedDuration: 4,
    });
  });

  it('przypisuje odstęp wcześniejszej próbce i nie daje czasu ostatniej', () => {
    const source = tcx([
      { time: '2000-01-01T00:00:00Z', hr: 151 },
      { time: '2000-01-01T00:00:02Z', hr: 180 },
    ]);

    expect(analyzeTcx(source, { targetMin: 150, targetMax: 162 })).toMatchObject({
      timeInTarget: 2,
      timeAboveTarget: 0,
      analyzedDuration: 2,
    });
  });

  it('wyklucza lukę dłuższą niż 5 s i pomija odstęp zerowy', () => {
    const source = tcx([
      { time: '2000-01-01T00:00:00Z', hr: 151 },
      { time: '2000-01-01T00:00:06Z', hr: 151 },
      { time: '2000-01-01T00:00:06Z', hr: 151 },
      { time: '2000-01-01T00:00:07Z', hr: 151 },
    ]);

    expect(analyzeTcx(source, { targetMin: 150, targetMax: 162 })).toMatchObject({
      timeInTarget: 1,
      analyzedDuration: 1,
      excludedDuration: 6,
      excludedGaps: 1,
      nonPositiveIntervals: 1,
    });
  });

  it('odrzuca pusty zakres HR zgodnie z computeExecution', () => {
    const source = tcx([
      { time: '2000-01-01T00:00:00Z', hr: 150 },
      { time: '2000-01-01T00:00:01Z', hr: 150 },
    ]);
    expect(() => analyzeTcx(source, { targetMin: 150, targetMax: 150 }))
      .toThrow('targetMin musi być mniejsze od targetMax');
  });

  it('sanityzuje lokalizację, dystans i prawdziwy czas, zachowując obliczenia', () => {
    const source = readFileSync(fixtureUrl, 'utf8');
    const sanitized = sanitizeTcx(source);

    expect(sanitized).not.toMatch(/Position|Latitude|Longitude|DistanceMeters/i);
    expect(sanitized).not.toContain('2026-08-23');
    expect(parseTcxLaps(sanitized)).toHaveLength(9);
    expect(analyzeTcx(sanitized, { targetMin: 150, targetMax: 162 }))
      .toEqual(analyzeTcx(source, { targetMin: 150, targetMax: 162 }));
  });
});
