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
    // Coach_Status is the explicit marker of a daily decision. A text-only Coach_Decision
    // may be a post-run note and must not be promoted to a decision retrospectively.
    if (!rawStatus) return [];
    const rawDate = exactValue(row, FIELDS.date, '');
    const date = dayKey(rawDate);
    if (!date) {
      issues.push({ id: 'undated-decision', severity: 'error', date: null, detail: 'Decyzja bez czytelnej daty.' });
      return [];
    }
    const rawTimestamp = exactValue(row, FIELDS.timestamp, '');
    const timestamp = parseRawTimestamp(rawTimestamp) || parseDate(rawDate);
    if (!timestamp) return [];
    if (!recommendation) {
      issues.push({
        id: `incomplete-decision-${date}-${timestamp.getTime()}-${rowIndex}`,
        severity: 'warning',
        date,
        detail: 'Decyzja sztabu jest niekompletna: brak Coach_Decision.',
      });
    }
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

function shiftedDayKey(dateValue, offset) {
  const date = parseDate(dateValue);
  if (!date) return null;
  date.setDate(date.getDate() + offset);
  return dayKey(date);
}

function decisionIntent(recommendation) {
  const text = normalize(recommendation);
  if (!text) return 'unknown';
  if (/\b(off|recovery|odpoczynek|regeneracja|rest|bez treningu)\b/.test(text)) return 'recovery';
  if (/\b(bieg|biegnij|trening|easy|run|marszobieg)\b/.test(text)) return 'training';
  return 'unknown';
}

function executionRecord(intent, sessionCount, preDecisionCount, unknownTimeCount, entryDate, today) {
  if (sessionCount > 0) {
    return intent === 'recovery' ? 'session-during-recovery' : 'session-recorded';
  }
  if (preDecisionCount > 0) return 'session-before-decision';
  if (unknownTimeCount > 0) return 'same-day-time-unknown';
  if (entryDate >= today) return 'pending';
  if (intent === 'training') return 'training-not-recorded';
  if (intent === 'recovery') return 'recovery-not-verifiable';
  return 'unknown';
}

function sessionTimestamp(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : parseRawTimestamp(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function attachDecisionOutcomes(journal = {}, sessions = [], dailyDays = [], options = {}) {
  const today = dayKey(options.today || new Date());
  const required = Number.isInteger(options.required) && options.required > 0 ? options.required : 3;
  const sessionRows = Array.isArray(sessions) ? sessions : [];
  const dayRows = Array.isArray(dailyDays) ? dailyDays : [];
  const entries = (journal.entries || []).map((entry) => {
    const sameDaySessions = sessionRows.filter(({ date }) => dayKey(date) === entry.date);
    const matchedSessions = sameDaySessions.filter((session) => {
      const timestamp = sessionTimestamp(session.timestamp);
      return timestamp && timestamp.getTime() >= entry.timestamp.getTime();
    });
    const preDecisionSessions = sameDaySessions.filter((session) => {
      const timestamp = sessionTimestamp(session.timestamp);
      return timestamp && timestamp.getTime() < entry.timestamp.getTime();
    });
    const unknownTimeSessions = sameDaySessions.filter(({ timestamp }) => !sessionTimestamp(timestamp));
    const nextDate = shiftedDayKey(entry.date, 1);
    const reactionDay = dayRows.find(({ date }) => dayKey(date) === nextDate) || null;
    const evidenceValue = (field) => parseNumber(entry.evidence?.find((item) => item.field === field)?.value);
    const nextHrv = parseNumber(reactionDay?.values?.hrv);
    const nextRhr = parseNumber(reactionDay?.values?.rhr);
    const hrvAtDecision = evidenceValue('hrv');
    const rhrAtDecision = evidenceValue('rhr');
    const intent = decisionIntent(entry.recommendation);
    const state = matchedSessions.length
      ? 'observed'
      : preDecisionSessions.length ? 'session-before-decision'
        : unknownTimeSessions.length ? 'same-day-time-unknown'
          : today && entry.date >= today ? 'pending' : 'no-session-recorded';

    return {
      ...entry,
      outcome: {
        state,
        intent,
        executionRecord: executionRecord(intent, matchedSessions.length, preDecisionSessions.length, unknownTimeSessions.length, entry.date, today),
        sessions: matchedSessions,
        preDecisionSessions,
        unknownTimeSessions,
        reaction: reactionDay ? {
          date: nextDate,
          hrv: nextHrv,
          rhr: nextRhr,
          hrvDelta: nextHrv !== null && hrvAtDecision !== null ? nextHrv - hrvAtDecision : null,
          rhrDelta: nextRhr !== null && rhrAtDecision !== null ? nextRhr - rhrAtDecision : null,
        } : null,
      },
    };
  });
  const observed = entries.filter(({ outcome }) => outcome.state === 'observed').length;
  return {
    ...journal,
    entries,
    outcomeCalibration: {
      state: observed >= required ? 'ready' : 'calibrating',
      observed,
      required,
      sample: `${Math.min(observed, required)}/${required}`,
    },
  };
}
