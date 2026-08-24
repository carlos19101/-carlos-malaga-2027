export function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((h, i) => String(h).trim() || `column_${i + 1}`);
  return nonEmpty.slice(1).map((values) => {
    const out = {};
    headers.forEach((header, i) => { out[header] = values[i] ?? ''; });
    return out;
  });
}

export function buildSheetCsvUrl(sheetId, sheetName, cacheBuster = Date.now(), query = '') {
  const queryParam = query ? `&tq=${encodeURIComponent(query)}` : '';
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&headers=1${queryParam}&_t=${cacheBuster}`;
}

export const CLOCK_RE = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/;
export const NULLISH = /^(?:—|–|-|#N\/A|#DIV\/0!|N\/A|null|undefined)$/i;

export function isNullish(value) {
  const raw = String(value ?? '').trim();
  return raw === '' || NULLISH.test(raw);
}

export function parseClock(value) {
  const raw = String(value ?? '').trim();
  if (!CLOCK_RE.test(raw)) return null;
  const p = raw.split(':').map(Number);
  return p.length === 2 ? p[0] + p[1] / 60 : p[0] * 60 + p[1] + p[2] / 60;
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (isNullish(raw) || raw.includes(':')) return null;

  const cleaned = raw
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');

  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatMetricNumber(value, {
  maximumFractionDigits = 2,
  minimumFractionDigits = 0,
  fallback = '—',
} = {}) {
  const n = parseNumber(value);
  if (n === null) return fallback;
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits, minimumFractionDigits }).format(n);
}

export function parseMetric(value) {
  return parseNumber(value) ?? parseClock(value);
}

function validLocalDate(year, month, day, hour = 0, minute = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day || d.getHours() !== hour || d.getMinutes() !== minute) return null;
  return d;
}

export function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // ISO-like local time: 2026-08-21, 2026-08-21 22:34, 2026-08-21T22:34
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, hh = '0', mm = '0'] = m;
    return validLocalDate(Number(y), Number(mo), Number(d), Number(hh), Number(mm));
  }

  // pl-PL / common EU: 21.08.2026 22:34, 21/08/2026, 21-08-26
  m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;

  let [, day, month, year, hh = '0', mm = '0'] = m;
  day = Number(day);
  month = Number(month);
  year = Number(year);
  if (year < 100) year += 2000;
  return validLocalDate(year, month, day, Number(hh), Number(mm));
}

export function normalizeActivityStatus(value) {
  const status = String(value ?? '').trim().toUpperCase();
  return status === 'RECOVERY' ? 'DONE' : status;
}

export function isRecoveryActivity(type, status = '') {
  const containsRecovery = (value) => /(^|[\s/])recovery($|[\s/])/.test(normalize(value));
  return containsRecovery(type) || containsRecovery(status);
}

export function validateDailyFeed(values = {}) {
  const hasText = (value) => {
    return !isNullish(value);
  };
  const required = [
    ['status', 'Status', hasText],
    ['hrv', 'HRV', (value) => parseNumber(value) !== null],
    ['rhr', 'RHR', (value) => parseNumber(value) !== null],
    ['weight', 'Weight', (value) => parseNumber(value) !== null],
    ['date', 'data', (value) => parseDate(value) !== null],
  ];
  const missing = required
    .filter(([field, , present]) => !present(values[field]))
    .map(([, label]) => label);
  const suspicious = [];
  const ranges = {
    readiness: ['Readiness', 0, 100],
    recovery: ['Recovery', 0, 100],
    bodyBattery: ['Body Battery', 0, 100],
    sleep: ['Sleep', 0, 100],
    hrv: ['HRV', 10, 250],
    rhr: ['RHR', 30, 120],
    weight: ['Weight', 50, 160],
    pain: ['Pain', 0, 10],
  };
  Object.entries(ranges).forEach(([field, [label, lo, hi]]) => {
    const raw = String(values[field] ?? '').trim();
    if (isNullish(raw)) return;
    const n = parseNumber(raw);
    if (n === null) suspicious.push(`${label}: nieprawidłowa liczba`);
    else if (n < lo || n > hi) suspicious.push(`${label}=${n} poza ${lo}–${hi}`);
  });
  return { ok: missing.length === 0 && suspicious.length === 0, missing, suspicious };
}

export function exactKey(row, aliases = []) {
  if (!row || typeof row !== 'object') return null;
  const wanted = new Set(aliases.map(normalize));
  return Object.keys(row).find((key) => wanted.has(normalize(key))) || null;
}

export function exactValue(row, aliases = [], fallback = '') {
  const key = exactKey(row, aliases);
  if (!key) return fallback;
  const value = String(row[key] ?? '').trim();
  return value === '' ? fallback : value;
}

export function datedRowsError(rows = [], aliases = ['date', 'data'], label = 'Arkusz') {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const hasDatedRow = rows.some((row) => parseDate(exactValue(row, aliases, '')) !== null);
  return hasDatedRow ? '' : `${label}: ${rows.length} wierszy, żaden nie ma czytelnej daty`;
}

export function findRecentMeasurement(rows = [], {
  dateAliases = ['date', 'data'],
  valueAliases = [],
  now = new Date(),
  maxAgeDays = 7,
} = {}) {
  const current = now instanceof Date ? new Date(now) : parseDate(now);
  if (!current || Number.isNaN(current.getTime()) || maxAgeDays <= 0) return null;
  const calendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const currentDay = calendarDay(current);
  const candidates = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const date = parseDate(exactValue(row, dateAliases, ''));
    const value = exactValue(row, valueAliases, '');
    if (!date || parseNumber(value) === null) return null;
    const ageDays = currentDay - calendarDay(date);
    if (ageDays < 0 || ageDays >= maxAgeDays) return null;
    return { value, date, ageDays, index };
  }).filter(Boolean).sort((a, b) => b.date - a.date || b.index - a.index);
  if (!candidates.length) return null;
  const { value, date, ageDays } = candidates[0];
  return { value, date, ageDays };
}

// Training Log history started with a schema where the activity type was the third CSV column.
// Exact aliases remain primary; the positional fallback is intentionally bounded only to this label.
export function resolveLogSession(row, aliases = []) {
  if (!row || typeof row !== 'object') return '';
  const exact = exactValue(row, aliases, '');
  if (exact) return exact;
  const legacy = Object.values(row)[2];
  return String(legacy ?? '').trim();
}
