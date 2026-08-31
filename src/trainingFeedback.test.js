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
    schemaVersion: 2,
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
    ['rpe', 0], ['rpe', -1], ['rpe', 11], ['pain', '#N/A'], ['legFatigue', ''],
  ])('odrzuca %s=%s poza skalą', (field, value) => {
    expect(validateTrainingFeedback(valid({ [field]: value })).ok).toBe(false);
  });

  it('czyta starą lokalną paczkę z RPE 0 bez zmiany jej danych', () => {
    const legacy = valid({ schemaVersion: undefined, rpe: 0 });
    const storage = memoryStorage({ [FEEDBACK_QUEUE_KEY]: JSON.stringify([legacy]) });
    expect(validateTrainingFeedback(legacy).ok).toBe(false);
    expect(validateTrainingFeedback(legacy, { allowLegacyRpeZero: true })).toMatchObject({
      ok: true,
      value: expect.objectContaining({ rpe: 0, schemaVersion: 2 }),
    });
    expect(readFeedbackQueue(storage)).toEqual([legacy]);
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
  it('nie zastępuje nowszej oceny starszą, dodaną później', () => {
    const storage = memoryStorage();
    const newer = valid({ feedbackId: 'feedback-newer-123', submittedAt: '2026-08-25T21:00:00.000Z', rpe: 4 });
    enqueueTrainingFeedback(storage, newer);
    enqueueTrainingFeedback(storage, valid());
    expect(readFeedbackQueue(storage)).toEqual([newer]);
  });

  it.each([false, true])('wysyła również ocenę dodaną podczas oczekiwania na sieć (ta sama sesja: %s)', async (sameSession) => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const newer = valid({
      sessionId: sameSession ? valid().sessionId : '2026-08-26-run-01',
      feedbackId: 'feedback-newer-123', submittedAt: '2026-08-25T21:00:00.000Z', rpe: 4,
    });
    const send = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue({ ok: true, status: 200 });
    const syncing = flushTrainingFeedbackQueue(storage, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    enqueueTrainingFeedback(storage, newer);
    release({ ok: true, status: 200 });
    const result = await syncing;
    expect(send.mock.calls.map(([item]) => item.feedbackId)).toEqual([valid().feedbackId, newer.feedbackId]);
    expect(result.synced).toHaveLength(2);
    expect(readFeedbackQueue(storage)).toEqual([]);
  });

  it('współdzieli trwający flush zamiast wysyłać ten sam wpis równolegle', async () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const send = vi.fn(() => pending);
    const first = flushTrainingFeedbackQueue(storage, send);
    const second = flushTrainingFeedbackQueue(storage, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    release({ ok: true, status: 200 });
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readFeedbackQueue(storage)).toEqual([]);
  });

  it.each([401, 422, 503])('wynik starego zapisu %s nie usuwa ani nie przywraca starszej wersji oceny', async (status) => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    const newer = valid({ feedbackId: 'feedback-newer-123', submittedAt: '2026-08-25T21:00:00.000Z', rpe: 4 });
    const send = vi.fn().mockImplementationOnce(async () => {
      enqueueTrainingFeedback(storage, newer);
      return { ok: false, status };
    }).mockResolvedValue({ ok: true, status: 200 });
    const result = await flushTrainingFeedbackQueue(storage, send);
    if (status === 422) {
      expect(result.rejected.map(({ feedback }) => feedback.feedbackId)).toEqual([valid().feedbackId]);
      expect(result.synced).toEqual([newer]);
      expect(send).toHaveBeenNthCalledWith(2, newer);
      expect(readFeedbackQueue(storage)).toEqual([]);
    } else {
      expect(readFeedbackQueue(storage)).toEqual([newer]);
      expect(result.remaining).toEqual([newer]);
    }
  });

  it('ponawia flush po błędzie sieci, bez zablokowania kolejki na zawsze', async () => {
    const storage = memoryStorage();
    enqueueTrainingFeedback(storage, valid());
    await flushTrainingFeedbackQueue(storage, vi.fn().mockRejectedValue(new Error('offline')));
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await flushTrainingFeedbackQueue(storage, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readFeedbackQueue(storage)).toEqual([]);
  });

  it('blokada przeglądarki obejmuje cały flush i odczyt aktualnej kolejki', async () => {
    const storage = memoryStorage();
    let locked = false;
    const newer = valid({ feedbackId: 'feedback-lock-123', submittedAt: '2026-08-25T21:00:00.000Z' });
    const locks = { request: vi.fn(async (name, run) => {
      expect(name).toBe(`${FEEDBACK_QUEUE_KEY}:flush`);
      enqueueTrainingFeedback(storage, newer);
      locked = true;
      try { return await run(); } finally { locked = false; }
    }) };
    const send = vi.fn(async () => {
      expect(locked).toBe(true);
      return { ok: true, status: 200 };
    });
    await flushTrainingFeedbackQueue(storage, send, { locks });
    expect(locks.request).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(newer);
    expect(readFeedbackQueue(storage)).toEqual([]);
  });

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
