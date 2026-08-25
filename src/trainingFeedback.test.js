import { describe, expect, it, vi } from 'vitest';
import {
  createTrainingFeedback,
  enqueueTrainingFeedback,
  FEEDBACK_QUEUE_KEY,
  flushTrainingFeedbackQueue,
  readFeedbackQueue,
  validateTrainingFeedback,
} from './trainingFeedback.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    value: (key) => values.get(key),
  };
}

function valid(overrides = {}) {
  return {
    sessionId: '2026-08-25-run-01',
    feedbackId: 'feedback-12345678',
    submittedAt: '2026-08-25T20:00:00.000Z',
    rpe: 3,
    pain: 0,
    legFatigue: 2,
    notes: 'Lekko.',
    ...overrides,
  };
}

describe('validateTrainingFeedback', () => {
  it('normalizuje prawidłowy formularz', () => {
    expect(validateTrainingFeedback(valid({ rpe: '3,5', notes: '  OK  ' }))).toEqual({
      ok: true,
      errors: {},
      value: valid({ rpe: 3.5, notes: 'OK' }),
    });
  });

  it.each([
    ['rpe', -1], ['rpe', 11], ['pain', '#N/A'], ['legFatigue', ''],
  ])('odrzuca %s=%s poza skalą', (field, value) => {
    expect(validateTrainingFeedback(valid({ [field]: value })).ok).toBe(false);
  });

  it('odrzuca nieprawidłowe identyfikatory, czas i zbyt długą notatkę', () => {
    const result = validateTrainingFeedback(valid({
      sessionId: '../x', feedbackId: 'x', submittedAt: 'nie-data', notes: 'x'.repeat(501),
    }));
    expect(result.errors).toEqual({
      sessionId: expect.any(String), feedbackId: expect.any(String),
      submittedAt: expect.any(String), notes: expect.any(String),
    });
  });
});

describe('createTrainingFeedback', () => {
  it('nadaje stabilny identyfikator i czas przez wstrzyknięte zależności', () => {
    expect(createTrainingFeedback({ sessionId: '2026-08-25-run-01', rpe: 3, pain: 0, legFatigue: 2 }, {
      now: new Date('2026-08-25T20:00:00.000Z'), idFactory: () => 'feedback-12345678',
    })).toEqual(valid({ notes: '' }));
  });

  it('rzuca błąd z mapą walidacji', () => {
    expect(() => createTrainingFeedback({})).toThrow('Nieprawidłowy feedback treningowy.');
  });
});

describe('kolejka offline', () => {
  it('odporne czytanie zwraca pustą kolejkę dla uszkodzonego JSON', () => {
    expect(readFeedbackQueue(memoryStorage({ [FEEDBACK_QUEUE_KEY]: '{' }))).toEqual([]);
  });

  it('dla jednej sesji zachowuje wyłącznie najnowszą ocenę', () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid({ feedbackId: 'feedback-old-123', submittedAt: '2026-08-25T19:00:00.000Z', rpe: 2 }));
    enqueueTrainingFeedback(storage, valid({ feedbackId: 'feedback-new-123', submittedAt: '2026-08-25T20:00:00.000Z', rpe: 4 }));
    expect(readFeedbackQueue(storage)).toEqual([expect.objectContaining({ feedbackId: 'feedback-new-123', rpe: 4 })]);
  });

  it('synchronizuje elementy po kolei i usuwa tylko potwierdzone', async () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    enqueueTrainingFeedback(storage, valid({ sessionId: '2026-08-24-run-01', feedbackId: 'feedback-87654321' }));
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await flushTrainingFeedbackQueue(storage, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ blocked: null, remaining: [], rejected: [] });
    expect(readFeedbackQueue(storage)).toEqual([]);
  });

  it('przy braku sieci zachowuje bieżący i wszystkie dalsze elementy', async () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    enqueueTrainingFeedback(storage, valid({ sessionId: '2026-08-24-run-01', feedbackId: 'feedback-87654321' }));
    const result = await flushTrainingFeedbackQueue(storage, vi.fn().mockRejectedValue(new Error('offline')));
    expect(result.blocked).toBe('offline');
    expect(result.remaining).toHaveLength(2);
  });

  it('401 zatrzymuje kolejkę, a 422 odrzuca tylko wadliwą paczkę', async () => {
    const authStorage = memoryStorage();
    enqueueTrainingFeedback(authStorage, valid());
    const auth = await flushTrainingFeedbackQueue(authStorage, vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    expect(auth).toMatchObject({ blocked: 'auth' });
    expect(auth.remaining).toHaveLength(1);

    const invalidStorage = memoryStorage();
    enqueueTrainingFeedback(invalidStorage, valid());
    const invalid = await flushTrainingFeedbackQueue(invalidStorage, vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    expect(invalid).toMatchObject({ blocked: null, remaining: [] });
    expect(invalid.rejected).toHaveLength(1);
  });

  it('404 zostawia ocenę do ponowienia po pojawieniu się sesji', async () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    const result = await flushTrainingFeedbackQueue(storage, vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(result).toMatchObject({ blocked: 'session-not-ready' });
    expect(readFeedbackQueue(storage)).toHaveLength(1);
  });
});
