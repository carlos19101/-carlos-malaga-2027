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

export const CLOCK_RE = /^\d{1,3}:[0-5]\d(:[0-5]\d)?$/;

export function parseClock(value) {
  const raw = String(value ?? '').trim();
  if (!CLOCK_RE.test(raw)) return null;
  const p = raw.split(':').map(Number);
  return p.length === 2 ? p[0] + p[1] / 60 : p[0] * 60 + p[1] + p[2] / 60;
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw.includes(':') || /^(?:—|-|#N\/A|N\/A|null|undefined)$/i.test(raw)) return null;

  const cleaned = raw
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');

  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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

// Training Log history started with a schema where the activity type was the third CSV column.
// Exact aliases remain primary; the positional fallback is intentionally bounded only to this label.
export function resolveLogSession(row, aliases = []) {
  if (!row || typeof row !== 'object') return '';
  const exact = exactValue(row, aliases, '');
  if (exact) return exact;
  const legacy = Object.values(row)[2];
  return String(legacy ?? '').trim();
}
