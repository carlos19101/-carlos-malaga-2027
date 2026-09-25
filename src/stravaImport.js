import { normalize, parseNumber } from './parse.js';
import { plannerDay } from './jointPlanner.js';

export const STRAVA_IMPORT_CATEGORIES = Object.freeze(['Mobilizacja', 'Siła', 'Bieg']);
export const STRAVA_RUN_FIELDS = Object.freeze({ hrAvg: 'HR avg', hrMax: 'HR max' });
export const isStravaRun = activity => ['run', 'trailrun', 'virtualrun'].includes(normalize(activity?.sportType || activity?.type).replace(/\s/g, ''));

export const STRAVA_IMPORT_FIELDS = Object.freeze({
  date: 'Date',
  time: 'Time',
  type: 'Type',
  name: 'Name',
  distance: 'Distance_km',
  duration: 'Duration_min',
  durationText: 'Duration_text',
  rpe: 'RPE',
  srpe: 'sRPE',
  notes: 'Notes',
  source: 'Source',
  status: 'Status',
  sessionId: 'Session_ID',
});

const ACTIVITY_ID_PATTERN = /^[1-9]\d{0,63}$/;

function result(action, details = {}) {
  return { action, ...details };
}

function localStart(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)/);
  if (!match) return null;
  const [year, month, day] = match[1].split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { date: match[1], time: match[2] };
}

function exactHeaderIndex(headers, wanted) {
  const matches = headers.reduce((output, header, index) => (
    normalize(header) === normalize(wanted) ? [...output, index] : output
  ), []);
  return matches.length === 1 ? matches[0] : -1;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function durationText(seconds) {
  const roundedSeconds = Math.round(seconds);
  return `${Math.floor(roundedSeconds / 60)}:${String(roundedSeconds % 60).padStart(2, '0')}`;
}

export function validateStravaImportRequest(input = {}) {
  const activityId = String(input.activityId ?? '').trim();
  const category = String(input.category ?? '').trim();
  const rpe = parseNumber(input.rpe);
  const missingRunRpe = category === 'Bieg' && (input.rpe == null || String(input.rpe).trim() === '');
  const errors = {};
  if (!ACTIVITY_ID_PATTERN.test(activityId)) errors.activityId = 'Nieprawidłowe ID aktywności Stravy.';
  if (!STRAVA_IMPORT_CATEGORIES.includes(category)) errors.category = 'Wybierz dozwoloną kategorię.';
  if (!missingRunRpe && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) errors.rpe = 'RPE musi być liczbą całkowitą 1–10.';
  return Object.keys(errors).length ? result('invalid', { errors }) : result('valid', { value: { activityId, category, rpe } });
}

export function createStravaImportRecord(activity = {}, request = {}) {
  const validated = validateStravaImportRequest(request);
  if (validated.action !== 'valid') return validated;
  if (String(activity.id ?? '').trim() !== validated.value.activityId) {
    return result('invalid-source', { reason: 'Strava zwróciła inną aktywność niż wybrana.' });
  }
  const running = validated.value.category === 'Bieg';
  if (running !== isStravaRun(activity)) return result('invalid-source', { reason: 'Kategoria biegu musi odpowiadać typowi Run, TrailRun lub VirtualRun ze Stravy.' });
  const started = localStart(running ? activity.startLocal : activity.startLocal || activity.startAt);
  if (!started) return result('invalid-source', { reason: 'Aktywność Stravy nie ma poprawnego lokalnego czasu rozpoczęcia.' });
  const elapsedSeconds = parseNumber(activity.elapsedSeconds);
  const movingSeconds = parseNumber(activity.movingSeconds);
  const durationSeconds = elapsedSeconds !== null && elapsedSeconds > 0 ? elapsedSeconds : movingSeconds;
  if (durationSeconds === null || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60) {
    return result('invalid-source', { reason: 'Aktywność Stravy nie ma poprawnego czasu trwania.' });
  }
  const distanceMeters = parseNumber(activity.distanceMeters);
  if (running && (distanceMeters === null || distanceMeters <= 0)) return result('invalid-source', { reason: 'Bieg nie ma dodatniego dystansu ze źródła.' });
  const rawAvg = parseNumber(activity.averageHeartRate);
  const rawMax = parseNumber(activity.maxHeartRate);
  const hrAvg = activity.hasHeartRate === false || rawAvg === null || rawAvg === 0 ? '' : rawAvg;
  const hrMax = activity.hasHeartRate === false || rawMax === null || rawMax === 0 ? '' : rawMax;
  if (running && ([hrAvg,hrMax].some(n => n !== '' && (n < 20 || n > 250)) || (hrAvg !== '' && hrMax !== '' && hrAvg > hrMax))) return result('invalid-source', { reason: 'Niespójne tętno średnie lub maksymalne ze Stravy.' });
  const durationMinutes = rounded(durationSeconds / 60);
  const sessionId = `strava-${validated.value.activityId}`;
  const name = String(activity.name || validated.value.category).trim().slice(0, 160) || validated.value.category;
  const distance = distanceMeters !== null && distanceMeters > 0 ? rounded(distanceMeters / 1000) : '';
  const srpe = validated.value.rpe === null ? '' : rounded(durationMinutes * validated.value.rpe);
  const durationSource = elapsedSeconds !== null && elapsedSeconds > 0 ? 'elapsed_time (cały zapis, z postojami)' : 'moving_time (czas ruchu — proxy, brak czasu całkowitego)';
  return result('ready', {
    record: {
      sessionId,
      activityId: validated.value.activityId,
      category: validated.value.category,
      rpe: validated.value.rpe,
      values: {
        date: started.date,
        time: started.time,
        type: validated.value.category,
        name,
        distance,
        duration: durationMinutes,
        durationText: durationText(durationSeconds),
        rpe: validated.value.rpe ?? '',
        srpe,
        notes: `Zaimportowano ze Stravy · ID ${validated.value.activityId}. Kategoria potwierdzona przez zawodnika. Czas do Duration i sRPE: ${durationSource}.` + (running ? ' Brak powiązania z celem Runna; HR średnie/maksymalne nie określają czasu w strefach.' : ''),
        source: 'Strava',
        status: 'DONE',
        sessionId,
        ...(running ? { hrAvg, hrMax } : {}),
      },
    },
  });
}

export function planStravaActivityAppend(table = [], record = {}) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) {
    return result('contract-error', { missingHeaders: Object.values(STRAVA_IMPORT_FIELDS) });
  }
  const headers = table[0].map((value) => String(value ?? ''));
  const fields = { ...STRAVA_IMPORT_FIELDS, ...(record.category === 'Bieg' ? STRAVA_RUN_FIELDS : {}) };
  const indexes = Object.fromEntries(Object.entries(fields).map(([key, header]) => [key, exactHeaderIndex(headers, header)]));
  const missingHeaders = Object.entries(indexes).filter(([, index]) => index === -1).map(([key]) => fields[key]);
  if (missingHeaders.length) return result('contract-error', { missingHeaders });
  const sessionId = String(record.sessionId ?? '').trim();
  if (!/^strava-[1-9]\d{0,63}$/.test(sessionId) || record.values?.sessionId !== sessionId) return result('contract-error', { reason: 'Nieprawidłowy identyfikator importu.' });
  const matches = table.slice(1).map((row, index) => ({ rowNumber: index + 2, row }))
    .filter(({ row }) => String(row[indexes.sessionId] ?? '').trim() === sessionId);
  if (matches.length) return result(matches.length === 1 ? 'noop' : 'duplicate-session', {
    sessionId,
    ...(matches.length > 1 ? { rowNumbers: matches.map(({ rowNumber }) => rowNumber) } : { rowNumber: matches[0].rowNumber }),
  });

  if (record.category === 'Bieg') {
    const candidates = table.slice(1).map((row,index) => ({ row, rowNumber:index+2 })).filter(({row}) => {
      const type = normalize(row[indexes.type]).replace(/\s/g,'');
      const run = ['run','running','bieg','trailrun','virtualrun'].includes(type);
      const date = plannerDay(row[indexes.date]);
      return run && (!date || date === record.values.date);
    });
    if (candidates.length) return result('possible-duplicate', { sessionId, rowNumbers:candidates.map(c=>c.rowNumber), reason:'W dzienniku istnieje już bieg z tego dnia lub bieg bez czytelnej daty. Sprawdź go przed importem — nie nadpisujemy TCX ani feedbacku.' });
  }

  const rowValues = Array(headers.length).fill('');
  Object.entries(record.values || {}).forEach(([key, value]) => {
    if (indexes[key] !== undefined) rowValues[indexes[key]] = value;
  });
  return result('append', { sessionId, activityId: record.activityId, rowValues, headers });
}
