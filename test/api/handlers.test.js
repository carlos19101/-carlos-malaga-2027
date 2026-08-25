import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sessionHandler from '../../api/session.js';
import feedbackHandler from '../../api/training-feedback.js';
import dataHandler from '../../api/data.js';
import { createPasscodeVerifier, createSessionToken, SESSION_COOKIE } from '../../api/_lib/session.js';

let passcodeVerifier;

beforeAll(async () => {
  passcodeVerifier = await createPasscodeVerifier('Carlos-2027-passcode!', { salt: Buffer.alloc(16, 8) });
});

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function configuredEnvironment() {
  vi.stubEnv('APP_PASSCODE_SCRYPT', passcodeVerifier);
  vi.stubEnv('SESSION_SECRET', 'session-secret-long-enough');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'service@example.test');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'key');
  vi.stubEnv('GOOGLE_SHEET_ID', 'sheet');
  vi.stubEnv('APP_ORIGIN', 'https://carlos-malaga-2027.vercel.app');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/api/session', () => {
  it('GET jawnie raportuje brak konfiguracji', async () => {
    ['APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
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
      body: { passcode: 'Carlos-2027-passcode!' },
    }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, authenticated: true });
    expect(response.headers['Set-Cookie']).toContain('HttpOnly');
    expect(response.headers['Set-Cookie']).toContain('SameSite=Strict');
  });

  it('POST z błędnym passcode nie ustawia sesji', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
      body: { passcode: 'Carlos-2027-wrong!' },
    }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toBe('invalid-passcode');
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });

  it('odrzuca obcy Origin przed sprawdzeniem passcode', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({ method: 'POST', headers: { origin: 'https://evil.example' }, body: { passcode: 'Carlos-2027-passcode!' } }, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toBe('origin-not-allowed');
  });
});

describe('/api/training-feedback', () => {
  it('nie próbuje łączyć się z Google bez konfiguracji', async () => {
    ['APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
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

describe('/api/data', () => {
  it('jawnie odrzuca prywatny odczyt bez konfiguracji', async () => {
    ['APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
      .forEach((name) => vi.stubEnv(name, ''));
    const response = responseMock();
    await dataHandler({ method: 'GET', headers: {} }, response);
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('private-data-not-configured');
  });

  it('przy konfiguracji nie ujawnia danych bez sesji', async () => {
    configuredEnvironment();
    const response = responseMock();
    await dataHandler({ method: 'GET', headers: {} }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toBe('authentication-required');
  });

  it('nie dopuszcza metod innych niż GET', async () => {
    const response = responseMock();
    await dataHandler({ method: 'POST', headers: {} }, response);
    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe('GET');
  });

  it('z ważną sesją zwraca cztery prywatne tabele bez cache', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    configuredEnvironment();
    vi.stubEnv('GOOGLE_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'endpoint-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        valueRanges: ['feed', 'log', 'plan', 'raw'].map((key) => ({ values: [[key], ['value']] })),
      }));
    vi.stubGlobal('fetch', fetchImpl);
    const token = createSessionToken('session-secret-long-enough', { nonce: 'handler-test' });
    const response = responseMock();
    await dataHandler({ method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${token}` } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, transport: 'google-sheets-api' });
    expect(Object.keys(response.body.tables)).toEqual(['feed', 'log', 'plan', 'raw']);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });
});
