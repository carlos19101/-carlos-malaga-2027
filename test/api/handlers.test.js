import { afterEach, describe, expect, it, vi } from 'vitest';
import sessionHandler from '../../api/session.js';
import feedbackHandler from '../../api/training-feedback.js';

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function configuredEnvironment() {
  vi.stubEnv('APP_PASSCODE', 'Carlos-2027!');
  vi.stubEnv('SESSION_SECRET', 'session-secret-long-enough');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'service@example.test');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'key');
  vi.stubEnv('GOOGLE_SHEET_ID', 'sheet');
  vi.stubEnv('APP_ORIGIN', 'https://carlos-malaga-2027.vercel.app');
}

afterEach(() => vi.unstubAllEnvs());

describe('/api/session', () => {
  it('GET jawnie raportuje brak konfiguracji', async () => {
    ['APP_PASSCODE', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
      .forEach((name) => vi.stubEnv(name, ''));
    const response = responseMock();
    await sessionHandler({ method: 'GET', headers: {} }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, configured: false, authenticated: false });
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('POST z poprawnym passcode ustawia sesję HttpOnly', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
      body: { passcode: 'Carlos-2027!' },
    }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, authenticated: true });
    expect(response.headers['Set-Cookie']).toContain('HttpOnly');
    expect(response.headers['Set-Cookie']).toContain('SameSite=Strict');
  });

  it('odrzuca obcy Origin przed sprawdzeniem passcode', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({ method: 'POST', headers: { origin: 'https://evil.example' }, body: { passcode: 'Carlos-2027!' } }, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toBe('origin-not-allowed');
  });
});

describe('/api/training-feedback', () => {
  it('nie próbuje łączyć się z Google bez konfiguracji', async () => {
    ['APP_PASSCODE', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
      .forEach((name) => vi.stubEnv(name, ''));
    const response = responseMock();
    await feedbackHandler({ method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' }, body: {} }, response);
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('feedback-not-configured');
  });

  it('przy konfiguracji wymaga podpisanej sesji', async () => {
    configuredEnvironment();
    const response = responseMock();
    await feedbackHandler({ method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' }, body: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toBe('authentication-required');
  });
});
