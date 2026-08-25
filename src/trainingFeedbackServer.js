import { normalize, parseNumber } from './parse.js';
import { validateTrainingFeedback } from './trainingFeedback.js';

export const FEEDBACK_SHEET_FIELDS = {
  sessionId: 'Session_ID',
  duration: 'Duration_min',
  rpe: 'RPE',
  srpe: 'sRPE',
  pain: 'Pain',
  legFatigue: 'Leg_Fatigue_0_10',
  feedbackId: 'Feedback_ID',
  submittedAt: 'Feedback_Submitted_At',
  notes: 'Feedback_Notes',
  syncedAt: 'Feedback_Synced_At',
};

function headerIndex(headers) {
  return new Map(headers.map((header, index) => [normalize(header), index]));
}

function parseStoredTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function planTrainingFeedbackUpdate(table = [], input = {}, options = {}) {
  const validated = validateTrainingFeedback(input);
  if (!validated.ok) return { action: 'invalid', errors: validated.errors };
  if (!Array.isArray(table) || !Array.isArray(table[0])) {
    return { action: 'contract-error', missingHeaders: Object.values(FEEDBACK_SHEET_FIELDS) };
  }

  const headers = table[0].map((value) => String(value ?? ''));
  const index = headerIndex(headers);
  const missingHeaders = Object.values(FEEDBACK_SHEET_FIELDS).filter((header) => !index.has(normalize(header)));
  if (missingHeaders.length) return { action: 'contract-error', missingHeaders };

  const sessionColumn = index.get(normalize(FEEDBACK_SHEET_FIELDS.sessionId));
  const matches = table.slice(1).map((row, offset) => ({ row, rowNumber: offset + 2 }))
    .filter(({ row }) => String(row?.[sessionColumn] ?? '').trim() === validated.value.sessionId);
  if (!matches.length) return { action: 'session-not-found', sessionId: validated.value.sessionId };
  if (matches.length > 1) return { action: 'duplicate-session', sessionId: validated.value.sessionId, rows: matches.map(({ rowNumber }) => rowNumber) };

  const { row, rowNumber } = matches[0];
  const fieldValue = (field) => row?.[index.get(normalize(FEEDBACK_SHEET_FIELDS[field]))] ?? '';
  const existingFeedbackId = String(fieldValue('feedbackId') || '').trim();
  const existingSubmittedAt = parseStoredTimestamp(fieldValue('submittedAt'));
  if (existingFeedbackId === validated.value.feedbackId) {
    return { action: 'noop', reason: 'same-feedback-id', rowNumber, sessionId: validated.value.sessionId };
  }
  if (existingSubmittedAt && existingSubmittedAt >= validated.value.submittedAt) {
    return {
      action: 'stale', reason: 'newer-feedback-already-stored', rowNumber,
      sessionId: validated.value.sessionId, existingSubmittedAt,
    };
  }

  const duration = parseNumber(fieldValue('duration'));
  const srpe = duration === null ? '' : duration * validated.value.rpe;
  const syncedAt = (options.syncedAt instanceof Date ? options.syncedAt : new Date(options.syncedAt || Date.now())).toISOString();
  const values = {
    rpe: validated.value.rpe,
    srpe,
    pain: validated.value.pain,
    legFatigue: validated.value.legFatigue,
    feedbackId: validated.value.feedbackId,
    submittedAt: validated.value.submittedAt,
    notes: validated.value.notes,
    syncedAt,
  };
  const updates = Object.entries(values).map(([field, value]) => ({
    field,
    header: FEEDBACK_SHEET_FIELDS[field],
    columnIndex: index.get(normalize(FEEDBACK_SHEET_FIELDS[field])),
    value,
  }));

  return {
    action: 'update', rowNumber, sessionId: validated.value.sessionId,
    feedbackId: validated.value.feedbackId, submittedAt: validated.value.submittedAt,
    duration, srpe, updates,
  };
}

export function columnLetter(zeroBasedIndex) {
  if (!Number.isInteger(zeroBasedIndex) || zeroBasedIndex < 0) return null;
  let value = zeroBasedIndex + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function feedbackBatchData(plan, sheetName = 'Training Log') {
  if (plan?.action !== 'update') return [];
  const quotedSheet = `'${String(sheetName).replaceAll("'", "''")}'`;
  return plan.updates.map(({ columnIndex, value }) => {
    const column = columnLetter(columnIndex);
    return { range: `${quotedSheet}!${column}${plan.rowNumber}`, values: [[value]] };
  });
}
