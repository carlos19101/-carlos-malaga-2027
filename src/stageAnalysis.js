import { parseHrTargetStages, HR_TARGET_OBSERVATION_SCHEMA } from './hrTargetStages.js';

export const STAGE_ANALYSIS_SCHEMA = 'carlos.hr-stage-analysis.v1';
const times = ['timeInTarget', 'timeAboveTarget', 'timeBelowTarget', 'analyzedDuration', 'observedDuration', 'recordedDuration'];
const atomicNames = ['Time_In_Target_s', 'Time_Above_Target_s', 'Time_Below_Target_s', 'HR_Analyzed_Duration_s'];
const close = (a, b) => Math.abs(a - b) < 1e-6;
const nonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function createStageAnalysis(analysis, sourceSha256) {
  return {
    schema: STAGE_ANALYSIS_SCHEMA, sourceSha256,
    observedDuration: analysis.observedDuration, excludedDuration: analysis.excludedDuration,
    unmappedDuration: analysis.unmappedDuration,
    results: analysis.stageResults.map((stage) => Object.fromEntries(
      [...times, 'hrAvg', 'hrMin', 'hrMax'].map((field) => [field, stage[field]]),
    )),
  };
}

export function validateStageAnalysis(targetInput, analysis, atomic) {
  const { schema, stages } = parseHrTargetStages(targetInput);
  const fail = () => { throw new TypeError('Niespójna analiza HR poszczególnych etapów.'); };
  if (schema !== HR_TARGET_OBSERVATION_SCHEMA || analysis?.schema !== STAGE_ANALYSIS_SCHEMA
    || !/^[A-F0-9]{64}$/.test(analysis.sourceSha256 || '')
    || !Array.isArray(analysis.results) || analysis.results.length !== stages.length
    || !['observedDuration', 'excludedDuration', 'unmappedDuration'].every((key) => nonnegative(analysis[key]))) fail();
  analysis.results.forEach((row, i) => {
    if (!row || !times.every((key) => nonnegative(row[key]))
      || !close(row.analyzedDuration, row.timeInTarget + row.timeAboveTarget + row.timeBelowTarget)
      || !close(row.recordedDuration, row.analyzedDuration + row.observedDuration)
      || row.recordedDuration > stages[i].durationSeconds + 1e-6
      || (stages[i].mode === 'observe' ? row.analyzedDuration !== 0 : row.observedDuration !== 0)) fail();
    if (row.recordedDuration === 0) {
      if (['hrAvg', 'hrMin', 'hrMax'].some((key) => row[key] !== null)) fail();
    } else if (!['hrAvg', 'hrMin', 'hrMax'].every((key) => nonnegative(row[key]) && row[key] >= 20 && row[key] <= 250)
      || row.hrMin > row.hrAvg || row.hrAvg > row.hrMax) fail();
  });
  const sum = (key) => analysis.results.reduce((total, row) => total + row[key], 0);
  if (!close(sum('observedDuration'), analysis.observedDuration)) fail();
  atomicNames.forEach((field, i) => {
    if (!nonnegative(atomic?.[field]) || !close(sum(times[i]), atomic[field])) fail();
  });
  return analysis;
}

export function savedStageAnalysis(targetInput, atomic) {
  const raw = typeof targetInput === 'string' ? JSON.parse(targetInput) : targetInput;
  if (!raw?.analysis) return null;
  return validateStageAnalysis(targetInput, raw.analysis, atomic);
}
