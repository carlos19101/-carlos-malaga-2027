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
