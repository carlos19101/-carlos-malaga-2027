import { normalize, parseDate, parseNumber } from './parse.js';
import { parseSessionMinutes } from './loadMap.js';

export const WEEKLY_SNAPSHOT_CONTRACT = Object.freeze({
  label: 'Podsumowanie 7 dni',
  windowDays: 7,
  purpose: 'Opisuje zapisane wykonanie i jakość danych; nie wydaje decyzji treningowej.',
  running: ['date', 'type', 'distance', 'duration'],
  internalLoad: ['date', 'duration', 'rpe', 'srpe'],
  execution: ['hrTargetMin', 'hrTargetMax', 'timeInTarget', 'timeAboveTarget', 'timeBelowTarget', 'analyzedDuration'],
  missing: 'BRAK DANYCH',
});

function localDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function inWindow(day, endDay, days = 7) {
  return day !== null && day <= endDay && day >= endDay - days + 1;
}

function isRun(value) {
  return ['bieg', 'run', 'running'].includes(normalize(value));
}

function includesAny(value, labels) {
  const text = normalize(value);
  return labels.some((label) => text.includes(label));
}

function activeSession(session) {
  return (session.km !== null && session.km > 0)
    || (session.minutes !== null && session.minutes > 0)
    || (session.rpe !== null && session.rpe > 0)
    || (session.srpe !== null && session.srpe > 0);
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

function normalizeRecords(records = [], today = new Date()) {
  const endDay = localDay(today);
  let undatedRows = 0;
  const rows = (Array.isArray(records) ? records : []).flatMap((record, index) => {
    const day = localDay(record?.timestamp) ?? localDay(record?.date);
    if (day === null) {
      undatedRows += 1;
      return [];
    }
    if (endDay === null || day > endDay || !inWindow(day, endDay)) return [];
    return [{
      ...record,
      index,
      day,
      type: String(record?.type ?? ''),
      name: String(record?.name ?? ''),
      km: parseNumber(record?.km),
      minutes: parseSessionMinutes(record?.duration ?? record?.minutes),
      rpe: parseNumber(record?.rpe),
      srpe: parseNumber(record?.srpe),
      execution: record?.execution || null,
    }];
  });
  return { rows, endDay, undatedRows };
}

function internalQuality(activeRows) {
  const rpeZero = activeRows.filter(({ km, minutes, rpe }) => (km > 0 || minutes > 0) && rpe === 0);
  const missingRpe = activeRows.filter(({ rpe }) => rpe === null);
  const missingSrpe = activeRows.filter(({ srpe }) => srpe === null);
  return {
    activeSessions: activeRows.length,
    rpeZero: rpeZero.length,
    missingRpe: missingRpe.length,
    missingSrpe: missingSrpe.length,
    state: activeRows.length === 0 ? 'missing'
      : rpeZero.length || missingRpe.length || missingSrpe.length ? 'unreliable'
        : 'ready',
  };
}

export function computeWeeklySnapshot(records = [], today = new Date()) {
  const normalized = normalizeRecords(records, today);
  const sessions = normalized.rows;
  const active = sessions.filter(activeSession);
  const runs = active.filter(({ type }) => isRun(type));
  const runsWithDistance = runs.filter(({ km }) => km !== null);
  const runsWithDuration = runs.filter(({ minutes }) => minutes !== null);
  const executionEligible = runs.filter(({ execution }) => execution && ['ok', 'over', 'under'].includes(execution.status));
  const executionDataErrors = runs.filter(({ execution }) => execution?.status === 'data-error');
  const executionCounts = ['ok', 'over', 'under'].reduce((output, status) => ({
    ...output,
    [status]: executionEligible.filter(({ execution }) => execution.status === status).length,
  }), {});
  const activeDays = new Set(active.map(({ day }) => day)).size;
  const runningMinutes = sum(runsWithDuration, 'minutes');
  const executionTargetPct = executionEligible.map(({ execution }) => parseNumber(execution.hrTargetPct)).filter((value) => value !== null);

  return {
    state: active.length ? 'observed' : 'missing',
    contract: WEEKLY_SNAPSHOT_CONTRACT,
    period: normalized.endDay === null ? { from: null, to: null, days: 7 } : {
      from: new Date((normalized.endDay - 6) * 86400000).toISOString().slice(0, 10),
      to: new Date(normalized.endDay * 86400000).toISOString().slice(0, 10),
      days: 7,
    },
    activity: {
      sessions: active.length,
      activeDays,
      runningSessions: runs.length,
      runningKm: sum(runsWithDistance, 'km'),
      runningMinutes,
      runningDistanceState: runs.length && runsWithDistance.length === runs.length ? 'ready'
        : runs.length ? 'partial' : 'missing',
      runningDurationState: runs.length && runsWithDuration.length === runs.length ? 'ready'
        : runs.length ? 'partial' : 'missing',
      boxingSessions: active.filter(({ type, name }) => includesAny(`${type} ${name}`, ['boks', 'boxing'])).length,
      strengthSessions: active.filter(({ type, name }) => includesAny(`${type} ${name}`, ['sila', 'siła', 'strength'])).length,
    },
    execution: {
      eligibleRuns: runs.length,
      observedRuns: executionEligible.length,
      unavailableRuns: Math.max(0, runs.length - executionEligible.length - executionDataErrors.length),
      dataErrorRuns: executionDataErrors.length,
      state: runs.length === 0 ? 'missing'
        : executionDataErrors.length ? 'data-error'
          : executionEligible.length === 0 ? 'missing'
            : executionEligible.length === runs.length ? 'ready' : 'partial',
      outcomes: executionCounts,
      averageTargetPct: executionTargetPct.length === executionEligible.length && executionTargetPct.length > 0
        ? Number((executionTargetPct.reduce((total, value) => total + value, 0) / executionTargetPct.length).toFixed(2))
        : null,
    },
    internal: internalQuality(active),
    dataQuality: {
      undatedRows: normalized.undatedRows,
      runsWithoutDistance: Math.max(0, runs.length - runsWithDistance.length),
    },
  };
}
