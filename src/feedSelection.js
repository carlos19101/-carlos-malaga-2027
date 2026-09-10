import { exactValue, parseDate } from './parse.js';
import { A } from './schema.js';

function syncTime(value) {
  const raw = String(value ?? '').trim();
  // Only explicit local timestamps: never infer a browser-dependent date format.
  if (!/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})[ T]\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) return -Infinity;
  const date = parseDate(raw);
  const seconds = Number(raw.match(/:\d{2}:(\d{2})$/)?.[1] ?? 0);
  if (!date || seconds > 59) return -Infinity;
  date.setSeconds(seconds);
  return date.getTime();
}

export function latestFeedRow(rows = []) {
  return rows.map((row, index) => {
    const date = parseDate(exactValue(row, A.date, ''));
    const day = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : -Infinity;
    return { row, index, day, synced: syncTime(exactValue(row, A.lastSynced, '')) };
  }).sort((a, b) => {
    if (a.day !== b.day) return a.day > b.day ? -1 : 1;
    if (a.synced !== b.synced) return a.synced > b.synced ? -1 : 1;
    // Equal/missing timestamps: the later source row is the deterministic fallback.
    return b.index - a.index;
  })[0]?.row ?? {};
}
