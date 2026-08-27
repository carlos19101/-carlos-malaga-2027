import { parseDate } from './parse.js';

export function parseTrainingLogTimestamp(dateValue, timeValue) {
  const date = parseDate(dateValue);
  const match = String(timeValue ?? '').trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!date || !match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, Number(match[2]), Number(match[3] || 0));
}

export function auditTrainingLogTimes(entries = []) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry, index) => {
    if (entry.requiresTimestamp === false) return [];
    if (parseTrainingLogTimestamp(entry.date, entry.time)) return [];
    const rawTime = String(entry.time ?? '').trim();
    return [{
      id: `training-log-time-${index}`,
      severity: 'warning',
      date: String(entry.date ?? '').trim() || 'bez daty',
      detail: `Training Log ${String(entry.date ?? '').trim() || 'bez daty'}${entry.name ? ` (${entry.name})` : ''}: ${rawTime ? `nieczytelna godzina Time „${rawTime}”` : 'brak godziny Time'}. Wpis nie może potwierdzić kolejności decyzja → wykonanie.`,
    }];
  });
}
