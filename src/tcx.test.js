import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTcx, analyzeTcxStages, formatTcxActivityTiming, parseTcxLaps, sanitizeTcx } from './tcx.js';

const fixtureUrl = new URL('../test/fixtures/2026-08-23-run-01.sanitized.tcx', import.meta.url);
const progressiveFixtureUrl = new URL('../test/fixtures/2026-08-29-progressive.sanitized.tcx', import.meta.url);
const progressiveStages = {
  schema: 'carlos.hr-target-stages.v1',
  stages: [
    { name: 'WU', durationSeconds: 600, min: 135, max: 145 },
    { name: 'Baza', durationSeconds: 1500, min: 150, max: 165 },
    { name: 'Steady', durationSeconds: 600, min: 166, max: 172 },
    { name: 'Finisz', durationSeconds: 300, min: 173, max: 175 },
    { name: 'CD', durationSeconds: 480, max: 150 },
  ],
};

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

  it('ocenia progresję względem pięciu etapów bez udawania jednego zakresu HR', () => {
    const result = analyzeTcxStages(readFileSync(progressiveFixtureUrl, 'utf8'), progressiveStages);

    expect(result).toMatchObject({
      targetMode: 'staged', plannedDuration: 3480, analyzedDuration: 3480, unmappedDuration: 4,
      timeInTarget: 2669, timeAboveTarget: 590, timeBelowTarget: 221,
      excludedDuration: 0, lapCount: 11, trackpointCount: 3495, nonPositiveIntervals: 10,
    });
    expect(result.stageResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'WU', analyzedDuration: 600, timeInTarget: 399, timeAboveTarget: 166, timeBelowTarget: 35 }),
      expect.objectContaining({ name: 'Baza', analyzedDuration: 1500, timeInTarget: 1284, timeAboveTarget: 169, timeBelowTarget: 47 }),
      expect.objectContaining({ name: 'Finisz', analyzedDuration: 300, timeInTarget: 105, timeAboveTarget: 79, timeBelowTarget: 116 }),
      expect.objectContaining({ name: 'CD', analyzedDuration: 480, timeInTarget: 424, timeAboveTarget: 56, timeBelowTarget: 0 }),
    ]));
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
