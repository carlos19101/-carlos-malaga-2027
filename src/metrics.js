import { normalize, parseDate, parseNumber } from './parse.js';
import { tryParseHrTargetStages } from './hrTargetStages.js';

export const VERIFIER_FIELDS = [
  { field: 'km7', label: 'BIEG 7D', unit: 'km', tolerance: 0.05 },
  { field: 'km28', label: 'BIEG 28D', unit: 'km', tolerance: 0.05 },
  { field: 'srpe7', label: 'sRPE 7D', unit: '', tolerance: 1 },
  { field: 'srpe28', label: 'sRPE 28D', unit: '', tolerance: 1 },
  { field: 'sessions7', label: 'BIEGI 7D', unit: '', tolerance: 0 },
  { field: 'weight', label: 'WAGA', unit: 'kg', tolerance: 0.1 },
];
export const VOLUME_TARGET_TOLERANCE = 0.02;

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

export function rollingWindow(rows = [], endDate = new Date(), days = 7) {
  const endDay = localDayNumber(endDate);
  if (endDay === null || !Number.isInteger(days) || days <= 0) {
    return {
      from: null, to: null, days: Math.max(0, Number(days) || 0), availabilityDays: 0,
      daysWithData: 0, coverage: 0, dataDayCoverage: 0, sessions: 0,
      km: 0, srpe: 0, minutes: 0, undatedSkipped: 0,
    };
  }

  let undatedSkipped = 0;
  const valid = (Array.isArray(rows) ? rows : []).map((row) => {
    const day = localDayNumber(row.date);
    if (day === null) {
      undatedSkipped += 1;
      return null;
    }
    return {
      day,
      km: parseNumber(row.km) ?? 0,
      srpe: parseNumber(row.srpe) ?? 0,
      minutes: parseNumber(row.minutes) ?? 0,
    };
  }).filter(Boolean).filter(({ day }) => day <= endDay);
  const fromDay = endDay - days + 1;
  const windowRows = valid.filter(({ day }) => day >= fromDay);
  const oldestDay = valid.length ? Math.min(...valid.map(({ day }) => day)) : null;
  const availabilityStart = oldestDay === null ? null : Math.max(oldestDay, fromDay);
  const availabilityDays = availabilityStart === null ? 0 : endDay - availabilityStart + 1;
  const daysWithData = new Set(windowRows.map(({ day }) => day)).size;

  return {
    from: new Date(fromDay * 86400000).toISOString().slice(0, 10),
    to: new Date(endDay * 86400000).toISOString().slice(0, 10),
    days,
    availabilityDays,
    daysWithData,
    coverage: availabilityDays / days,
    dataDayCoverage: daysWithData / days,
    sessions: windowRows.length,
    km: sum(windowRows, 'km'),
    srpe: sum(windowRows, 'srpe'),
    minutes: sum(windowRows, 'minutes'),
    undatedSkipped,
  };
}

export function computeLoad(trainingLog = [], today = new Date()) {
  const endDay = localDayNumber(today);
  const acute = rollingWindow(trainingLog, today, 7);
  const full = rollingWindow(trainingLog, today, 28);
  if (endDay === null) {
    return {
      km7: 0, km28: 0, srpe7: 0, srpe28: 0, sessions7: 0, sessions28: 0,
      loadRatio: null, ratioStatus: 'calibrating', calibrationDays: '0/28',
      acute, chronic: { srpe: 0, weeklyAverage: 0 }, undatedSkipped: full.undatedSkipped,
    };
  }

  const chronicRows = (Array.isArray(trainingLog) ? trainingLog : []).map((row) => ({
    day: localDayNumber(row.date),
    srpe: parseNumber(row.srpe) ?? 0,
  })).filter(({ day }) => day !== null && day >= endDay - 27 && day <= endDay - 7);
  const chronicSrpe = sum(chronicRows, 'srpe');
  const chronicWeeklyAverage = chronicSrpe / 3;
  const calibrated = full.availabilityDays >= 28;
  const loadRatio = calibrated && chronicWeeklyAverage > 0
    ? Number((acute.srpe / chronicWeeklyAverage).toFixed(4))
    : null;

  return {
    km7: acute.km,
    km28: full.km,
    srpe7: acute.srpe,
    srpe28: full.srpe,
    sessions7: acute.sessions,
    sessions28: full.sessions,
    loadRatio,
    ratioStatus: !calibrated ? 'calibrating' : chronicWeeklyAverage > 0 ? 'ok' : 'no-chronic-load',
    calibrationDays: `${Math.min(full.availabilityDays, 28)}/28`,
    acute,
    chronic: { srpe: chronicSrpe, weeklyAverage: chronicWeeklyAverage },
    undatedSkipped: full.undatedSkipped,
  };
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
    targetMode: 'none',
    targetStages: [],
    hrTargetPct: null,
    aboveTargetPct: null,
    belowTargetPct: null,
    timeInTarget: null,
    timeAboveTarget: null,
    timeBelowTarget: null,
    analyzedDuration: null,
    unmappedDuration: null,
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
  const staged = tryParseHrTargetStages(session.targetStages);
  const hasSingleTarget = targetLo !== null && targetHi !== null;
  if (!staged && !hasSingleTarget) return executionResult();
  if (!staged && targetLo >= targetHi) return executionResult({ targetLo, targetHi, status: 'data-error' });

  const timeInTarget = parseNumber(session.timeInTarget);
  const timeAboveTarget = parseNumber(session.timeAboveTarget);
  const timeBelowTarget = parseNumber(session.timeBelowTarget);
  const analyzedDuration = parseNumber(session.analyzedDuration);
  const base = staged
    ? { targetLo: null, targetHi: null, targetMode: 'staged', targetStages: staged.stages }
    : { targetLo, targetHi, targetMode: 'single', targetStages: [] };

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
  const unmappedDuration = parseNumber(session.unmappedDuration);
  if (unmappedDuration !== null && unmappedDuration < 0) {
    return executionResult({
      ...base, timeInTarget, timeAboveTarget, timeBelowTarget, analyzedDuration,
      hrTargetPct, aboveTargetPct, belowTargetPct, unmappedDuration, status: 'data-error',
    });
  }
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
      hrTargetPct, aboveTargetPct, belowTargetPct, unmappedDuration, actualKm, distanceTargetMin, distanceTargetMax,
      status: 'data-error',
    });
  }

  const volumePct = actualKm !== null && distanceTargetMax !== null
    ? percent(actualKm, distanceTargetMax)
    : null;
  const intensityStatus = aboveTargetPct > 40 ? 'over' : belowTargetPct > 40 ? 'under' : 'ok';
  const volumeStatus = actualKm === null || distanceTargetMin === null
    ? 'ok'
    : actualKm > distanceTargetMax * (1 + VOLUME_TARGET_TOLERANCE) ? 'over'
      : actualKm < distanceTargetMin * (1 - VOLUME_TARGET_TOLERANCE) ? 'under' : 'ok';
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
    unmappedDuration,
    actualKm,
    distanceTargetMin,
    distanceTargetMax,
    volumePct,
    status,
  });
}

export function computeEasyExecutionPattern(sessions = [], options = {}) {
  const required = Number.isInteger(options.required) && options.required > 0 ? options.required : 3;
  const thresholdPct = parseNumber(options.thresholdPct) ?? 40;
  const easySessions = (Array.isArray(sessions) ? sessions : [])
    .filter(({ session }) => /(^|\s)easy(?:\s|$)/.test(normalize(session)))
    .map((session, index) => ({
      ...session,
      index,
      dateValue: parseDate(session.date)?.getTime() ?? null,
      aboveTargetPct: parseNumber(session.aboveTargetPct),
    }))
    .sort((a, b) => {
      if (a.dateValue === null && b.dateValue === null) return a.index - b.index;
      if (a.dateValue === null) return -1;
      if (b.dateValue === null) return 1;
      return a.dateValue - b.dateValue || a.index - b.index;
    });
  const recent = easySessions.slice(-required);
  const analyzed = recent.filter(({ aboveTargetPct }) => aboveTargetPct !== null);
  const base = {
    required,
    thresholdPct,
    available: analyzed.length,
    totalEasy: easySessions.length,
    sample: `${analyzed.length}/${required}`,
    sessions: recent.map(({ date, session, aboveTargetPct, status }) => ({ date, session, aboveTargetPct, status })),
  };

  if (recent.length < required || analyzed.length < required) {
    return { ...base, state: 'calibrating', active: false };
  }
  const active = analyzed.every(({ aboveTargetPct }) => aboveTargetPct > thresholdPct);
  return { ...base, state: active ? 'active' : 'clear', active };
}
