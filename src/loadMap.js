import { normalize, parseDate, parseNumber } from './parse.js';

export const LOAD_MAP_CONTRACTS = Object.freeze({
  runningVolume: Object.freeze({
    label: 'Objętość biegowa',
    required: ['date', 'type', 'distance'],
    windowsDays: [7, 28],
    missing: 'BRAK DANYCH',
  }),
  longRun: Object.freeze({
    label: 'Długi bieg',
    required: ['date', 'type', 'distance'],
    windowDays: 30,
    missing: 'BRAK PUNKTU ODNIESIENIA',
  }),
  sessionSpike: Object.freeze({
    label: 'Zmiana dystansu sesji',
    required: ['date', 'type', 'distance'],
    windowDays: 30,
    missing: 'BRAK PUNKTU ODNIESIENIA',
    calibration: 'HISTORIA CZĘŚCIOWA',
  }),
  internalLoad: Object.freeze({
    label: 'Obciążenie wewnętrzne',
    required: ['date', 'duration', 'rpe'],
    windowsDays: [7, 28],
    missing: 'NIEPEŁNE DANE RPE',
  }),
  mechanical: Object.freeze({
    label: 'Odpowiedź mechaniczna',
    required: ['pain', 'legFatigue'],
    missing: 'BRAK OCENY',
  }),
});

function dateValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value);
  return parseDate(value);
}

function localDay(value) {
  const date = dateValue(value);
  if (!date) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function inWindow(day, endDay, days) {
  return day !== null && day <= endDay && day >= endDay - days + 1;
}

function isRun(value) {
  return ['bieg', 'run', 'running'].includes(normalize(value));
}

function includesAny(value, labels) {
  const text = normalize(value);
  return labels.some((label) => text.includes(label));
}

export function parseSessionMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const clock = raw.match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
  if (clock) {
    const [, first, second, third] = clock;
    return third === undefined
      ? Number(first) + Number(second) / 60
      : Number(first) * 60 + Number(second) + Number(third) / 60;
  }
  const numeric = parseNumber(raw);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function normalizedRows(rows = [], today = new Date()) {
  const endDay = localDay(today);
  let undated = 0;
  const normalizedRows = (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    const timestamp = dateValue(row.timestamp) || dateValue(row.date);
    const day = localDay(timestamp);
    if (day === null) {
      undated += 1;
      return [];
    }
    if (endDay !== null && day > endDay) return [];
    return [{
      ...row,
      index,
      timestamp,
      day,
      typeText: normalize(row.type),
      nameText: normalize(row.name),
      km: parseNumber(row.km),
      minutes: parseSessionMinutes(row.duration),
      rpe: parseNumber(row.rpe),
      srpe: parseNumber(row.srpe),
      pain: parseNumber(row.pain),
      legFatigue: parseNumber(row.legFatigue),
    }];
  }).sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  return { rows: normalizedRows, endDay, undated };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

function historyDays(rows, endDay, requiredDays) {
  if (!rows.length || endDay === null) return 0;
  const oldest = Math.min(...rows.map(({ day }) => day));
  return Math.min(requiredDays, Math.max(0, endDay - oldest + 1));
}

function metricState(value, availableDays, requiredDays) {
  if (value === null || value === undefined) return 'missing';
  return availableDays >= requiredDays ? 'ready' : 'calibrating';
}

function activeLoadSessions(rows) {
  return rows.filter(({ km, minutes, rpe, srpe }) => (
    (km !== null && km > 0) || (minutes !== null && minutes > 0) || (rpe !== null && rpe > 0) || (srpe !== null && srpe > 0)
  ));
}

function internalQuality(rows) {
  const active = activeLoadSessions(rows);
  const rpeZero = active.filter(({ minutes, km, rpe }) => ((minutes ?? 0) > 0 || (km ?? 0) > 0) && rpe === 0);
  const rpeMissing = active.filter(({ rpe }) => rpe === null);
  const srpeMissing = active.filter(({ srpe }) => srpe === null);
  return {
    active,
    rpeZero,
    rpeMissing,
    srpeMissing,
    state: active.length && !rpeZero.length && !rpeMissing.length && !srpeMissing.length
      ? 'ready'
      : active.length ? 'unreliable' : 'missing',
  };
}

export function computeLoadMap(inputRows = [], today = new Date()) {
  const normalized = normalizedRows(inputRows, today);
  const sessions = normalized.rows;
  const runs = sessions.filter((row) => isRun(row.type));
  const runsWithDistance = runs.filter(({ km }) => km !== null && km >= 0);
  const runs7 = runsWithDistance.filter(({ day }) => inWindow(day, normalized.endDay, 7));
  const runs28 = runsWithDistance.filter(({ day }) => inWindow(day, normalized.endDay, 28));
  const longRuns = runsWithDistance.filter(({ type, name }) => includesAny(`${type} ${name}`, ['long', 'dlugi', 'długi']));
  const latestLongRun = longRuns.at(-1) || null;
  const latestLongRun7 = [...longRuns].reverse().find(({ day }) => inWindow(day, normalized.endDay, 7)) || null;
  const sessions7 = sessions.filter(({ day }) => inWindow(day, normalized.endDay, 7));
  const sessions28 = sessions.filter(({ day }) => inWindow(day, normalized.endDay, 28));
  const internal7 = internalQuality(sessions7);
  const internal28 = internalQuality(sessions28);
  const runningHistoryDays = historyDays(runsWithDistance, normalized.endDay, 30);
  const latestRun = runsWithDistance.at(-1) || null;
  const previousRuns = latestRun
    ? runsWithDistance.filter((row) => row !== latestRun && row.day >= latestRun.day - 29 && row.timestamp <= latestRun.timestamp)
    : [];
  const previousLongest30 = previousRuns.length ? Math.max(...previousRuns.map(({ km }) => km)) : null;
  const longest30 = runsWithDistance.filter(({ day }) => inWindow(day, normalized.endDay, 30));
  const longest30Km = longest30.length ? Math.max(...longest30.map(({ km }) => km)) : null;
  const longest7Km = runs7.length ? Math.max(...runs7.map(({ km }) => km)) : null;
  const km7 = sum(runs7, 'km');
  const km28 = sum(runs28, 'km');
  const sessionSpikePct = latestRun && previousLongest30 !== null && previousLongest30 > 0
    ? Number((((latestRun.km / previousLongest30) - 1) * 100).toFixed(2))
    : null;
  const spikeHistoryDays = latestRun ? historyDays(previousRuns, latestRun.day, 30) : 0;
  const latestMechanical = [...sessions].reverse().find(({ pain, legFatigue }) => pain !== null || legFatigue !== null) || null;
  const boxing7 = sessions7.filter(({ type, name }) => includesAny(`${type} ${name}`, ['boks', 'boxing'])).length;
  const strength7 = sessions7.filter(({ type, name }) => includesAny(`${type} ${name}`, ['sila', 'siła', 'strength'])).length;

  return {
    state: sessions.length ? (runningHistoryDays >= 30 ? 'ready' : 'calibrating') : 'missing',
    contracts: LOAD_MAP_CONTRACTS,
    dataQuality: {
      undatedRows: normalized.undated,
      runsWithoutDistance: runs.length - runsWithDistance.length,
    },
    running: {
      km7,
      km28,
      minutes7: sum(runs7, 'minutes'),
      minutes28: sum(runs28, 'minutes'),
      count7: runs7.length,
      count28: runs28.length,
      averageDistance7: runs7.length ? Number((km7 / runs7.length).toFixed(2)) : null,
      historyDays: runningHistoryDays,
      state: runsWithDistance.length ? metricState(km28, runningHistoryDays, 28) : 'missing',
    },
    longRun: {
      latestKm: latestLongRun?.km ?? null,
      latestDate: latestLongRun?.date ?? null,
      longest7Km,
      longest30Km,
      share7Pct: latestLongRun7 && km7 > 0 ? Number(((latestLongRun7.km / km7) * 100).toFixed(2)) : null,
      state: latestLongRun ? metricState(longest30Km, runningHistoryDays, 30) : 'missing',
    },
    sessionSpike: {
      currentKm: latestRun?.km ?? null,
      referenceKm: previousLongest30,
      valuePct: sessionSpikePct,
      historyDays: spikeHistoryDays,
      state: sessionSpikePct === null ? 'no-reference' : spikeHistoryDays >= 30 ? 'ready' : 'calibrating',
      confidence: sessionSpikePct === null ? 'none' : spikeHistoryDays >= 30 ? 'full-history' : 'partial-history',
    },
    internal: {
      srpe7: sum(internal7.active, 'srpe'),
      srpe28: sum(internal28.active, 'srpe'),
      rpeZeroSessions7: internal7.rpeZero.length,
      missingRpeSessions7: internal7.rpeMissing.length,
      missingSrpeSessions7: internal7.srpeMissing.length,
      rpeZeroSessions28: internal28.rpeZero.length,
      missingRpeSessions28: internal28.rpeMissing.length,
      missingSrpeSessions28: internal28.srpeMissing.length,
      state: internal7.state,
      state28: internal28.state,
    },
    systemic: {
      boxing7,
      strength7,
      state: sessions7.length ? 'observed' : 'missing',
    },
    mechanical: {
      pain: latestMechanical?.pain ?? null,
      legFatigue: latestMechanical?.legFatigue ?? null,
      date: latestMechanical?.date ?? null,
      state: latestMechanical ? 'observed' : 'missing',
    },
    intensity: {
      state: 'not-computable',
      reason: 'Training Log nie zawiera pełnego czasu w domenach intensywności; Execution opisuje cel sesji, nie pełny rozkład stref.',
    },
  };
}
