import { describe, expect, it } from 'vitest';
import { buildProgressReport, formatProgressPace, formatProgressTime, progressDay } from './progressReport.js';

const run = (date, km = 5, minutes = 35, extra = {}) => ({ date, distanceKm: km, durationMinutes: minutes, type: 'Bieg', name: 'Easy', ...extra });
const report = (sessions, extra = {}) => buildProgressReport({ sessions, now: '2026-09-14', ...extra });
const analyzed = { status: 'over', hrTargetPct: 50, aboveTargetPct: 45 };
const sixEasy = () => ['2026-08-03', '2026-08-05', '2026-08-07', '2026-08-24', '2026-08-26', '2026-08-28']
  .map((date, i) => run(date, 5, i < 3 ? 35 : 33, { hrAvg: 150 + i % 2, execution: analyzed }));

describe('raport progresu EPA', () => {
  it('keeps the ambitious goal with no invented forecast', () => {
    const r = report([run('2026-09-10')]);
    expect(r.target).toMatchObject({ label: '1:30', pace: '4:16/km' });
    expect(r.estimate).toMatchObject({ state: 'missing', predictedSeconds: null, targetGapSeconds: null });
  });
  it('counts the last 14 calendar days relative to today even after a running break', () => {
    const r = report([run('2026-08-01'), run('2026-08-25', 7)]);
    expect(r.history).toMatchObject({ recentKm: 0, recentSessions: 0, previousKm: 7, volumeDeltaPct: -100 });
    expect(r.history.recentFrom).toBe('2026-09-01');
    expect(r.asOf).toBe('2026-09-14');
  });
  it('uses nonoverlapping inclusive calendar boundaries', () => {
    const r = report(['2026-08-01', '2026-08-17', '2026-08-18', '2026-08-31', '2026-09-01', '2026-09-14'].map((d) => run(d)));
    expect(r.history).toMatchObject({ recentKm: 10, previousKm: 10, volumeDeltaPct: 0 });
  });
  it('does not compare a truncated first period as a full 14 days', () => {
    const r = report([run('2026-08-25'), run('2026-08-28'), run('2026-09-12')]);
    expect(r.history).toMatchObject({ completeWindows: false, volumeDeltaPct: null });
  });
  it('handles an empty or invalid clock without fake ratios', () => {
    expect(report([]).history).toMatchObject({ state: 'missing', sessions: 0, longestKm: null, volumeDeltaPct: null });
    expect(report([run('2026-09-01')], { now: new Date(NaN) }).asOf).toBeNull();
  });
  it('does not include planned, future, undated or non-running activities', () => {
    const r = report([run('2026-09-13'), run('2026-09-15'), run('bad'), run('2026-09-12', 50, 60, { type: 'Ride' }), run('2026-09-11', 20, 120, { status: 'PLANNED' })]);
    expect(r.history).toMatchObject({ sessions: 1, km: 5, state: 'partial' });
    expect(r.issues.map(({ reason }) => reason).sort()).toEqual(['future', 'invalid-date', 'not-completed', 'not-run']);
  });
  it.each([null, '', '#N/A', -1, 0, '5–6', 'abc5', true, '1e9'])('keeps a run with invalid distance %s visible as incomplete', (km) => {
    const r = report([run('2026-08-01'), run('2026-09-13', km)]);
    expect(r.history).toMatchObject({ sessions: 2, missingKm: 1, recentMissingKm: 1, volumeDeltaPct: null, state: 'partial' });
  });
  it('deduplicates identical IDs and refuses conflicting IDs without arbitrary row order', () => {
    const a = run('2026-09-13', 5, 35, { id: 'one' });
    expect(report([a, { ...a }]).history.km).toBe(5);
    for (const rows of [[a, { ...a, distanceKm: 7 }], [{ ...a, distanceKm: 7 }, a]]) {
      expect(report(rows).history).toMatchObject({ km: 0, sessions: 0, state: 'partial' });
    }
  });
  it('keeps two different same-day sessions', () => {
    expect(report([run('2026-09-13', 5, 35, { id: 'am' }), run('2026-09-13', 6, 40, { id: 'pm' })]).history.km).toBe(11);
  });
  it('fills chronological weeks including no-entry weeks and marks partial weeks', () => {
    const r = report([run('2026-08-25'), run('2026-09-13', 8)]);
    expect(r.weekly.values.map(({ week, km }) => [week, km])).toEqual([
      ['2026-08-24', 5], ['2026-08-31', 0], ['2026-09-07', 8], ['2026-09-14', 0],
    ]);
    expect(r.weekly.values[1]).toMatchObject({ noEntries: true, partial: false });
    expect(r.weekly.values.at(-1)).toMatchObject({ noEntries: true, partial: true });
  });
  it('shows the six actual easy runs used for the comparison', () => {
    const r = report(sixEasy());
    expect(r.easyTrend).toMatchObject({ state: 'potential-improvement', paceDeltaSeconds: -24 });
    expect(r.easyTrend.first.sessions.map(({ date }) => date)).toEqual(['2026-08-03', '2026-08-05', '2026-08-07']);
    expect(r.easyTrend.recent.sessions).toHaveLength(3);
  });
  it('excludes incompatible distances, mixed workouts, missing and impossible measurements', () => {
    for (const extra of [{ distanceKm: 10 }, { name: 'Easy + przebieżki' }, { hrAvg: 190 }, { hrAvg: 0 }, { durationMinutes: 0 }]) {
      const rows = sixEasy(); Object.assign(rows[0], extra);
      expect(report(rows).easyTrend.state).toBe('missing');
    }
  });
  it('requires the last three easy to be consecutive and fully analyzed', () => {
    const rows = sixEasy();
    expect(report(rows).execution.easyPattern.active).toBe(true);
    rows.at(-1).execution = { status: 'no-data' };
    expect(report(rows).execution.easyPattern).toMatchObject({ active: false, sample: '2/3' });
    rows.at(-1).execution = { status: 'ok', hrTargetPct: 80, aboveTargetPct: 10 };
    expect(report(rows).execution.easyPattern.active).toBe(false);
  });
  it('does not hide a pain observation behind missing-data priorities', () => {
    const r = report([run('2026-09-13', 5, 35, { pain: 4 })]);
    expect(r.priorities.slice(0, 3).some(({ state }) => state === 'REAKCJA')).toBe(true);
  });
  it('retains source age and changes only the target gap when the goal changes', () => {
    const rows = [run('2026-09-10', 10, 45, { name: 'Test 10 km' })];
    const a = report(rows), b = report(rows, { goalId: '1h45' });
    expect(a.estimate).toMatchObject({ state: 'provisional', sourceAgeDays: 4, source: { durationSeconds: 2700 } });
    expect(a.estimate.predictedSeconds).toBe(5957);
    expect(b.estimate.predictedSeconds).toBe(a.estimate.predictedSeconds);
    expect(a.estimate.targetGapSeconds - b.estimate.targetGapSeconds).toBe(900);
  });
  it.each(['Easy 10 km', 'testowanie butów', 'Test butów', 'race pace', 'przed zawodami', 'fastest run'])('does not forecast from %s', (name) => {
    expect(report([run('2026-09-10', 10, 45, { name })]).estimate.state).toBe('missing');
  });
  it('sorts candidate tests by date, ignores later easy and future tests', () => {
    const r = report([run('2026-09-12', 10, 44, { name: 'Zawody' }), run('2026-09-01', 5, 20, { name: 'parkrun' }), run('2026-09-15', 10, 35, { name: 'Test' }), run('2026-09-13')]);
    expect(r.estimate.source.date).toBe('2026-09-12');
  });
  it('rounds time and pace with proper minute carry, preserving missing values', () => {
    expect(formatProgressPace(359.9)).toBe('6:00/km');
    expect(formatProgressTime(3599.9)).toBe('1:00:00');
    expect(formatProgressTime(null)).toBe('—');
    expect(formatProgressPace(0)).toBe('—');
  });
  it('uses local calendar day numbers across DST', () => {
    expect(progressDay(new Date(2026, 9, 26)) - progressDay(new Date(2026, 9, 24))).toBe(2);
  });
});
