import { plannerDay, plannerWeek, shiftPlannerDay, BOXING_SLOTS } from './jointPlanner.js';
import { exactValue } from './parse.js';
import { A } from './schema.js';

export const RUNNA_REFERENCE_KEY = 'carlos:runna-reference:v1';
export const RUNNA_REFERENCE_VERSION = 'carlos.runna-reference.v1';
export const RUNNA_TYPES = Object.freeze({ easy: 'Bieg spokojny', intervals: 'Interwały', tempo: 'Bieg tempowy', long: 'Długi bieg', time_trial: 'Próba czasowa', taper_intervals: 'Interwały przed startem', race: 'Start' });
export const MAX_REFERENCE_BYTES = 100000;
const fail = (message) => { throw new Error(message); };
const cleanText = (value, max = 100) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// A reference is neither an API connection nor the canonical training Plan.
// Rebuild the accepted object: never retain unknown fields from an imported file.
export function parseRunnaReference(input) {
  if (typeof input !== 'string' || input.length > MAX_REFERENCE_BYTES) fail('Plik jest za duży lub nie zawiera tekstu JSON.');
  let raw;
  try { raw = JSON.parse(input); } catch { fail('Nieprawidłowy plik JSON.'); }
  if (!raw || raw.version !== RUNNA_REFERENCE_VERSION) fail('Nieobsługiwany format kopii planu.');
  if (!cleanText(raw.title) || !cleanText(raw.sourceLabel) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.capturedOn) || !plannerDay(raw.capturedOn)) fail('Brakuje tytułu, źródła lub poprawnej daty kopii.');
  if (!Array.isArray(raw.weeks) || !raw.weeks.length || raw.weeks.length > 60) fail('Kopia musi zawierać od 1 do 60 tygodni.');
  const numbers = new Set(), starts = new Set(), dates = new Set();
  const weeks = raw.weeks.map((week) => {
    if (!week || !Number.isInteger(week.number) || week.number < 1 || week.number > 60 || numbers.has(week.number)) fail('Nieprawidłowy lub powtórzony numer tygodnia.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week.start) || !plannerDay(week.start) || plannerWeek(week.start)[0] !== week.start || starts.has(week.start)) fail('Tydzień musi zaczynać się w poniedziałek i nie może się powtarzać.');
    numbers.add(week.number); starts.add(week.start);
    if (!Array.isArray(week.sessions) || !week.sessions.length || week.sessions.length > 7) fail('Nieprawidłowa lista sesji tygodnia.');
    const sessions = week.sessions.map((s) => {
      if (!s || !Number.isInteger(s.day) || s.day < 0 || s.day > 6 || !Object.hasOwn(RUNNA_TYPES, s.type) || typeof s.km !== 'number' || !Number.isFinite(s.km) || s.km <= 0 || s.km > 100) fail('Sesja wymaga dnia, obsługiwanego typu i dodatniego dystansu.');
      const date = shiftPlannerDay(week.start, s.day);
      if (dates.has(date)) fail('Dwie sesje biegowe na ten sam dzień wymagają osobnego wyjaśnienia.');
      dates.add(date);
      return { day: s.day, date, type: s.type, km: s.km, id: `runna:${date}:${s.type}`, source: 'reference' };
    }).sort((a, b) => a.day - b.day);
    const km = Math.round(sessions.reduce((sum, s) => sum + s.km, 0) * 100) / 100;
    if (typeof week.totalKm !== 'number' || !Number.isFinite(week.totalKm) || Math.abs(km - week.totalKm) > 0.011) fail(`Tydzień ${week.number}: suma sesji nie zgadza się z kilometrażem.`);
    return { number: week.number, start: week.start, end: shiftPlannerDay(week.start, 6), totalKm: km, sessions };
  }).sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < weeks.length; i++) {
    const days = (Date.parse(weeks[i].start) - Date.parse(weeks[i - 1].start)) / 86400000;
    if (weeks[i].number - weeks[i - 1].number !== days / 7) fail('Numery tygodni nie odpowiadają datom.');
  }
  return { version: RUNNA_REFERENCE_VERSION, title: raw.title.trim(), sourceLabel: raw.sourceLabel.trim(), capturedOn: raw.capturedOn, weeks };
}

export function serializeRunnaReference(reference) {
  return JSON.stringify({ ...reference, weeks: reference.weeks.map((w) => ({ number: w.number, start: w.start, totalKm: w.totalKm, sessions: w.sessions.map(({ day, type, km }) => ({ day, type, km })) })) }, null, 2);
}

export function loadRunnaReference(storage) {
  try { const saved = storage.getItem(RUNNA_REFERENCE_KEY); return saved ? { reference: parseRunnaReference(saved), error: '' } : { reference: null, error: '' }; }
  catch { return { reference: null, error: 'Nie można odczytać lokalnej kopii. Wczytaj ponownie plik planu.' }; }
}

export function referenceWeekIndex(reference, now) {
  const today = plannerDay(now);
  const index = reference.weeks.findIndex((w) => w.end >= today);
  return index < 0 ? reference.weeks.length - 1 : index;
}

export function referenceDays(week, boxing = true) {
  return plannerWeek(week.start).map((date, day) => ({ date,
    sessions: [...week.sessions.filter((s) => s.date === date), ...(boxing ? BOXING_SLOTS.filter((s) => s.weekday === day + 1).map((s) => ({ ...s, id: `club:${date}`, date, type: 'boxing', source: 'appointment' })) : [])],
  }));
}

// A shared date is a comparison aid, never an identity or authority transfer.
export function referencePlanContext(session, planRows = [], dataReady = false) {
  if (!session || session.source !== 'reference') return null;
  if (!dataReady) return { state: 'unavailable', entries: [], undated: 0 };
  const rows = planRows.map((row, index) => ({ row, index, date: plannerDay(exactValue(row, A.date, '')) }));
  const undated = rows.filter((r) => !r.date).length;
  const entries = rows.filter((r) => r.date === session.date).map(({ row, index }) => ({
    row: index + 2,
    titles: [...new Set([exactValue(row, A.planMorning, ''), exactValue(row, A.planSession, '')].filter(Boolean))],
    hr: exactValue(row, A.planHr, ''),
    status: exactValue(row, A.planStatus, ''),
  }));
  return { state: entries.length > 1 ? 'ambiguous' : entries.length ? 'unlinked' : undated ? 'unknown' : 'missing', entries, undated };
}
