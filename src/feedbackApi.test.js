import { describe, expect, it, vi } from 'vitest';
import { feedbackLogin, feedbackSessionStatus, sendTrainingFeedback } from './feedbackApi.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe('feedbackApi', () => {
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

  it('zamienia błąd sieci na kontrolowany status offline', async () => {
    expect(await sendTrainingFeedback({}, vi.fn().mockRejectedValue(new Error('offline'))))
      .toEqual({ ok: false, status: 0, error: 'offline' });
  });
});
