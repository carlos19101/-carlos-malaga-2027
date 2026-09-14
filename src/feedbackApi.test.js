import { describe, expect, it, vi } from 'vitest';
import { feedbackLogin, feedbackLogout, feedbackSessionStatus, retryAfterSeconds, sendTcxImport, sendTrainingFeedback } from './feedbackApi.js';
import { createTrainingFeedback, enqueueTrainingFeedback, flushTrainingFeedbackQueue, readFeedbackQueue } from './trainingFeedback.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('feedbackApi', () => {
  it.each([{}, { ok: 'true' }, { ok: 1 }, { ok: null }])('wymaga jawnego logicznego potwierdzenia serwera', async (body) => {
    expect(await sendTrainingFeedback({}, vi.fn().mockResolvedValue(response(200, body))))
      .toMatchObject({ ok: false, status: 200, error: 'invalid-response' });
  });
  it('błędna odpowiedź API zachowuje kolejkę, następna poprawna synchronizuje ten sam wpis', async () => {
    const entries = new Map();
    const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
    const feedback = createTrainingFeedback({ sessionId: '2026-09-14-run-01', rpe: 2, pain: 0, legFatigue: 1 });
    enqueueTrainingFeedback(storage, feedback);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(200, {})).mockResolvedValueOnce(response(200, { ok: true }));
    const send = (item) => sendTrainingFeedback(item, fetchImpl);
    expect((await flushTrainingFeedbackQueue(storage, send)).synced).toEqual([]);
    expect(readFeedbackQueue(storage)).toEqual([feedback]);
    expect((await flushTrainingFeedbackQueue(storage, send)).synced).toEqual([feedback]);
    expect(readFeedbackQueue(storage)).toEqual([]);
    expect(fetchImpl.mock.calls[0][1].body).toBe(fetchImpl.mock.calls[1][1].body);
  });
  it('rozpoznaje datę HTTP w Retry-After i odrzuca przeszły termin', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    expect(retryAfterSeconds(new Headers({ 'Retry-After': 'Mon, 14 Sep 2026 12:02:00 GMT' }), now)).toBe(120);
    expect(retryAfterSeconds(new Headers({ 'Retry-After': 'Mon, 14 Sep 2026 11:59:00 GMT' }), now)).toBeNull();
    expect(retryAfterSeconds(new Headers({ 'Retry-After': '-1' }), now)).toBeNull();
  });
  it.each([null, [], 'html'])('nie potwierdza zapisu dla niepoprawnego body', async (body) => {
    expect(await sendTrainingFeedback({}, vi.fn().mockResolvedValue(response(200, body)))).toMatchObject({ ok: false, error: 'invalid-response' });
  });
  it('nie potwierdza zapisu gdy JSON jest uszkodzony', async () => {
    expect(await sendTrainingFeedback({}, vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('JSON'); } }))).toMatchObject({ ok: false, error: 'invalid-response' });
  });
  it('kończy zawieszone sprawdzanie sesji i przerywa żądanie', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise(() => {}));
      const pending = feedbackSessionStatus(fetchImpl);
      await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toEqual({ ok: false, status: 0, error: 'timeout' });
      expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('obejmuje limitem również zawieszone odczytywanie body', async () => {
    vi.useFakeTimers();
    try {
      const pending = feedbackSessionStatus(vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => new Promise(() => {}),
      }));
      await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toMatchObject({ ok: false, error: 'timeout' });
    } finally { vi.useRealTimers(); }
  });

  it('usuwa timer po poprawnej odpowiedzi', async () => {
    vi.useFakeTimers();
    try {
      await feedbackSessionStatus(vi.fn().mockResolvedValue(response(200, { ok: true })));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('sprawdza sesję bez cache i z cookie same-origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, configured: true, authenticated: false }));
    expect(await feedbackSessionStatus(fetchImpl)).toMatchObject({ ok: true, status: 200, configured: true });
    expect(fetchImpl).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'GET', cache: 'no-store', credentials: 'same-origin',
    }));
  });

  it('wysyła passcode i feedback jako JSON', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, authenticated: true }))
      .mockResolvedValueOnce(response(200, { ok: true, action: 'update' }));
    expect(await feedbackLogin('sekret', fetchImpl)).toMatchObject({ ok: true, authenticated: true });
    expect(await sendTrainingFeedback({ sessionId: 'session-1' }, fetchImpl)).toMatchObject({ ok: true, action: 'update' });
    expect(fetchImpl.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: 'POST', body: JSON.stringify({ passcode: 'sekret' }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  it('wysyła wyłącznie kopertę TCX do prywatnego endpointu', async () => {
    const envelope = { schema: 'carlos.tcx-import.v1', sessionId: '2026-08-25-run-01' };
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true, action: 'noop' }));
    expect(await sendTcxImport(envelope, fetchImpl)).toMatchObject({ ok: true, action: 'noop' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/tcx-import', expect.objectContaining({
      method: 'POST', body: JSON.stringify(envelope), credentials: 'same-origin', cache: 'no-store',
    }));
  });

  it('zamienia błąd sieci na kontrolowany status offline', async () => {
    expect(await sendTrainingFeedback({}, vi.fn().mockRejectedValue(new Error('offline'))))
      .toEqual({ ok: false, status: 0, error: 'offline' });
  });

  it('przekazuje jawny czas ponownej próby po blokadzie logowania', async () => {
    const headers = new Headers({ 'Retry-After': '900' });
    const fetchImpl = vi.fn().mockResolvedValue({
      ...response(429, { ok: false, error: 'too-many-login-attempts' }),
      headers,
    });
    expect(await feedbackLogin('niepoprawne-haslo', fetchImpl)).toMatchObject({
      ok: false, status: 429, retryAfterSeconds: 900,
    });
    expect(retryAfterSeconds(new Headers({ 'Retry-After': 'nie-liczba' }))).toBeNull();
  });

  it('wylogowuje sesję żądaniem DELETE bez body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { ok: true }));
    expect(await feedbackLogout(fetchImpl)).toMatchObject({ ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'DELETE' }));
  });
});
