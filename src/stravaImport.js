import { normalize, parseNumber } from './parse.js';

export const STRAVA_IMPORT_CATEGORIES = Object.freeze(['Mobilizacja', 'Siła']);

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
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})T([0-2]\d:[0-5]\d:[0-5]\d)/);
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
  const errors = {};
  if (!ACTIVITY_ID_PATTERN.test(activityId)) errors.activityId = 'Nieprawidłowe ID aktywności Stravy.';
  if (!STRAVA_IMPORT_CATEGORIES.includes(category)) errors.category = 'Wybierz dozwoloną kategorię.';
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) errors.rpe = 'RPE musi być liczbą całkowitą 1–10.';
  return Object.keys(errors).length ? result('invalid', { errors }) : result('valid', { value: { activityId, category, rpe } });
}

export function createStravaImportRecord(activity = {}, request = {}) {
  const validated = validateStravaImportRequest(request);
  if (validated.action !== 'valid') return validated;
  if (String(activity.id ?? '').trim() !== validated.value.activityId) {
    return result('invalid-source', { reason: 'Strava zwróciła inną aktywność niż wybrana.' });
  }
  const started = localStart(activity.startLocal || activity.startAt);
  if (!started) return result('invalid-source', { reason: 'Aktywność Stravy nie ma poprawnego lokalnego czasu rozpoczęcia.' });
  const elapsedSeconds = parseNumber(activity.elapsedSeconds);
  const movingSeconds = parseNumber(activity.movingSeconds);
  const durationSeconds = elapsedSeconds !== null && elapsedSeconds > 0 ? elapsedSeconds : movingSeconds;
  if (durationSeconds === null || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60) {
    return result('invalid-source', { reason: 'Aktywność Stravy nie ma poprawnego czasu trwania.' });
  }
  const distanceMeters = parseNumber(activity.distanceMeters);
  const durationMinutes = rounded(durationSeconds / 60);
  const sessionId = `strava-${validated.value.activityId}`;
  const name = String(activity.name || validated.value.category).trim().slice(0, 160) || validated.value.category;
  const distance = distanceMeters !== null && distanceMeters > 0 ? rounded(distanceMeters / 1000) : '';
  const srpe = rounded(durationMinutes * validated.value.rpe);
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
        rpe: validated.value.rpe,
        srpe,
        notes: `Zaimportowano ze Stravy · ID ${validated.value.activityId}. Kategoria potwierdzona przez zawodnika.`,
        source: 'Strava',
        status: 'DONE',
        sessionId,
      },
    },
  });
}

export function planStravaActivityAppend(table = [], record = {}) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) {
    return result('contract-error', { missingHeaders: Object.values(STRAVA_IMPORT_FIELDS) });
  }
  const headers = table[0].map((value) => String(value ?? ''));
  const indexes = Object.fromEntries(Object.entries(STRAVA_IMPORT_FIELDS).map(([key, header]) => [key, exactHeaderIndex(headers, header)]));
  const missingHeaders = Object.entries(indexes).filter(([, index]) => index === -1).map(([key]) => STRAVA_IMPORT_FIELDS[key]);
  if (missingHeaders.length) return result('contract-error', { missingHeaders });
  const sessionId = String(record.sessionId ?? '').trim();
  const matches = table.slice(1).map((row, index) => ({ rowNumber: index + 2, row }))
    .filter(({ row }) => String(row[indexes.sessionId] ?? '').trim() === sessionId);
  if (matches.length) return result(matches.length === 1 ? 'noop' : 'duplicate-session', {
    sessionId,
    ...(matches.length > 1 ? { rowNumbers: matches.map(({ rowNumber }) => rowNumber) } : { rowNumber: matches[0].rowNumber }),
  });

  const rowValues = Array(headers.length).fill('');
  Object.entries(record.values || {}).forEach(([key, value]) => {
    if (indexes[key] !== undefined) rowValues[indexes[key]] = value;
  });
  return result('append', { sessionId, activityId: record.activityId, rowValues, headers });
}
