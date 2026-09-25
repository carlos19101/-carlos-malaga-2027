import { describe, expect, it } from 'vitest';
import { computeWeeklySnapshot, WEEKLY_SNAPSHOT_CONTRACT } from './weeklySnapshot.js';

const executed = (status, hrTargetPct = 80) => ({ status, hrTargetPct });

describe('computeWeeklySnapshot', () => {
  const now = '2026-09-25';
  const record = extra => ({date:now,type:'Bieg',km:8,duration:'60:00',rpe:2,srpe:120,...extra});
  it('reports partial internal load rather than inventing missing RPE', () => {
    const result = computeWeeklySnapshot([record({}), record({rpe:'',srpe:''})],now);
    expect(result.internal).toMatchObject({activeSessions:2,rpeSessions:1,averageRpe:2,srpeSessions:1,srpeTotal:120,srpeState:'partial',state:'unreliable'});
  });
  it('reports no internal load when every run lacks feedback', () => {
    expect(computeWeeklySnapshot([record({rpe:'',srpe:''})],now).internal).toMatchObject({averageRpe:null,srpeTotal:null,srpeState:'missing'});
  });
  it('rejects out-of-scale RPE and inconsistent sRPE from totals', () => {
    const records = [record({rpe:11,srpe:660}),record({rpe:0,srpe:0}),record({srpe:-1}),record({srpe:60})];
    expect(computeWeeklySnapshot(records,now).internal).toMatchObject({invalidRpe:2,inconsistentSrpe:2,srpeSessions:0,srpeTotal:null,state:'unreliable'});
  });
  it('allows rounded sRPE and fractional historical feedback without overwriting it', () => {
    expect(computeWeeklySnapshot([record({duration:'1:40:40',rpe:7.5,srpe:755})],now).internal).toMatchObject({srpeTotal:755,state:'ready'});
  });
  it('counts boxing duration from evidence, not calendar slots', () => {
    const result = computeWeeklySnapshot([record({type:'Boks',km:'',duration:'1:25:50',rpe:'',srpe:''}),record({type:'Boks',km:'',duration:'',rpe:'',srpe:''})],now);
    expect(result.activity).toMatchObject({boxingSessions:2,boxingDurationSessions:1,boxingDurationState:'partial'});
    expect(result.activity.boxingMinutes).toBeCloseTo(85 + 50/60);
    expect(result.internal.activeSessions).toBe(2);
  });
  it('explicit mobility type wins over a strength title and is not double counted', () => {
    expect(computeWeeklySnapshot([record({type:'Mobilizacja',name:'Trening siła strength',km:''})],now).activity).toMatchObject({mobilitySessions:1,strengthSessions:0,runningSessions:0});
  });
  it('a known run with missing metrics remains a session, not a zero or an absent run', () => {
    const result = computeWeeklySnapshot([record({km:'',duration:'',rpe:'',srpe:''})],now);
    expect(result.state).toBe('observed');
    expect(result.activity).toMatchObject({runningSessions:1,runningDistanceState:'missing',runningDurationState:'missing'});
    expect(result.dataQuality).toMatchObject({runsWithoutDistance:1,runsWithoutDuration:1});
  });
  it('does not subtract negative distance or label zero duration as complete', () => {
    const result = computeWeeklySnapshot([record({km:-2,duration:'0:00'}),record({km:8})],now);
    expect(result.activity).toMatchObject({runningKm:8,runningDistanceState:'partial',runningDurationState:'partial'});
  });
  it('preserves an undated-row warning even when no dated activity exists', () => {
    const result = computeWeeklySnapshot([record({date:'unreadable'})],now);
    expect(result.state).toBe('missing');expect(result.dataQuality.undatedRows).toBe(1);
  });
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
