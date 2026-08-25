import { describe, expect, it } from 'vitest';
import {
  columnLetter,
  feedbackBatchData,
  FEEDBACK_SHEET_FIELDS,
  planTrainingFeedbackUpdate,
} from './trainingFeedbackServer.js';

const HEADERS = [
  'Date', 'Duration_min', 'RPE', 'sRPE', 'Pain', 'Session_ID',
  'Leg_Fatigue_0_10', 'Feedback_ID', 'Feedback_Submitted_At', 'Feedback_Notes', 'Feedback_Synced_At',
];

function feedback(overrides = {}) {
  return {
    sessionId: '2026-08-25-run-01', feedbackId: 'feedback-12345678',
    submittedAt: '2026-08-25T20:00:00.000Z', rpe: 3, pain: 0, legFatigue: 2, notes: 'OK',
    ...overrides,
  };
}

function table(rowOverrides = {}) {
  const values = {
    Date: '2026-08-25', Duration_min: 40, RPE: '', sRPE: '', Pain: '',
    Session_ID: '2026-08-25-run-01', Leg_Fatigue_0_10: '', Feedback_ID: '',
    Feedback_Submitted_At: '', Feedback_Notes: '', Feedback_Synced_At: '',
    ...rowOverrides,
  };
  return [HEADERS, HEADERS.map((header) => values[header])];
}

describe('planTrainingFeedbackUpdate', () => {
  it('planuje aktualizację istniejącej sesji i liczy sRPE', () => {
    const result = planTrainingFeedbackUpdate(table(), feedback(), { syncedAt: '2026-08-25T20:01:00.000Z' });
    expect(result).toMatchObject({ action: 'update', rowNumber: 2, duration: 40, srpe: 120 });
    expect(Object.fromEntries(result.updates.map(({ header, value }) => [header, value]))).toEqual({
      RPE: 3, sRPE: 120, Pain: 0, Leg_Fatigue_0_10: 2,
      Feedback_ID: 'feedback-12345678', Feedback_Submitted_At: '2026-08-25T20:00:00.000Z',
      Feedback_Notes: 'OK', Feedback_Synced_At: '2026-08-25T20:01:00.000Z',
    });
  });

  it('zwraca noop dla ponowienia tego samego Feedback_ID', () => {
    expect(planTrainingFeedbackUpdate(table({ Feedback_ID: 'feedback-12345678' }), feedback()))
      .toMatchObject({ action: 'noop', reason: 'same-feedback-id' });
  });

  it('starsza paczka nie nadpisuje nowszej oceny', () => {
    expect(planTrainingFeedbackUpdate(table({
      Feedback_ID: 'feedback-new-999', Feedback_Submitted_At: '2026-08-25T21:00:00.000Z',
    }), feedback())).toMatchObject({ action: 'stale', reason: 'newer-feedback-already-stored' });
  });

  it('odrzuca brak sesji i zduplikowany Session_ID', () => {
    expect(planTrainingFeedbackUpdate([HEADERS], feedback())).toMatchObject({ action: 'session-not-found' });
    expect(planTrainingFeedbackUpdate([...table(), table()[1]], feedback())).toMatchObject({ action: 'duplicate-session', rows: [2, 3] });
  });

  it('wylicza brakujące nagłówki kontraktu', () => {
    const result = planTrainingFeedbackUpdate([HEADERS.filter((header) => header !== 'Feedback_ID')], feedback());
    expect(result).toEqual({ action: 'contract-error', missingHeaders: ['Feedback_ID'] });
    expect(Object.values(FEEDBACK_SHEET_FIELDS)).toContain('Session_ID');
  });

  it('nie wymyśla sRPE bez Duration_min', () => {
    const result = planTrainingFeedbackUpdate(table({ Duration_min: '' }), feedback());
    expect(result).toMatchObject({ action: 'update', duration: null, srpe: '' });
  });
});

describe('feedbackBatchData', () => {
  it('tworzy precyzyjne zakresy A1 dla pojedynczego wiersza', () => {
    const plan = planTrainingFeedbackUpdate(table(), feedback(), { syncedAt: '2026-08-25T20:01:00.000Z' });
    expect(feedbackBatchData(plan)).toEqual(expect.arrayContaining([
      { range: "'Training Log'!C2", values: [[3]] },
      { range: "'Training Log'!G2", values: [[2]] },
      { range: "'Training Log'!K2", values: [['2026-08-25T20:01:00.000Z']] },
    ]));
  });

  it('obsługuje kolumny po Z i escapuje apostrof w nazwie zakładki', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(feedbackBatchData({ action: 'update', rowNumber: 2, updates: [{ columnIndex: 26, value: 1 }] }, "Coach's Log"))
      .toEqual([{ range: "'Coach''s Log'!AA2", values: [[1]] }]);
  });
});
