import { describe, expect, it } from 'vitest';
import { parseHrTargetStages, stringifyHrTargetStages } from './hrTargetStages.js';
import { analyzeTcxStages } from './tcx.js';
import { createTcxImport, validateTcxImportEnvelope, reconcileTcxImport, resolvePlanStagedTarget, TCX_STAGED_ATOMIC_HEADERS } from './tcxImport.js';
import { computeExecution } from './metrics.js';
import { executionForLogRow } from './sessionExecution.js';
import { tcxDataStatus } from './postRunStatus.js';

const target = { schema: 'carlos.hr-target-stages.v3', stages: [
  { name: 'Baza', durationSeconds: 2, min: 150, max: 165 },
  { name: 'Przebieżka', durationSeconds: 2, mode: 'observe' },
  { name: 'Schłodzenie', durationSeconds: 2, max: 150, maxExclusive: true },
] };
const tcx = (points) => `<Lap><Track>${points.map(([t, hr]) => `<Trackpoint><Time>${new Date(Date.UTC(2000, 0, 1) + t * 1000).toISOString()}</Time><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`).join('')}</Track></Lap>`;
const source = tcx([[0,150],[1,165],[2,190],[3,192],[4,150],[5,140],[6,145],[7,145]]);
const envelope = () => createTcxImport(source, { sessionId: '2000-01-01-run-01', targetStages: target, sourceSha256: 'A'.repeat(64) });
function logTable() { return { headers: ['Date','Session_ID','HR_Target_Stages_JSON',...TCX_STAGED_ATOMIC_HEADERS], rows: [{ rowNumber: 2, values: ['2000-01-01','2000-01-01-run-01','','','','',''] }] }; }
function input(e, saved = true) { return {
  targetStages: saved ? JSON.stringify({ ...JSON.parse(e.targetStages), analysis: e.stageAnalysis }) : e.targetStages,
  timeInTarget: e.atomic.Time_In_Target_s, timeAboveTarget: e.atomic.Time_Above_Target_s,
  timeBelowTarget: e.atomic.Time_Below_Target_s, analyzedDuration: e.atomic.HR_Analyzed_Duration_s,
}; }

describe('observed HR contract', () => {
  it('keeps high HR observations out of target numerator and denominator', () => {
    const result = analyzeTcxStages(source, target);
    expect(result).toMatchObject({ timeInTarget: 3, timeAboveTarget: 1, timeBelowTarget: 0, analyzedDuration: 4, observedDuration: 2, unmappedDuration: 1 });
    expect(result.stageResults[1]).toMatchObject({ recordedDuration: 2, observedDuration: 2, analyzedDuration: 0, timeInTarget: 0, hrAvg: 191, hrMin: 190, hrMax: 192 });
    expect(computeExecution(input(envelope()))).toMatchObject({ status:'ok', hrTargetPct:75, aboveTargetPct:25 });
  });
  it('splits an interval at observation boundaries without shifting the clock', () => {
    const result = analyzeTcxStages(tcx([[0,160],[5,140],[6,140]]), target);
    expect(result).toMatchObject({ analyzedDuration:4, observedDuration:2, timeInTarget:3, timeAboveTarget:1 });
    expect(result.stageResults[1].hrAvg).toBe(160);
  });
  it('counts gaps separately and does not substitute zero for an unmeasured stage', () => {
    const result = analyzeTcxStages(tcx([[0,150],[6,140],[7,140]]), target);
    expect(result).toMatchObject({ analyzedDuration:0, observedDuration:0, excludedDuration:6, unmappedDuration:1 });
    expect(result.stageResults[1]).toMatchObject({ hrAvg:null, hrMin:null, hrMax:null });
  });
  it.each([
    { ...target, schema:'carlos.hr-target-stages.v1' },
    { ...target, stages:[{durationSeconds:2,mode:'observe',min:100},target.stages[0]] },
    { ...target, stages:[{durationSeconds:2,mode:'guess'},target.stages[0]] },
    { ...target, stages:[{durationSeconds:2,mode:'observe'}] },
    { ...target, stages:[{durationSeconds:2,min:100,maxExclusive:true}] },
  ])('rejects ambiguous targets rather than defaulting to all-in-target', (bad) => {
    expect(() => parseHrTargetStages(bad)).toThrow();
  });
  it('requires versioned summaries and matching atomic sums/source hashes', () => {
    const e = envelope();
    expect(validateTcxImportEnvelope(e).action).toBe('valid');
    expect(e.schema).toBe('carlos.tcx-import.v4');
    expect(e.methodology.targetBoundaryMode).toBe('per-stage');
    expect(e.methodology.inclusiveTarget).toBeUndefined();
    for (const mutate of [
      e=>delete e.methodology.targetBoundaryMode,
      e=>e.methodology.inclusiveTarget=true,
      e=>delete e.stageAnalysis,
      e=>e.stageAnalysis.results[1].analyzedDuration=2,
      e=>e.stageAnalysis.results[0].timeInTarget=1,
      e=>e.stageAnalysis.sourceSha256='B'.repeat(64),
      e=>e.stageAnalysis.results[0].hrAvg=300,
    ]) { const bad=structuredClone(e); mutate(bad); expect(validateTcxImportEnvelope(bad).action).toBe('contract-error'); }
  });
  it('roundtrips observations through the existing JSON cell, then becomes idempotent', () => {
    const e=envelope(), table=logTable();
    const first=reconcileTcxImport(table,e,{allowStageBootstrap:true});
    expect(first.action).toBe('update');
    first.updates.forEach(u=>u.values.forEach((v,i)=>{table.rows[0].values[u.startColumnIndex+i]=v;}));
    expect(reconcileTcxImport(table,e,{allowStageBootstrap:true}).action).toBe('noop');
    const saved=table.rows[0].values[2];
    expect(stringifyHrTargetStages(saved)).toBe(e.targetStages);
    expect(tcxDataStatus(input(e))).toMatchObject({complete:true});
    expect(tcxDataStatus(input(e,false))).toMatchObject({complete:false});
    expect(computeExecution(input(e,false)).status).toBe('no-data');
    const changed=structuredClone(e);changed.stageAnalysis.results[1].hrAvg=190;
    expect(reconcileTcxImport(table,changed,{allowStageBootstrap:true}).action).toBe('conflict');
  });
  it('detects a Plan changing observations into targets and rejects duplicate dates on import', () => {
    const e=envelope();
    const row={ Date:'2000-01-01', HR_Target_Stages_JSON:input(e).targetStages,...e.atomic };
    const plan=[{Data:'2000-01-01',HR_Target_Stages_JSON:e.targetStages}];
    expect(executionForLogRow(row,plan).status).toBe('ok');
    const modified=structuredClone(target);modified.stages[1]={name:'Przebieżka',durationSeconds:2,min:150,max:165};
    plan[0].HR_Target_Stages_JSON=JSON.stringify(modified);
    expect(executionForLogRow(row,plan).planState).toBe('target-conflict');
    const table={headers:['Data','HR_Target_Stages_JSON'],rows:[{rowNumber:2,values:['2000-01-01',e.targetStages]},{rowNumber:3,values:['2000-01-01','']}]};
    expect(resolvePlanStagedTarget(logTable(),table,e.sessionId).action).toBe('contract-error');
  });
  it('never uses RPE to modify a target-HR score', () => {
    const e=envelope();
    expect(computeExecution({...input(e),rpe:1})).toEqual(computeExecution({...input(e),rpe:9}));
  });
});
