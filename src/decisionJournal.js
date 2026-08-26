import { parseRawTimestamp } from './dailyMetrics.js';
import { exactValue, isNullish, normalize, parseDate, parseNumber } from './parse.js';

const FIELDS = {
  date: ['date'],
  timestamp: ['timestamp'],
  source: ['source'],
  status: ['coach status'],
  decision: ['coach decision'],
};

export const DECISION_EVIDENCE_FIELDS = {
  sleepMinutes: { label: 'Sen', aliases: ['sleep min'], min: 0, max: 1440, unit: 'min' },
  sleepScore: { label: 'Sleep Score', aliases: ['sleep score'], min: 0, max: 100, unit: '/100' },
  hrv: { label: 'HRV', aliases: ['hrv night ms'], min: 10, max: 250, unit: 'ms' },
  rhr: { label: 'RHR', aliases: ['rhr bpm'], min: 30, max: 120, unit: 'bpm' },
  readiness: { label: 'Gotowość treningowa Garmina', aliases: ['readiness garmin'], min: 0, max: 100, unit: '/100' },
  bodyBattery: { label: 'Body Battery', aliases: ['bodybattery current'], min: 0, max: 100, unit: '/100' },
  bodyBatteryGain: { label: 'BB gain', aliases: ['bodybattery gain'], min: 0, max: 100, unit: '' },
  pain: { label: 'Ból', aliases: ['pain 0 10'], min: 0, max: 10, unit: '/10' },
  doms: { label: 'DOMS', aliases: ['doms 0 10'], min: 0, max: 10, unit: '/10' },
  fatigue: { label: 'Zmęczenie', aliases: ['fatigue 0 10'], min: 0, max: 10, unit: '/10' },
};

function dayKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sourcePriority(field, sourceValue) {
  const source = normalize(sourceValue);
  if (['pain', 'doms', 'fatigue'].includes(field) && source.includes('user')) return 5;
  if (source.includes('agent garmin')) return 4;
  if (source.includes('garmin')) return 3;
  if (source.includes('user')) return 2;
  if (source.includes('head coach')) return 1;
  return 0;
}

function evidenceForDecision(field, definition, rows, decisionTime, date, issues) {
  const candidates = rows.flatMap((row, rowIndex) => {
    const raw = exactValue(row, definition.aliases, '');
    if (isNullish(raw)) return [];
    const value = parseNumber(raw);
    if (value === null || value < definition.min || value > definition.max) {
      issues.push({
        id: `invalid-evidence-${field}`,
        severity: 'warning',
        date,
        detail: `${definition.label}: wartość ${raw} poza kontraktem ${definition.min}–${definition.max}.`,
      });
      return [];
    }
    const rawTimestamp = exactValue(row, FIELDS.timestamp, '');
    const timestamp = parseRawTimestamp(rawTimestamp) || parseDate(exactValue(row, FIELDS.date, ''));
    if (!timestamp || timestamp.getTime() > decisionTime.getTime()) return [];
    const source = exactValue(row, FIELDS.source, '');
    return [{ value, timestamp, rawTimestamp, source, priority: sourcePriority(field, source), rowIndex }];
  }).sort((a, b) => b.timestamp - a.timestamp || b.priority - a.priority || b.rowIndex - a.rowIndex);

  if (!candidates.length) return null;
  const first = candidates[0];
  const tied = candidates.filter((candidate) => (
    candidate.timestamp.getTime() === first.timestamp.getTime() && candidate.priority === first.priority
  ));
  const tiedValues = [...new Set(tied.map(({ value }) => value))];
  if (tiedValues.length > 1) {
    issues.push({
      id: `ambiguous-evidence-${field}`,
      severity: 'warning',
      date,
      detail: `${definition.label}: sprzeczne dowody z tym samym czasem i priorytetem źródła.`,
    });
    return null;
  }
  return {
    field,
    label: definition.label,
    value: first.value,
    unit: definition.unit,
    observedAt: first.rawTimestamp || dayKey(first.timestamp),
    source: first.source,
  };
}

export function buildDecisionJournal(rawRows = [], options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : Infinity;
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const issues = [];
  const rowsByDay = new Map();

  rows.forEach((row) => {
    const date = dayKey(exactValue(row, FIELDS.date, ''));
    if (!date) return;
    if (!rowsByDay.has(date)) rowsByDay.set(date, []);
    rowsByDay.get(date).push(row);
  });

  const entries = rows.flatMap((row, rowIndex) => {
    const recommendation = String(exactValue(row, FIELDS.decision, '') || '').trim();
    const rawStatus = String(exactValue(row, FIELDS.status, '') || '').trim();
    if (!recommendation && !rawStatus) return [];
    const rawDate = exactValue(row, FIELDS.date, '');
    const date = dayKey(rawDate);
    if (!date) {
      issues.push({ id: 'undated-decision', severity: 'error', date: null, detail: 'Decyzja bez czytelnej daty.' });
      return [];
    }
    const rawTimestamp = exactValue(row, FIELDS.timestamp, '');
    const timestamp = parseRawTimestamp(rawTimestamp) || parseDate(rawDate);
    if (!timestamp) return [];
    const evidence = Object.entries(DECISION_EVIDENCE_FIELDS).map(([field, definition]) => (
      evidenceForDecision(field, definition, rowsByDay.get(date) || [], timestamp, date, issues)
    )).filter(Boolean);
    return [{
      id: `${date}-${timestamp.getTime()}-${rowIndex}`,
      date,
      timestamp,
      rawTimestamp: rawTimestamp || date,
      status: rawStatus ? rawStatus.toUpperCase() : 'INFO',
      recommendation,
      source: exactValue(row, FIELDS.source, ''),
      evidence,
    }];
  }).sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id)).slice(0, limit);

  return { entries, issues };
}

export function verifyDecisionStatus(feedDecision = {}, journalEntries = []) {
  const date = dayKey(feedDecision.date);
  const fromFeed = String(feedDecision.status ?? '').trim().toUpperCase();
  if (!date || !fromFeed) return { state: 'unverified', checkedDate: date, entry: null, mismatches: [] };

  const entry = (Array.isArray(journalEntries) ? journalEntries : [])
    .find((candidate) => candidate.date === date) || null;
  if (!entry) return { state: 'unverified', checkedDate: date, entry: null, mismatches: [] };

  const fromRaw = String(entry.status ?? '').trim().toUpperCase();
  if (fromRaw === fromFeed && ['GREEN', 'YELLOW', 'RED'].includes(fromRaw)) {
    return { state: 'verified', checkedDate: date, entry, mismatches: [] };
  }

  return {
    state: 'mismatch',
    checkedDate: date,
    entry,
    mismatches: [{
      field: 'coachStatus',
      label: 'STATUS DECYZJI',
      unit: '',
      fromFeed: fromFeed || 'brak',
      computed: fromRaw || 'brak',
      delta: null,
      severity: 'error',
      source: 'Raw_Data',
    }],
  };
}
