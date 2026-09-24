import { describe, expect, it } from 'vitest';
import { isRunnaDate, runnaDayState } from './runnaPolicy.js';
import { executionForLogRow, planForLogRow, executionIssueMessage } from './sessionExecution.js';
import { reconcileTcxImport, resolvePlanStagedTarget, resolveTcxTarget, runnaTcxConflict } from './tcxImport.js';

describe('Runna authority from Warsaw calendar day 24 September', () => {
  it.each(['2026-09-24','24.09.2026',new Date('2026-09-23T22:00:00Z')])('switches on the approved day %s', date => expect(isRunnaDate(date)).toBe(true));
  it.each(['2026-09-23','',null,new Date('2026-09-23T21:59:59Z'),new Date('invalid')])('does not retroactively switch %s', date => expect(isRunnaDate(date)).toBe(false));
  it('never uses legacy HR or distance targets even when atom times are saved', () => {
    const row = {Date:'2026-09-24',HR_Target_Min_bpm:145,HR_Target_Max_bpm:158,Time_In_Target_s:800,Time_Above_Target_s:100,Time_Below_Target_s:100,HR_Analyzed_Duration_s:1000,Distance_km:9};
    const plans = [{Data:row.Date,Distance_Target_Max_km:5}, {Data:row.Date,Distance_Target_Max_km:6}];
    expect(planForLogRow(plans,row)).toBeNull();
    const result = executionForLogRow(row,plans);
    expect(result).toMatchObject({status:'no-target',planState:'runna-target-pending',hrTargetPct:null,volumePct:null});
    expect(executionIssueMessage(result)).toContain('Runna');
  });
  it('keeps pre-cutover scoring', () => {
    expect(executionForLogRow({Date:'2026-09-23',Distance_km:9,HR_Target_Min_bpm:145,HR_Target_Max_bpm:158,Time_In_Target_s:800,Time_Above_Target_s:100,Time_Below_Target_s:100,HR_Analyzed_Duration_s:1000},[{Data:'2026-09-23',Distance_Target_Min_km:5,Distance_Target_Max_km:6}]).volumePct).toBe(150);
  });
  it('blocks scalar, staged and direct TCX reconciliation against server session date', () => {
    const table = {headers:['Session_ID','Date'],rows:[{rowNumber:2,values:['run-1','2026-09-24']}]};
    expect(resolveTcxTarget(table,'run-1').action).toBe('conflict');
    expect(resolvePlanStagedTarget(table,{},'run-1').action).toBe('conflict');
    expect(reconcileTcxImport(table,{sessionId:'run-1',targetSource:'Runna'}).action).toBe('conflict');
    expect(runnaTcxConflict(table,'other')).toBeNull();
    table.rows[0].values[1]='2026-09-23';
    expect(runnaTcxConflict(table,'run-1')).toBeNull();
  });
  it('distinguishes an absent copy from an explicitly empty day', () => {
    const reference = {weeks:[{start:'2026-09-21',end:'2026-09-27',sessions:[{date:'2026-09-25',type:'tempo',km:8}]}]};
    expect(runnaDayState(null,'2026-09-24').state).toBe('missing');
    expect(runnaDayState(reference,'2026-09-28').state).toBe('missing');
    expect(runnaDayState(reference,'2026-09-24')).toEqual({state:'covered',session:null});
    expect(runnaDayState(reference,'2026-09-25').session.km).toBe(8);
  });
});
