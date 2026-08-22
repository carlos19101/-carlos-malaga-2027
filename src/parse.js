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
  return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60 + p[1] + p[2] / 60;
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw.includes(':') || /^(?:—|-|#N\/A|N\/A|null|undefined)$/i.test(raw)) return null;

  const cleaned = raw
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');

  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseMetric(value) {
  return parseNumber(value) ?? parseClock(value);
}

export function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;

  let [, day, month, year, hh = '0', mm = '0'] = m;
  day = Number(day);
  month = Number(month);
  year = Number(year);
  const hour = Number(hh);
  const minute = Number(mm);
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}
