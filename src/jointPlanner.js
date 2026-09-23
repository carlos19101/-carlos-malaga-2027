import { exactValue, isNullish, normalize } from './parse.js';
import { A } from './schema.js';

// Calendar coordination only. These are user-defined appointments, not HR-derived load.
export const JOINT_PLANNER_VERSION = 'carlos.joint-planner.v1';
export const BOXING_SLOTS = Object.freeze([
  Object.freeze({ weekday: 2, start: '20:00', end: '22:00' }),
  Object.freeze({ weekday: 4, start: '20:00', end: '22:00' }),
]);
export const RACE_DAY = '2027-03-07';
const DAY_MS = 86400000;
const value = (row, field) => exactValue(row, A[field] || [], '');
const blank = (input) => isNullish(input) ? '' : String(input).trim();

// Date-only values are calendar dates, never UTC instants. Instants use Warsaw.
export function plannerDay(input) {
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(input);
    const part = (key) => parts.find((p) => p.type === key)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  const text = String(input ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const pl = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (!iso && !pl) return null;
  const [, a, b, c] = iso || pl;
  const [year, month, day] = iso ? [+a, +b, +c] : [+c, +b, +a];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function shiftPlannerDay(day, count) {
  if (!plannerDay(day) || !Number.isInteger(count)) return null;
  return new Date(Date.parse(`${day}T12:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

export function plannerWeek(day) {
  const valid = plannerDay(day);
  if (!valid) return [];
  const weekday = new Date(`${valid}T12:00:00Z`).getUTCDay();
  const monday = shiftPlannerDay(valid, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftPlannerDay(monday, i));
}

export function plannerSport(title) {
  const text = normalize(title).replaceAll('ł', 'l');
  const has = (pattern) => pattern.test(text);
  const sports = [
    ['boxing', /\b(boks|boxing|sparring|sparing)\b/],
    ['running', /\b(bieg\w*|run|running|easy|long|tempo|interwal\w*|interval\w*|przebiezki)\b/],
    ['strength', /\b(sila|silownia|strength|s&c|trap\s*bar|goblet)\b/],
    ['aerobic', /\b(rower|bike|cycling|ergometr)\b/],
  ].filter(([, pattern]) => has(pattern)).map(([sport]) => sport);
  if (sports.length > 1) return 'mixed';
  // OFF biegowy is not a run, but "easy + recovery" is not a rest day.
  if (/^(off|odpoczynek|rest|regeneracja|recovery)(\b|\s)/.test(text) && !sports.includes('boxing')) return 'recovery';
  return sports[0] || 'unknown';
}

function statusOf(raw) {
  const status = String(raw || '').trim().toUpperCase();
  if (['DONE', 'COMPLETED', 'WYKONANE', 'ZROBIONE'].includes(status)) return 'done';
  if (['SKIPPED', 'CANCELLED', 'CANCELED', 'POMINIĘTE', 'ODWOŁANE'].includes(status)) return 'skipped';
  // Green/yellow is guidance, not proof of execution.
  return 'planned';
}

export function readJointPlan(rows = []) {
  const sessions = [];
  const issues = [];
  const dateCounts = new Map();
  for (const [index, row] of rows.entries()) {
    const day = plannerDay(value(row, 'date'));
    if (!day) {
      issues.push({ code: 'undated', row: index + 2, message: `Plan, wiersz ${index + 2}: data wymaga wyjaśnienia (${blank(value(row, 'date')) || 'brak'}).` });
      continue;
    }
    dateCounts.set(day, (dateCounts.get(day) || 0) + 1);
    const morning = blank(value(row, 'planMorning'));
    const generic = blank(value(row, 'planSession'));
    if (morning && generic && normalize(morning) !== normalize(generic)) {
      issues.push({ code: 'title-conflict', day, message: `${day}: pola Rano i Trening opisują różne jednostki. Nie wybieramy celu automatycznie.` });
    }
    const slots = [['main', morning || generic], ['later', blank(value(row, 'planLater'))]];
    if (!slots.some(([, title]) => title)) issues.push({ code: 'empty', day, message: `${day}: brak nazwy treningu w Planie.` });
    for (const [slot, title] of slots) {
      if (!title) continue;
      const sport = plannerSport(title);
      sessions.push({
        id: `sheet:${index}:${slot}`, day, originalDay: day, title, sport,
        // Row status/HR targets can refer only to the main workout. Never copy to "later".
        status: slot === 'main' ? statusOf(value(row, 'planStatus')) : 'unconfirmed',
        sourceStatus: slot === 'main' ? blank(value(row, 'planStatus')) : '',
        source: 'plan', slot, sourceRow: index + 2,
        targetHr: slot === 'main' ? blank(value(row, 'planHr')) : '',
        targetRpe: slot === 'main' ? blank(value(row, 'planRpe')) : '',
        targets: slot === 'main' ? {
          hrMin: value(row, 'planHrTargetMin'), hrMax: value(row, 'planHrTargetMax'),
          distanceMin: value(row, 'planDistanceTargetMin'), distanceMax: value(row, 'planDistanceTargetMax'),
          hrStages: value(row, 'planHrTargetStages'),
        } : null,
        notes: blank(value(row, 'planNotes')),
        key: sport === 'boxing' || (sport === 'running' && /\b(long|dlugi|tempo|interwal\w*|interval\w*)\b/.test(normalize(title).replaceAll('ł', 'l'))),
      });
    }
  }
  for (const [day, count] of dateCounts) {
    if (count > 1) issues.push({ code: 'duplicate-day', day, message: `${day}: ${count} wiersze Planu. Rozdzielenie jednostek wymaga potwierdzenia.` });
  }
  return { sessions, issues };
}

function calendarWarnings(sessions, days) {
  const warnings = [];
  const active = sessions.filter((s) => s.status !== 'skipped' && s.sport !== 'recovery');
  for (const day of days) {
    const daily = active.filter((s) => s.day === day);
    const boxing = daily.filter((s) => s.sport === 'boxing');
    const other = daily.filter((s) => ['running', 'strength', 'aerobic'].includes(s.sport));
    if (boxing.length && other.length) warnings.push({
      code: 'boxing-same-day', day, sessionIds: [...boxing, ...other].map((s) => s.id),
      message: `${day}: boks i ${other.length} dodatkowe jednostki. Sprawdź kolejność oraz tolerancję; wspólny dzień nie oznacza zakazu treningu.`,
    });
    const rest = sessions.some((s) => s.day === day && s.sport === 'recovery' && s.status !== 'skipped');
    if (rest && daily.length) warnings.push({ code: 'rest-conflict', day, sessionIds: daily.map((s) => s.id), message: `${day}: wpis odpoczynku i aktywny trening. Ustal, czy odpoczynek dotyczy tylko biegania.` });
    for (const session of daily.filter((s) => s.key && s.sport === 'running')) {
      if (active.some((s) => s.sport === 'boxing' && Math.abs(Date.parse(s.day) - Date.parse(day)) === DAY_MS)) {
        warnings.push({ code: 'key-neighbour', day, sessionIds: [session.id], message: `${day}: bieg z akcentem lub długi bieg sąsiaduje z boksem. To sygnał do przeglądu układu, nie automatyczna redukcja.` });
      }
    }
  }
  return warnings;
}

export function buildJointWeek({ planRows = [], logRows = [], now = new Date(), weekOf, boxing = true, dataReady = true } = {}) {
  const today = plannerDay(now);
  const days = plannerWeek(weekOf || today);
  const read = readJointPlan(planRows);
  const issues = [...read.issues];
  if (!today || !days.length) issues.push({ code: 'invalid-date', message: 'Nie można ustalić daty kalendarza.' });
  if (!dataReady) issues.push({ code: 'source-unavailable', message: 'Odczyt jest niepełny lub pochodzi z kopii. Propozycje zmian są zablokowane do odświeżenia.' });
  // Include neighbours outside this week so Sunday/Monday does not hide a conflict.
  const sessions = [...read.sessions];
  if (boxing && days.length) {
    for (let offset = -1; offset <= 7; offset += 1) {
      const day = shiftPlannerDay(days[0], offset);
      if (!today || day < today || day > RACE_DAY) continue;
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      const slot = BOXING_SLOTS.find((s) => s.weekday === weekday);
      const exists = sessions.some((s) => s.day === day && ['boxing', 'mixed'].includes(s.sport));
      // A cancelled boxing entry suppresses the recurring appointment, too.
      if (slot && !exists) sessions.push({
        id: `anchor:boxing:${day}`, day, originalDay: day, title: 'Boks klubowy', sport: 'boxing',
        source: 'appointment', status: 'planned', key: true, start: slot.start, end: slot.end,
        targetHr: '', targetRpe: '', notes: 'Stały termin użytkownika, nie zapis wykonania i nie nowy wpis w arkuszu.',
      });
    }
  }
  const weekSessions = sessions.filter((s) => days.includes(s.day));
  const recordedRunDays = new Set(logRows.filter((row) => statusOf(value(row, 'logStatus')) !== 'skipped'
    && plannerSport(blank(value(row, 'logType')) || value(row, 'logName')) === 'running')
    .map((row) => plannerDay(value(row, 'date'))).filter(Boolean));
  for (const session of weekSessions) {
    if (session.sport === 'running' && session.status === 'planned' && session.day >= today && recordedRunDays.has(session.day)) {
      issues.push({ code: 'execution-link', day: session.day, message: `${session.day}: Training Log zawiera bieg. Najpierw potwierdź powiązanie z Planem; nie przenosimy potencjalnie wykonanego treningu.` });
    }
  }
  const hasUnknown = weekSessions.some((s) => ['unknown', 'mixed'].includes(s.sport) && s.status === 'planned');
  if (hasUnknown) issues.push({ code: 'unknown-sport', message: 'Część wpisów ma niejednoznaczny typ. Automatyczne propozycje czekają na wyjaśnienie.' });
  return {
    version: JOINT_PLANNER_VERSION, today, days, sessions: weekSessions,
    contextSessions: sessions, issues, warnings: calendarWarnings(sessions, days),
    canSuggest: issues.length === 0 && days.some((day) => day >= today) && days[0] <= RACE_DAY,
    planSessionCount: weekSessions.filter((s) => s.source === 'plan').length,
  };
}

export function previewJointMove(week, sessionId, targetDay) {
  const reject = (reason) => ({ ok: false, reason });
  if (!week?.canSuggest) return reject('Najpierw wyjaśnij jakość danych źródłowych.');
  const session = week.sessions.find((s) => s.id === sessionId);
  if (!session || session.source !== 'plan' || session.sport !== 'running') return reject('Ten podgląd przenosi tylko istniejące biegi z Planu.');
  if (session.status !== 'planned' || session.day < week.today || session.day >= RACE_DAY) return reject('Nie przenosimy wykonanych, pominiętych ani minionych sesji, zawodów lub sesji po starcie.');
  if (!week.days.includes(targetDay) || targetDay < week.today || targetDay >= RACE_DAY) return reject('Wybierz przyszły dzień tego tygodnia przed startem.');
  if (session.day === targetDay) return reject('To już jest dzień tej sesji.');
  const occupied = week.sessions.some((s) => s.id !== sessionId && s.day === targetDay && s.status !== 'skipped');
  if (occupied) return reject('Dzień zawiera trening lub jawny odpoczynek. Nie nakładamy jednostek automatycznie.');
  const moved = { ...session, day: targetDay };
  const next = week.contextSessions.map((s) => s.id === sessionId ? moved : s);
  return {
    ok: true, sourceId: sessionId, from: session.day, to: targetDay, session: moved,
    warnings: calendarWarnings(next, week.days),
    reason: 'Alternatywa kalendarzowa: zachowano jednostkę i jej cele. Brak wpisu w dniu docelowym nie potwierdza dostępności ani gotowości.',
    requiresConfirmation: true, writeEnabled: false,
  };
}

export function suggestJointMove(week, sessionId) {
  const session = week?.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const proposals = week.days.map((day) => previewJointMove(week, sessionId, day)).filter((p) => p.ok);
  const ownWarnings = (p) => p.warnings.filter((w) => w.sessionIds?.includes(sessionId)).length;
  proposals.sort((a, b) => ownWarnings(a) - ownWarnings(b)
    || Math.abs(Date.parse(a.to) - Date.parse(session.day)) - Math.abs(Date.parse(b.to) - Date.parse(session.day))
    || a.to.localeCompare(b.to));
  return proposals[0] || null;
}

function strictPositive(input, allowZero = false) {
  const raw = blank(input).replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : null;
}

// Observed facts only: a missing session/day is not zero training or proof of adherence.
export function jointHistory(logRows = [], now = new Date()) {
  const today = plannerDay(now);
  if (!today) return { state: 'missing', runs: 0, boxing: 0, km: null, distanceCoverage: '0/0', invalidDates: 0 };
  const from = shiftPlannerDay(today, -27);
  let invalidDates = 0;
  const seen = new Set();
  let duplicateIds = 0;
  const records = logRows.flatMap((row) => {
    const day = plannerDay(value(row, 'date'));
    if (!day) { invalidDates += 1; return []; }
    if (day < from || day > today || statusOf(value(row, 'logStatus')) === 'skipped') return [];
    const id = blank(value(row, 'logSessionId'));
    if (id && seen.has(id)) { duplicateIds += 1; return []; }
    if (id) seen.add(id);
    const type = blank(value(row, 'logType'));
    const sport = plannerSport(type || value(row, 'logName'));
    return [{ day, sport, km: strictPositive(value(row, 'logDistance'), true) }];
  });
  const runs = records.filter((r) => r.sport === 'running');
  const known = runs.filter((r) => r.km !== null);
  return {
    state: invalidDates || duplicateIds ? 'data-error' : !records.length ? 'missing' : known.length < runs.length ? 'partial' : 'observed',
    from, to: today, runs: runs.length, boxing: records.filter((r) => r.sport === 'boxing').length,
    km: known.length && !duplicateIds ? known.reduce((sum, r) => sum + r.km, 0) : null,
    distanceCoverage: `${known.length}/${runs.length}`, invalidDates, duplicateIds,
  };
}
