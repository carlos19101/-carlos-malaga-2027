import { describe, expect, it } from 'vitest';
import { epaExecutionFor, latestEpaRun, selectEpaActivity } from './epaData.js';

const row = (extra = {}) => ({ Date: '2026-09-13', Time: '18:00', Session_ID: 'one', Status: 'DONE', Distance_km: '6', HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Time_In_Target_s: '800', Time_Above_Target_s: '100', Time_Below_Target_s: '100', HR_Analyzed_Duration_s: '1000', ...extra });
const plan = (extra = {}) => ({ Data: '2026-09-13', HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Distance_Target_Min_km: '5', Distance_Target_Max_km: '6', ...extra });

describe('EPA source linkage', () => {
  it('never borrows an older Strava run for the latest session', () => {
    const entries = [{ state: 'matched', session: { id: 'older' }, activity: { distanceMeters: 5000 } }];
    expect(selectEpaActivity(entries, { id: 'latest' })).toEqual({ activity: null, state: 'missing' });
  });
  it('rejects review and duplicate pairings', () => {
    const entry = { state: 'matched', session: { id: 'one' }, activity: { id: 's' } };
    expect(selectEpaActivity([entry], { id: 'one' }).activity.id).toBe('s');
    expect(selectEpaActivity([{ ...entry, state: 'review' }], { id: 'one' })).toEqual({ activity: null, state: 'review' });
    expect(selectEpaActivity([entry, entry], { id: 'one' }).state).toBe('ambiguous');
  });
  it('chooses the later same-day run by clock, not row order', () => {
    const am = row({ Time: '07:00', Session_ID: 'am' });
    const pm = row({ Time: '19:00', Session_ID: 'pm' });
    for (const rows of [[am, pm], [pm, am]]) expect(latestEpaRun(rows, '2026-09-14').row.Session_ID).toBe('pm');
    expect(latestEpaRun([am, row({ Time: '' })], '2026-09-14').ambiguous).toBe(true);
  });
  it('ignores future and planned runs when selecting the latest execution', () => {
    expect(latestEpaRun([row(), row({ Date: '2026-09-15' }), row({ Date: '2026-09-14', Status: 'PLANNED' })], '2026-09-14').row.Date).toBe('2026-09-13');
  });
  it('retains recorded HR analysis when the plan is missing but does not invent a volume target', () => {
    expect(epaExecutionFor(row())).toMatchObject({ status: 'ok', planState: 'missing', hrTargetPct: 80, volumePct: null });
    expect(epaExecutionFor(row(), [plan()])).toMatchObject({ status: 'ok', planState: 'matched', volumePct: 100 });
  });
  it('flags ambiguous plans and conflicting HR targets', () => {
    expect(epaExecutionFor(row(), [plan(), plan()])).toMatchObject({ status: 'data-error', planState: 'ambiguous', hrTargetPct: null });
    expect(epaExecutionFor(row(), [plan({ HR_Target_Max_bpm: '162' })])).toMatchObject({ status: 'data-error', planState: 'target-conflict' });
  });
  it('does not retroactively apply planned targets to unlabelled atom times', () => {
    expect(epaExecutionFor(row({ HR_Target_Min_bpm: '', HR_Target_Max_bpm: '' }), [plan()])).toMatchObject({ status: 'no-data', hrTargetPct: null });
  });
  it('rejects malformed stages instead of falling back to a single target', () => {
    expect(epaExecutionFor(row({ HR_Target_Stages_JSON: '{bad' }), [plan()]).status).toBe('data-error');
  });

  it('retains exact engine dimensions at the rounded volume boundary', () => {
    const result = epaExecutionFor(row({ Distance_km: '6.120001' }), [plan()]);
    expect(result).toMatchObject({ volumePct: 102, status: 'over', volumeStatus: 'over', intensityStatus: 'ok' });
    expect(epaExecutionFor(row(), []).volumeStatus).toBeNull();
  });
});
