import { describe, expect, it } from 'vitest';
import { reconcileStravaActivities, STRAVA_RECONCILIATION_CONTRACT } from './stravaReconcile.js';

function activity(overrides = {}) {
  return {
    id: 'strava-1', type: 'Run', sportType: 'Run', startLocal: '2026-08-27T18:55:00Z',
    distanceMeters: 5920, movingSeconds: 2443, ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: '2026-08-27-run-01', type: 'Bieg', date: '2026-08-27', distanceMeters: 5920, durationSeconds: 2444, ...overrides,
  };
}

describe('reconcileStravaActivities', () => {
  it('łączy jednoznaczny bieg po dniu, typie i dystansie', () => {
    const result = reconcileStravaActivities([activity()], [session()]);
    expect(result.summary).toMatchObject({ matched: 1, review: 0, unmatched: 0 });
    expect(result.entries[0]).toMatchObject({ state: 'matched', session: expect.objectContaining({ id: '2026-08-27-run-01' }) });
  });

  it('nie traktuje czasu ruchu jako rozjazdu, jeśli dystans biegu jest zgodny', () => {
    const result = reconcileStravaActivities([activity({ movingSeconds: 2400 })], [session({ durationSeconds: 2600 })]);
    expect(result.entries[0].state).toBe('matched');
    expect(result.entries[0].comparison.duration.diffSeconds).toBe(200);
  });

  it('oznacza różny dystans lub wieloznaczność jako wymagające przeglądu', () => {
    expect(reconcileStravaActivities([activity({ distanceMeters: 6800 })], [session()]).entries[0].state).toBe('review');
    expect(reconcileStravaActivities([activity()], [session(), session({ id: '2026-08-27-run-02' })]).entries[0].state).toBe('ambiguous');
  });

  it('nie łączy aktywności bez odpowiedniej sesji i nie interpretuje obcego typu', () => {
    expect(reconcileStravaActivities([activity({ startLocal: '2026-08-13T19:00:00Z' })], [session()]).entries[0].state).toBe('unmatched');
    expect(reconcileStravaActivities([activity({ type: 'Ride', sportType: 'Ride' })], [session()]).entries[0].state).toBe('outside-contract');
    expect(STRAVA_RECONCILIATION_CONTRACT.runDistanceToleranceMeters).toBe(100);
  });

  it('oddziela aktywności sprzed początku Training Log od bieżących braków', () => {
    const result = reconcileStravaActivities([
      activity({ startLocal: '2026-08-13T19:00:00Z' }),
      activity({ id: 'strava-2', startLocal: '2026-08-25T19:00:00Z' }),
    ], [session()], { coverageStartDate: '2026-08-18' });
    expect(result.entries.map((entry) => entry.state)).toEqual(['historical', 'unmatched']);
    expect(result.summary).toMatchObject({ historical: 1, unmatched: 1 });
  });

  it('łączy świadomie zaimportowaną mobilizację po trwałym ID źródła', () => {
    const result = reconcileStravaActivities([
      activity({ id: '123456789', type: 'WeightTraining', sportType: 'WeightTraining', startLocal: '2026-08-25T16:00:18Z' }),
    ], [session({ id: 'strava-123456789', type: 'Mobilizacja', date: '2026-08-25', distanceMeters: 0, durationSeconds: 3750 })]);
    expect(result.entries[0]).toMatchObject({ state: 'matched', match: 'source-id', session: { type: 'Mobilizacja' } });
  });
});
