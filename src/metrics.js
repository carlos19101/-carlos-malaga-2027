import { normalize, parseDate, parseNumber } from './parse.js';

export const VERIFIER_FIELDS = [
  { field: 'km7', label: 'BIEG 7D', unit: 'km', tolerance: 0.05 },
  { field: 'km28', label: 'BIEG 28D', unit: 'km', tolerance: 0.05 },
  { field: 'srpe7', label: 'sRPE 7D', unit: '', tolerance: 1 },
  { field: 'srpe28', label: 'sRPE 28D', unit: '', tolerance: 1 },
  { field: 'sessions7', label: 'BIEGI 7D', unit: '', tolerance: 0 },
  { field: 'weight', label: 'WAGA', unit: 'kg', tolerance: 0.1 },
];

function localDayNumber(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function inWindow(dayNumber, endDay, days) {
  return dayNumber !== null && dayNumber <= endDay && dayNumber >= endDay - days + 1;
}

function isRun(type) {
  return ['bieg', 'run', 'running'].includes(normalize(type));
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

export function computeVerifierMetrics(trainingRows = [], rawRows = [], today = new Date()) {
  const endDay = localDayNumber(today);
  if (endDay === null) {
    return { km7: 0, km28: 0, srpe7: 0, srpe28: 0, sessions7: 0, weight: null };
  }

  const sessions = (Array.isArray(trainingRows) ? trainingRows : []).map((row) => ({
    day: localDayNumber(row.date),
    run: isRun(row.type),
    km: parseNumber(row.km),
    srpe: parseNumber(row.srpe),
  })).filter((row) => row.day !== null && row.day <= endDay);

  const rows7 = sessions.filter((row) => inWindow(row.day, endDay, 7));
  const rows28 = sessions.filter((row) => inWindow(row.day, endDay, 28));
  const runs7 = rows7.filter((row) => row.run);
  const runs28 = rows28.filter((row) => row.run);

  const weights = (Array.isArray(rawRows) ? rawRows : []).map((row, index) => ({
    day: localDayNumber(row.date),
    value: parseNumber(row.weight),
    index,
  })).filter((row) => row.day !== null && row.day <= endDay && row.value !== null)
    .sort((a, b) => b.day - a.day || b.index - a.index);

  return {
    km7: sum(runs7, 'km'),
    km28: sum(runs28, 'km'),
    srpe7: sum(rows7, 'srpe'),
    srpe28: sum(rows28, 'srpe'),
    sessions7: runs7.length,
    weight: weights[0]?.value ?? null,
  };
}

export function compareVerifierMetrics(computed = {}, appFeed = {}) {
  return VERIFIER_FIELDS.map(({ field, label, unit, tolerance }) => {
    const fromFeed = parseNumber(appFeed[field]);
    const computedValue = parseNumber(computed[field]);
    if (fromFeed === null || computedValue === null) {
      return { field, label, unit, fromFeed, computed: computedValue, delta: null, severity: 'skipped' };
    }

    const delta = Number((computedValue - fromFeed).toFixed(12));
    const absoluteDelta = Math.abs(delta);
    if (absoluteDelta <= tolerance) {
      return { field, label, unit, fromFeed, computed: computedValue, delta, severity: 'ok' };
    }

    const relativeError = Math.abs(fromFeed) > 0 ? absoluteDelta / Math.abs(fromFeed) : Infinity;
    const severeByTolerance = tolerance === 0 ? absoluteDelta > 0 : absoluteDelta > tolerance * 3;
    const severity = relativeError > 0.05 || severeByTolerance ? 'error' : 'warning';
    return { field, label, unit, fromFeed, computed: computedValue, delta, severity };
  });
}

export function crossValidate(computed = {}, appFeed = {}) {
  return compareVerifierMetrics(computed, appFeed)
    .filter(({ severity }) => severity === 'warning' || severity === 'error');
}

function executionResult(overrides = {}) {
  return {
    targetLo: null,
    targetHi: null,
    hrTargetPct: null,
    aboveTargetPct: null,
    belowTargetPct: null,
    timeInTarget: null,
    timeAboveTarget: null,
    timeBelowTarget: null,
    analyzedDuration: null,
    actualKm: null,
    distanceTargetMin: null,
    distanceTargetMax: null,
    volumePct: null,
    status: 'no-target',
    ...overrides,
  };
}

function percent(value, total) {
  return Number(((value / total) * 100).toFixed(2));
}

export function computeExecution(session = {}) {
  const targetLo = parseNumber(session.targetLo);
  const targetHi = parseNumber(session.targetHi);
  if (targetLo === null || targetHi === null) return executionResult();
  if (targetLo >= targetHi) return executionResult({ targetLo, targetHi, status: 'data-error' });

  const timeInTarget = parseNumber(session.timeInTarget);
  const timeAboveTarget = parseNumber(session.timeAboveTarget);
  const timeBelowTarget = parseNumber(session.timeBelowTarget);
  const analyzedDuration = parseNumber(session.analyzedDuration);
  const base = { targetLo, targetHi };

  if ([timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration].some((value) => value === null)
    || analyzedDuration === 0) {
    return executionResult({ ...base, status: 'no-data' });
  }
  if ([timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration].some((value) => value < 0)
    || Math.abs(timeInTarget + timeAboveTarget + timeBelowTarget - analyzedDuration) > 1) {
    return executionResult({
      ...base, timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration, status: 'data-error',
    });
  }

  const hrTargetPct = percent(timeInTarget, analyzedDuration);
  const aboveTargetPct = percent(timeAboveTarget, analyzedDuration);
  const belowTargetPct = percent(timeBelowTarget, analyzedDuration);
  const actualKm = parseNumber(session.actualKm);
  const distanceTargetMin = parseNumber(session.distanceTargetMin);
  const distanceTargetMax = parseNumber(session.distanceTargetMax);
  const partialDistanceTarget = (distanceTargetMin === null) !== (distanceTargetMax === null);
  const invalidDistanceTarget = distanceTargetMin !== null && (
    distanceTargetMin < 0 || distanceTargetMax <= 0 || distanceTargetMin > distanceTargetMax
  );
  if (partialDistanceTarget || invalidDistanceTarget) {
    return executionResult({
      ...base, timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration,
      hrTargetPct, aboveTargetPct, belowTargetPct, actualKm, distanceTargetMin, distanceTargetMax,
      status: 'data-error',
    });
  }

  const volumePct = actualKm !== null && distanceTargetMax !== null
    ? percent(actualKm, distanceTargetMax)
    : null;
  const intensityStatus = aboveTargetPct > 40 ? 'over' : belowTargetPct > 40 ? 'under' : 'ok';
  const volumeStatus = actualKm === null || distanceTargetMin === null
    ? 'ok'
    : actualKm > distanceTargetMax ? 'over' : actualKm < distanceTargetMin ? 'under' : 'ok';
  const status = intensityStatus === 'over' || volumeStatus === 'over'
    ? 'over'
    : intensityStatus === 'under' || volumeStatus === 'under' ? 'under' : 'ok';

  return executionResult({
    ...base,
    hrTargetPct,
    aboveTargetPct,
    belowTargetPct,
    timeInTarget,
    timeAboveTarget,
    timeBelowTarget,
    analyzedDuration,
    actualKm,
    distanceTargetMin,
    distanceTargetMax,
    volumePct,
    status,
  });
}
