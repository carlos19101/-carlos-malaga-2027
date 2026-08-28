import { describe, expect, it } from 'vitest';
import { computeWeeklySnapshot, WEEKLY_SNAPSHOT_CONTRACT } from './weeklySnapshot.js';

const executed = (status, hrTargetPct = 80) => ({ status, hrTargetPct });

describe('computeWeeklySnapshot', () => {
  it('opisuje tylko bieżące siedem dni kalendarzowych i nie liczy przyszłości', () => {
    const result = computeWeeklySnapshot([
      { date: '2026-08-19', type: 'Bieg', km: 5, duration: '40:00', rpe: 2, srpe: 80 },
      { date: '2026-08-20', type: 'Bieg', km: 6, duration: '45:00', rpe: 2, srpe: 90 },
      { date: '2026-08-26', type: 'Boks', duration: '60:00', rpe: 3, srpe: 180 },
      { date: '2026-08-27', type: 'Bieg', km: 7, duration: '52:00', rpe: 2, srpe: 104 },
      { date: '2026-08-28', type: 'Bieg', km: 9, duration: '70:00', rpe: 3, srpe: 210 },
    ], '2026-08-27');

    expect(result.period).toMatchObject({ from: '2026-08-21', to: '2026-08-27', days: 7 });
    expect(result.activity).toMatchObject({ sessions: 2, activeDays: 2, runningSessions: 1, runningKm: 7, runningMinutes: 52, runningDurationState: 'ready', boxingSessions: 1 });
  });

  it('oddziela wynik wykonania od sesji bez danych atomowych', () => {
    const result = computeWeeklySnapshot([
      { date: '2026-08-25', type: 'Bieg', km: 6, duration: '45:00', rpe: 2, srpe: 90, execution: executed('ok', 92) },
      { date: '2026-08-26', type: 'Bieg', km: 5, duration: '40:00', rpe: 2, srpe: 80, execution: { status: 'no-data' } },
      { date: '2026-08-27', type: 'Bieg', km: 7, duration: '50:00', rpe: 3, srpe: 150, execution: executed('over', 58) },
    ], '2026-08-27');

    expect(result.execution).toMatchObject({
      eligibleRuns: 3,
      observedRuns: 2,
      unavailableRuns: 1,
      dataErrorRuns: 0,
      state: 'partial',
      outcomes: { ok: 1, over: 1, under: 0 },
      averageTargetPct: 75,
    });
  });

  it('opisuje mobilizację oddzielnie od siły i biegania', () => {
    const result = computeWeeklySnapshot([
      { date: '2026-08-25', type: 'Mobilizacja', name: 'Lekki trening mobilizacyjny', duration: '45:00', rpe: 1, srpe: 45 },
      { date: '2026-08-26', type: 'Siła', name: 'Nogi', duration: '45:00', rpe: 4, srpe: 180 },
      { date: '2026-08-27', type: 'Bieg', km: 7, duration: '52:00', rpe: 2, srpe: 104 },
    ], '2026-08-27');

    expect(result.activity).toMatchObject({
      sessions: 3,
      runningSessions: 1,
      strengthSessions: 1,
      mobilitySessions: 1,
    });
  });

  it('nie zamienia RPE 0 ukończonej sesji w wiarygodne zero', () => {
    const result = computeWeeklySnapshot([
      { date: '2026-08-27', type: 'Bieg', km: 6.8, duration: '51:39', rpe: 0, srpe: 0 },
      { date: '2026-08-26', type: 'Recovery', duration: '', rpe: 0, srpe: 0 },
    ], '2026-08-27');

    expect(result.internal).toMatchObject({ activeSessions: 1, rpeZero: 1, state: 'unreliable' });
  });

  it('nie tworzy metryk, gdy nie ma sesji', () => {
    const result = computeWeeklySnapshot([], '2026-08-27');
    expect(result.state).toBe('missing');
    expect(result.activity).toMatchObject({ sessions: 0, runningSessions: 0, runningDistanceState: 'missing' });
    expect(result.execution).toMatchObject({ state: 'missing', observedRuns: 0 });
  });

  it('oznacza błąd atomowych danych Execution oddzielnie od braku danych', () => {
    const result = computeWeeklySnapshot([
      { date: '2026-08-27', type: 'Bieg', km: 6, duration: '45:00', rpe: 2, srpe: 90, execution: { status: 'data-error' } },
    ], '2026-08-27');
    expect(result.execution).toMatchObject({ state: 'data-error', observedRuns: 0, unavailableRuns: 0, dataErrorRuns: 1 });
  });

  it('publikuje kontrakt, że Snapshot nie jest werdyktem treningowym', () => {
    expect(WEEKLY_SNAPSHOT_CONTRACT).toMatchObject({ windowDays: 7, missing: 'BRAK DANYCH' });
    expect(WEEKLY_SNAPSHOT_CONTRACT.purpose).toContain('nie wydaje decyzji treningowej');
  });
});
