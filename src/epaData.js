import { exactValue, normalize } from './parse.js';
import { A } from './schema.js';
import { progressDay } from './progressReport.js';

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

export { executionForLogRow as epaExecutionFor } from './sessionExecution.js';
