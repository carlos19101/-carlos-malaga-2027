import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sessionHandler from '../../api/session.js';
import feedbackHandler from '../../api/training-feedback.js';
import dataHandler from '../../api/data.js';
import tcxImportHandler from '../../api/tcx-import.js';
import { createPasscodeVerifier, createSessionToken, SESSION_COOKIE } from '../../api/_lib/session.js';

let passcodeVerifier;
let serviceAccountPrivateKey;

beforeAll(async () => {
  passcodeVerifier = await createPasscodeVerifier('Carlos-2027-passcode!', { salt: Buffer.alloc(16, 8) });
  serviceAccountPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
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
  vi.stubEnv('GOOGLE_PRIVATE_KEY', serviceAccountPrivateKey);
  vi.stubEnv('GOOGLE_SHEET_ID', 'sheet');
  vi.stubEnv('APP_ORIGIN', 'https://carlos-malaga-2027.vercel.app');
}

function loginProtectionFetch(rows = []) {
  return vi.fn(async (url, options = {}) => {
    const href = String(url);
    if (href === 'https://oauth2.googleapis.com/token') return jsonResponse(200, { access_token: 'login-token', expires_in: 3600 });
    if (href.includes('fields=sheets.properties')) return jsonResponse(200, { sheets: [{ properties: { title: 'Auth_Limits' } }] });
    if (href.includes('Auth_Limits') && (!options.method || options.method === 'GET')) {
      return jsonResponse(200, { values: [['Client_Key_HMAC', 'Window_Started_At', 'Failures', 'Blocked_Until', 'Updated_At'], ...rows] });
    }
    if (href.includes('Auth_Limits')) {
      if (new URL(href).searchParams.get('valueInputOption') !== 'RAW') return jsonResponse(400, { error: 'valueInputOption-required' });
      const values = JSON.parse(options.body).values;
      if (options.method === 'POST') rows.push(...values);
      else if (options.method === 'PUT') {
        const match = decodeURIComponent(href).match(/!A(\d+):E\d+/);
        if (!match) throw new Error('unexpected login limit range');
        rows[Number(match[1]) - 2] = values[0];
      }
      return jsonResponse(200, { updates: {} });
    }
    throw new Error(`unexpected fetch ${href}`);
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/api/session', () => {
  it('po dwóch błędnych próbach poprawne hasło zeruje istniejący licznik i loguje', async () => {
    configuredEnvironment();
    const rows = [];
    const fetchImpl = loginProtectionFetch(rows);
    vi.stubGlobal('fetch', fetchImpl);
    const request = (passcode) => ({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app', 'x-forwarded-for': '192.0.2.10' },
      body: { passcode },
    });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = responseMock();
      await sessionHandler(request('Carlos-2027-wrong!'), response);
      expect(response.statusCode).toBe(401);
      expect(rows).toHaveLength(1);
      expect(rows[0][2]).toBe(attempt);
    }
    const response = responseMock();
    await sessionHandler(request('Carlos-2027-passcode!'), response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Set-Cookie']).toContain('HttpOnly');
    expect(rows[0][2]).toBe(0);
  });

  it('GET jawnie raportuje brak konfiguracji', async () => {
    ['APP_PASSCODE_SCRYPT', 'SESSION_SECRET', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID']
      .forEach((name) => vi.stubEnv(name, ''));
    const response = responseMock();
    await sessionHandler({ method: 'GET', headers: {} }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, configured: false, authenticated: false });
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(response.headers['Referrer-Policy']).toBe('no-referrer');
  });

  it('POST z poprawnym passcode ustawia sesję HttpOnly', async () => {
    configuredEnvironment();
    vi.stubGlobal('fetch', loginProtectionFetch());
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
    vi.stubGlobal('fetch', loginProtectionFetch());
    const response = responseMock();
    await sessionHandler({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
      body: { passcode: 'Carlos-2027-wrong!' },
    }, response);
    expect(response.statusCode).toBe(401);
    expect(response.body.error).toBe('invalid-passcode');
    expect(response.headers['Set-Cookie']).toBeUndefined();
  });

  it('odrzuca zbyt duży sparsowany payload przed weryfikacją passcode', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
      body: { passcode: 'x'.repeat(1100) },
    }, response);
    expect(response.statusCode).toBe(413);
    expect(response.body.error).toBe('invalid-request');
  });

  it('odrzuca obcy Origin przed sprawdzeniem passcode', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({ method: 'POST', headers: { origin: 'https://evil.example' }, body: { passcode: 'Carlos-2027-passcode!' } }, response);
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toBe('origin-not-allowed');
  });

  it('DELETE czyści sesję tymi samymi bezpiecznymi atrybutami cookie', async () => {
    configuredEnvironment();
    const response = responseMock();
    await sessionHandler({
      method: 'DELETE', headers: { origin: 'https://carlos-malaga-2027.vercel.app' },
    }, response);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(response.headers['Set-Cookie']).toContain('HttpOnly');
    expect(response.headers['Set-Cookie']).toContain('Secure');
    expect(response.headers['Set-Cookie']).toContain('SameSite=Strict');
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
    expect(response.body.meta.serverDurationMs).toBeTypeOf('number');
    expect(Object.keys(response.body.tables)).toEqual(['feed', 'log', 'plan', 'raw']);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers['Server-Timing']).toMatch(/^app;dur=\d+$/);
  });
});

describe('/api/tcx-import', () => {
  it('wymaga dozwolonego Origin i podpisanej sesji', async () => {
    configuredEnvironment();
    const foreign = responseMock();
    await tcxImportHandler({ method: 'POST', headers: { origin: 'https://evil.example' }, body: {} }, foreign);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.error).toBe('origin-not-allowed');

    const anonymous = responseMock();
    await tcxImportHandler({
      method: 'POST', headers: { origin: 'https://carlos-malaga-2027.vercel.app' }, body: {},
    }, anonymous);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body.error).toBe('authentication-required');
  });

  it('odrzuca nieprawidłową kopertę przed połączeniem z Google', async () => {
    configuredEnvironment();
    const token = createSessionToken('session-secret-long-enough', { nonce: 'tcx-invalid' });
    const response = responseMock();
    await tcxImportHandler({
      method: 'POST',
      headers: {
        origin: 'https://carlos-malaga-2027.vercel.app',
        cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: { schema: 'unknown' },
    }, response);
    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({ ok: false, error: 'validation-error' });
  });
});
