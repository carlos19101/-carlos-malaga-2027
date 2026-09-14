import { normalize, parseDate } from './parse.js';

export const HALF_MARATHON_KM = 21.0975;
export const RACE_GOALS = [
  { id: '1h30', label: '1:30', seconds: 90 * 60 },
  { id: '1h35', label: '1:35', seconds: 95 * 60 },
  { id: '1h40', label: '1:40', seconds: 100 * 60 },
  { id: '1h45', label: '1:45', seconds: 105 * 60 },
];
export const PROGRESS_METHOD = 'epa-progress-v2';

export function progressNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(',', '.');
  const n = Number(raw);
  return /^[+-]?\d+(?:\.\d+)?$/.test(raw) && Number.isFinite(n) ? n : null;
}
export function progressDay(value) {
  const date = value instanceof Date ? new Date(value) : parseDate(value);
  return date && !Number.isNaN(date.getTime())
    ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000 : null;
}
const dateKey = (day) => day === null ? null : new Date(day * 86400000).toISOString().slice(0, 10);
const positive = (value) => { const n = progressNumber(value); return n !== null && n > 0 ? n : null; };
const feedback = (value) => { const n = progressNumber(value); return n !== null && n >= 0 && n <= 10 ? n : null; };
const sum = (items, key) => items.reduce((total, item) => total + (item[key] ?? 0), 0);
const countKm = (items) => items.filter(({ km }) => km === null).length;
const prettyKm = (km) => km.toFixed(1).replace('.', ',');

export function formatProgressTime(seconds) {
  const n = progressNumber(seconds);
  if (n === null || n < 0) return '—';
  const total = Math.round(n);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const tail = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}
export function formatProgressPace(seconds) {
  const n = positive(seconds);
  return n === null ? '—' : `${formatProgressTime(n)}/km`;
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function isEasySession(session) {
  const label = normalize(`${session.name || ''} ${session.type || ''}`);
  return /\b(easy|spokoj\w*|recovery|regener\w*)\b/.test(label)
    && !/\b(test\w*|interwal\w*|progress\w*|progres\w*|przebiez\w*|tempo|finisz|race)\b/.test(label);
}
function isRaceOrTest(session) {
  const label = normalize(`${session.name} ${session.type}`);
  // A title is only a candidate label, not evidence that an effort was maximal.
  if (/\b(bez testu|test(?:owanie|owy)? (?:butow|zegarka|pasa|sprzetu)|przed testem|przed zawodami|race pace|race preparation)\b/.test(label)) return false;
  return /\b(test|sprawdzian|zawody|zawodach|race|parkrun|time trial)\b/.test(label);
}
function normalizedSessions(input, endDay) {
  const issues = [];
  const accepted = [];
  (Array.isArray(input) ? input : []).forEach((session, index) => {
    const reject = (reason) => issues.push({ index, id: session?.id || '', reason });
    if (!session || typeof session !== 'object' || Array.isArray(session)) return reject('invalid-row');
    if (!['', 'bieg', 'run', 'running'].includes(normalize(session.type))) return reject('not-run');
    if (!['', 'done', 'completed', 'finished', 'wykonany'].includes(normalize(session.status))) return reject('not-completed');
    const day = progressDay(session.date);
    if (day === null) return reject('invalid-date');
    if (endDay === null || day > endDay) return reject('future');
    const hr = positive(session.hrAvg);
    accepted.push({
      ...session, index, id: String(session.id ?? '').trim(), date: dateKey(day), day,
      name: String(session.name ?? ''), type: String(session.type ?? ''),
      km: positive(session.distanceKm), minutes: positive(session.durationMinutes),
      hrAvg: hr !== null && hr >= 20 && hr <= 250 ? hr : null,
      rpe: feedback(session.rpe), pain: feedback(session.pain), legs: feedback(session.legFatigue),
      isEasy: isEasySession(session),
    });
  });
  const ids = new Map();
  accepted.filter(({ id }) => id).forEach((row) => ids.set(row.id, [...(ids.get(row.id) || []), row]));
  const excluded = new Set();
  for (const rows of ids.values()) {
    if (rows.length < 2) continue;
    const fingerprint = ({ index, ...row }) => JSON.stringify(row);
    const identical = rows.every((row) => fingerprint(row) === fingerprint(rows[0]));
    for (const row of identical ? rows.slice(1) : rows) {
      excluded.add(row.index);
      issues.push({ index: row.index, id: row.id, reason: identical ? 'duplicate' : 'conflicting-id' });
    }
  }
  const sessions = accepted.filter(({ index }) => !excluded.has(index))
    .sort((a, b) => a.day - b.day || String(a.time || '').localeCompare(String(b.time || '')) || a.index - b.index);
  return { sessions, issues };
}
function weekStart(day) {
  return day - ((new Date(day * 86400000).getUTCDay() || 7) - 1);
}
function weeklyHistory(sessions, endDay) {
  if (!sessions.length || endDay === null) return { values: [], maximumKm: 0 };
  const lastWeek = weekStart(endDay);
  const firstWeek = Math.max(weekStart(sessions[0].day), lastWeek - 7 * 7);
  const values = [];
  for (let day = firstWeek; day <= lastWeek; day += 7) {
    const rows = sessions.filter((row) => row.day >= day && row.day <= Math.min(day + 6, endDay));
    values.push({
      week: dateKey(day), to: dateKey(Math.min(day + 6, endDay)),
      km: sum(rows, 'km'), sessions: rows.length, missingKm: countKm(rows),
      noEntries: rows.length === 0, partial: day + 6 > endDay || day < sessions[0].day,
    });
  }
  return { values, maximumKm: Math.max(0, ...values.map(({ km }) => km)) };
}
function easyTrend(sessions) {
  const easy = sessions.filter(({ isEasy, minutes, hrAvg, km }) => isEasy && minutes !== null && km !== null && hrAvg !== null);
  const referenceKm = median(easy.slice(-3).map(({ km }) => km));
  const referenceHr = median(easy.slice(-3).map(({ hrAvg }) => hrAvg));
  const comparable = referenceKm === null ? [] : easy.filter(({ km, hrAvg }) =>
    Math.abs(km - referenceKm) / referenceKm <= 0.2 + 1e-10 && Math.abs(hrAvg - referenceHr) <= 3);
  const base = { sample: `${Math.min(comparable.length, 6)}/6`, totalComparable: comparable.length, referenceKm, referenceHr };
  if (comparable.length < 6) return { ...base, state: 'missing', first: null, recent: null, paceDeltaSeconds: null, hrDelta: null };
  const summarize = (rows) => ({
    paceSeconds: median(rows.map(({ minutes, km }) => minutes * 60 / km)),
    hr: median(rows.map(({ hrAvg }) => hrAvg)),
    sessions: rows.map(({ id, date, name, minutes, km, hrAvg }) => ({ id, date, name, km, hrAvg, paceSeconds: minutes * 60 / km })),
  });
  const first = summarize(comparable.slice(0, 3));
  const recent = summarize(comparable.slice(-3));
  const paceDeltaSeconds = Math.round(recent.paceSeconds - first.paceSeconds);
  const hrDelta = Math.round((recent.hr - first.hr) * 10) / 10;
  const state = Math.abs(hrDelta) > 3 ? 'mixed' : paceDeltaSeconds <= -5 ? 'potential-improvement'
    : paceDeltaSeconds >= 5 ? 'potential-regression' : 'mixed';
  return { ...base, state, first, recent, paceDeltaSeconds, hrDelta };
}
function raceEstimate(sessions, endDay, target) {
  const source = sessions.filter((s) => isRaceOrTest(s) && s.km >= 5 && s.minutes !== null).at(-1);
  if (!source) return { state: 'missing', predictedSeconds: null, source: null, targetGapSeconds: null };
  const predictedSeconds = Math.round(source.minutes * 60 * ((HALF_MARATHON_KM / source.km) ** 1.06));
  return {
    state: 'provisional', predictedSeconds, targetGapSeconds: predictedSeconds - target.seconds, sourceAgeDays: endDay - source.day,
    source: { id: source.id, date: source.date, km: source.km, durationSeconds: Math.round(source.minutes * 60), name: source.name || source.type || 'test' },
  };
}
function executionHistory(sessions) {
  const complete = (s) => ['ok', 'over', 'under'].includes(s.execution?.status) && progressNumber(s.execution?.hrTargetPct) !== null;
  const recentEasy = sessions.filter((s) => s.isEasy).slice(-3);
  const analyzed = recentEasy.filter(complete);
  return {
    analyzed: sessions.filter(complete).length, total: sessions.length,
    invalid: sessions.filter((s) => s.execution?.status === 'data-error').length,
    easyPattern: {
      sample: `${analyzed.length}/3`,
      active: recentEasy.length === 3 && analyzed.length === 3 && analyzed.every((s) => progressNumber(s.execution.aboveTargetPct) > 40),
      sessions: recentEasy.map((s) => ({ date: s.date, name: s.name, aboveTargetPct: complete(s) ? progressNumber(s.execution.aboveTargetPct) : null })),
    },
  };
}
export function buildProgressReport(input = {}) {
  const endDay = progressDay(input.now ?? new Date());
  // Legacy callers may pass positional execution; UI keeps execution attached to each session.
  const rows = (Array.isArray(input.sessions) ? input.sessions : []).map((s, i) =>
    s && typeof s === 'object' && !Array.isArray(s) ? { ...s, execution: s.execution ?? input.execution?.[i] } : s);
  const { sessions, issues } = normalizedSessions(rows, endDay);
  const recent = sessions.filter(({ day }) => day >= endDay - 13);
  const previous = sessions.filter(({ day }) => day >= endDay - 27 && day < endDay - 13);
  const target = RACE_GOALS.find(({ id }) => id === input.goalId) || RACE_GOALS[0];
  const estimate = raceEstimate(sessions, endDay, target);
  const execution = executionHistory(sessions);
  const historyDays = sessions.length ? endDay - sessions[0].day + 1 : 0;
  const dataError = issues.some(({ reason }) => ['invalid-date', 'invalid-row', 'conflicting-id'].includes(reason)) || endDay === null;
  const recentKm = sum(recent, 'km');
  const previousKm = sum(previous, 'km');
  const completeWindows = historyDays >= 28 && !countKm(recent) && !countKm(previous) && !dataError;
  const delta = completeWindows && previousKm > 0 ? Number(((recentKm / previousKm - 1) * 100).toFixed(1)) : null;
  const recentPain = recent.filter(({ pain }) => pain !== null && pain >= 3);
  const priorities = [];
  if (dataError || countKm(sessions)) priorities.push({ state: 'DANE', title: 'Raport ma niepełne dane', detail: `${issues.length} pominiętych wpisów; ${countKm(sessions)} biegów bez poprawnego dystansu. Sumy obejmują tylko znane wartości.` });
  if (recentPain.length) priorities.push({ state: 'REAKCJA', title: 'Sprawdź odnotowany ból ze sztabem', detail: `${recentPain.map((s) => `${s.date}: ${s.pain}/10`).join(' · ')}. Te zapisy wymagają kontekstu przed kolejną zmianą obciążenia.` });
  if (execution.easyPattern.active) priorities.push({ state: 'INTENSYWNOŚĆ', title: 'Dopilnuj easy', detail: 'Trzy ostatnie kolejne easy mają ponad 40% analizowanego czasu powyżej celu HR. Sprawdź wykonanie i ustawiony zakres ze sztabem.' });
  if (execution.analyzed < sessions.length) priorities.push({ state: 'DANE', title: 'Domknij analizę HR zapisanych biegów', detail: `${execution.analyzed}/${sessions.length} biegów ma analizę celu HR. Pozostałe biegi nadal liczą się do historii dystansu; sam brak TCX nie oznacza niewykonania.` });
  if (estimate.state === 'missing') priorities.push({ state: 'DANE', title: 'Brak podstaw do automatycznej prognozy', detail: `Cel ${target.label} pozostaje zapisany. Potrzebny jest oznaczony test biegowy lub zawody od 5 km, zgodnie z planem.` });
  if (delta !== null) priorities.push({ state: 'OBJĘTOŚĆ', title: 'Zmiana zarejestrowanej objętości', detail: `${prettyKm(recentKm)} km wobec ${prettyKm(previousKm)} km (${delta >= 0 ? '+' : ''}${delta}%). Sam dystans nie rozstrzyga o poprawie formy ani potrzebie zwiększenia treningu.` });
  if (historyDays < 28) priorities.push({ state: 'KALIBRACJA', title: 'Zbieramy historię do porównania okresów', detail: `${Math.min(historyDays, 28)}/28 dni od pierwszego wpisu. Dni bez zarejestrowanego biegu nie są liczone jako trening.` });
  return {
    method: PROGRESS_METHOD, asOf: dateKey(endDay), issues,
    target: { ...target, pace: formatProgressPace(target.seconds / HALF_MARATHON_KM) },
    goalOptions: RACE_GOALS.map((goal) => ({ ...goal, pace: formatProgressPace(goal.seconds / HALF_MARATHON_KM) })),
    history: {
      state: dataError || countKm(sessions) ? 'partial' : !sessions.length ? 'missing' : completeWindows ? 'ready' : 'calibrating',
      sessions: sessions.length, km: sum(sessions, 'km'), missingKm: countKm(sessions),
      longestKm: sessions.some(({ km }) => km !== null) ? Math.max(...sessions.map(({ km }) => km ?? 0)) : null,
      historyDays, firstDate: sessions[0]?.date ?? null, lastDate: sessions.at(-1)?.date ?? null,
      recentFrom: dateKey(endDay === null ? null : endDay - 13), previousFrom: dateKey(endDay === null ? null : endDay - 27),
      previousTo: dateKey(endDay === null ? null : endDay - 14),
      recentSessions: recent.length, recentKm, recentMissingKm: countKm(recent),
      previousSessions: previous.length, previousKm, previousMissingKm: countKm(previous),
      volumeDeltaPct: delta, completeWindows,
    },
    estimate, execution, weekly: weeklyHistory(sessions, endDay), easyTrend: easyTrend(sessions), priorities,
  };
}
