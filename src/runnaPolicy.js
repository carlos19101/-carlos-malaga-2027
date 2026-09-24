import { exactValue, parseDate } from './parse.js';
import { A } from './schema.js';

// User-approved prospective cutover. Never rescore the earlier training block.
export const RUNNA_AUTHORITY_FROM = '2026-09-24';
export const RUNNA_TARGET_PENDING = 'Od 24.09 plan biegowy ustala Runna. Brak zweryfikowanego powiązania z pełnym celem Runny — stary cel CARLOS nie jest używany do oceny ani zapisu analizy TCX.';

export function isRunnaDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return false;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = type => parts.find(p => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}` >= RUNNA_AUTHORITY_FROM;
  }
  const parsed = parseDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return false;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) >= Date.UTC(2026, 8, 24);
}

// These callers operate on running execution only, not boxing targets.
export const isRunnaSession = row => isRunnaDate(exactValue(row || {}, A.date, ''));

export function runnaDayState(reference, today) {
  const week = reference?.weeks.find(w => w.start <= today && today <= w.end);
  if (!week) return { state: 'missing', session: null };
  return { state: 'covered', session: week.sessions.find(s => s.date === today) || null };
}
