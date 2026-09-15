import { describe, expect, it } from 'vitest';
import { executionForLogRow, executionIssueMessage, planForLogRow } from './sessionExecution.js';

const session = { Date: '2026-09-13', HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Time_In_Target_s: '800', Time_Above_Target_s: '100', Time_Below_Target_s: '100', HR_Analyzed_Duration_s: '1000', Distance_km: '6' };
const plan = { Data: '2026-09-13', HR_Target_Min_bpm: '145', HR_Target_Max_bpm: '158', Distance_Target_Min_km: '5', Distance_Target_Max_km: '6' };

describe('shared execution source checks', () => {
  it('reports competing plans identically regardless of row order', () => {
    const other = { ...plan, HR_Target_Max_bpm: '165' };
    for (const plans of [[plan, other], [other, plan]]) {
      expect(planForLogRow(plans, session)).toBeNull();
      const result = executionForLogRow(session, plans);
      expect(result).toMatchObject({ status: 'data-error', planState: 'ambiguous', planDate: '2026-09-13', planMatchCount: 2, hrTargetPct: null });
      expect(executionIssueMessage(result)).toContain('2 wpisy dla 2026-09-13');
    }
  });
  it('distinguishes an invalid target from a disagreement between two valid targets', () => {
    const invalid = executionForLogRow(session, [{ ...plan, HR_Target_Stages_JSON: '{bad' }]);
    expect(executionIssueMessage(invalid)).toContain('Plan: nieprawidłowy');
    const conflict = executionForLogRow(session, [{ ...plan, HR_Target_Max_bpm: '165' }]);
    expect(executionIssueMessage(conflict)).toContain('Cel HR w Training Log różni się od Planu');
  });
  it('ignores nullish stage markers while preserving a valid single target', () => {
    for (const absent of ['—', '#N/A', 'null']) {
      expect(executionForLogRow({ ...session, HR_Target_Stages_JSON: absent }, [plan])).toMatchObject({ status: 'ok', hrTargetPct: 80 });
    }
  });
  it('preserves the distinction between missing TCX and duplicate plans without TCX', () => {
    const missing = { Date: session.Date, Distance_km: '6' };
    expect(executionForLogRow(missing, [plan])).toMatchObject({ status: 'no-data', planState: 'matched' });
    expect(executionForLogRow(missing, [plan, plan])).toMatchObject({ status: 'data-error', planState: 'ambiguous' });
  });
  it('does not change valid atom analysis or infer it from HR average', () => {
    expect(executionForLogRow(session, [plan])).toMatchObject({ status: 'ok', hrTargetPct: 80, volumePct: 100 });
    expect(executionForLogRow({ Date: session.Date, HR_avg: '151' }, [plan]).hrTargetPct).toBeNull();
  });
});
