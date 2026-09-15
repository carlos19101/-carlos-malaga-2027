import { exactValue, isNullish } from './parse.js';
import { A } from './schema.js';
import { computeExecution } from './metrics.js';
import { tryParseHrTargetStages } from './hrTargetStages.js';
import { progressDay, progressNumber } from './progressReport.js';

const epaValue = (row, field) => exactValue(row || {}, A[field] || [], '');

export function planCandidatesForLogRow(plan = [], row) {
  const day = row ? progressDay(epaValue(row, 'date')) : null;
  return day === null ? [] : plan.filter((entry) => progressDay(epaValue(entry, 'date')) === day);
}

export function planForLogRow(plan = [], row) {
  const matches = planCandidatesForLogRow(plan, row);
  return matches.length === 1 ? matches[0] : null;
}

export function executionIssueMessage(execution = {}) {
  if (execution.planState === 'ambiguous') return `Plan: ${execution.planMatchCount} wpisy dla ${execution.planDate}. Ustal jeden cel tej sesji przed analizą TCX.`;
  if (execution.planState === 'target-conflict') return 'Cel HR w Training Log różni się od Planu. Wyjaśnij cel użyty do analizy przed ponownym importem TCX.';
  if (execution.planState === 'invalid-target') return `${execution.targetSource}: nieprawidłowy zakres lub zapis etapów HR.`;
  if (execution.status === 'data-error') return 'Czasy analizy HR lub cel dystansu są niespójne. Sprawdź zapisane wartości.';
  return '';
}

function target(row, prefix) {
  const stagesValue = epaValue(row, `${prefix}HrTargetStages`);
  const rawStages = isNullish(stagesValue) ? '' : stagesValue;
  const stages = rawStages ? tryParseHrTargetStages(rawStages) : null;
  const lo = progressNumber(epaValue(row, `${prefix}HrTargetMin`));
  const hi = progressNumber(epaValue(row, `${prefix}HrTargetMax`));
  const invalid = Boolean(rawStages && !stages) || (!stages && ((lo === null) !== (hi === null) || (lo !== null && (lo >= hi || lo < 20 || hi > 250))));
  const key = stages ? JSON.stringify({ basis: stages.basis, stages: stages.stages.map(({ name, ...stage }) => stage) })
    : lo !== null && hi !== null ? `${lo}:${hi}` : null;
  return { stages: rawStages, lo, hi, invalid, key };
}

export function executionForLogRow(row, plan = []) {
  if (!row) return { ...computeExecution(), planState: 'missing' };
  const matches = planCandidatesForLogRow(plan, row);
  const planDate = String(epaValue(row, 'date'));
  if (matches.length > 1) return { ...computeExecution(), status: 'data-error', planState: 'ambiguous', planDate, planMatchCount: matches.length };
  const planned = matches[0] || null;
  const recordedTarget = target(row, 'log');
  const planTarget = target(planned, 'plan');
  if (recordedTarget.invalid || planTarget.invalid) {
    return { ...computeExecution(), status: 'data-error', planState: 'invalid-target', targetSource: recordedTarget.invalid ? 'Training Log' : 'Plan' };
  }
  if (recordedTarget.key && planTarget.key && recordedTarget.key !== planTarget.key) {
    return { ...computeExecution(), status: 'data-error', planState: 'target-conflict' };
  }
  const saved = Boolean(recordedTarget.key);
  const chosen = saved ? recordedTarget : planTarget;
  const result = computeExecution({
    targetLo: chosen.lo, targetHi: chosen.hi, targetStages: chosen.stages,
    // Existing atom times cannot be retrospectively assigned to a new target from Plan.
    timeInTarget: saved ? epaValue(row, 'logTimeInTarget') : null,
    timeAboveTarget: saved ? epaValue(row, 'logTimeAboveTarget') : null,
    timeBelowTarget: saved ? epaValue(row, 'logTimeBelowTarget') : null,
    analyzedDuration: saved ? epaValue(row, 'logHrAnalyzedDuration') : null,
    actualKm: epaValue(row, 'logDistance'),
    distanceTargetMin: epaValue(planned, 'planDistanceTargetMin'),
    distanceTargetMax: epaValue(planned, 'planDistanceTargetMax'),
  });
  return { ...result, planState: planned ? 'matched' : 'missing' };
}
