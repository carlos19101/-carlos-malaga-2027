import { exactValue, parseNumber, normalize } from './parse.js';
import { A } from './schema.js';
import { plannerDay } from './jointPlanner.js';
import { parseSessionMinutes } from './loadMap.js';

export const HR_LOAD_CONFIG = Object.freeze({ hrMax: 210, fallbackRest: 50, maxGapSeconds: 30 });
export const HR_EVIDENCE_SCHEMA = 'carlos.hr-seconds.v1';
export const HR_LOAD_METHOD = 'BANISTER_MALE_INTERVALS_V1';
const read = (row, key) => exactValue(row || {}, A[key] || [], '');
const age = (day, today) => (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000;
const validHr = hr => Number.isFinite(hr) && hr >= 20 && hr <= 250;

// Previous sample owns its interval; do not remove missing-HR samples before pairing.
// A histogram is a lossless sufficient statistic for this integral (no GPS retained).
export function hrEvidence(points = [], sourceSha256 = null) {
  const bins = new Map();
  let excludedSeconds = 0, nonPositiveIntervals = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const current = points[i], next = points[i + 1];
    const seconds = (next.timeMs - current.timeMs) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) { nonPositiveIntervals++; continue; }
    if (seconds > HR_LOAD_CONFIG.maxGapSeconds || !validHr(current.heartRate) || !Number.isInteger(current.heartRate)) {
      excludedSeconds += seconds; continue;
    }
    bins.set(current.heartRate, (bins.get(current.heartRate) || 0) + seconds);
  }
  return { schema: HR_EVIDENCE_SCHEMA, sourceSha256, maxGapSeconds: 30,
    bins: [...bins].sort(([a], [b]) => a - b), excludedSeconds, nonPositiveIntervals };
}

export function validHrEvidence(e) {
  if (!e || e.schema !== HR_EVIDENCE_SCHEMA || e.maxGapSeconds !== 30 || !Array.isArray(e.bins)
    || e.bins.length > 231 || !(e.sourceSha256 === null || /^[A-F0-9]{64}$/.test(e.sourceSha256))
    || !Number.isFinite(e.excludedSeconds) || e.excludedSeconds < 0 || e.excludedSeconds > 604800
    || !Number.isInteger(e.nonPositiveIntervals) || e.nonPositiveIntervals < 0) return false;
  let last = 0, seconds = 0;
  for (const bin of e.bins) {
    if (!Array.isArray(bin) || bin.length !== 2) return false;
    const [hr, duration] = bin;
    if (!Number.isInteger(hr) || !validHr(hr) || hr <= last || !Number.isFinite(duration) || duration <= 0) return false;
    last = hr; seconds += duration;
  }
  return seconds <= 604800;
}

export function banisterTrimp(hr, minutes, rest, hrMax = HR_LOAD_CONFIG.hrMax) {
  if (!validHr(hr) || !Number.isFinite(minutes) || minutes <= 0 || !validHr(rest) || rest >= hrMax) return null;
  // HR above configured HRmax is retained, not silently clipped; the UI flags it.
  const reserve = Math.max(0, (hr - rest) / (hrMax - rest));
  return minutes * reserve * 0.64 * Math.exp(1.92 * reserve);
}

export function resolveHrRest(raw = [], date) {
  const sameDay = raw.filter(row => plannerDay(read(row, 'date')) === date);
  for (const [field, source] of [['rawHrLying', 'HR_lying_bpm'], ['rawRhr', 'RHR_bpm']]) {
    const values = [...new Set(sameDay.map(row => parseNumber(read(row, field)))
      .filter(value => validHr(value) && value < HR_LOAD_CONFIG.hrMax))];
    if (values.length === 1) return { value: values[0], source, date };
    // Conflicting rows must not depend on spreadsheet row order.
    if (values.length > 1) return { value: 50, source: 'fallback-conflict', date };
  }
  return { value: HR_LOAD_CONFIG.fallbackRest, source: 'fallback-50', date };
}

export function loadFromEvidence(evidence, rest) {
  if (!validHrEvidence(evidence) || !evidence.bins.length) return null;
  const seconds = evidence.bins.reduce((sum, [, time]) => sum + time, 0);
  const value = evidence.bins.reduce((sum, [hr, time]) => sum + banisterTrimp(hr, time / 60, rest.value), 0);
  return { value, method: HR_LOAD_METHOD, hrMax: HR_LOAD_CONFIG.hrMax, rest, seconds,
    aboveMax: evidence.bins.some(([hr]) => hr > HR_LOAD_CONFIG.hrMax),
    coverage: seconds / (seconds + evidence.excludedSeconds), evidence };
}

export function sessionHrLoad(row, raw = []) {
  const date = plannerDay(read(row, 'date')), rest = resolveHrRest(raw, date);
  const minutes = parseSessionMinutes(read(row, 'logDuration')) ?? parseNumber(exactValue(row, ['duration min'], ''));
  const rpe = parseNumber(read(row, 'logRpe'));
  const srpe = minutes > 0 && rpe !== null && rpe >= 0 && rpe <= 10 ? minutes * rpe : null;
  const strength = /(?:si[lł]a|si[lł]owy|strength|weighttraining|weight training|si[lł]ownia)/.test(normalize(read(row, 'logType')));
  const base = { date, sessionId: read(row, 'logSessionId'), name: read(row, 'logName'), rest, srpe, strength };
  if (strength) return { ...base, kind: srpe === null ? 'missing' : 'srpe', trimp: null };
  let stored = null;
  try { stored = JSON.parse(exactValue(row, ['coach load notes'], '')); } catch { /* legacy free text */ }
  if (stored?.method === HR_LOAD_METHOD && stored?.rest?.date === date
    && validHr(stored.rest.value) && stored.rest.value < HR_LOAD_CONFIG.hrMax
    && ['HR_lying_bpm','RHR_bpm','fallback-50','fallback-conflict'].includes(stored.rest.source)) {
    const atomic = loadFromEvidence(stored.evidence, stored.rest);
    if (atomic) return { ...base, ...atomic, trimp: atomic.value, kind: 'atomic' };
  }
  const hr = parseNumber(read(row, 'logHrAvg'));
  const trimp = banisterTrimp(hr, minutes, rest.value);
  return { ...base, trimp, kind: trimp !== null ? 'estimate' : srpe !== null ? 'srpe' : 'missing',
    aboveMax: hr > HR_LOAD_CONFIG.hrMax };
}

export function hrLoadZone(ratio) {
  return ratio === null ? null : ratio < .8 ? 'Niskie' : ratio <= 1.3 ? 'Optymalne' : ratio <= 1.5 ? 'Uwaga' : 'Wysokie';
}

// Input must be completed, deduplicated Training Log rows. Calendar span is not
// proof of import completeness: missing training days cannot be inferred here.
export function summarizeHrLoad(rows = [], raw = [], now = new Date()) {
  const today = plannerDay(now);
  const history = rows.map(row => plannerDay(read(row, 'date'))).filter(day => day && day <= today).sort();
  const historyDays = history.length ? Math.min(28, age(history[0], today) + 1) : 0;
  const sessions = rows.map(row => sessionHrLoad(row, raw)).filter(s => s.date && age(s.date, today) >= 0 && age(s.date, today) < 28);
  const week = sessions.filter(s => age(s.date, today) < 7);
  const sum = (list, key) => { const values = list.map(s => s[key]).filter(v => v !== null && Number.isFinite(v)); return values.length ? values.reduce((a,b) => a+b,0) : null; };
  const total28 = sum(sessions, 'trimp'), acute = sum(week, 'trimp');
  const chronic = total28 === null ? null : total28 / 4;
  const hrSessions = sessions.filter(s => s.trimp !== null);
  const missingHr = sessions.filter(s => !s.strength && s.trimp === null).length;
  // Empty current week is zero only when a historical HR series exists.
  const acuteValue = acute ?? (hrSessions.length && week.every(s => s.strength) ? 0 : null);
  const ratio = historyDays >= 21 && !missingHr && chronic > 0 && acuteValue !== null ? acuteValue / chronic : null;
  return { sessions, historyDays, acute: acuteValue, total28, chronic, ratio, zone: hrLoadZone(ratio), missingHr,
    status: historyDays < 21 ? 'calibration' : missingHr ? 'partial' : ratio === null ? 'missing' : 'ready',
    hrCoverage: sessions.length ? hrSessions.length / sessions.length * 100 : null,
    atomicCount: sessions.filter(s => s.kind === 'atomic').length,
    estimateCount: sessions.filter(s => s.kind === 'estimate').length,
    srpe7: sum(week.filter(s => s.trimp === null), 'srpe'), srpe28: sum(sessions.filter(s => s.trimp === null), 'srpe'),
    srpeMissing: sessions.filter(s => s.trimp === null && s.srpe === null).length };
}
