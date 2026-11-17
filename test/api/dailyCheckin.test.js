import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  allowedRequestOrigin: vi.fn(),
  serviceConfiguration: vi.fn(),
  consumeDailyCheckinRequest: vi.fn(),
  updateDailyCheckin: vi.fn(),
}));

vi.mock('../../api/_lib/session.js', () => ({
  authenticated: mocks.authenticated,
  allowedRequestOrigin: mocks.allowedRequestOrigin,
  serviceConfiguration: mocks.serviceConfiguration,
}));
vi.mock('../../api/_lib/dailyCheckinRateLimit.js', () => ({ consumeDailyCheckinRequest: mocks.consumeDailyCheckinRequest }));
vi.mock('../../api/_lib/googleSheets.js', () => ({ updateDailyCheckin: mocks.updateDailyCheckin }));

import handler from '../../api/daily-checkin.js';

function responseMock() {
  return {
    headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function request(overrides = {}) {
  return {
    method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
    body: {
      date: '2026-11-17', hrvOrthostatic: '56', hrLying: '48', hrStanding: '62', sleepHours: '7.5',
      wellbeing: 'GOOD', symptomsConfirmed: true,
      symptoms: { dizziness: false, palpitations: false, chestPain: false, illness: false },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_PASSCODE_SCRYPT', 'configured');
  vi.stubEnv('SESSION_SECRET', 'session-secret');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'service@example.test');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'private-key');
  vi.stubEnv('GOOGLE_SHEET_ID', 'sheet-id');
  mocks.authenticated.mockReturnValue(true);
  mocks.allowedRequestOrigin.mockReturnValue(true);
  mocks.serviceConfiguration.mockReturnValue({ configured: true, missing: [] });
  mocks.consumeDailyCheckinRequest.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.updateDailyCheckin.mockResolvedValue({ action: 'update', date: '2026-11-17', rowNumber: 108 });
});

afterEach(() => vi.unstubAllEnvs());

describe('/api/daily-checkin', () => {
  it('wymaga POST, dozwolonego Origin, konfiguracji i aktywnej sesji', async () => {
    const wrongMethod = responseMock();
    await handler(request({ method: 'GET' }), wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);

    mocks.allowedRequestOrigin.mockReturnValue(false);
    const wrongOrigin = responseMock();
    await handler(request(), wrongOrigin);
    expect(wrongOrigin.statusCode).toBe(403);
    mocks.allowedRequestOrigin.mockReturnValue(true);

    mocks.authenticated.mockReturnValue(false);
    const noSession = responseMock();
    await handler(request(), noSession);
    expect(noSession.statusCode).toBe(401);
  });

  it('odrzuca ruch po przekroczeniu trwałego limitu', async () => {
    mocks.consumeDailyCheckinRequest.mockResolvedValue({ allowed: false, retryAfterSeconds: 420 });
    const response = responseMock();
    await handler(request(), response);
    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('420');
    expect(mocks.updateDailyCheckin).not.toHaveBeenCalled();
  });

  it('waliduje dane, zapisuje check-in i zwraca numer wiersza', async () => {
    const response = responseMock();
    await handler(request(), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, action: 'update', date: '2026-11-17', rowNumber: 108 });
    expect(mocks.updateDailyCheckin).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-11-17', hrvOrthostatic: 56, hrLying: 48, hrStanding: 62, sleepMinutes: 450,
    }));
  });

  it('zwraca błędy pól bez próby zapisu arkusza', async () => {
    const response = responseMock();
    await handler(request({ body: { date: '2026-11-18', wellbeing: 'maybe' } }), response);
    expect(response.statusCode).toBe(422);
    expect(response.body.fields).toHaveProperty('date');
    expect(response.body.fields).toHaveProperty('wellbeing');
    expect(mocks.updateDailyCheckin).not.toHaveBeenCalled();
  });
});
