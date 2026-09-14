import { exactValue, normalize } from './parse.js';
import { A } from './schema.js';
import { computeExecution } from './metrics.js';
import { tryParseHrTargetStages } from './hrTargetStages.js';
import { progressDay, progressNumber } from './progressReport.js';

export const epaValue = (row, field, fallback = '') => exactValue(row || {}, A[field] || [], fallback);

export function latestEpaRun(rows = [], now = new Date()) {
  const end = progressDay(now);
  const valid = rows.filter((row) => {
    const day = progressDay(epaValue(row, 'date'));
    return day !== null && end !== null && day <= end
      && ['', 'done', 'completed', 'finished', 'wykonany'].includes(normalize(epaValue(row, 'logStatus')));
  }).sort((a, b) => progressDay(epaValue(b, 'date')) - progressDay(epaValue(a, 'date')));
  if (!valid.length) return { row: null, ambiguous: false };
  const day = progressDay(epaValue(valid[0], 'date'));
  const latest = valid.filter((row) => progressDay(epaValue(row, 'date')) === day);
  if (latest.length === 1) return { row: latest[0], ambiguous: false };
  const times = latest.map((row) => String(epaValue(row, 'logTime')).trim());
  if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time))) return { row: null, ambiguous: true };
  const stamps = times.map((time) => time.length === 5 ? `${time}:00` : time);
  const max = [...stamps].sort().at(-1);
  return stamps.filter((time) => time === max).length === 1
    ? { row: latest[stamps.indexOf(max)], ambiguous: false } : { row: null, ambiguous: true };
}

export function selectEpaActivity(entries = [], session) {
  if (!session?.id) return { activity: null, state: 'missing' };
  const candidates = entries.filter((entry) => entry.session?.id === session.id);
  if (candidates.length > 1) return { activity: null, state: 'ambiguous' };
  const entry = candidates[0];
  if (!entry) return { activity: null, state: 'missing' };
  // A review candidate must never supply facts to a different or confirmed session.
  return entry.state === 'matched'
    ? { activity: entry.activity, state: 'matched' } : { activity: null, state: 'review' };
}

function target(row, prefix) {
  const rawStages = epaValue(row, `${prefix}HrTargetStages`);
  const stages = rawStages ? tryParseHrTargetStages(rawStages) : null;
  const lo = progressNumber(epaValue(row, `${prefix}HrTargetMin`));
  const hi = progressNumber(epaValue(row, `${prefix}HrTargetMax`));
  const invalid = Boolean(rawStages && !stages) || (!stages && ((lo === null) !== (hi === null) || (lo !== null && (lo >= hi || lo < 20 || hi > 250))));
  const key = stages ? JSON.stringify({ basis: stages.basis, stages: stages.stages.map(({ name, ...stage }) => stage) })
    : lo !== null && hi !== null ? `${lo}:${hi}` : null;
  return { stages: rawStages, lo, hi, invalid, key };
}

export function epaExecutionFor(row, plan = []) {
  if (!row) return { ...computeExecution(), planState: 'missing' };
  const day = progressDay(epaValue(row, 'date'));
  const matches = day === null ? [] : plan.filter((p) => progressDay(epaValue(p, 'date')) === day);
  if (matches.length > 1) return { ...computeExecution(), status: 'data-error', planState: 'ambiguous' };
  const planned = matches[0] || null;
  const recordedTarget = target(row, 'log');
  const planTarget = target(planned, 'plan');
  if (recordedTarget.invalid || planTarget.invalid || (recordedTarget.key && planTarget.key && recordedTarget.key !== planTarget.key)) {
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
